// @tests: acceptance-verify-lane, autonomous-plan-to-pr-merge, specs-cr-gate-multi-reviewer
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lanes/manual.js', () => ({
  runManual: vi.fn(async () => ({ lane: 'manual', sinkPath: 'm', ok: true })),
}));
vi.mock('../lanes/codex.js', () => ({
  runCodex: vi.fn(async () => ({ lane: 'codex', sinkPath: 'c', ok: true })),
  codexSupportsBaseSha: vi.fn(async () => true),
}));
vi.mock('../lanes/subagent.js', () => ({
  runSubagent: vi.fn(async () => ({ lane: 'reviewer', sinkPath: 's', ok: true })),
}));
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
    const r = await run({
      args: {
        slug: 'x',
        artifact: 'docs/x.md',
        kind: 'spec',
        lanes: ['manual', 'reviewer'],
        baseSha: 'b',
        fullReview: false,
        autonomous: false,
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
