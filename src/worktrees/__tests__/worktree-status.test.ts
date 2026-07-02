// @tests: dashboard-worktree-health-page, de-superpowers-vendor-spec-plan-and-worktree-flows, parallel-worktree-workflow

import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  allocatePorts,
  computeWarnings,
  detectFileOverlap,
  formatStatus,
  gatherStats,
  parseWorktreeList,
  readPort,
} from '../worktree-status.js';

describe('parseWorktreeList', () => {
  it('parses main + two feature worktrees from porcelain output', () => {
    const porcelain = [
      'worktree /repo',
      'HEAD aaaaaaa',
      'branch refs/heads/main',
      '',
      'worktree /repo/.worktrees/foo',
      'HEAD bbbbbbb',
      'branch refs/heads/feat/foo',
      '',
      'worktree /repo/.worktrees/bar',
      'HEAD ccccccc',
      'detached',
      '',
    ].join('\n');

    expect(parseWorktreeList(porcelain)).toEqual([
      { path: '/repo', branch: 'main', detached: false },
      { path: '/repo/.worktrees/foo', branch: 'feat/foo', detached: false },
      { path: '/repo/.worktrees/bar', branch: null, detached: true },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(parseWorktreeList('')).toEqual([]);
  });
});

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'wt-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Test']);
  await writeFile(join(root, 'README.md'), 'initial');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'initial']);
  return root;
}

describe('gatherStats', () => {
  it('reports zero ahead/behind, clean, no touched files for fresh worktree', async () => {
    const repo = await makeRepo();
    try {
      const stats = await gatherStats(repo, 'main');
      expect(stats.ahead).toBe(0);
      expect(stats.behind).toBe(0);
      expect(stats.dirtyCount).toBe(0);
      expect(stats.touchedFiles).toEqual([]);
      expect(stats.lastCommit).toMatch(/initial/);
    } finally {
      await rm(repo, { force: true, recursive: true });
    }
  });

  it('reports ahead and touched files on a feature branch', async () => {
    const repo = await makeRepo();
    try {
      execFileSync('git', ['-C', repo, 'checkout', '-b', 'feat/x']);
      await writeFile(join(repo, 'a.txt'), 'a');
      execFileSync('git', ['-C', repo, 'add', '.']);
      execFileSync('git', ['-C', repo, 'commit', '-m', 'add a']);

      const stats = await gatherStats(repo, 'feat/x');
      expect(stats.ahead).toBe(1);
      expect(stats.behind).toBe(0);
      expect(stats.touchedFiles).toEqual(['a.txt']);
    } finally {
      await rm(repo, { force: true, recursive: true });
    }
  });

  it('reports dirtyCount and oldestDirtyMtime for staged + unstaged changes', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'dirty.txt'), 'unstaged');
      const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
      await utimes(join(repo, 'dirty.txt'), oldTime, oldTime);

      const stats = await gatherStats(repo, 'main');
      expect(stats.dirtyCount).toBe(1);
      expect(stats.oldestDirtyMtime).not.toBeNull();
      expect(stats.oldestDirtyMtime!.getTime()).toBeLessThan(Date.now() - 60 * 60 * 1000);
    } finally {
      await rm(repo, { force: true, recursive: true });
    }
  });
});

describe('gatherStats - dirtyFiles', () => {
  it('returns dirtyFiles array equal in length to dirtyCount', async () => {
    // Run against the current worktree (always present)
    const stats = await gatherStats(process.cwd(), 'main');
    expect(Array.isArray(stats.dirtyFiles)).toBe(true);
    expect(stats.dirtyFiles.length).toBe(stats.dirtyCount);
  });
});

describe('readPort', () => {
  it('returns null when .env.local missing', async () => {
    const repo = await makeRepo();
    try {
      expect(await readPort(repo)).toBeNull();
    } finally {
      await rm(repo, { force: true, recursive: true });
    }
  });

  it('parses PORT from existing .env.local', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, '.env.local'), 'OTHER=foo\nPORT=5174\n');
      expect(await readPort(repo)).toBe(5174);
    } finally {
      await rm(repo, { force: true, recursive: true });
    }
  });
});

