// @tests: pendev-ui-design-phase
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { classifyAncestry, evaluateUiDesignFreshness } from '../ui-design-freshness.js';

const exec = (cmd: string, args: string[], cwd: string, env?: Record<string, string>) =>
  new Promise<string>((resolve, reject) => {
    execFile(cmd, args, { cwd, env: { ...process.env, ...env } }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.toString());
    });
  });

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
  let cwd: string;
  let epoch = 1000;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'ui-fresh-'));
    epoch = 1000;
    await exec('git', ['init', '-q'], cwd);
    await exec('git', ['config', 'user.email', 't@e'], cwd);
    await exec('git', ['config', 'user.name', 't'], cwd);
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  async function commitFiles(paths: string[], msg: string): Promise<void> {
    for (const path of paths) {
      const abs = join(cwd, path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, `${msg}\n`, 'utf8');
    }
    epoch += 100;
    await exec('git', ['add', '-A'], cwd);
    await exec('git', ['commit', '-q', '-m', msg], cwd, {
      GIT_AUTHOR_DATE: `@${epoch} +0000`,
      GIT_COMMITTER_DATE: `@${epoch} +0000`,
    });
  }

  it('whole check skipped when uiPaths absent or empty', async () => {
    await commitFiles(['src/app/page.tsx'], 'feat: ui');
    for (const config of [{}, { uiPaths: [] }]) {
      const v = await evaluateUiDesignFreshness(cwd, config);
      expect(v.overall).toBe('skipped');
      expect(v.surfaces).toEqual([]);
    }
  });

  it('uninitialized when surface globs have commits but baseline file is absent', async () => {
    await commitFiles(['src/app/page.tsx'], 'feat: ui');
    const v = await evaluateUiDesignFreshness(cwd, { uiPaths: ['src/app/**'] });
    expect(v.overall).toBe('uninitialized');
    expect(v.surfaces[0]).toMatchObject({ surface: 'app', status: 'uninitialized' });
  });

  it('per-surface skipped when no commit ever touched the globs', async () => {
    await commitFiles(['docs/design/ui/baseline/app.pen'], 'docs: baseline');
    const v = await evaluateUiDesignFreshness(cwd, { uiPaths: ['src/app/**'] });
    expect(v.surfaces[0].status).toBe('skipped');
  });

  it('fresh when baseline commit is at or after the UI commit (ancestry)', async () => {
    await commitFiles(['src/app/page.tsx'], 'feat: ui');
    await commitFiles(['docs/design/ui/baseline/app.pen'], 'docs: baseline sync');
    const v = await evaluateUiDesignFreshness(cwd, { uiPaths: ['src/app/**'] });
    expect(v.overall).toBe('fresh');
  });

  it('fresh when one commit touches both (U == B)', async () => {
    await commitFiles(['src/app/page.tsx', 'docs/design/ui/baseline/app.pen'], 'feat: ui+baseline');
    const v = await evaluateUiDesignFreshness(cwd, { uiPaths: ['src/app/**'] });
    expect(v.overall).toBe('fresh');
  });

  it('stale when UI moved after the baseline, with both commits named', async () => {
    await commitFiles(['docs/design/ui/baseline/app.pen'], 'docs: baseline');
    await commitFiles(['src/app/page.tsx'], 'feat: ui drift');
    const v = await evaluateUiDesignFreshness(cwd, { uiPaths: ['src/app/**'] });
    expect(v.overall).toBe('stale');
    expect(v.surfaces[0].uiCommit).toBeTruthy();
    expect(v.surfaces[0].baselineCommit).toBeTruthy();
    expect(v.surfaces[0].detail).toContain('ui-sync');
  });

  it('test/doc-only commits do not stale a surface', async () => {
    await commitFiles(['src/app/page.tsx'], 'feat: ui');
    await commitFiles(['docs/design/ui/baseline/app.pen'], 'docs: baseline');
    await commitFiles(['src/app/__tests__/page.test.tsx'], 'test: only');
    await commitFiles(['src/app/README.md'], 'docs: only');
    const v = await evaluateUiDesignFreshness(cwd, { uiPaths: ['src/app/**'] });
    expect(v.overall).toBe('fresh');
  });

  it('committed deletion of the baseline reads uninitialized, never fresh', async () => {
    await commitFiles(['src/app/page.tsx'], 'feat: ui');
    await commitFiles(['docs/design/ui/baseline/app.pen'], 'docs: baseline');
    const { rm: rmFile } = await import('node:fs/promises');
    await rmFile(join(cwd, 'docs/design/ui/baseline/app.pen'));
    epoch += 100;
    await exec('git', ['add', '-A'], cwd);
    await exec('git', ['commit', '-q', '-m', 'chore: delete baseline'], cwd, {
      GIT_AUTHOR_DATE: `@${epoch} +0000`,
      GIT_COMMITTER_DATE: `@${epoch} +0000`,
    });
    const v = await evaluateUiDesignFreshness(cwd, { uiPaths: ['src/app/**'] });
    expect(v.surfaces[0].status).toBe('uninitialized');
  });

  it('flags UI commits outside every declared surface as an (unmapped) stale row', async () => {
    await commitFiles(['src/a/x.tsx'], 'feat: a');
    await commitFiles(['docs/design/ui/baseline/a.pen'], 'docs: a baseline');
    await commitFiles(['src/other/y.tsx'], 'feat: unmapped ui');
    const v = await evaluateUiDesignFreshness(cwd, {
      uiPaths: ['src/a/**', 'src/other/**'],
      uiSurfaces: { a: ['src/a/**'] },
    });
    expect(v.overall).toBe('stale');
    expect(v.surfaces.find((s) => s.surface === '(unmapped)')?.status).toBe('stale');
  });

  it('multi-surface worst-of aggregation, rows sorted by surface name', async () => {
    await commitFiles(['docs/design/ui/baseline/a.pen'], 'docs: a');
    await commitFiles(['src/a/x.tsx'], 'feat: a drift');
    await commitFiles(['src/b/y.tsx'], 'feat: b');
    await commitFiles(['docs/design/ui/baseline/b.pen'], 'docs: b');
    const v = await evaluateUiDesignFreshness(cwd, {
      uiPaths: ['src/a/**', 'src/b/**'],
      uiSurfaces: { a: ['src/a/**'], b: ['src/b/**'] },
    });
    expect(v.overall).toBe('stale');
    expect(v.surfaces.map((s) => [s.surface, s.status])).toEqual([
      ['a', 'stale'],
      ['b', 'fresh'],
    ]);
  });
});
