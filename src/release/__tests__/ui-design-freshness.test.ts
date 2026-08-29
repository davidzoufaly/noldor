// @tests: pendev-ui-design-phase
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { digestBytes, receiptRelPath } from '../../design/ui-capture.js';
import { runProbe, type ProbeContext } from '../preflight-probes.js';
import { classifyAncestry, evaluateUiDesignFreshness } from '../ui-design-freshness.js';

const exec = (cmd: string, args: string[], cwd: string, env?: Record<string, string>) =>
  new Promise<string>((resolve, reject) => {
    execFile(cmd, args, { cwd, env: { ...process.env, ...env } }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.toString());
    });
  });

/** A throwaway git repo plus its own commit clock, so both suites below share
 * one harness instead of each re-implementing `git init` + dated commits. */
interface Repo {
  cwd: string;
  epoch: number;
}

async function initRepo(prefix: string): Promise<Repo> {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  await exec('git', ['init', '-q'], cwd);
  await exec('git', ['config', 'user.email', 't@e'], cwd);
  await exec('git', ['config', 'user.name', 't'], cwd);
  return { cwd, epoch: 1000 };
}

/** Commit at a fixed, advancing date so ancestry — not wall-clock — decides. */
async function commitAt(repo: Repo, msg: string): Promise<void> {
  repo.epoch += 100;
  await exec('git', ['add', '-A'], repo.cwd);
  await exec('git', ['commit', '-q', '-m', msg], repo.cwd, {
    GIT_AUTHOR_DATE: `@${repo.epoch} +0000`,
    GIT_COMMITTER_DATE: `@${repo.epoch} +0000`,
  });
}

async function commitFiles(repo: Repo, paths: string[], msg: string): Promise<void> {
  for (const path of paths) {
    const abs = join(repo.cwd, path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, `${msg}\n`, 'utf8');
  }
  await commitAt(repo, msg);
}

/** Minimal `.noldor/config.json` whose consumer block declares `uiPaths`. */
async function writeUiConfig(cwd: string, uiPaths: string[]): Promise<void> {
  await mkdir(join(cwd, '.noldor'), { recursive: true });
  await writeFile(
    join(cwd, '.noldor/config.json'),
    JSON.stringify({
      consumer: {
        name: 'x',
        repoUrl: 'https://example.com/x',
        lockstepPackages: ['x'],
        e2ePrefix: 'e2e',
        samplesPath: 'samples',
        packagePrefix: '@x/',
        appPathPrefix: 'apps/',
        uiPaths,
      },
    }),
    'utf8',
  );
}

describe('classifyAncestry', () => {
  it('fresh when UI commit is ancestor of (or equal to) baseline commit', () => {
    expect(classifyAncestry(true, false)).toBe('fresh');
    expect(classifyAncestry(true, true)).toBe('fresh'); // U == B: both directions true
  });
  it('stale when baseline is strictly behind the UI commit', () => {
    expect(classifyAncestry(false, true)).toBe('stale');
  });
  it('skipped when neither is an ancestor (unrelated / diverged / shallow-cut)', () => {
    expect(classifyAncestry(false, false)).toBe('skipped');
  });
});

