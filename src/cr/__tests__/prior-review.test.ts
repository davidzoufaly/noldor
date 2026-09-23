// @tests: specs-cr-gate-multi-reviewer, cr-re-round-cap-enforcement-and-oscillation-detector
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LaneInput } from '../lane-types.js';

vi.mock('../lanes/manual.js', () => ({
  runManual: vi.fn(async () => ({ lane: 'manual', sinkPath: 'm', ok: true })),
}));
vi.mock('../lanes/subagent.js', () => ({
  runSubagent: vi.fn(async () => ({ lane: 'reviewer', sinkPath: 's', ok: true })),
}));
vi.mock('../lanes/codex.js', () => ({
  runCodex: vi.fn(async () => ({ lane: 'codex', sinkPath: 'c', ok: true })),
}));
import { runCodex } from '../lanes/codex.js';
import { runManual } from '../lanes/manual.js';
import { runSubagent } from '../lanes/subagent.js';
import { EXIT_PRIOR_UNUSABLE, run } from '../orchestrate.js';

const reviewerInput = (): LaneInput => vi.mocked(runSubagent).mock.calls.at(-1)![0] as LaneInput;
const codexInput = (): LaneInput => vi.mocked(runCodex).mock.calls.at(-1)![0] as LaneInput;

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'prior-'));
  await mkdir(join(root, '.noldor', 'cr'), { recursive: true });
  vi.mocked(runSubagent).mockClear();
  vi.mocked(runManual).mockClear();
  vi.mocked(runCodex).mockClear();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const sink = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    lane: 'reviewer',
    artifact: 'docs/x.md',
    kind: 'spec',
    slug: 'x',
    blockers: [{ file: 'docs/x.md', severity: 'high', message: 'unaddressed', class: 'design' }],
    suggestions: [],
    summary: 'blockers found',
    startedAt: '2026-08-15T00:00:00.000Z',
    finishedAt: '2026-08-15T00:01:00.000Z',
    ...over,
  });

const writeSink = (name: string, body: string): Promise<void> =>
  writeFile(join(root, '.noldor', 'cr', name), body, 'utf8');

const args = (over: Record<string, unknown> = {}) => ({
  slug: 'x',
  artifact: 'docs/x.md',
  kind: 'spec' as const,
  lanes: ['reviewer' as const],
  autonomous: true,
  ...over,
});

