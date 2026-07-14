// @tests: acceptance-verify-lane, autonomous-plan-to-pr-merge, specs-cr-gate-multi-reviewer
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
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
import { resolveLanes, run } from '../orchestrate.js';
import { setSmokeRunner } from '../lanes/verify.js';
import { setVerifyDispatcher } from '../lanes/verify-dispatch.js';

describe('resolveLanes', () => {
  it('CLI --lanes wins', () => {
    expect(resolveLanes({ slug: 'x', kind: 'spec', lanes: ['manual'] }, null)).toEqual(['manual']);
  });
  it('config default applied when CLI unset + skipLanePicker', () => {
    expect(
      resolveLanes(
        { slug: 'x', kind: 'spec' },
        {
          crLanes: { spec: ['reviewer'] },
          autonomous: { skipLanePicker: true, onFailure: 'prompt', requireHumanPrApproval: false },
        },
      ),
    ).toEqual(['reviewer']);
  });
  it('autonomous + no config => built-in defaults (no throw)', () => {
    expect(resolveLanes({ slug: 'x', kind: 'spec', autonomous: true }, null)).toEqual(['reviewer']);
    expect(resolveLanes({ slug: 'x', kind: 'code', autonomous: true }, null)).toEqual(['reviewer']);
  });
  it('configured crLanes overrides built-in default (shift 2: autonomous + skipLanePicker:false)', () => {
    expect(
      resolveLanes(
        { slug: 'x', kind: 'code', autonomous: true },
        {
          crLanes: { code: ['reviewer', 'codex'] },
          autonomous: { skipLanePicker: false, onFailure: 'prompt', requireHumanPrApproval: false },
        },
      ),
    ).toEqual(['reviewer', 'codex']);
  });
  it('skipLanePicker:true + absent crLanes => built-in defaults (shift 3, no --autonomous flag)', () => {
    expect(
      resolveLanes(
        { slug: 'x', kind: 'plan' },
        {
          autonomous: { skipLanePicker: true, onFailure: 'prompt', requireHumanPrApproval: false },
        },
      ),
    ).toEqual(['reviewer']);
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
        lanes: ['reviewer', 'manual'],
        fullReview: false,
        autonomous: false,
      },
      cwd: root,
    });
    expect(result.lanesRun.toSorted()).toEqual(['manual', 'reviewer']);
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
      lane: 'reviewer',
      sinkPath: 's',
      ok: false,
    });
    const result = await run({
      args: {
        slug: 'x',
        artifact: 'docs/x.md',
        kind: 'spec',
        lanes: ['reviewer'],
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
        lanes: ['reviewer'],
        baseSha: 'aaa',
        fullReview: false,
        autonomous: false,
      },
      cwd: root,
      isEmptyDiff: async () => true,
    });
    expect(result.syntheticOks).toContain('reviewer');
  });
  it('autonomous flag reaches guardLaneOverwrite (prior sink → archive default)', async () => {
    const { writeFile, readdir } = await import('node:fs/promises');
    await writeFile(
      join(root, '.noldor', 'cr', 'x-spec-reviewer.json'),
      JSON.stringify({
        lane: 'reviewer',
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
        lanes: ['reviewer'],
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

describe('verify lane wiring', () => {
  it('rejects verify for non-code kinds at entry', async () => {
    await expect(
      run({
        args: {
          slug: 's',
          artifact: 'spec.md',
          kind: 'spec',
          lanes: ['verifier'],
          fullReview: false,
          autonomous: true,
        },
        cwd: mkdtempSync(join(tmpdir(), 'noldor-orch-')),
      }),
    ).rejects.toThrow(/code-only/);
  });
});

describe('verify lane positive wiring', () => {
  it('crLanes.code containing verify resolves AND dispatches runVerify through run()', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'noldor-orch-verify-'));
    await mkdir(join(cwd, '.noldor'), { recursive: true });
    await mkdir(join(cwd, 'docs', 'features'), { recursive: true });
    await writeFile(
      join(cwd, '.noldor', 'config.json'),
      JSON.stringify({ crLanes: { code: ['verifier'] } }),
    );
    await writeFile(
      join(cwd, 'docs', 'features', 'wired.md'),
      '## Summary\n\nDoes the thing.\n\n## Usage\n\n- run it\n',
    );
    setSmokeRunner(async () => ({ ok: true, surfaces: [], notes: [] }));
    setVerifyDispatcher(
      async () => '```json\n{"verdict":"pass","evidence":[],"mismatches":[]}\n```',
    );
    const r = await run({
      args: {
        slug: 'wired',
        artifact: '.',
        kind: 'code',
        fullReview: false,
        autonomous: true,
        headSha: 'head',
      },
      cwd,
    });
    expect(r.lanesRun).toEqual(['verifier']);
    expect(r.exitCode).toBe(0);
    const sink = JSON.parse(
      await readFile(join(cwd, '.noldor', 'cr', 'wired-code-verifier.json'), 'utf8'),
    );
    expect(sink.verdict).toBe('pass');
  });
});

import { parseArgs } from '../orchestrate-args.js';

describe('--profile arg', () => {
  it('parses --profile', () => {
    const a = parseArgs([
      'node',
      'x',
      '--slug',
      's',
      '--artifact',
      'a',
      '--kind',
      'code',
      '--profile',
      'fast-track',
    ]);
    expect(a.profile).toBe('fast-track');
  });
  it('leaves profile undefined when absent', () => {
    const a = parseArgs(['node', 'x', '--slug', 's', '--artifact', 'a', '--kind', 'code']);
    expect(a.profile).toBeUndefined();
  });
});
