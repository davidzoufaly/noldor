import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { ensureGardenFresh } from '../garden/garden-receipt.js';
import { autoStampOnCleanDetect } from './auto-restamp.js';
import { fillAllNoldorMarkers } from '../core/release-markers.js';
import { classifyCommits, deriveBumpLevel, readCommitsSince } from './release-commits.js';
import { checkCrGate } from './release-cr-gate.js';
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
import { applyBump, findPreviousTag, getRepoUrl } from './release-version.js';

const execFileP = promisify(execFile);

const LOCKSTEP_PACKAGES = [
  'package.json',
  'apps/web/package.json',
  'packages/format/package.json',
  'packages/engine/package.json',
  'packages/viewport/package.json',
  'packages/test-fixtures/package.json',
  'packages/examples/package.json',
] as const;

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

async function ensureGraphFresh(): Promise<void> {
  const graphTs = await run('git', ['log', '-1', '--format=%ct', '--', 'graphify-out/graph.json']);
  if (graphTs.length === 0) {
    throw new Error(
      'graphify-out/graph.json has no git history. Run the pre-release sweep: /graphify → pnpm toon → /refactor → /graphify → pnpm toon, then commit.',
    );
  }
  // Match the SDD detectors' src roots (`packages`, `apps`, `scripts`) — see
  // `scripts/garden/sdd-report.ts` `ReportInput.graphSrcRoots`. A
  // `scripts/`-only change still invalidates the import graph that
  // detectors 9/10/13 rely on; without this check the release would ship
  // with stale graph + degraded-mode meta-gaps in the report.
  const srcTs = await run('git', [
    'log',
    '-1',
    '--format=%ct',
    '--',
    'apps/',
    'packages/',
    'scripts/',
  ]);
  if (srcTs.length > 0 && Number(srcTs) > Number(graphTs)) {
    throw new Error(
      'Knowledge graph is stale: src files were committed after graphify-out/graph.json. ' +
        'Run the pre-release sweep before releasing: /graphify → pnpm toon → /refactor against ' +
        'graphify-out/GRAPH_REPORT.md → /graphify → pnpm toon again, then commit and re-run pnpm release.',
    );
  }
}

async function runCheck(label: string, cmd: string, args: string[]): Promise<void> {
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
    await ensureCleanTreeOnMain();
    await ensureGhAvailable();
    await ensureGraphFresh();
    await autoStampOnCleanDetect({ cwd: process.cwd() });
    ensureGardenFresh();

    await runCheck('pnpm typecheck', 'pnpm', ['typecheck']);
    await runCheck('pnpm test', 'pnpm', ['test']);
    await runCheck('pnpm test:smoke', 'pnpm', ['test:smoke']);
    await runCheck('pnpm test:e2e', 'pnpm', ['test:e2e']);
    await runCheck('pnpm docs:build', 'pnpm', ['docs:build']);
    const dirtyDocs = await run('git', ['status', '--porcelain', 'docs/user/']);
    if (dirtyDocs.length > 0) {
      throw new Error(
        'docs/user/ has uncommitted changes after pnpm docs:build. ' +
          'Commit the regenerated docs before releasing.',
      );
    }
    await runCheck('pnpm sdd:report --release', 'pnpm', ['sdd:report', '--release']);
    const dirtyReport = await run('git', ['status', '--porcelain', 'docs/sdd-report.md']);
    if (dirtyReport.length > 0) {
      throw new Error(
        'docs/sdd-report.md has uncommitted changes after pnpm sdd:report. ' +
          'Commit the regenerated report before releasing.',
      );
    }
    await runCheck('pnpm build', 'pnpm', ['build']);
    await runCheck('pnpm validate:features', 'pnpm', ['validate:features']);
    if (process.env.RELEASE_SKIP_GATE_COMPLIANCE === '1') {
      console.log(
        '→ pnpm garden:detect --gate-compliance (SKIPPED via RELEASE_SKIP_GATE_COMPLIANCE=1)',
      );
    } else {
      await runCheck('pnpm garden:detect --gate-compliance', 'pnpm', [
        'garden:detect',
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

    await runCheck('pnpm validate:features (post-marker-fill)', 'pnpm', ['validate:features']);

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

    await runCheck('pnpm fmt (post-write)', 'pnpm', ['fmt']);

    await run('git', [
      'add',
      'CHANGELOG.md',
      'docs/release-notes.md',
      'docs/features',
      'docs/noldor',
      ...LOCKSTEP_PACKAGES,
    ]);
    await run('git', ['commit', '-m', `chore(release): v${newVersion}`]);
    await run('git', ['tag', '-a', `v${newVersion}`, '-m', `v${newVersion}`]);
    console.log(`Created commit + tag v${newVersion}.`);

    await run('git', ['push', '--follow-tags', 'origin', 'main'], {
      env: { NOLDOR_RELEASE_PUSH: '1' },
    });
    console.log('Pushed commit + tag.');

    const notesBody = await extractLatestReleaseNotes();
    const notesTmp = `/tmp/charuy-release-notes-v${newVersion}.md`;
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