describe('prior-review context attachment', () => {
  it('red prior + non-empty diff → fixes-in-diff context on the reviewer input', async () => {
    await writeSink('x-spec-reviewer.json', sink());
    await run({ args: args({ baseSha: 'b' }), cwd: root, isEmptyDiff: async () => false });
    const li = reviewerInput();
    expect(li.priorReview).toEqual({
      mode: 'fixes-in-diff',
      blockers: [{ file: 'docs/x.md', severity: 'high', message: 'unaddressed', class: 'design' }],
    });
  });

  it('fullReviewOverride (empty diff, red prior) → reexamine context', async () => {
    await writeSink('x-spec-reviewer.json', sink());
    await run({ args: args({ baseSha: 'b' }), cwd: root, isEmptyDiff: async () => true });
    const li = reviewerInput();
    expect(li.fullReview).toBe(true); // the override actually fired
    expect(li.priorReview?.mode).toBe('reexamine');
  });

  it('explicit --full-review → reexamine context, no isEmptyDiff call', async () => {
    await writeSink('x-spec-reviewer.json', sink());
    const isEmptyDiff = vi.fn(async () => false);
    await run({ args: args({ baseSha: 'b', fullReview: true }), cwd: root, isEmptyDiff });
    expect(reviewerInput().priorReview?.mode).toBe('reexamine');
    expect(isEmptyDiff).not.toHaveBeenCalled();
  });

  it('green prior → no context (and suggestions alone do not create one)', async () => {
    await writeSink(
      'x-spec-reviewer.json',
      sink({
        blockers: [],
        suggestions: [{ file: 'docs/x.md', severity: 'low', message: 'nit' }],
        summary: 'approve',
      }),
    );
    await run({ args: args({ fullReview: true }), cwd: root });
    expect('priorReview' in reviewerInput()).toBe(false);
  });

  it('an unparseable reviewer prior sink refuses the round before any lane runs', async () => {
    await writeSink('x-spec-reviewer.json', '{not json');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await run({ args: args({ baseSha: 'b' }), cwd: root, isEmptyDiff: async () => true });
    expect(r.exitCode).toBe(EXIT_PRIOR_UNUSABLE);
    expect(r.lanesRun).toEqual([]);
    expect(runSubagent).not.toHaveBeenCalled();
    expect(err.mock.calls.flat().join('\n')).toContain('x-spec-reviewer.json');
    err.mockRestore();
  });

  it('a schema-rejected codex prior sink refuses the round too', async () => {
    await writeSink('x-spec-codex.json', JSON.stringify({ lane: 'codex' }));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await run({
      args: args({ lanes: ['reviewer', 'codex'], baseSha: 'b' }),
      cwd: root,
      isEmptyDiff: async () => false,
    });
    expect(r.exitCode).toBe(EXIT_PRIOR_UNUSABLE);
    expect(runSubagent).not.toHaveBeenCalled();
    expect(runCodex).not.toHaveBeenCalled();
    expect(err.mock.calls.flat().join('\n')).toContain('x-spec-codex.json');
    err.mockRestore();
  });

  it('an unparseable prior sink on a lane that carries no priors still just re-runs', async () => {
    await writeSink('x-code-manual.json', '{not json');
    const r = await run({
      args: args({ kind: 'code', lanes: ['manual'], baseSha: 'b' }),
      cwd: root,
      isEmptyDiff: async () => true,
    });
    expect(r.exitCode).not.toBe(EXIT_PRIOR_UNUSABLE);
    expect(runManual).toHaveBeenCalledTimes(1);
  });

  it('legacy-named prior sink (pre-0.7.0 `subagent`) is found and attached', async () => {
    await writeSink('x-spec-subagent.json', sink({ lane: 'reviewer' }));
    await run({ args: args({ baseSha: 'b' }), cwd: root, isEmptyDiff: async () => false });
    expect(reviewerInput().priorReview?.blockers).toHaveLength(1);
  });

  it('reads the reviewer sink exactly once per run, and not at all when reviewer is absent', async () => {
    const readPriorSink = vi.fn(async () => ({ kind: 'absent' as const }));
    await run({
      args: args({ baseSha: 'b' }),
      cwd: root,
      isEmptyDiff: async () => false,
      readPriorSink,
    });
    const reviewerReads = readPriorSink.mock.calls.filter((c: unknown[]) => c[3] === 'reviewer');
    expect(reviewerReads).toHaveLength(1);

    readPriorSink.mockClear();
    // kind 'code' — spec/plan would union the mandatory reviewer back in.
    await run({
      args: args({ kind: 'code', lanes: ['manual'], baseSha: 'b' }),
      cwd: root,
      isEmptyDiff: async () => false,
      readPriorSink,
    });
    expect(readPriorSink.mock.calls.filter((c: unknown[]) => c[3] === 'reviewer')).toHaveLength(0);
  });

  it('non-reviewer lanes never receive priorReview', async () => {
    await writeSink('x-spec-reviewer.json', sink());
    await writeSink('x-spec-manual.json', sink({ lane: 'manual' }));
    await run({
      args: args({ lanes: ['manual', 'reviewer'], baseSha: 'b' }),
      cwd: root,
      isEmptyDiff: async () => false,
    });
    const manualIn = vi.mocked(runManual).mock.calls.at(-1)![0] as LaneInput;
    expect('priorReview' in manualIn).toBe(false);
    expect(reviewerInput().priorReview).toBeDefined();
  });

  it('codex receives its own prior blockers, in the round mode', async () => {
    await writeSink('x-spec-reviewer.json', sink());
    await writeSink(
      'x-spec-codex.json',
      sink({
        lane: 'codex',
        blockers: [{ file: 'docs/x.md', severity: 'high', message: 'codex said so' }],
      }),
    );
    await run({
      args: args({ lanes: ['reviewer', 'codex'], baseSha: 'b' }),
      cwd: root,
      isEmptyDiff: async () => false,
    });
    expect(codexInput().priorReview).toEqual({
      mode: 'fixes-in-diff',
      blockers: [{ file: 'docs/x.md', severity: 'high', message: 'codex said so' }],
    });
    expect(reviewerInput().priorReview?.blockers[0]?.message).toBe('unaddressed');
  });

  it('reads each prior-aware sink once', async () => {
    const readPriorSink = vi.fn(async () => ({ kind: 'absent' as const }));
    await run({
      args: args({ lanes: ['reviewer', 'codex'], baseSha: 'b' }),
      cwd: root,
      isEmptyDiff: async () => true,
      readPriorSink,
    });
    for (const lane of ['reviewer', 'codex']) {
      expect(readPriorSink.mock.calls.filter((c: unknown[]) => c[3] === lane)).toHaveLength(1);
    }
  });

  it('never carries a lane failure blocker, and still carries the priors beside it', async () => {
    await writeSink(
      'x-spec-reviewer.json',
      sink({
        blockers: [
          { file: '<reviewer>', severity: 'high', message: 'subagent lane errored: boom' },
          { file: 'docs/x.md', severity: 'high', message: 'unaddressed', class: 'design' },
        ],
        summary: 'subagent error',
      }),
    );
    await run({ args: args({ baseSha: 'b' }), cwd: root, isEmptyDiff: async () => false });
    expect(reviewerInput().priorReview?.blockers).toEqual([
      { file: 'docs/x.md', severity: 'high', message: 'unaddressed', class: 'design' },
    ]);
  });

  it('a sink holding only a lane failure attaches no priors', async () => {
    await writeSink(
      'x-spec-reviewer.json',
      sink({
        blockers: [
          { file: '<reviewer>', severity: 'high', message: 'subagent lane errored: boom' },
        ],
        summary: 'subagent error',
      }),
    );
    await run({ args: args({ baseSha: 'b' }), cwd: root, isEmptyDiff: async () => false });
    expect('priorReview' in reviewerInput()).toBe(false);
  });
});