describe('allocatePorts', () => {
  it('assigns lowest free port in 5174-5179', async () => {
    const repo = await makeRepo();
    try {
      const treeA = join(repo, '.worktrees', 'a');
      const treeB = join(repo, '.worktrees', 'b');
      await mkdir(treeA, { recursive: true });
      await mkdir(treeB, { recursive: true });

      const result = await allocatePorts([
        { path: treeA, currentPort: null },
        { path: treeB, currentPort: null },
      ]);

      expect(result.assignments).toEqual([
        { path: treeA, port: 5174 },
        { path: treeB, port: 5175 },
      ]);
      expect(result.exhausted).toBe(false);

      expect(await readFile(join(treeA, '.env.local'), 'utf-8')).toContain('PORT=5174');
      expect(await readFile(join(treeB, '.env.local'), 'utf-8')).toContain('PORT=5175');
    } finally {
      await rm(repo, { force: true, recursive: true });
    }
  });

  it('preserves existing .env.local content when adding PORT', async () => {
    const repo = await makeRepo();
    try {
      const tree = join(repo, '.worktrees', 'a');
      await mkdir(tree, { recursive: true });
      await writeFile(join(tree, '.env.local'), 'OTHER=foo\n');

      await allocatePorts([{ path: tree, currentPort: null }]);

      const content = await readFile(join(tree, '.env.local'), 'utf-8');
      expect(content).toContain('OTHER=foo');
      expect(content).toContain('PORT=5174');
    } finally {
      await rm(repo, { force: true, recursive: true });
    }
  });

  it('refuses to assign when range exhausted', async () => {
    const repo = await makeRepo();
    try {
      const fillers = [5174, 5175, 5176, 5177, 5178, 5179].map((p, i) => ({
        path: join(repo, '.worktrees', `f${i}`),
        currentPort: p,
      }));
      const newcomer = { path: join(repo, '.worktrees', 'newcomer'), currentPort: null };

      const result = await allocatePorts([...fillers, newcomer]);
      expect(result.exhausted).toBe(true);
      expect(result.assignments).toEqual([]);
    } finally {
      await rm(repo, { force: true, recursive: true });
    }
  });
});

describe('detectFileOverlap', () => {
  it('returns empty array when no overlap', () => {
    const result = detectFileOverlap([
      { branch: 'feat/a', touchedFiles: ['a.ts'] },
      { branch: 'feat/b', touchedFiles: ['b.ts'] },
    ]);
    expect(result).toEqual([]);
  });

  it('reports each pair with intersecting files', () => {
    const result = detectFileOverlap([
      { branch: 'feat/a', touchedFiles: ['shared.ts', 'a.ts'] },
      { branch: 'feat/b', touchedFiles: ['shared.ts', 'b.ts'] },
      { branch: 'feat/c', touchedFiles: ['c.ts'] },
    ]);
    expect(result).toEqual([{ branchA: 'feat/a', branchB: 'feat/b', files: ['shared.ts'] }]);
  });

  it('handles three-way overlap as separate pairs', () => {
    const result = detectFileOverlap([
      { branch: 'feat/a', touchedFiles: ['x.ts'] },
      { branch: 'feat/b', touchedFiles: ['x.ts'] },
      { branch: 'feat/c', touchedFiles: ['x.ts'] },
    ]);
    expect(result).toHaveLength(3);
    expect(result.map((p) => `${p.branchA}/${p.branchB}`)).toEqual([
      'feat/a/feat/b',
      'feat/a/feat/c',
      'feat/b/feat/c',
    ]);
  });
});