describe('evaluateUiDesignFreshness', () => {
  let repo: Repo;
  let cwd: string;

  beforeEach(async () => {
    repo = await initRepo('ui-fresh-');
    cwd = repo.cwd;
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  const commit = (paths: string[], msg: string) => commitFiles(repo, paths, msg);

  /**
   * Commit a capture receipt for `surface`, bound to whatever its baseline
   * currently holds. `digest` overrides the binding so a test can express a
   * receipt committed WITHOUT its baseline.
   */
  async function commitReceipt(surface: string, msg: string, digest?: string): Promise<void> {
    const baseline = join(cwd, `docs/design/ui/baseline/${surface}.pen`);
    const bound = digest ?? digestBytes(await readFile(baseline));
    const rel = receiptRelPath(surface);
    const abs = join(cwd, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(
      abs,
      `${JSON.stringify({ capturedAt: new Date(repo.epoch * 1000).toISOString(), baselineDigest: bound, command: 'pnpm capture' }, null, 2)}\n`,
      'utf8',
    );
    await commitAt(repo, msg);
  }

  it('whole check skipped when uiPaths absent or empty', async () => {
    await commit(['src/app/page.tsx'], 'feat: ui');
    for (const config of [{}, { uiPaths: [] }]) {
      const v = await evaluateUiDesignFreshness(cwd, config);
      expect(v.overall).toBe('skipped');
      expect(v.surfaces).toEqual([]);
    }
  });

  it('uninitialized when surface globs have commits but baseline file is absent', async () => {
    await commit(['src/app/page.tsx'], 'feat: ui');
    const v = await evaluateUiDesignFreshness(cwd, { uiPaths: ['src/app/**'] });
    expect(v.overall).toBe('uninitialized');
    expect(v.surfaces[0]).toMatchObject({ surface: 'app', status: 'uninitialized' });
  });

  it('per-surface skipped when no commit ever touched the globs', async () => {
    await commit(['docs/design/ui/baseline/app.pen'], 'docs: baseline');
    const v = await evaluateUiDesignFreshness(cwd, { uiPaths: ['src/app/**'] });
    expect(v.surfaces[0].status).toBe('skipped');
  });

  it('legacy-fresh baseline with no receipt reports unverified, not fresh', async () => {
    await commit(['src/app/page.tsx'], 'feat: ui');
    await commit(['docs/design/ui/baseline/app.pen'], 'docs: baseline sync');
    const v = await evaluateUiDesignFreshness(cwd, { uiPaths: ['src/app/**'] });
    expect(v.overall).toBe('unverified');
    expect(v.surfaces[0].remediation).toBe('capture');
  });

  it('legacy fallback still reports unverified when one commit touches both', async () => {
    await commit(['src/app/page.tsx', 'docs/design/ui/baseline/app.pen'], 'feat: ui+baseline');
    const v = await evaluateUiDesignFreshness(cwd, { uiPaths: ['src/app/**'] });
    expect(v.overall).toBe('unverified');
  });

  it('stale when UI moved after the baseline, with both commits named', async () => {
    await commit(['docs/design/ui/baseline/app.pen'], 'docs: baseline');
    await commit(['src/app/page.tsx'], 'feat: ui drift');
    const v = await evaluateUiDesignFreshness(cwd, { uiPaths: ['src/app/**'] });
    expect(v.overall).toBe('stale');
    expect(v.surfaces[0].uiCommit).toBeTruthy();
    expect(v.surfaces[0].baselineCommit).toBeTruthy();
    expect(v.surfaces[0].detail).toContain('ui-sync');
  });

  it('test/doc-only commits do not stale a surface', async () => {
    await commit(['src/app/page.tsx'], 'feat: ui');
    await commit(['docs/design/ui/baseline/app.pen'], 'docs: baseline');
    await commitReceipt('app', 'chore: capture');
    await commit(['src/app/__tests__/page.test.tsx'], 'test: only');
    await commit(['src/app/README.md'], 'docs: only');
    const v = await evaluateUiDesignFreshness(cwd, { uiPaths: ['src/app/**'] });
    expect(v.overall).toBe('fresh');
  });

  it('committed deletion of the baseline reads uninitialized, never fresh', async () => {
    await commit(['src/app/page.tsx'], 'feat: ui');
    await commit(['docs/design/ui/baseline/app.pen'], 'docs: baseline');
    const { rm: rmFile } = await import('node:fs/promises');
    await rmFile(join(cwd, 'docs/design/ui/baseline/app.pen'));
    await commitAt(repo, 'chore: delete baseline');
    const v = await evaluateUiDesignFreshness(cwd, { uiPaths: ['src/app/**'] });
    expect(v.surfaces[0].status).toBe('uninitialized');
  });

  it('flags UI commits outside every declared surface as an (unmapped) stale row', async () => {
    await commit(['src/a/x.tsx'], 'feat: a');
    await commit(['docs/design/ui/baseline/a.pen'], 'docs: a baseline');
    await commit(['src/other/y.tsx'], 'feat: unmapped ui');
    const v = await evaluateUiDesignFreshness(cwd, {
      uiPaths: ['src/a/**', 'src/other/**'],
      uiSurfaces: { a: ['src/a/**'] },
    });
    expect(v.overall).toBe('stale');
    expect(v.surfaces.find((s) => s.surface === '(unmapped)')?.status).toBe('stale');
  });

  it('multi-surface worst-of aggregation, rows sorted by surface name', async () => {
    await commit(['docs/design/ui/baseline/a.pen'], 'docs: a');
    await commit(['src/a/x.tsx'], 'feat: a drift');
    await commit(['src/b/y.tsx'], 'feat: b');
    await commit(['docs/design/ui/baseline/b.pen'], 'docs: b');
    const v = await evaluateUiDesignFreshness(cwd, {
      uiPaths: ['src/a/**', 'src/b/**'],
      uiSurfaces: { a: ['src/a/**'], b: ['src/b/**'] },
    });
    expect(v.overall).toBe('stale');
    expect(v.surfaces.map((s) => [s.surface, s.status])).toEqual([
      ['a', 'stale'],
      ['b', 'unverified'],
    ]);
  });
  it('fresh when the capture receipt commit is at or after the UI commit', async () => {
    await commit(['src/app/page.tsx'], 'feat: ui');
    await commit(['docs/design/ui/baseline/app.pen'], 'docs: baseline');
    await commitReceipt('app', 'chore: capture');
    const v = await evaluateUiDesignFreshness(cwd, { uiPaths: ['src/app/**'] });
    expect(v.overall).toBe('fresh');
    expect(v.surfaces[0].detail).toContain('capture receipt at/after UI');
  });

  it('a failed capture leaves the receipt behind, so a later UI commit reads stale', async () => {
    await commit(['src/app/page.tsx'], 'feat: ui');
    await commit(['docs/design/ui/baseline/app.pen'], 'docs: baseline');
    await commitReceipt('app', 'chore: capture');
    // The capture that would have re-vouched for this UI change never wrote a
    // receipt, and the .pen it would have rewritten is untouched — exactly the
    // shape that read `fresh` before this feature.
    await commit(['src/app/page.tsx'], 'feat: ui moved the buttons');
    const v = await evaluateUiDesignFreshness(cwd, { uiPaths: ['src/app/**'] });
    expect(v.overall).toBe('stale');
    expect(v.surfaces[0].remediation).toBe('capture');
    expect(v.surfaces[0].detail).toContain('design capture');
  });

  it('survives squash-merge: a fresh surface stays fresh in a squashed clone', async () => {
    await commit(['src/app/page.tsx'], 'feat: ui');
    await commit(['docs/design/ui/baseline/app.pen'], 'docs: baseline');
    await commitReceipt('app', 'chore: capture');
    const before = await evaluateUiDesignFreshness(cwd, { uiPaths: ['src/app/**'] });
    expect(before.overall).toBe('fresh');

    // Squash every commit into one, the way pr-flow merges a PR: none of the
    // original shas survives. A receipt storing one of them would degrade to
    // `skipped` here — permanently, and silently.
    const target = await mkdtemp(join(tmpdir(), 'ui-squash-'));
    try {
      await exec('git', ['init', '-q'], target);
      await exec('git', ['config', 'user.email', 't@e'], target);
      await exec('git', ['config', 'user.name', 't'], target);
      // `git merge --squash` refuses an empty HEAD, so the squash target needs
      // a root commit first — which also mirrors reality: a PR squashes onto a
      // main that already exists.
      await exec('git', ['commit', '-q', '--allow-empty', '-m', 'root'], target, {
        GIT_AUTHOR_DATE: '@8000 +0000',
        GIT_COMMITTER_DATE: '@8000 +0000',
      });
      await exec('git', ['remote', 'add', 'src', cwd], target);
      await exec('git', ['fetch', '-q', 'src', 'HEAD'], target);
      await exec(
        'git',
        ['merge', '--squash', '--allow-unrelated-histories', '-q', 'FETCH_HEAD'],
        target,
      );
      await exec('git', ['commit', '-q', '-m', 'feat: squashed'], target, {
        GIT_AUTHOR_DATE: '@9000 +0000',
        GIT_COMMITTER_DATE: '@9000 +0000',
      });
      const after = await evaluateUiDesignFreshness(target, { uiPaths: ['src/app/**'] });
      expect(after.overall).toBe('fresh');
    } finally {
      await rm(target, { recursive: true, force: true });
    }
  });

  it('stale when the receipt was committed without its baseline (digest mismatch)', async () => {
    await commit(['src/app/page.tsx'], 'feat: ui');
    await commit(['docs/design/ui/baseline/app.pen'], 'docs: baseline');
    await commitReceipt('app', 'chore: capture', 'f'.repeat(64));
    const v = await evaluateUiDesignFreshness(cwd, { uiPaths: ['src/app/**'] });
    expect(v.overall).toBe('stale');
    expect(v.surfaces[0].detail).toContain('committed without its baseline');
  });

  it('removing an adopted receipt reads stale, never back through the legacy path', async () => {
    await commit(['docs/design/ui/baseline/app.pen'], 'docs: baseline');
    await commit(['src/app/page.tsx'], 'feat: ui');
    await commitReceipt('app', 'chore: capture');
    await commit(['src/app/page.tsx'], 'feat: ui drift');
    expect((await evaluateUiDesignFreshness(cwd, { uiPaths: ['src/app/**'] })).overall).toBe(
      'stale',
    );

    // Deleting the proof must not buy a non-blocking verdict: the legacy read
    // of this recently committed baseline would otherwise be reported
    // `unverified`, and the block would vanish.
    await rm(join(cwd, receiptRelPath('app')), { force: true });
    await commitAt(repo, 'chore: drop receipt');
    const v = await evaluateUiDesignFreshness(cwd, { uiPaths: ['src/app/**'] });
    expect(v.overall).toBe('stale');
    expect(v.surfaces[0].detail).toContain('removed after adoption');
  });

  it('a malformed receipt is indeterminate, never a red', async () => {
    await commit(['src/app/page.tsx'], 'feat: ui');
    await commit(['docs/design/ui/baseline/app.pen'], 'docs: baseline');
    await commitReceipt('app', 'chore: capture');
    const abs = join(cwd, receiptRelPath('app'));
    await writeFile(abs, 'not json at all', 'utf8');
    await commitAt(repo, 'chore: corrupt receipt');
    const v = await evaluateUiDesignFreshness(cwd, { uiPaths: ['src/app/**'] });
    expect(v.surfaces[0].status).toBe('skipped');
  });

  it('a stale surface still drives the overall verdict when another is unverified', async () => {
    // The RANK ordering is what makes this hold: if `unverified` outranked
    // `stale`, the blocking surface would be masked and the release would pass.
    await commit(['docs/design/ui/baseline/a.pen'], 'docs: a baseline');
    await commit(['src/a/x.tsx'], 'feat: a drift');
    await commit(['src/b/y.tsx'], 'feat: b');
    await commit(['docs/design/ui/baseline/b.pen'], 'docs: b baseline');
    const v = await evaluateUiDesignFreshness(cwd, {
      uiPaths: ['src/a/**', 'src/b/**'],
      uiSurfaces: { a: ['src/a/**'], b: ['src/b/**'] },
    });
    expect(v.surfaces.map((s) => [s.surface, s.status])).toEqual([
      ['a', 'stale'],
      ['b', 'unverified'],
    ]);
    expect(v.overall).toBe('stale');
  });
});

describe('release preflight — ui-design-freshness row', () => {
  let repo: Repo;
  let cwd: string;

  beforeEach(async () => {
    repo = await initRepo('ui-probe-');
    cwd = repo.cwd;
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  const commit = (paths: string[], msg: string) => commitFiles(repo, paths, msg);

  const ctx = (): ProbeContext => ({
    cwd,
    scanPaths: [],
    nowMs: 0,
    treeState: () => {
      throw new Error('not needed by this probe');
    },
    previousTag: () => {
      throw new Error('not needed by this probe');
    },
    config: () => null,
  });

  it('does not block a release on a surface that merely lacks a capture receipt', async () => {
    // The status set the probe branches on is not exhaustive — its final
    // `return` is `blocking`, with `detail` filtered to `stale`. A new status
    // that falls through there blocks every consumer on upgrade, with an empty
    // reason.
    await commit(['src/app/page.tsx'], 'feat: ui');
    await commit(['docs/design/ui/baseline/app.pen'], 'docs: baseline');
    await writeUiConfig(cwd, ['src/app/**']);

    const row = await runProbe('ui-design-freshness', ctx());
    expect(row.status).toBe('warn');
    expect(row.detail).toContain('app');
  });

  it('still blocks a release on a genuinely stale surface', async () => {
    await commit(['docs/design/ui/baseline/app.pen'], 'docs: baseline');
    await commit(['src/app/page.tsx'], 'feat: ui drift');
    await writeUiConfig(cwd, ['src/app/**']);

    const row = await runProbe('ui-design-freshness', ctx());
    expect(row.status).toBe('blocking');
    expect(row.detail).toContain('app');
  });
});
