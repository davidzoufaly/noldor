// @tests: acceptance-verify-lane, autonomous-plan-to-pr-merge, specs-cr-gate-multi-reviewer
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lanes/manual.js', () => ({
  runManual: vi.fn(async () => ({ lane: 'manual', sinkPath: 'm', ok: true })),
}));
vi.mock('../lanes/codex.js', () => ({
  runCodex: vi.fn(async () => ({ lane: 'codex', sinkPath: 'c', ok: true })),
}));
vi.mock('../lanes/subagent.js', () => ({
  runSubagent: vi.fn(async () => ({ lane: 'reviewer', sinkPath: 's', ok: true })),
}));
import { runManual } from '../lanes/manual.js';
import { run } from '../orchestrate.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'delta-'));
  await mkdir(join(root, '.noldor', 'cr'), { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('delta short-circuit', () => {
  it('writes synthetic OK for ALL lanes when empty diff', async () => {
    // A green prior sink per lane is what makes "no changes since prior run" true
    // — a lane without one runs for real, whatever its name or kind (see
    // orchestrate.test.ts). `autonomous` keeps the overwrite guard from prompting
    // over those prior sinks.
    for (const lane of ['reviewer', 'manual']) {
      await writeFile(
        join(root, '.noldor', 'cr', `x-spec-${lane}.json`),
        JSON.stringify({
          lane,
          artifact: 'docs/x.md',
          kind: 'spec',
          slug: 'x',
          blockers: [],
          suggestions: [],
          summary: 'prior',
          startedAt: '2026-05-25T00:00:00.000Z',
          finishedAt: '2026-05-25T00:01:00.000Z',
        }),
        'utf8',
      );
    }
    const r = await run({
      args: {
        slug: 'x',
        artifact: 'docs/x.md',
        kind: 'spec',
        lanes: ['manual', 'reviewer'],
        baseSha: 'b',
        fullReview: false,
        autonomous: true,
      },
      cwd: root,
      isEmptyDiff: async () => true,
    });
    expect(r.syntheticOks.toSorted()).toEqual(['manual', 'reviewer']);
    const manualJson = JSON.parse(
      await readFile(join(root, '.noldor', 'cr', 'x-spec-manual.json'), 'utf8'),
    );
    expect(manualJson.summary).toBe('no changes since prior run');
  });
  it('--full-review bypasses delta', async () => {
    const r = await run({
      args: {
        slug: 'x',
        artifact: 'docs/x.md',
        kind: 'spec',
        lanes: ['manual'],
        baseSha: 'b',
        fullReview: true,
        autonomous: false,
      },
      cwd: root,
      isEmptyDiff: async () => true,
    });
    expect(r.syntheticOks).toEqual([]);
  });
});

describe('stale base (Q-0265)', () => {
  // A branch forked from main, then main moved on. `--base-sha main` must review only the
  // branch's own change, so every lane gets the fork point — not main's tip, whose two-dot
  // diff against the branch would carry main's newer commits reversed.
  it('hands every lane the merge-base when --base-sha has moved past the fork point', async () => {
    const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    git('config', 'commit.gpgsign', 'false');
    await writeFile(join(root, 'a.txt'), 'a\n');
    git('add', 'a.txt');
    git('commit', '-q', '--no-verify', '-m', 'fork point');
    const forkPoint = git('rev-parse', 'HEAD');
    git('checkout', '-q', '-b', 'feat');
    await writeFile(join(root, 'b.txt'), 'b\n');
    git('add', 'b.txt');
    git('commit', '-q', '--no-verify', '-m', 'branch change');
    const head = git('rev-parse', 'HEAD');
    git('checkout', '-q', 'main');
    await writeFile(join(root, 'c.txt'), 'c\n');
    git('add', 'c.txt');
    git('commit', '-q', '--no-verify', '-m', 'main moved on');
    const mainTip = git('rev-parse', 'HEAD');
    git('checkout', '-q', 'feat');

    const emptyDiffBases: string[] = [];
    vi.mocked(runManual).mockClear();
    await run({
      args: {
        slug: 'x',
        artifact: 'b.txt',
        kind: 'code',
        lanes: ['manual'],
        baseSha: mainTip,
        fullReview: false,
        autonomous: true,
      },
      cwd: root,
      isEmptyDiff: async (_r, base) => {
        emptyDiffBases.push(base);
        return false;
      },
    });
    expect(head).not.toBe(forkPoint);
    expect(emptyDiffBases).toEqual([forkPoint]);
    expect(vi.mocked(runManual).mock.calls[0]?.[0].baseSha).toBe(forkPoint);
  });
});