describe('computeWarnings', () => {
  it('warns on cap exceeded (>3 feature worktrees)', () => {
    const trees = [
      { path: '/r/.worktrees/a', branch: 'feat/a', detached: false, stats: emptyStats() },
      { path: '/r/.worktrees/b', branch: 'feat/b', detached: false, stats: emptyStats() },
      { path: '/r/.worktrees/c', branch: 'feat/c', detached: false, stats: emptyStats() },
      { path: '/r/.worktrees/d', branch: 'feat/d', detached: false, stats: emptyStats() },
    ];
    const warnings = computeWarnings(trees);
    expect(warnings).toContainEqual({ kind: 'cap-exceeded', count: 4 });
  });

  it('warns on drift >24h or >12 commits behind main', () => {
    const trees = [
      {
        path: '/r/.worktrees/a',
        branch: 'feat/a',
        detached: false,
        stats: { ...emptyStats(), behind: 13 },
      },
    ];
    const warnings = computeWarnings(trees);
    expect(warnings).toContainEqual({ kind: 'drift', branch: 'feat/a', behind: 13 });
  });

  it('warns on stale dirty changes >1h old', () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const trees = [
      {
        path: '/r/.worktrees/a',
        branch: 'feat/a',
        detached: false,
        stats: { ...emptyStats(), dirtyCount: 1, oldestDirtyMtime: old },
      },
    ];
    expect(computeWarnings(trees)).toContainEqual({
      kind: 'stale-dirty',
      branch: 'feat/a',
    });
  });

  it('warns on orphan worktree (branch is null and not detached intentionally)', () => {
    const trees = [
      {
        path: '/r/.worktrees/a',
        branch: null,
        detached: false,
        stats: emptyStats(),
      },
    ];
    expect(computeWarnings(trees)).toContainEqual({
      kind: 'orphan',
      path: '/r/.worktrees/a',
    });
  });

  it('forwards overlap findings into warnings', () => {
    const trees = [
      {
        path: '/r/.worktrees/a',
        branch: 'feat/a',
        detached: false,
        stats: { ...emptyStats(), touchedFiles: ['x.ts'] },
      },
      {
        path: '/r/.worktrees/b',
        branch: 'feat/b',
        detached: false,
        stats: { ...emptyStats(), touchedFiles: ['x.ts'] },
      },
    ];
    expect(computeWarnings(trees)).toContainEqual({
      kind: 'overlap',
      branchA: 'feat/a',
      branchB: 'feat/b',
      files: ['x.ts'],
    });
  });
});

describe('formatStatus', () => {
  it('renders table with header and one row per tree', () => {
    const out = formatStatus({
      trees: [
        {
          path: '.',
          branch: 'main',
          port: 5173,
          stats: {
            ...emptyStats(),
            lastCommit: 'aaa1 2h ago — feat: foo',
          },
        },
        {
          path: '.worktrees/foo',
          branch: 'feat/foo',
          port: 5174,
          stats: {
            ...emptyStats(),
            ahead: 3,
            behind: 0,
            dirtyCount: 2,
            lastCommit: 'bbb2 4h ago — feat: bar',
          },
        },
      ],
      warnings: [],
    });
    expect(out).toContain('PATH');
    expect(out).toContain('BRANCH');
    expect(out).toContain('main');
    expect(out).toContain('feat/foo');
    expect(out).toContain('5174');
    expect(out).toContain('3/0');
    expect(out).toContain('2 mod');
    expect(out).not.toContain('Warnings:');
  });

  it('appends Warnings section when warnings present', () => {
    const out = formatStatus({
      trees: [],
      warnings: [
        { kind: 'drift', branch: 'feat/x', behind: 15 },
        { kind: 'overlap', branchA: 'feat/a', branchB: 'feat/b', files: ['x.ts'] },
      ],
    });
    expect(out).toContain('Warnings:');
    expect(out).toContain('feat/x 15 commits behind');
    expect(out).toContain('feat/a and feat/b both touch x.ts');
  });
});

function emptyStats() {
  return {
    ahead: 0,
    behind: 0,
    dirtyCount: 0,
    dirtyFiles: [] as string[],
    oldestDirtyMtime: null,
    lastCommit: '',
    touchedFiles: [] as string[],
  };
}

import { deriveSurfacePort } from '../worktree-status.js';
describe('deriveSurfacePort', () => {
  it('adds the offset to the base port', () => {
    expect(deriveSurfacePort(5174, 0)).toBe(5174);
    expect(deriveSurfacePort(5174, 100)).toBe(5274);
  });
});
