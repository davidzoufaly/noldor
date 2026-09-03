// @tests: acceptance-verify-lane, autonomous-plan-to-pr-merge, specs-cr-gate-multi-reviewer
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
vi.mock('../lanes/render-compare.js', () => ({
  runRenderCompare: vi.fn(async () => ({ lane: 'render-compare', sinkPath: 'rc', ok: true })),
}));
import { resolveLanes, run } from '../orchestrate.js';
import { ledgerDir, ledgerPath } from '../autofix-ledger.js';
import { runRenderCompare } from '../lanes/render-compare.js';
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
  it('unions codex on spec/code when the session path is spec-bearing (M/L/XL)', () => {
    expect(resolveLanes({ slug: 'x', kind: 'spec', lanes: ['manual'] }, null, 'full-new')).toEqual([
      'manual',
      'reviewer',
      'codex',
    ]);
    expect(
      resolveLanes({ slug: 'x', kind: 'code', autonomous: true }, null, 'specs-only-new'),
    ).toEqual(['reviewer', 'codex']);
  });
  it('does not force codex on plan kind, XS/S paths, or sessionless runs', () => {
    expect(
      resolveLanes({ slug: 'x', kind: 'plan', lanes: ['reviewer'] }, null, 'full-new'),
    ).toEqual(['reviewer']);
    expect(resolveLanes({ slug: 'x', kind: 'code', autonomous: true }, null, 'fast-track')).toEqual(
      ['reviewer'],
    );
    expect(resolveLanes({ slug: 'x', kind: 'code', autonomous: true }, null, null)).toEqual([
      'reviewer',
    ]);
  });
  it('does not duplicate an already-configured codex lane', () => {
    expect(
      resolveLanes(
        { slug: 'x', kind: 'code', autonomous: true },
        {
          crLanes: { code: ['reviewer', 'codex'] },
          autonomous: { skipLanePicker: true, onFailure: 'prompt', requireHumanPrApproval: false },
        },
        'full-attach',
      ),
    ).toEqual(['reviewer', 'codex']);
  });
  it('interactive empty-set sentinel survives a spec-bearing session path', () => {
    expect(resolveLanes({ slug: 'x', kind: 'spec' }, null, 'full-new')).toEqual([]);
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
  it('persists the resolved lane set for aggregate (Q-0100)', async () => {
    await run({
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
    const rec = JSON.parse(
      await readFile(join(root, '.noldor', 'cr', 'expected', 'x-spec.json'), 'utf8'),
    );
    // mandatory-reviewer union included — the record must match what actually ran
    expect(rec.lanes.toSorted()).toEqual(['manual', 'reviewer']);
    expect(rec.slug).toBe('x');
    expect(rec.kind).toBe('spec');
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
  it('carries the resolved dispatch timeout onto the lane input (default, then configured)', async () => {
    const { runSubagent } = await import('../lanes/subagent.js');
    const { DEFAULT_DISPATCH_TIMEOUT_MS } = await import('../../core/config.js');
    const args = {
      slug: 'x',
      artifact: 'docs/x.md',
      kind: 'spec' as const,
      lanes: ['reviewer' as const],
      autonomous: true,
    };
    (runSubagent as ReturnType<typeof vi.fn>).mockClear();
    await run({ args, cwd: root });
    expect((runSubagent as ReturnType<typeof vi.fn>).mock.calls[0][0].dispatchTimeoutMs).toBe(
      DEFAULT_DISPATCH_TIMEOUT_MS,
    );

    await writeFile(
      join(root, '.noldor', 'config.json'),
      JSON.stringify({ crReview: { dispatchTimeoutMs: 1_500_000 } }),
      'utf8',
    );
    (runSubagent as ReturnType<typeof vi.fn>).mockClear();
    await run({ args, cwd: root });
    expect((runSubagent as ReturnType<typeof vi.fn>).mock.calls[0][0].dispatchTimeoutMs).toBe(
      1_500_000,
    );
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

describe('ui-review lane wiring', () => {
  it('rejects ui-reviewer for non-code kinds at entry', async () => {
    for (const kind of ['spec', 'plan'] as const) {
      await expect(
        run({
          args: {
            slug: 's',
            artifact: 'spec.md',
            kind,
            lanes: ['ui-reviewer'],
            fullReview: false,
            autonomous: true,
          },
          cwd: mkdtempSync(join(tmpdir(), 'noldor-orch-ui-')),
        }),
      ).rejects.toThrow(/code-only/);
    }
  });

  it('never mints a synthetic OK for ui-reviewer on an empty artifact diff', async () => {
    // The lane's review object is the UI diff plus a design file, not --artifact;
    // and an advisory `cannot-review` sink carries no blockers, so a synthetic OK
    // would overwrite an un-performed review with a verdict-less green.
    const cwd = mkdtempSync(join(tmpdir(), 'noldor-orch-ui-delta-'));
    mkdirSync(join(cwd, '.noldor', 'cr'), { recursive: true });
    writeFileSync(
      join(cwd, '.noldor', 'cr', 's-code-ui-reviewer.json'),
      JSON.stringify({
        lane: 'ui-reviewer',
        artifact: 'a.ts',
        kind: 'code',
        slug: 's',
        blockers: [],
        suggestions: [],
        summary: 'cannot-review: pen-unreadable',
        verdict: 'cannot-review',
        reason: 'pen-unreadable',
        startedAt: new Date().toISOString(),
      }),
    );
    const result = await run({
      args: {
        slug: 's',
        artifact: 'a.ts',
        kind: 'code',
        lanes: ['ui-reviewer'],
        baseSha: 'base',
        fullReview: false,
        autonomous: true,
      },
      cwd,
      isEmptyDiff: async () => true,
    });
    expect(result.syntheticOks).not.toContain('ui-reviewer');
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

describe('render-compare lane wiring', () => {
  it('rejects render-compare for non-code kinds at entry', async () => {
    for (const kind of ['spec', 'plan'] as const) {
      await expect(
        run({
          args: {
            slug: 's',
            artifact: 'spec.md',
            kind,
            lanes: ['render-compare'],
            fullReview: false,
            autonomous: true,
          },
          cwd: mkdtempSync(join(tmpdir(), 'noldor-orch-rc-')),
        }),
      ).rejects.toThrow(/code-only/);
    }
  });

  it('never mints a synthetic OK for render-compare on an empty artifact diff', async () => {
    // Same rationale as ui-reviewer: the review object is the booted app + a
    // design raster, not the --artifact label (AC2).
    const cwd = mkdtempSync(join(tmpdir(), 'noldor-orch-rc-delta-'));
    mkdirSync(join(cwd, '.noldor', 'cr'), { recursive: true });
    writeFileSync(
      join(cwd, '.noldor', 'cr', 's-code-render-compare.json'),
      JSON.stringify({
        lane: 'render-compare',
        artifact: 'a.ts',
        kind: 'code',
        slug: 's',
        blockers: [],
        suggestions: [],
        summary: 'cannot-review: boot-failed',
        verdict: 'cannot-review',
        reason: 'boot-failed',
        startedAt: new Date().toISOString(),
      }),
    );
    const result = await run({
      args: {
        slug: 's',
        artifact: 'a.ts',
        kind: 'code',
        lanes: ['render-compare'],
        baseSha: 'base',
        fullReview: false,
        autonomous: true,
      },
      cwd,
      isEmptyDiff: async () => true,
    });
    expect(result.syntheticOks).not.toContain('render-compare');
    expect(vi.mocked(runRenderCompare)).toHaveBeenCalled();
  });

  it('starts only after the verifier lane resolves when both share the round (AC5)', async () => {
    const events: string[] = [];
    setSmokeRunner(async () => {
      await new Promise((r) => setTimeout(r, 100));
      events.push('verifier-smoke-done');
      return {
        ok: false,
        surfaces: [{ name: 'doctor', ok: false, evidence: { command: 'x', observed: 'boom' } }],
        notes: [],
      };
    });
    vi.mocked(runRenderCompare).mockImplementationOnce(async () => {
      events.push('render-compare-start');
      return { lane: 'render-compare', sinkPath: 'rc', ok: true };
    });
    const cwd = mkdtempSync(join(tmpdir(), 'noldor-orch-rc-predep-'));
    mkdirSync(join(cwd, '.noldor'), { recursive: true });
    // render-compare listed FIRST — the pre-dep must hold regardless of order.
    await run({
      args: {
        slug: 's',
        artifact: 'a.ts',
        kind: 'code',
        lanes: ['render-compare', 'verifier'],
        fullReview: false,
        autonomous: true,
      },
      cwd,
    });
    expect(events).toEqual(['verifier-smoke-done', 'render-compare-start']);
  });

  it('starts immediately when verifier is absent from the round', async () => {
    vi.mocked(runRenderCompare).mockClear();
    const cwd = mkdtempSync(join(tmpdir(), 'noldor-orch-rc-solo-'));
    mkdirSync(join(cwd, '.noldor'), { recursive: true });
    const result = await run({
      args: {
        slug: 's',
        artifact: 'a.ts',
        kind: 'code',
        lanes: ['render-compare'],
        fullReview: false,
        autonomous: true,
      },
      cwd,
    });
    expect(vi.mocked(runRenderCompare)).toHaveBeenCalledTimes(1);
    expect(result.lanesRun).toContain('render-compare');
  });
});

describe('round budget (Q-0170)', () => {
  const ARGS = {
    slug: 'x',
    artifact: 'docs/x.md',
    kind: 'spec',
    lanes: ['reviewer'],
    fullReview: false,
    autonomous: false,
  } as const;

  /** Ledger entries as prior rounds, written the way orchestrate writes them. */
  async function seedRounds(
    rounds: Array<{ headSha: string; verdict?: 'green' | 'red'; closingRound?: boolean }>,
    session = '',
  ): Promise<void> {
    await mkdir(ledgerDir(root), { recursive: true });
    await writeFile(
      ledgerPath(root, 'x' as never, 'spec'),
      JSON.stringify({
        slug: 'x',
        kind: 'spec',
        sessionStartedAt: session,
        rounds: rounds.map((r, i) => ({
          round: i + 1,
          headSha: r.headSha,
          fingerprint: `seed-${i}`,
          verdict: r.verdict ?? 'red',
          applied: 0,
          deferred: 0,
          diffStat: '',
          ...(r.closingRound ? { closingRound: true } : {}),
        })),
      }),
      'utf8',
    );
  }

  async function ledgerRounds(): Promise<Array<Record<string, unknown>>> {
    return JSON.parse(await readFile(ledgerPath(root, 'x' as never, 'spec'), 'utf8')).rounds;
  }

  it('records the FIRST dispatch, which is what makes the counter bootstrap', async () => {
    const r = await run({ args: { ...ARGS, headSha: 'aaaaaaa' }, cwd: root });
    expect(r.exitCode).toBe(0);
    const rounds = await ledgerRounds();
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({ headSha: 'aaaaaaa', round: 1 });
  });

  it('takes the verdict from the round aggregate, not from the exit code', async () => {
    // The mocked reviewer lane resolves ok but writes no sink, so `aggregate`
    // reports it unresolved and the round is red even though `run` exits 0.
    // That split is the point: the exit code also carries a failed receipt
    // amend, which is not a review finding.
    const red = await run({ args: { ...ARGS, headSha: 'aaaaaaa' }, cwd: root });
    expect(red.exitCode).toBe(0);
    expect((await ledgerRounds())[0]).toMatchObject({ verdict: 'red' });

    // A resolved sink with no blockers is what green actually means.
    await writeFile(
      join(root, '.noldor', 'cr', 'x-spec-reviewer.json'),
      JSON.stringify({
        lane: 'reviewer',
        artifact: 'docs/x.md',
        kind: 'spec',
        slug: 'x',
        blockers: [],
        suggestions: [],
        summary: 'approve',
        startedAt: '2026-09-03T00:00:00.000Z',
        finishedAt: '2026-09-03T00:00:01.000Z',
      }),
      'utf8',
    );
    await run({ args: { ...ARGS, headSha: 'bbbbbbb', autonomous: true }, cwd: root });
    expect((await ledgerRounds()).at(-1)).toMatchObject({
      headSha: 'bbbbbbb',
      verdict: 'green',
    });
  });

  it('refuses past the cap when HEAD is unchanged, and names the way out', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await seedRounds([{ headSha: 'aaaaaaa' }, { headSha: 'bbbbbbb' }, { headSha: 'ccccccc' }]);
    const r = await run({ args: { ...ARGS, headSha: 'ccccccc' }, cwd: root });
    expect(r.exitCode).toBe(3);
    expect(r.lanesRun).toEqual([]);
    const said = spy.mock.calls.flat().join('\n');
    expect(said).toContain('cap reached');
    expect(said).toContain('Noldor-Path-Override');
    spy.mockRestore();
  });

  it('green rounds never advance the budget, however many run', async () => {
    await seedRounds([
      { headSha: 'aaaaaaa', verdict: 'red' },
      { headSha: 'bbbbbbb', verdict: 'green' },
      { headSha: 'ccccccc', verdict: 'green' },
      { headSha: 'ddddddd', verdict: 'green' },
    ]);
    const r = await run({ args: { ...ARGS, headSha: 'ddddddd' }, cwd: root });
    expect(r.exitCode).toBe(0);
  });

  it('spends one closing round when a fix changed HEAD past the cap', async () => {
    await seedRounds([{ headSha: 'aaaaaaa' }, { headSha: 'bbbbbbb' }, { headSha: 'ccccccc' }]);
    const r = await run({ args: { ...ARGS, headSha: 'ddddddd' }, cwd: root });
    expect(r.exitCode).toBe(0);
    expect((await ledgerRounds()).at(-1)).toMatchObject({
      headSha: 'ddddddd',
      closingRound: true,
    });
  });

  it('refuses every dispatch after the closing round, even at a new HEAD', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await seedRounds(
      [
        { headSha: 'aaaaaaa' },
        { headSha: 'bbbbbbb' },
        { headSha: 'ccccccc' },
        { headSha: 'ddddddd', closingRound: true },
      ],
      'S1',
    );
    writeFileSync(
      join(root, '.noldor', 'session.json'),
      JSON.stringify({ path: 'fast-track', startedAt: 'S1' }),
      'utf8',
    );
    const r = await run({ args: { ...ARGS, headSha: 'eeeeeee' }, cwd: root });
    expect(r.exitCode).toBe(3);
    spy.mockRestore();
  });

  it('marks a RED closing round terminal, whatever the exit code says', async () => {
    // The mocked lanes write no sinks, so the aggregate is red while `run` exits
    // 0. Gating the sentinel on the exit code would leave a red closing round
    // unmarked and hand out another one after the next commit.
    await seedRounds([{ headSha: 'aaaaaaa' }, { headSha: 'bbbbbbb' }, { headSha: 'ccccccc' }]);
    const r = await run({ args: { ...ARGS, headSha: 'ddddddd' }, cwd: root });
    expect(r.exitCode).toBe(0);
    expect((await ledgerRounds()).at(-1)).toMatchObject({
      verdict: 'red',
      closingRound: true,
    });
  });

  it('leaves the pair open after a GREEN closing round, so re-mints stay free', async () => {
    await writeFile(
      join(root, '.noldor', 'cr', 'x-spec-reviewer.json'),
      JSON.stringify({
        lane: 'reviewer',
        artifact: 'docs/x.md',
        kind: 'spec',
        slug: 'x',
        blockers: [],
        suggestions: [],
        summary: 'approve',
        startedAt: '2026-09-03T00:00:00.000Z',
        finishedAt: '2026-09-03T00:00:01.000Z',
      }),
      'utf8',
    );
    await seedRounds([{ headSha: 'aaaaaaa' }, { headSha: 'bbbbbbb' }, { headSha: 'ccccccc' }]);
    const green = await run({
      args: { ...ARGS, headSha: 'ddddddd', autonomous: true },
      cwd: root,
    });
    expect(green.exitCode).toBe(0);
    expect((await ledgerRounds()).at(-1)).toMatchObject({ verdict: 'green' });
    expect((await ledgerRounds()).at(-1)!.closingRound).toBeUndefined();
    // The receipt is HEAD^{tree}-bound, so the next commit strips it. That
    // re-mint must still be dispatchable.
    const remint = await run({
      args: { ...ARGS, headSha: 'eeeeeee', autonomous: true },
      cwd: root,
    });
    expect(remint.exitCode).toBe(0);
  });

  it('records nothing for a run that dispatched no lane', async () => {
    // The empty lane set is the interactive "prompt the operator" sentinel — no
    // review happened, so no budget may be spent.
    const r = await run({
      args: {
        slug: 'x',
        artifact: 'docs/x.md',
        kind: 'code',
        fullReview: false,
        autonomous: false,
      },
      cwd: root,
    });
    expect(r.lanesRun).toEqual([]);
    await expect(readFile(ledgerPath(root, 'x' as never, 'code'), 'utf8')).rejects.toThrow();
  });

  it('does not record expected lanes for a refused dispatch', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await seedRounds([{ headSha: 'aaaaaaa' }, { headSha: 'bbbbbbb' }, { headSha: 'ccccccc' }]);
    const r = await run({ args: { ...ARGS, headSha: 'ccccccc' }, cwd: root });
    expect(r.exitCode).toBe(3);
    // A refused run dispatches nothing, so writing its lane set would leave
    // `aggregate` reporting a never-dispatched lane unresolved — red forever,
    // including for the closing round meant to rescue the session.
    expect(await readdir(join(root, '.noldor', 'cr'))).not.toContain('x-spec-expected-lanes.json');
    spy.mockRestore();
  });

  it('leaves the cap inert when the ledger cannot be parsed', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await mkdir(ledgerDir(root), { recursive: true });
    await writeFile(ledgerPath(root, 'x' as never, 'spec'), '{ not json', 'utf8');
    // Fail-open: a missed cap costs one dispatch, a false cap costs the ship.
    const r = await run({ args: { ...ARGS, headSha: 'aaaaaaa' }, cwd: root });
    expect(r.exitCode).toBe(0);
    spy.mockRestore();
  });
});
