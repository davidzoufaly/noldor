// @tests: acceptance-verify-lane, specs-cr-gate-multi-reviewer, review-run-lifecycle-module
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The lane now calls reviewWithCodex in-process rather than shelling out through pnpm, so the
// seam under test is that function — not a child process.
const { reviewFn } = vi.hoisted(() => ({ reviewFn: vi.fn() }));
vi.mock('../../review-with-codex.js', () => ({ reviewWithCodex: reviewFn }));

const { spawnFactory } = vi.hoisted(() => ({ spawnFactory: vi.fn(() => 'SPAWN') }));
vi.mock('../../codex-adapter.js', () => ({ makeCodexSpawn: spawnFactory }));

import { DEFAULT_DISPATCH_TIMEOUT_MS } from '../../../core/config.js';
import { runCodex } from '../../lanes/codex.js';
import type { LaneInput } from '../../lane-types.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'codex-'));
  await mkdir(join(root, '.noldor', 'cr'), { recursive: true });
  reviewFn.mockReset();
  spawnFactory.mockClear();
  reviewFn.mockResolvedValue({ summary: 'ok', findings: [] });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function input(over: Partial<LaneInput> = {}): LaneInput {
  return {
    slug: 's',
    kind: 'spec',
    artifact: 'docs/design/specs/x.md',
    repoRoot: root,
    ...over,
  } as LaneInput;
}

async function sink(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(root, '.noldor', 'cr', 's-spec-codex.json'), 'utf8'));
}

describe('runCodex lane — process ownership', () => {
  it('spawns unattended: a cap, and no foreground (so the registry detaches and group-kills)', async () => {
    await runCodex(input({ dispatchTimeoutMs: 4242 }));
    expect(spawnFactory).toHaveBeenCalledWith({ timeoutMs: 4242, cwd: root });
    expect(spawnFactory.mock.calls[0]![0]).not.toHaveProperty('foreground');
  });

  it('defaults to DEFAULT_DISPATCH_TIMEOUT_MS, not the old hard-coded 120_000', async () => {
    await runCodex(input());
    expect(spawnFactory).toHaveBeenCalledWith({
      timeoutMs: DEFAULT_DISPATCH_TIMEOUT_MS,
      cwd: root,
    });
  });

  it('passes the cap to the review so a timeout can name itself', async () => {
    await runCodex(input({ dispatchTimeoutMs: 999 }));
    expect(reviewFn.mock.calls[0]![3]).toEqual({ timeoutMs: 999 });
  });

  it('never shells out', async () => {
    // The whole point of the unit: no pnpm, no CLI subprocess, nothing between the cap and
    // codex. reviewWithCodex is called directly with the review descriptor.
    await runCodex(input());
    expect(reviewFn).toHaveBeenCalledTimes(1);
    expect(reviewFn.mock.calls[0]![1]).toBe(root);
    expect(reviewFn.mock.calls[0]![2]).toBe('SPAWN');
  });
});

describe('runCodex lane — findings mapping', () => {
  it('splits findings into blockers and suggestions by severity', async () => {
    reviewFn.mockResolvedValue({
      summary: 'two',
      findings: [
        { file: 'a.ts', message: 'bad', severity: 'high' },
        { file: 'b.ts', message: 'meh', severity: 'med' },
      ],
    });
    const r = await runCodex(input());
    const s = await sink();
    expect(s.blockers).toHaveLength(1);
    expect(s.suggestions).toHaveLength(1);
    expect(r.ok).toBe(false);
  });

  it('is ok when there are no blockers', async () => {
    const r = await runCodex(input());
    expect(r.ok).toBe(true);
    expect((await sink()).summary).toBe('ok');
  });

  it('records the sink path the aggregator expects', async () => {
    const r = await runCodex(input());
    expect(r.sinkPath).toBe(join(root, '.noldor', 'cr', 's-spec-codex.json'));
    expect(r.lane).toBe('codex');
  });
});

describe('runCodex lane — base-sha', () => {
  it('forwards baseSha to the review and records it in the sink', async () => {
    // This is the behaviour codexSupportsBaseSha silently suppressed: the probe grepped
    // intercepted --help output, could never return true, and so every artifact review ran
    // full-scope with baseSha never reaching a sink.
    await runCodex(input({ baseSha: 'abc123' }));
    expect(reviewFn.mock.calls[0]![0]).toMatchObject({ baseSha: 'abc123', fullReview: false });
    expect((await sink()).baseSha).toBe('abc123');
  });

  it('omits baseSha from the sink under fullReview', async () => {
    await runCodex(input({ baseSha: 'abc123', fullReview: true }));
    expect(reviewFn.mock.calls[0]![0]).toMatchObject({ fullReview: true });
    expect(await sink()).not.toHaveProperty('baseSha');
  });

  it('carries the kind through unchanged for all three kinds', async () => {
    for (const kind of ['spec', 'plan', 'code'] as const) {
      reviewFn.mockClear();
      await runCodex(input({ kind }));
      expect(reviewFn.mock.calls[0]![0]).toMatchObject({ kind });
    }
  });
});
