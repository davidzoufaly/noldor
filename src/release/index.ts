import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { loadConfigSync } from '../core/config.js';
import { loadConsumerConfig } from '../core/consumer-config.js';
import { noldorCliCommand } from '../core/noldor-cli.js';
import { fillAllNoldorMarkers } from '../core/release-markers.js';
import { blockingIds, recordOverrides, runPreflight } from './preflight.js';
import { SAFE_FIXES } from './preflight-fix.js';
import { renderPreflight } from './preflight-render.js';
import { classifyCommits, deriveBumpLevel, readCommitsSince } from './release-commits.js';
import { generateFdChangelogs } from './release-fd-changelog.js';
import { prependToChangelog, renderChangelogEntry } from './release-changelog.js';
import { fillAllMarkers } from './release-markers.js';
import {
  collectFeaturesForRelease,
  prependToReleaseNotes,
  renderReleaseNotesEntry,
} from './release-notes.js';
import { bumpAllPackages } from './release-packages.js';
import { withReleaseSession } from './release-session.js';
import { awaitPublish, isVersionOnRegistry, readPkgIdentity } from './release-publish.js';
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
const RELEASE_SURFACE_FILES = new Set([
  'CHANGELOG.md',
  'docs/release-notes.md',
  'docs/sdd-report.md',
]);
/** Release-owned directories (marker fills + noldor pages). */
const RELEASE_SURFACE_PREFIXES = ['docs/features/', 'docs/noldor/'];

