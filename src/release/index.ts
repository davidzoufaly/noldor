import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { loadConsumerConfig } from '../core/consumer-config.js';
import { noldorCliCommand } from '../core/noldor-cli.js';
import { appendOverrideLog } from '../core/overrides-log.js';
import { ensureGardenFresh } from '../garden/garden-receipt.js';
import { autoStampOnCleanDetect } from './auto-restamp.js';
import { ensureGraphFresh } from './graph-freshness.js';
import { fillAllNoldorMarkers } from '../core/release-markers.js';
import { classifyCommits, deriveBumpLevel, readCommitsSince } from './release-commits.js';
import { checkCrGate } from './release-cr-gate.js';
import { generateFdChangelogs } from './release-fd-changelog.js';
import { prependToChangelog, renderChangelogEntry } from './release-changelog.js';
import { onlyReviewSkipCountChanged } from './sdd-report-diff.js';
import { fillAllMarkers } from './release-markers.js';
import {
  collectFeaturesForRelease,
  prependToReleaseNotes,
  renderReleaseNotesEntry,
} from './release-notes.js';
import { bumpAllPackages } from './release-packages.js';
import { withReleaseSession } from './release-session.js';
import { clearReleaseState, readReleaseState, writeReleaseState } from './release-state.js';
import { applyBump, findPreviousTag, getRepoUrl } from './release-version.js';

const execFileP = promisify(execFile);

async function run(
  cmd: string,
  args: string[],
  opts: { captureOutput?: boolean; env?: Record<string, string>; cwd?: string } = {},
): Promise<string> {
  const env = opts.env ? { ...process.env, ...opts.env } : process.env;
  const { stdout, stderr } = await execFileP(cmd, args, { env, cwd: opts.cwd });
  if (!opts.captureOutput && stderr) {
    process.stderr.write(stderr);
  }
  return stdout.trim();
}

async function ensureCleanTreeOnMain(): Promise<void> {
  const branch = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') {
    throw new Error(`Release must be run from main branch (currently on ${branch}).`);
  }
  const status = await run('git', ['status', '--porcelain']);
  if (status.length > 0) {
    throw new Error('Working tree is not clean. Commit or stash first.');
  }
  await run('git', ['fetch', 'origin', 'main']);
  const local = await run('git', ['rev-parse', 'HEAD']);
  const remote = await run('git', ['rev-parse', 'origin/main']);
  if (local !== remote) {
    throw new Error('Local main is not up to date with origin/main.');
  }
}

async function ensureGhAvailable(): Promise<void> {
  try {
    await run('gh', ['--version']);
    await run('gh', ['auth', 'status']);
  } catch {
    throw new Error(
      'gh CLI missing or unauthenticated. Install from https://cli.github.com/ and run `gh auth login`.',
    );
  }
}

async function runCheck(label: string, cmd: string, args: string[]): Promise<void> {
  console.log(`→ ${label}`);
  await run(cmd, args);
}

