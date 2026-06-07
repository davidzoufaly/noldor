import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { loadConsumerConfig } from '../core/consumer-config.js';
import { noldorCliCommand } from '../core/noldor-cli.js';
import { ensureGardenFresh } from '../garden/garden-receipt.js';
import { autoStampOnCleanDetect } from './auto-restamp.js';
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
import { applyBump, findPreviousTag, getRepoUrl } from './release-version.js';

const execFileP = promisify(execFile);

async function run(
  cmd: string,
  args: string[],
  opts: { captureOutput?: boolean; env?: Record<string, string> } = {},
): Promise<string> {
  const env = opts.env ? { ...process.env, ...opts.env } : process.env;
  const { stdout, stderr } = await execFileP(cmd, args, { env });
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

/**
 * Knowledge-graph freshness gate. Graphify is OPTIONAL — a consumer that does
 * not track `graphify-out/graph.json` skips the check entirely. When a graph
 * IS tracked, it must postdate the latest commit under the configured
 * `scanPaths` (the SDD detectors read the graph; a stale graph ships degraded
 * meta-gaps in the report).
 */
async function ensureGraphFresh(scanPaths: string[]): Promise<void> {
  const graphTs = await run('git', ['log', '-1', '--format=%ct', '--', 'graphify-out/graph.json']);
  if (graphTs.length === 0) {
    console.log('→ graph freshness (skipped — no graphify-out/graph.json tracked)');
    return;
  }
  if (scanPaths.length === 0) return;
  const srcTs = await run('git', ['log', '-1', '--format=%ct', '--', ...scanPaths]);
  if (srcTs.length > 0 && Number(srcTs) > Number(graphTs)) {
    throw new Error(
      'Knowledge graph is stale: source files were committed after graphify-out/graph.json. ' +
        'Regenerate the graph (/graphify) and commit it before releasing.',
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

async function extractLatestReleaseNotes(): Promise<string> {
  const raw = await readFile('docs/release-notes.md', 'utf8');
  const entries = raw.split(/^## /m).slice(1);
  if (entries.length === 0) {
    throw new Error('Release notes empty.');
  }
  return `## ${entries[0].trimEnd()}`;
}

async function main(): Promise<void> {
  await withReleaseSession(process.cwd(), async () => {
    const { lockstepPackages, name: cfgName, scanPaths } = loadConsumerConfig();
    await ensureCleanTreeOnMain();
    await ensureGhAvailable();
    await ensureGraphFresh(scanPaths);
    await autoStampOnCleanDetect({ cwd: process.cwd() });
    ensureGardenFresh();

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
        console.log('→ Codex CR gate (SKIPPED via RELEASE_SKIP_CR_GATE=1)');
      } else {
        const crGate = checkCrGate({ from: previousTag, to: 'HEAD', cwd: process.cwd() });
        if (!crGate.ok) {
          console.error('Codex CR gate failed:');
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
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nRelease aborted: ${message}`);
  process.exitCode = 1;
});