/**
 * Finish an interrupted release from wherever it died. Check-then-act ladder
 * (commit → tag → push → GitHub Release → publish wait) driven ONLY by the state file written
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
    name?: string;
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
      !RELEASE_SURFACE_FILES.has(p) &&
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

  // Rung 7 — publish: opt-in (`release.publish.enabled`). The tag push from
  // rung 5 already triggered publish.yml — this rung only VERIFIES registry
  // visibility, it never publishes. Skip-if-done: the version already
  // resolves. A timeout throws BEFORE clearReleaseState, so the resume token
  // survives and the ladder stays re-runnable.
  const publishCfg = loadConfigSync(join(cwd, '.noldor/config.json'))?.release?.publish;
  if (publishCfg?.enabled) {
    const pkgName = pkg.name;
    if (!pkgName) {
      throw new Error('package.json has no name — cannot verify the registry publish.');
    }
    const probe = {
      pkgName,
      version: state.version,
      registry: publishCfg.registry,
      env: opts.env,
    };
    if (await isVersionOnRegistry(probe)) {
      console.log(`→ publish: ${pkgName}@${state.version} already on registry (skipped)`);
    } else {
      console.log(`→ publish: waiting for ${pkgName}@${state.version} on ${publishCfg.registry} …`);
      await awaitPublish(probe);
      console.log(`→ publish: ${pkgName}@${state.version} visible on ${publishCfg.registry}.`);
    }
  }

  clearReleaseState(cwd);
  console.log(`Resume complete: release ${tag} finished; state file cleared.`);
}

async function main(): Promise<void> {
  // Dispatch reshapes argv so this module sees
  // `node <modPath> [--resume] [--preflight] [--fix]`.
  const argv = new Set(process.argv.slice(2));
  const resume = argv.has('--resume');
  const preflightOnly = argv.has('--preflight');
  const wantFix = argv.has('--fix');

  // Refuse the combination rather than pick a winner by branch order. Checked
  // before the config load so a broken config cannot mask the flag conflict.
  if (preflightOnly && resume) {
    throw new Error(
      '--preflight and --resume are mutually exclusive: resume deliberately skips every ' +
        'precondition, so there is nothing for the aggregate to report. Run one or the other.',
    );
  }

  const { lockstepPackages, name: cfgName, scanPaths } = loadConsumerConfig();

  // --preflight reports and exits. It never enters withReleaseSession, so it
  // writes no session marker — and with `sddReportOut: 'temp'` it leaves no
  // tracked file changed either.
  if (preflightOnly) {
    const rows = await runPreflight({
      cwd: process.cwd(),
      scanPaths,
      nowMs: Date.now(),
      fixes: wantFix ? SAFE_FIXES : [],
    });
    console.log(renderPreflight(rows));
    // No recordOverrides here on purpose: --preflight releases nothing, so it
    // has no business appending to the release audit log.
    process.exitCode = blockingIds(rows).length > 0 ? 1 : 0;
    return;
  }

  // The aggregate IS the release's first rung, and it runs AHEAD of
  // withReleaseSession on purpose: that wrapper overwrites .noldor/session.json
  // with `release-automation` and clears it in a `finally`, so a session-marker
  // row evaluated inside it could never be blocking — and making the wrapper
  // non-asserting so the row *could* fire would let it overwrite-then-delete a
  // live gate session on a run that aborts anyway. Running first keeps the
  // marker intact and readable; the wrapper's own throw stays behind us as a
  // backstop for a marker that appears in the window between the two.
  //
  // `fixes` is limited to garden-receipt: that is the auto-restamp the pipeline
  // already performed here, and a release must never delete a session marker or
  // move the branch pointer on its own.
  if (!resume) {
    const rows = await runPreflight({
      cwd: process.cwd(),
      scanPaths,
      nowMs: Date.now(),
      fixes: ['garden-receipt'],
    });
    console.log(renderPreflight(rows));
    // Record RELEASE_SKIP_* bypasses once, here rather than inside the probes:
    // this is the release decision point, and probe evaluation stays read-only.
    for (const override of recordOverrides(rows, process.cwd())) {
      console.log(`→ release override recorded: ${override}`);
    }
    const blocking = blockingIds(rows);
    if (blocking.length > 0) {
      throw new Error(
        `Release preflight found ${blocking.length} blocking gate(s): ${blocking.join(', ')}. ` +
          'See the report above for each remedy.',
      );
    }
  }

  await withReleaseSession(process.cwd(), async () => {
    if (resume) {
      // Resume re-enters withReleaseSession (fresh release-automation marker
      // for the pre-commit hook) and skips every precondition, check, and
      // version derivation — the ladder trusts only the state file. The
      // aggregate is skipped too: a resumable run has a release-state file by
      // definition, so its `release-state` row would abort the very token that
      // authorizes the resume.
      await resumeRelease(process.cwd(), { lockstepPackages, name: cfgName });
      return;
    }

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
    await runOptionalCheck(scripts, 'build');

    // `validate features`, gate-compliance and the CR gate all moved into the
    // preflight aggregate above — one report instead of three sequential aborts.
    //
    // The sdd-report CHECK moved there too, but its in-place regen did not: the
    // aggregate compares against a temp file so that a run which aborts on an
    // earlier row cannot leave a rewritten tracked file behind. The canonical
    // regen therefore happens here, once the aggregate is green, so any
    // volatile-only drift lands in the working tree and rides the release
    // commit's `git add` list exactly as it always did. No drift check is needed
    // after it — the aggregate's `sdd-report` row already proved the report
    // matches modulo volatile sections.
    await runCliCheck('noldor garden sdd-report --release', ['garden', 'sdd-report', '--release']);

    const previousTag = await findPreviousTag();
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

    // Publish-verification rung — opt-in via `release.publish.enabled`
    // (default false: consumers running this vendored pipeline never touch
    // npm). The v-tag push above already fired publish.yml; this rung only
    // waits for registry visibility. It runs BEFORE clearReleaseState so a
    // publish failure leaves the resume token — the operator lands in
    // `pnpm release --resume` (rung 7), never in half-released limbo.
    const publishCfg = loadConfigSync()?.release?.publish;
    if (publishCfg?.enabled) {
      const pkgName = readPkgIdentity(process.cwd()).name;
      console.log(
        `→ publish: waiting for ${pkgName}@${newVersion} on ${publishCfg.registry} ` +
          `(dist-tag ${publishCfg.distTag}) …`,
      );
      const { elapsedMs } = await awaitPublish({
        pkgName,
        version: newVersion,
        registry: publishCfg.registry,
      });
      console.log(
        `→ publish: ${pkgName}@${newVersion} visible after ${Math.round(elapsedMs / 1000)}s.`,
      );
    }
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