/** Load the consumer's package.json `scripts` map (empty if none). */
async function consumerScripts(): Promise<Record<string, string>> {
  try {
    const pkg = JSON.parse(await readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

/**
 * Run `pnpm <name> [...args]` only if the consumer declares that script.
 * Keeps the pipeline consumer-agnostic: a repo with `test:e2e` runs it; a
 * single-package repo without one skips it loudly. Returns whether it ran.
 */
async function runOptionalCheck(
  scripts: Record<string, string>,
  name: string,
  args: string[] = [],
): Promise<boolean> {
  if (!scripts[name]) {
    console.log(`→ pnpm ${name} (skipped — not declared in package.json)`);
    return false;
  }
  await runCheck(`pnpm ${name}`, 'pnpm', [name, ...args]);
  return true;
}

/** Run a framework check through the noldor CLI (always available). */
async function runCliCheck(label: string, cliArgs: string[]): Promise<void> {
  const [cmd, args] = noldorCliCommand(cliArgs);
  console.log(`→ ${label}`);
  await run(cmd, args);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function extractLatestReleaseNotes(cwd: string = process.cwd()): Promise<string> {
  const raw = await readFile(join(cwd, 'docs/release-notes.md'), 'utf8');
  const entries = raw.split(/^## /m).slice(1);
  if (entries.length === 0) {
    throw new Error('Release notes empty.');
  }
  return `## ${entries[0].trimEnd()}`;
}

/**
 * Normal-path guard: a leftover release-state file means an earlier run died
 * mid-release. Re-running the full pipeline would reject on the dirty tree —
 * or, after a manual commit, re-derive the WRONG version because the release
 * commit itself would enter the bump window — so name the two valid moves.
 */
export function assertNoInProgressRelease(cwd: string): void {
  const state = readReleaseState(cwd);
  if (state === null) return;
  throw new Error(
    `In-progress release v${state.version} detected (.noldor/release-state.json). ` +
      'Run `pnpm release --resume` to finish it, or discard with ' +
      '`git reset --hard && rm .noldor/release-state.json`.',
  );
}

/** Options for {@link resumeRelease}. `main()` fills these from the consumer config. */
export interface ResumeOptions {
  /** Same lockstep list the normal-path `git add` stages. */
  lockstepPackages: string[];
  /** Consumer name — names the release-notes temp file, as on the normal path. */
  name: string;
  /** Extra env for every spawned command (tests prepend a fake-gh PATH). */
  env?: Record<string, string>;
}

/** Exact release-owned files the pipeline mutates and commits. */
const RELEASE_SURFACE_FILES = ['CHANGELOG.md', 'docs/release-notes.md', 'docs/sdd-report.md'];
/** Release-owned directories (marker fills + noldor pages). */
const RELEASE_SURFACE_PREFIXES = ['docs/features/', 'docs/noldor/'];

/**
 * Finish an interrupted release from wherever it died. Check-then-act ladder
 * (commit → tag → push → GitHub Release) driven ONLY by the state file written
 * at the mutation boundary — it never re-derives the version and never re-runs
 * checks (the tree is byte-identical to when they passed; the shape check and
 * version cross-check catch external tampering). Safe to re-run after a
 * partial resume: every rung skips when its outcome already exists.
 */
export async function resumeRelease(cwd: string, opts: ResumeOptions): Promise<void> {
  const runIn = (
    cmd: string,
    args: string[],
    extra: { captureOutput?: boolean; env?: Record<string, string> } = {},
  ): Promise<string> => run(cmd, args, { ...extra, cwd, env: { ...opts.env, ...extra.env } });

  // Rung 1 — load + verify state. Branch must be main; the working-tree
  // version must still equal the state version (guards a stale token left
  // behind by an unrelated manual reset). Deliberately NO clean-tree or
  // origin-sync check — the tree is intentionally dirty mid-release.
  const state = readReleaseState(cwd);
  if (state === null) {
    throw new Error('Nothing to resume: .noldor/release-state.json not found.');
  }
  const branch = await runIn('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') {
    throw new Error(`Resume must run from main branch (currently on ${branch}).`);
  }
  const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as {
    version?: string;
  };
  if (pkg.version !== state.version) {
    throw new Error(
      `Version mismatch: package.json has ${pkg.version ?? 'no version'} but ` +
        `.noldor/release-state.json expects ${state.version}. The tree no longer matches the ` +
        'in-progress release — discard with `git reset --hard && rm .noldor/release-state.json`.',
    );
  }

  // Rung 2 — shape check: every dirty path must be release-owned. Never guess.
  // run() trims stdout, so the first line may have lost the leading space of
  // its two-char XY status column — strip the status token by pattern, not by
  // fixed offset.
  const porcelain = await runIn('git', ['status', '--porcelain']);
  const dirty = porcelain
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.trimStart().replace(/^\S+\s+/, ''));
  const offenders = dirty.filter(
    (p) =>
      !RELEASE_SURFACE_FILES.includes(p) &&
      !opts.lockstepPackages.includes(p) &&
      !RELEASE_SURFACE_PREFIXES.some((prefix) => p.startsWith(prefix)),
  );
  if (offenders.length > 0) {
    throw new Error(
      `Dirty paths outside the release surface: ${offenders.join(', ')}. ` +
        'Refusing to fold them into the release commit. Clean them up, or discard the ' +
        'in-progress release with `git reset --hard && rm .noldor/release-state.json`.',
    );
  }
  // Rung 3 — commit: skip when HEAD already carries the release subject
  // (same subject + `git add` list as the normal path). Runs inside
  // withReleaseSession, so the pre-commit hook sees a fresh
  // release-automation marker.
  const subject = `chore(release): v${state.version}`;
  const headSubject = await runIn('git', ['log', '-1', '--format=%s']);
  if (headSubject === subject) {
    console.log(`→ commit: HEAD is already "${subject}" (skipped)`);
  } else {
    await runIn('git', [
      'add',
      'CHANGELOG.md',
      'docs/release-notes.md',
      'docs/sdd-report.md',
      'docs/features',
      'docs/noldor',
      ...opts.lockstepPackages,
    ]);
    await runIn('git', ['commit', '-m', subject]);
    console.log(`→ commit: created "${subject}"`);
  }

  // Rung 4 — tag: skip when the tag already exists.
  const tag = `v${state.version}`;
  let tagExists = true;
  try {
    await runIn('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], {
      captureOutput: true,
    });
  } catch {
    tagExists = false;
  }
  if (tagExists) {
    console.log(`→ tag: ${tag} already exists (skipped)`);
  } else {
    await runIn('git', ['tag', '-a', tag, '-m', tag]);
    console.log(`→ tag: created ${tag}`);
  }
  // Rung 5 — push: skip when origin/main already equals HEAD after a fetch
  // (same rev-parse pair as ensureCleanTreeOnMain). Push carries the
  // release-automation env stamp exactly like the normal path.
  await runIn('git', ['fetch', 'origin', 'main']);
  const local = await runIn('git', ['rev-parse', 'HEAD']);
  const remote = await runIn('git', ['rev-parse', 'origin/main']);
  if (local === remote) {
    console.log('→ push: origin/main already at HEAD (skipped)');
  } else {
    await runIn('git', ['push', '--follow-tags', 'origin', 'main'], {
      env: { NOLDOR_RELEASE_PUSH: '1' },
    });
    console.log('→ push: pushed commit + tag');
  }

  // Rung 6 — GitHub Release: skip when it already exists.
  let releaseExists = true;
  try {
    await runIn('gh', ['release', 'view', tag], { captureOutput: true });
  } catch {
    releaseExists = false;
  }
  if (releaseExists) {
    console.log(`→ gh release: ${tag} already exists (skipped)`);
  } else {
    const notesBody = await extractLatestReleaseNotes(cwd);
    const notesTmp = `/tmp/${opts.name}-release-notes-${tag}.md`;
    await writeFile(notesTmp, notesBody, 'utf8');
    await runIn('gh', [
      'release',
      'create',
      tag,
      '--notes-file',
      notesTmp,
      '--latest',
      '--title',
      tag,
    ]);
    console.log(`→ gh release: created ${tag}`);
  }

  clearReleaseState(cwd);
  console.log(`Resume complete: release ${tag} finished; state file cleared.`);
}

async function main(): Promise<void> {
  await withReleaseSession(process.cwd(), async () => {
    const { lockstepPackages, name: cfgName, scanPaths } = loadConsumerConfig();
    assertNoInProgressRelease(process.cwd());
    await ensureCleanTreeOnMain();
    await ensureGhAvailable();
    await ensureGraphFresh(scanPaths);
    await autoStampOnCleanDetect({ cwd: process.cwd() });
    ensureGardenFresh(process.cwd(), scanPaths);

    // Consumer-defined quality gates run only when declared — keeps the
    // pipeline portable across single-package and monorepo consumers.
    const scripts = await consumerScripts();
    await runOptionalCheck(scripts, 'typecheck');
    await runOptionalCheck(scripts, 'test');
    await runOptionalCheck(scripts, 'test:smoke');
    await runOptionalCheck(scripts, 'test:e2e');
    const builtDocs = await runOptionalCheck(scripts, 'docs:build');
    if (builtDocs) {
      const dirtyDocs = await run('git', ['status', '--porcelain', 'docs/user/']);
      if (dirtyDocs.length > 0) {
        throw new Error(
          'docs/user/ has uncommitted changes after pnpm docs:build. ' +
            'Commit the regenerated docs before releasing.',
        );
      }
    }
    // Framework checks always run via the noldor CLI.
    await runCliCheck('noldor garden sdd-report --release', ['garden', 'sdd-report', '--release']);
    const dirtyReport = await run('git', ['status', '--porcelain', 'docs/sdd-report.md']);
    if (dirtyReport.length > 0) {
      let baseline: string | null = null;
      try {
        baseline = await run('git', ['show', 'HEAD:docs/sdd-report.md'], { captureOutput: true });
      } catch {
        // No committed baseline (first release / file untracked) — nothing to
        // compare against, so fall through to the abort below.
        baseline = null;
      }
      const working = (await readFile('docs/sdd-report.md', 'utf8')).trim();
      if (baseline !== null && onlyReviewSkipCountChanged(baseline, working)) {
        console.log(
          '→ docs/sdd-report.md differs only in the review-skip count line; ' +
            'folding regen into the release commit.',
        );
      } else {
        throw new Error(
          'docs/sdd-report.md has uncommitted changes after sdd-report regen. ' +
            'Commit the regenerated report before releasing.',
        );
      }
    }
    await runOptionalCheck(scripts, 'build');
    await runCliCheck('noldor validate features', ['validate', 'features']);
    if (process.env.RELEASE_SKIP_GATE_COMPLIANCE === '1') {
      appendOverrideLog(process.cwd(), 'RELEASE_SKIP_GATE_COMPLIANCE=1', 'release');
      console.log(
        '→ noldor garden detect --gate-compliance (SKIPPED via RELEASE_SKIP_GATE_COMPLIANCE=1)',
      );
    } else {
      await runCliCheck('noldor garden detect --gate-compliance', [
        'garden',
        'detect',
        '--gate-compliance',
      ]);
    }

    const previousTag = await findPreviousTag();
    if (previousTag !== 'v0.0.0') {
      if (process.env.RELEASE_SKIP_CR_GATE === '1') {
        appendOverrideLog(process.cwd(), 'RELEASE_SKIP_CR_GATE=1', 'release');
        console.log('→ release CR gate (SKIPPED via RELEASE_SKIP_CR_GATE=1)');
      } else {
        const crGate = checkCrGate({ from: previousTag, to: 'HEAD', cwd: process.cwd() });
        if (!crGate.ok) {
          console.error('Release CR gate failed:');
          console.error(crGate.reason ?? '');
          process.exit(1);
        }
      }
    }
    console.log(`Previous tag: ${previousTag}`);

    const commits = await readCommitsSince(previousTag, 'HEAD');
    if (commits.length === 0) {
      console.log('No commits since previous tag — nothing to release.');
      process.exitCode = 1;
      return;
    }

    const bumpLevel = deriveBumpLevel(commits);
    if (bumpLevel === null) {
      throw new Error('Could not derive bump level from commits.');
    }
    console.log(`Bump level: ${bumpLevel}`);

    const previousVersion = previousTag.replace(/^v/, '');
    const newVersion = applyBump(previousVersion, bumpLevel);
    console.log(`New version: v${newVersion}`);

    if (process.env.NOLDOR_RELEASE_DRY_RUN === '1') {
      console.log(
        `\n[dry-run] Preconditions + checks passed. Would bump ${previousTag} → v${newVersion} ` +
          `from ${commits.length} commit(s). No files written, no tag, no push.`,
      );
      return;
    }

    const releaseDate = todayIso();
    // The run now commits to mutating files — drop the resume token first so a
    // death anywhere between here and the GitHub Release leaves it behind.
    writeReleaseState(process.cwd(), {
      version: newVersion,
      previousTag,
      date: releaseDate,
      startedAt: new Date().toISOString(),
    });
    const repoUrl = await getRepoUrl();

    const changelogBlocks = await generateFdChangelogs({
      featuresDir: 'docs/features',
      previousTag,
      newVersion,
      date: releaseDate,
      repoUrl,
    });
    console.log(`Generated changelog blocks for ${changelogBlocks.size} feature MD(s).`);

    const markerTouched = await fillAllMarkers(newVersion, new Set(changelogBlocks.keys()));
    console.log(`Filled markers on ${markerTouched.length} feature MD(s).`);

    const noldorTouched = await fillAllNoldorMarkers(newVersion);
    if (noldorTouched.length > 0) {
      console.log(`Filled introduced on ${noldorTouched.length} Noldor page(s):`);
      for (const p of noldorTouched) console.log(`  ${p}`);
    }

    await runCliCheck('noldor validate features (post-marker-fill)', ['validate', 'features']);

    const packagesTouched = await bumpAllPackages(newVersion);
    console.log(`Bumped ${packagesTouched.length} package.json(s).`);

    const classified = classifyCommits(commits);
    const date = releaseDate;

    const changelogEntry = renderChangelogEntry({
      date,
      repoUrl,
      version: newVersion,
      ...classified,
    });
    const changelogExisting = await readFile('CHANGELOG.md', 'utf8').catch(() => '');
    await writeFile('CHANGELOG.md', prependToChangelog(changelogExisting, changelogEntry), 'utf8');
    console.log('Wrote CHANGELOG.md entry.');

    const releaseFeatures = await collectFeaturesForRelease(newVersion, changelogBlocks);
    const releaseNotesEntry = await renderReleaseNotesEntry({
      date,
      features: releaseFeatures,
      version: newVersion,
    });
    const releaseNotesExisting = await readFile('docs/release-notes.md', 'utf8').catch(() => '');
    await writeFile(
      'docs/release-notes.md',
      prependToReleaseNotes(releaseNotesExisting, releaseNotesEntry),
      'utf8',
    );
    console.log('Wrote docs/release-notes.md entry.');

    await runOptionalCheck(scripts, 'fmt');

    await run('git', [
      'add',
      'CHANGELOG.md',
      'docs/release-notes.md',
      'docs/sdd-report.md',
      'docs/features',
      'docs/noldor',
      ...lockstepPackages,
    ]);
    await run('git', ['commit', '-m', `chore(release): v${newVersion}`]);
    await run('git', ['tag', '-a', `v${newVersion}`, '-m', `v${newVersion}`]);
    console.log(`Created commit + tag v${newVersion}.`);

    await run('git', ['push', '--follow-tags', 'origin', 'main'], {
      env: { NOLDOR_RELEASE_PUSH: '1' },
    });
    console.log('Pushed commit + tag.');

    const notesBody = await extractLatestReleaseNotes();
    const notesTmp = `/tmp/${cfgName}-release-notes-v${newVersion}.md`;
    await writeFile(notesTmp, notesBody, 'utf8');
    await run('gh', [
      'release',
      'create',
      `v${newVersion}`,
      '--notes-file',
      notesTmp,
      '--latest',
      '--title',
      `v${newVersion}`,
    ]);
    console.log(`Created GitHub Release v${newVersion}.`);
    clearReleaseState(process.cwd());
  });
}

// Execute only when dispatched as the CLI entrypoint (`noldor release run`
// reshapes argv so argv[1] is this module's path). Importing this module in
// tests must NOT fire a release run.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nRelease aborted: ${message}`);
    process.exitCode = 1;
  });
}
