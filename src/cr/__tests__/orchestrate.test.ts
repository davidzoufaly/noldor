// @tests: acceptance-verify-lane, autonomous-plan-to-pr-merge, specs-cr-gate-multi-reviewer
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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
  it('CLI --lanes wins (reviewer appended — mandatory on spec)', () => {
    expect(resolveLanes({ slug: 'x', kind: 'spec', lanes: ['manual'] }, null)).toEqual([
      'manual',
      'reviewer',
    ]);
  });
  it('CLI --lanes wins verbatim on code (reviewer not forced there)', () => {
    expect(resolveLanes({ slug: 'x', kind: 'code', lanes: ['manual'] }, null)).toEqual(['manual']);
  });
  it('does not duplicate an already-picked reviewer lane', () => {
    expect(resolveLanes({ slug: 'x', kind: 'plan', lanes: ['reviewer', 'manual'] }, null)).toEqual([
      'reviewer',
      'manual',
    ]);
  });
  it('unions reviewer into a configured crLanes set that omits it', () => {
    expect(
      resolveLanes(
        { slug: 'x', kind: 'plan', autonomous: true },
        {
          crLanes: { plan: ['manual'] },
          autonomous: { skipLanePicker: true, onFailure: 'prompt', requireHumanPrApproval: false },
        },
      ),
    ).toEqual(['manual', 'reviewer']);
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
  it('runs the reviewer lane on a spec even when it was not requested, and says so', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await run({
      args: {
        slug: 'x',
        artifact: 'docs/x.md',
        kind: 'spec',
        lanes: ['manual'],
        fullReview: false,
        autonomous: false,
      },
      cwd: root,
    });
    expect(result.lanesRun.toSorted()).toEqual(['manual', 'reviewer']);
    expect(result.exitCode).toBe(0);
    expect(spy.mock.calls.flat().join('\n')).toContain("lane 'reviewer' is mandatory for spec");
    spy.mockRestore();
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
        baseSha: 'aaa',
        fullReview: false,
        autonomous: true,
      },
      cwd: root,
      isEmptyDiff: async () => true,
    });
    expect(result.syntheticOks).toContain('reviewer');
  });
  it('runs the mandatory reviewer lane on an empty delta when it has no prior sink', async () => {
    const { runSubagent } = await import('../lanes/subagent.js');
    (runSubagent as ReturnType<typeof vi.fn>).mockClear();
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
    expect(result.syntheticOks).toEqual([]);
    expect(result.lanesRun).toEqual(['reviewer']);
    // ...and over the whole artifact: a delta prompt here would review nothing.
    const dispatched = (runSubagent as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(dispatched.fullReview).toBe(true);
    expect(dispatched.baseSha).toBeUndefined();
  });
  it('re-runs the mandatory reviewer lane on an empty delta when the prior sink was red', async () => {
    await writeFile(
      join(root, '.noldor', 'cr', 'x-spec-reviewer.json'),
      JSON.stringify({
        lane: 'reviewer',
        artifact: 'docs/x.md',
        kind: 'spec',
        slug: 'x',
        blockers: [{ file: 'docs/x.md', severity: 'high', message: 'unaddressed' }],
        suggestions: [],
        summary: 'blockers found',
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
        baseSha: 'aaa',
        fullReview: false,
        autonomous: true,
      },
      cwd: root,
      isEmptyDiff: async () => true,
    });
    expect(result.syntheticOks).toEqual([]);
    expect(result.lanesRun).toEqual(['reviewer']);
  });
  it('runs a code-kind reviewer lane with no prior sink rather than synthesizing a pass', async () => {
    const { runSubagent } = await import('../lanes/subagent.js');
    (runSubagent as ReturnType<typeof vi.fn>).mockClear();
    const result = await run({
      args: {
        slug: 'x',
        artifact: 'src/x.ts',
        kind: 'code',
        lanes: ['reviewer'],
        baseSha: 'aaa',
        fullReview: false,
        autonomous: false,
      },
      cwd: root,
      isEmptyDiff: async () => true,
    });
    // A comma-joined `--artifact` matches no pathspec → empty diff on a branch
    // that did change. The prior-run gate is what stops that from minting a
    // green code-stage sink (and, downstream, a push receipt) on a first pass.
    expect(result.syntheticOks).toEqual([]);
    expect(result.lanesRun).toEqual(['reviewer']);
    expect((runSubagent as ReturnType<typeof vi.fn>).mock.calls[0][0].fullReview).toBe(true);
  });
  it('short-circuits a code-kind lane whose prior sink went green', async () => {
    await writeFile(
      join(root, '.noldor', 'cr', 'x-code-reviewer.json'),
      JSON.stringify({
        lane: 'reviewer',
        artifact: 'src/x.ts',
        kind: 'code',
        slug: 'x',
        blockers: [],
        suggestions: [],
        summary: 'prior green',
        startedAt: '2026-08-06T00:00:00.000Z',
        finishedAt: '2026-08-06T00:01:00.000Z',
      }),
      'utf8',
    );
    const result = await run({
      args: {
        slug: 'x',
        artifact: 'src/x.ts',
        kind: 'code',
        lanes: ['reviewer'],
        baseSha: 'aaa',
        fullReview: false,
        autonomous: true,
      },
      cwd: root,
      isEmptyDiff: async () => true,
    });
    expect(result.syntheticOks).toEqual(['reviewer']);
  });
  it('re-runs a code-kind lane whose prior sink was red (no green-wash)', async () => {
    const { runSubagent } = await import('../lanes/subagent.js');
    (runSubagent as ReturnType<typeof vi.fn>).mockClear();
    (runSubagent as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      lane: 'reviewer',
      sinkPath: 's',
      ok: false,
    });
    await writeFile(
      join(root, '.noldor', 'cr', 'x-code-reviewer.json'),
      JSON.stringify({
        lane: 'reviewer',
        artifact: 'src/x.ts',
        kind: 'code',
        slug: 'x',
        blockers: [{ file: 'src/x.ts', severity: 'high', message: 'unaddressed' }],
        suggestions: [],
        summary: 'blockers found',
        startedAt: '2026-08-06T00:00:00.000Z',
        finishedAt: '2026-08-06T00:01:00.000Z',
      }),
      'utf8',
    );
    const result = await run({
      args: {
        slug: 'x',
        artifact: 'src/x.ts',
        kind: 'code',
        lanes: ['reviewer'],
        baseSha: 'aaa',
        fullReview: false,
        autonomous: true,
      },
      cwd: root,
      isEmptyDiff: async () => true,
    });
    expect(result.syntheticOks).toEqual([]);
    // Red stays red: the no-op re-run reports the blockers, not a synthetic pass.
    expect(result.exitCode).toBe(1);
  });
  it('re-runs a non-reviewer lane whose prior sink was red', async () => {
    const { runManual } = await import('../lanes/manual.js');
    (runManual as ReturnType<typeof vi.fn>).mockClear();
    await writeFile(
      join(root, '.noldor', 'cr', 'x-spec-manual.json'),
      JSON.stringify({
        lane: 'manual',
        artifact: 'docs/x.md',
        kind: 'spec',
        slug: 'x',
        blockers: [{ file: 'docs/x.md', severity: 'med', message: 'operator blocker' }],
        suggestions: [],
        summary: 'blockers found',
        startedAt: '2026-08-06T00:00:00.000Z',
        finishedAt: '2026-08-06T00:01:00.000Z',
      }),
      'utf8',
    );
    await writeFile(
      join(root, '.noldor', 'cr', 'x-spec-reviewer.json'),
      JSON.stringify({
        lane: 'reviewer',
        artifact: 'docs/x.md',
        kind: 'spec',
        slug: 'x',
        blockers: [],
        suggestions: [],
        summary: 'prior green',
        startedAt: '2026-08-06T00:00:00.000Z',
        finishedAt: '2026-08-06T00:01:00.000Z',
      }),
      'utf8',
    );
    const result = await run({
      args: {
        slug: 'x',
        artifact: 'docs/x.md',
        kind: 'spec',
        lanes: ['manual', 'reviewer'],
        baseSha: 'aaa',
        fullReview: false,
        autonomous: true,
      },
      cwd: root,
      isEmptyDiff: async () => true,
    });
    // Only the green reviewer lane short-circuits; the red manual lane re-runs,
    // so its unaddressed blockers are not overwritten by `blockers: []`.
    expect(result.syntheticOks).toEqual(['reviewer']);
    expect((runManual as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
  it('autonomous flag reaches guardLaneOverwrite (prior sink → archive default)', async () => {
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
