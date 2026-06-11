// @tests: autonomous-plan-to-pr-merge
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
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
  runSubagent: vi.fn(async () => ({ lane: 'subagent', sinkPath: 's', ok: true })),
}));
import { resolveLanes, run } from '../orchestrate.js';

describe('resolveLanes', () => {
  it('CLI --lanes wins', () => {
    expect(resolveLanes({ slug: 'x', kind: 'spec', lanes: ['manual'] }, null)).toEqual(['manual']);
  });
  it('config default applied when CLI unset + skipLanePicker', () => {
    expect(
      resolveLanes(
        { slug: 'x', kind: 'spec' },
        {
          crLanes: { spec: ['subagent'] },
          autonomous: { skipLanePicker: true, onFailure: 'prompt', requireHumanPrApproval: false },
        },
      ),
    ).toEqual(['subagent']);
  });
  it('autonomous + no config => built-in defaults (no throw)', () => {
    expect(resolveLanes({ slug: 'x', kind: 'spec', autonomous: true }, null)).toEqual(['subagent']);
    expect(resolveLanes({ slug: 'x', kind: 'code', autonomous: true }, null)).toEqual(['subagent']);
  });
  it('configured crLanes overrides built-in default (shift 2: autonomous + skipLanePicker:false)', () => {
    expect(
      resolveLanes(
        { slug: 'x', kind: 'code', autonomous: true },
        {
          crLanes: { code: ['subagent', 'codex'] },
          autonomous: { skipLanePicker: false, onFailure: 'prompt', requireHumanPrApproval: false },
        },
      ),
    ).toEqual(['subagent', 'codex']);
  });
  it('skipLanePicker:true + absent crLanes => built-in defaults (shift 3, no --autonomous flag)', () => {
    expect(
      resolveLanes(
        { slug: 'x', kind: 'plan' },
        {
          autonomous: { skipLanePicker: true, onFailure: 'prompt', requireHumanPrApproval: false },
        },
      ),
    ).toEqual(['subagent']);
  });
  it('interactive + no CLI flag => returns empty (signal: skill prompts)', () => {
    expect(resolveLanes({ slug: 'x', kind: 'spec' }, null)).toEqual([]);
  });
});

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orc-'));
  await mkdir(join(root, '.noldor', 'cr'), { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('run (orchestrate)', () => {
  it('runs requested lanes via Promise.allSettled', async () => {
    const result = await run({
      args: {
        slug: 'x',
        artifact: 'docs/x.md',
        kind: 'spec',
        lanes: ['subagent', 'manual'],
        fullReview: false,
        autonomous: false,
      },
      cwd: root,
    });
    expect(result.lanesRun.toSorted()).toEqual(['manual', 'subagent']);
    expect(result.exitCode).toBe(0);
  });
  it('rejects standalone as a runnable lane with an escalate pointer', async () => {
    await expect(
      run({
        args: {
          slug: 'x',
          artifact: 'docs/x.md',
          kind: 'spec',
          lanes: ['standalone'],
          fullReview: false,
          autonomous: false,
        },
        cwd: root,
      }),
    ).rejects.toThrow(/no longer an orchestrate lane.*escalate/);
  });
  it('exit 1 when any sync lane fails', async () => {
    const { runSubagent } = await import('../lanes/subagent.js');
    (runSubagent as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      lane: 'subagent',
      sinkPath: 's',
      ok: false,
    });
    const result = await run({
      args: {
        slug: 'x',
        artifact: 'docs/x.md',
        kind: 'spec',
        lanes: ['subagent'],
        fullReview: false,
        autonomous: false,
      },
      cwd: root,
    });
    expect(result.exitCode).toBe(1);
  });
  it('skips lane when prior sink shows empty delta + baseSha set', async () => {
    const result = await run({
      args: {
        slug: 'x',
        artifact: 'docs/x.md',
        kind: 'spec',
        lanes: ['subagent'],
        baseSha: 'aaa',
        fullReview: false,
        autonomous: false,
      },
      cwd: root,
      isEmptyDiff: async () => true,
    });
    expect(result.syntheticOks).toContain('subagent');
  });
  it('autonomous flag reaches guardLaneOverwrite (prior sink → archive default)', async () => {
    const { writeFile, readdir } = await import('node:fs/promises');
    await writeFile(
      join(root, '.noldor', 'cr', 'x-spec-subagent.json'),
      JSON.stringify({
        lane: 'subagent',
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
    const result = await run({
      args: {
        slug: 'x',
        artifact: 'docs/x.md',
        kind: 'spec',
        lanes: ['subagent'],
        fullReview: false,
        autonomous: true,
      },
      cwd: root,
    });
    expect(result.exitCode).toBe(0);
    const archive = await readdir(join(root, '.noldor', 'cr', 'archive'));
    expect(archive.length).toBe(1);
  });
});
