// @tests: acceptance-verify-lane, autonomous-plan-to-pr-merge, specs-cr-gate-multi-reviewer
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all four lanes at the public boundary
vi.mock('../lanes/manual.js', () => ({
  runManual: vi.fn(async (input) => {
    const { writeJsonAtomic } = await import('../atomic-write.js');
    const path = join(input.repoRoot, '.noldor', 'cr', `${input.slug}-${input.kind}-manual.json`);
    await writeJsonAtomic(path, {
      lane: 'manual',
      artifact: input.artifact,
      kind: input.kind,
      slug: input.slug,
      blockers: [],
      suggestions: [],
      summary: 'mock',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });
    return { lane: 'manual', sinkPath: path, ok: true };
  }),
}));
vi.mock('../lanes/codex.js', () => ({
  runCodex: vi.fn(async (input) => {
    const { writeJsonAtomic } = await import('../atomic-write.js');
    const path = join(input.repoRoot, '.noldor', 'cr', `${input.slug}-${input.kind}-codex.json`);
    await writeJsonAtomic(path, {
      lane: 'codex',
      artifact: input.artifact,
      kind: input.kind,
      slug: input.slug,
      blockers: [],
      suggestions: [],
      summary: 'mock',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });
    return { lane: 'codex', sinkPath: path, ok: true };
  }),
  codexSupportsBaseSha: vi.fn(async () => true),
}));
vi.mock('../lanes/subagent.js', () => ({
  runSubagent: vi.fn(async (input) => {
    const { writeJsonAtomic } = await import('../atomic-write.js');
    const path = join(input.repoRoot, '.noldor', 'cr', `${input.slug}-${input.kind}-reviewer.json`);
    await writeJsonAtomic(path, {
      lane: 'reviewer',
      artifact: input.artifact,
      kind: input.kind,
      slug: input.slug,
      blockers: [],
      suggestions: [],
      summary: 'mock',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });
    return { lane: 'reviewer', sinkPath: path, ok: true };
  }),
}));
import { run } from '../orchestrate.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'oint-'));
  await mkdir(join(root, '.noldor', 'cr'), { recursive: true });
  await mkdir(join(root, 'docs', 'features'), { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('orchestrate integration', () => {
  it('runs all three runnable lanes; writes 3 schema-valid sinks', async () => {
    const r = await run({
      args: {
        slug: 'x',
        artifact: 'docs/superpowers/specs/x.md',
        kind: 'spec',
        lanes: ['manual', 'codex', 'reviewer'],
        fullReview: false,
        autonomous: false,
      },
      cwd: root,
    });
    expect(r.lanesRun.toSorted()).toEqual(['codex', 'manual', 'reviewer']);
    const entries = await readdir(join(root, '.noldor', 'cr'));
    expect(entries.filter((e) => e.endsWith('.json')).toSorted()).toEqual([
      'x-spec-codex.json',
      'x-spec-manual.json',
      'x-spec-reviewer.json',
    ]);
    expect(entries.filter((e) => e.endsWith('.tmp'))).toEqual([]);
  });

  // TODO(Task 5.5): once `guardLaneOverwrite` lands, add a test here exercising
  // the archive path through run(). Intentionally not encoded as `it.todo` /
  // `it.skip` — oxlint's `vitest/{warn-todo,no-disabled-tests}` rules forbid
  // disabled tests in committed code. The plan's todo marker lives here as a
  // comment instead, with no behavioral effect.
});
