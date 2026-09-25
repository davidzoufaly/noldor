// @tests: acceptance-verify-lane, make-noldor-agent-agnostic, noldor, cr-lane-verdicts-blocked-by-serialization-not-substance, cr-re-round-cap-enforcement-and-oscillation-detector, spec-stage-cr-stopping-rule
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runCodex, type Spawn } from '../run-codex.js';
import { reviewWithCodex, toFindings } from '../review-with-codex.js';
import { REV_RE } from '../cli-args.js';
import { CUT_MARKER_TOKEN } from '../../core/structural-context-contract.js';
import { BLOCKING_DEFINITION, SPEC_BLOCKING_DEFINITION } from '../blocking-definition.js';

const ctx = { diff: 'D', featureMd: 'F', rules: 'R' };

describe('runCodex', () => {
  it('returns the parsed CR record on valid JSON', async () => {
    const spawn: Spawn = vi.fn(async () => ({
      stdout: JSON.stringify({ blockers: [], suggestions: [], summary: 'ok', prior: [] }),
      stderr: '',
      exitCode: 0,
      timedOut: false,
    }));
    const out = await runCodex({ ctx, spawn });
    expect(out.summary).toBe('ok');
    expect(out.blockers).toEqual([]);
  });

  it('treats non-JSON as a synthetic blocker', async () => {
    const spawn: Spawn = vi.fn(async () => ({ stdout: '!!! not json', stderr: '', exitCode: 0 }));
    const out = await runCodex({ ctx, spawn });
    expect(out.blockers).toHaveLength(1);
    expect(out.blockers[0].message).toMatch(/malformed CR record/i);
  });

  it('treats schema-failed JSON as a synthetic blocker', async () => {
    const spawn: Spawn = vi.fn(async () => ({
      stdout: JSON.stringify({ blockers: 'oops', suggestions: [], summary: '' }),
      stderr: '',
      exitCode: 0,
      timedOut: false,
    }));
    const out = await runCodex({ ctx, spawn });
    expect(out.blockers[0].message).toMatch(/malformed CR record/i);
  });

  it('propagates non-zero exit as a synthetic blocker', async () => {
    const spawn: Spawn = vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 2 }));
    const out = await runCodex({ ctx, spawn });
    expect(out.blockers[0].message).toMatch(/exit code 2/);
  });

  it('turns auth-shaped stderr into an explicit `codex login` hint', async () => {
    const spawn: Spawn = vi.fn(async () => ({
      stdout: '',
      stderr: 'ERROR: no valid credentials found for this account\n',
      exitCode: 1,
      timedOut: false,
    }));
    const out = await runCodex({ ctx, spawn });
    expect(out.blockers).toHaveLength(1);
    expect(out.blockers[0].message).toContain('codex login');
    expect(out.blockers[0].message).toMatch(/exit code 1/);
  });

  it('bounds a huge non-auth stderr to a tail and reports its true size', async () => {
    // The shape that deadlocked the old spawn: codex 0.133.0 emits ~326 KB of
    // models-cache noise. It must reach the sink bounded, and must NOT be read as auth.
    const noise = `ERROR codex_models_manager::cache: unknown variant \`max\`\n${'x'.repeat(326_525)}`;
    const spawn: Spawn = vi.fn(async () => ({ stdout: '', stderr: noise, exitCode: 1 }));
    const out = await runCodex({ ctx, spawn });
    const msg = out.blockers[0].message;
    expect(msg).toContain(`of ${Buffer.byteLength(noise, 'utf8')} bytes`);
    expect(msg).not.toContain('codex login');
    // Bounded: the tail cap plus the surrounding message, nowhere near 326 KB.
    expect(msg.length).toBeLessThan(4500);
  });

  it('names the probed CLI version in a failure, and never throws when the probe fails', async () => {
    const failing: Spawn = vi.fn(async () => ({
      stdout: '',
      stderr: 'boom',
      exitCode: 3,
      timedOut: false,
    }));
    const named = await runCodex({
      ctx,
      spawn: failing,
      probe: async () => 'codex-cli 0.133.0',
    });
    expect(named.blockers[0].message).toContain('codex-cli 0.133.0');

    // The probe never throws by contract; if it somehow degrades, the failure it was
    // attributing must still surface rather than being masked.
    const out = await runCodex({
      ctx,
      spawn: failing,
      probe: async () => 'codex (version unknown)',
    });
    expect(out.blockers[0].message).toMatch(/version unknown/);
    expect(out.blockers[0].message).toMatch(/exit code 3/);
  });

  it('recovers the CR record from stdout wrapped in non-JSON noise', async () => {
    const spawn: Spawn = vi.fn(async () => ({
      stdout: `> some banner\n${JSON.stringify({ blockers: [], suggestions: [], summary: 'ok', prior: [] })}\ntrailing chatter`,
      stderr: '',
      exitCode: 0,
      timedOut: false,
    }));
    const out = await runCodex({ ctx, spawn });
    expect(out.summary).toBe('ok');
    expect(out.blockers).toEqual([]);
  });

  it('hands the prompt to the spawn and owns no argv of its own', async () => {
    // Argv belongs to the agent registry now (see codex-adapter). runCodex passing only
    // stdin is what makes it impossible for a caller to redirect the review spawn.
    const spawn: Spawn = vi.fn(async () => ({
      stdout: JSON.stringify({ blockers: [], suggestions: [], summary: 'ok', prior: [] }),
      stderr: '',
      exitCode: 0,
      timedOut: false,
    }));
    await runCodex({ ctx, spawn });
    expect(spawn).toHaveBeenCalledTimes(1);
    const call = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(Object.keys(call)).toEqual(['stdin']);
    expect(typeof call.stdin).toBe('string');
  });

  it('embeds the JSON-only directive at the top of the prompt', async () => {
    const spawn: Spawn = vi.fn(async () => ({
      stdout: JSON.stringify({ blockers: [], suggestions: [], summary: 'ok', prior: [] }),
      stderr: '',
      exitCode: 0,
      timedOut: false,
    }));
    await runCodex({ ctx, spawn });
    const call = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.stdin).toMatch(/^Respond ONLY with a JSON object/);
    expect(call.stdin).toMatch(/Do not call tools/);
  });

  it('plan ctx → plan-review prompt with artifact content and plan heuristics', async () => {
    const spawn: Spawn = vi.fn(async () => ({
      stdout: JSON.stringify({ blockers: [], suggestions: [], summary: 'ok', prior: [] }),
      stderr: '',
      exitCode: 0,
      timedOut: false,
    }));
    await runCodex({
      ctx: { kind: 'plan', artifact: '## My plan body', featureMd: 'F', rules: 'R' },
      spawn,
    });
    const call = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.stdin).toMatch(/^Respond ONLY with a JSON object/);
    expect(call.stdin).toMatch(/plan/i);
    expect(call.stdin).toMatch(/edge case/i);
    expect(call.stdin).toMatch(/acceptance criteria/i);
    expect(call.stdin).toMatch(/placeholder/i);
    expect(call.stdin).toContain('## My plan body');
    // plan review reads the artifact, not a code diff
    expect(call.stdin).not.toMatch(/Diff to review/);
  });

  it('spec ctx → spec-review prompt mentioning spec', async () => {
    const spawn: Spawn = vi.fn(async () => ({
      stdout: JSON.stringify({ blockers: [], suggestions: [], summary: 'ok', prior: [] }),
      stderr: '',
      exitCode: 0,
      timedOut: false,
    }));
    await runCodex({
      ctx: { kind: 'spec', artifact: 'SPEC TEXT', featureMd: 'F', rules: 'R' },
      spawn,
    });
    const call = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.stdin).toMatch(/spec/i);
    expect(call.stdin).toContain('SPEC TEXT');
  });
});

describe('cut-marker contract in the codex prompt (Q-0170)', () => {
  /** Capture the prompt the lane actually hands codex on stdin. */
  function capturingSpawn(): { spawn: Spawn; stdin: () => string } {
    let seen = '';
    const spawn: Spawn = vi.fn(async (opts: { stdin: string }) => {
      seen = opts.stdin;
      return {
        stdout: JSON.stringify({ blockers: [], suggestions: [], summary: 'ok', prior: [] }),
        stderr: '',
        exitCode: 0,
        timedOut: false,
      };
    }) as unknown as Spawn;
    return { spawn, stdin: () => seen };
  }

  it('tells codex a marked cut is a decision on a CODE review', async () => {
    const { spawn, stdin } = capturingSpawn();
    await runCodex({ ctx, spawn });
    expect(stdin()).toContain(CUT_MARKER_TOKEN);
    expect(stdin()).toContain('a marked cut is a deliberate decision');
  });

  it('tells codex the same on a SPEC review, where the markers actually live', async () => {
    // `formatPrompt` early-returns the artifact builder, so an injection inside
    // the code branch alone would leave spec and plan reviews with no contract —
    // the stage where cut markers in FDs and structural-context sections sit.
    const { spawn, stdin } = capturingSpawn();
    await runCodex({ ctx: { artifact: 'A', kind: 'spec', featureMd: 'F', rules: 'R' }, spawn });
    expect(stdin()).toContain(CUT_MARKER_TOKEN);
  });

  it('renders the shared blocking definition on code and plan reviews, the spec one on spec reviews', async () => {
    const code = capturingSpawn();
    await runCodex({ ctx, spawn: code.spawn });
    expect(code.stdin()).toContain(BLOCKING_DEFINITION);
    const plan = capturingSpawn();
    await runCodex({
      ctx: { artifact: 'A', kind: 'plan', featureMd: 'F', rules: 'R' },
      spawn: plan.spawn,
    });
    expect(plan.stdin()).toContain(BLOCKING_DEFINITION);
    const spec = capturingSpawn();
    await runCodex({
      ctx: { artifact: 'A', kind: 'spec', featureMd: 'F', rules: 'R' },
      spawn: spec.spawn,
    });
    expect(spec.stdin()).toContain(SPEC_BLOCKING_DEFINITION);
    expect(spec.stdin()).not.toContain(BLOCKING_DEFINITION);
  });

  it('never lets a marker waive a defect, a race or an accessibility regression', async () => {
    const { spawn, stdin } = capturingSpawn();
    await runCodex({ ctx, spawn });
    for (const carveOut of ['defect', 'race', 'accessibility regression']) {
      expect(stdin()).toContain(carveOut);
    }
  });
});

describe('base-sha argv-injection guard', () => {
  const review = (baseSha: string) => ({
    kind: 'spec' as const,
    artifact: 'docs/x.md',
    slug: 's',
    fullReview: false,
    baseSha,
  });
  const neverSpawn = vi.fn(async () => {
    throw new Error('spawn must not be reached');
  });

  it.each([
    ['--output=/tmp/pwned', 'a git option, not a rev — would turn review into a file write'],
    ['-x', 'any leading dash is parsed by git as an option'],
  ])('refuses %s before it reaches a git argv', async (bad) => {
    const out = await reviewWithCodex(review(bad), process.cwd(), neverSpawn as never);
    expect(out.findings[0]!.message).toMatch(/invalid baseSha/);
    expect(neverSpawn).not.toHaveBeenCalled();
  });

  it('accepts an ordinary sha', () => {
    expect(REV_RE.test('0f2549ac331daa43a0291a4cb18ecbc8b16238c4')).toBe(true);
    expect(REV_RE.test('origin/main')).toBe(true);
  });
});

describe('toFindings never-blocks demotion (Q-0250)', () => {
  it('moves a codex blocker marked maybe: or unverified: to the suggestions', () => {
    const record = {
      summary: 's',
      blockers: [
        {
          file: 'a.ts',
          line: 1,
          severity: 'high' as const,
          message: 'real defect',
          suggestion: null,
        },
        {
          file: 'a.ts',
          line: 2,
          severity: 'high' as const,
          message: 'maybe: a race',
          suggestion: null,
        },
        {
          file: 'a.ts',
          line: 3,
          severity: null,
          message: 'Unverified: typecheck may fail',
          suggestion: null,
        },
      ],
      suggestions: [],
    };
    expect(toFindings(record, 'x', 'code').map((f) => f.severity)).toEqual(['high', 'med', 'med']);
  });
});

describe('prior blockers in the codex prompt (Q-0260)', () => {
  const p1 = { file: 'docs/x.md', severity: 'high' as const, message: 'first prior' };
  const prior = { mode: 'fixes-in-diff' as const, blockers: [p1] };
  function capture(
    record: Record<string, unknown> = { blockers: [], suggestions: [], summary: 'ok', prior: [] },
  ): { spawn: Spawn; stdin: () => string } {
    let seen = '';
    const spawn: Spawn = vi.fn(async (opts: { stdin: string }) => {
      seen = opts.stdin;
      return { stdout: JSON.stringify(record), stderr: '', exitCode: 0, timedOut: false };
    }) as unknown as Spawn;
    return { spawn, stdin: () => seen };
  }

  it('renders the numbered priors after the blocking definition in a code review', async () => {
    const { spawn, stdin } = capture();
    await runCodex({ ctx: { ...ctx, prior }, spawn });
    expect(stdin()).toContain('P1 [high] first prior');
    expect(stdin()).toContain('regression the fix caused');
    expect(stdin().indexOf(BLOCKING_DEFINITION)).toBeLessThan(
      stdin().indexOf('Prior review round'),
    );
  });

  it('renders them in a spec review too', async () => {
    const { spawn, stdin } = capture();
    await runCodex({
      ctx: { kind: 'spec', artifact: 'SPEC TEXT', featureMd: 'F', rules: 'R', prior },
      spawn,
    });
    expect(stdin()).toContain('P1 [high] first prior');
    expect(stdin().indexOf(SPEC_BLOCKING_DEFINITION)).toBeGreaterThan(-1);
    expect(stdin().indexOf(SPEC_BLOCKING_DEFINITION)).toBeLessThan(
      stdin().indexOf('Prior review round'),
    );
  });

  it('leaves a first-round prompt unchanged', async () => {
    const a = capture();
    const b = capture();
    await runCodex({ ctx, spawn: a.spawn });
    await runCodex({ ctx: { ...ctx, prior: undefined }, spawn: b.spawn });
    expect(a.stdin()).not.toContain('Prior review round');
    expect(b.stdin()).toBe(a.stdin());
  });

  it('returns the prior answers codex gives', async () => {
    const { spawn } = capture({
      blockers: [],
      suggestions: [],
      summary: 'ok',
      prior: [{ n: 1, resolved: true, why: 'fixed' }],
    });
    const out = await runCodex({ ctx: { ...ctx, prior }, spawn });
    expect(out.prior).toEqual([{ n: 1, resolved: true, why: 'fixed' }]);
    expect(out.blockers).toEqual([]);
  });

  it('treats a record with no prior field as malformed', async () => {
    const { spawn } = capture({ blockers: [], suggestions: [], summary: 'ok' });
    const out = await runCodex({ ctx, spawn });
    expect(out.blockers[0]!.message).toMatch(/malformed CR record/i);
  });

  it('files its own failure against <codex>, with no prior answers', async () => {
    const spawn: Spawn = vi.fn(async () => ({ stdout: '!!! not json', stderr: '', exitCode: 0 }));
    const out = await runCodex({ ctx, spawn });
    expect(out.blockers[0]!.file).toBe('<codex>');
    expect(out.prior).toEqual([]);
  });
});

describe('reviewWithCodex prior threading (Q-0260)', () => {
  it('hands the priors to the prompt and returns the answers beside the findings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwc-'));
    writeFileSync(join(dir, 'spec.md'), '# Spec');
    let seen = '';
    const spawn = vi.fn(async (opts: { stdin: string }) => {
      seen = opts.stdin;
      return {
        stdout: JSON.stringify({
          blockers: [],
          suggestions: [],
          summary: 'ok',
          prior: [{ n: 1, resolved: false, why: 'still there' }],
        }),
        stderr: '',
        exitCode: 0,
        timedOut: false,
      };
    }) as unknown as Spawn;
    const out = await reviewWithCodex({ kind: 'spec', artifact: 'spec.md' }, dir, spawn, {
      prior: {
        mode: 'reexamine',
        blockers: [{ file: 'spec.md', severity: 'high', message: 'old' }],
      },
    });
    expect(seen).toContain('P1 [high] old');
    expect(out.prior).toEqual([{ n: 1, resolved: false, why: 'still there' }]);
  });

  it('files a caught failure against <codex>', async () => {
    const out = await reviewWithCodex(
      { kind: 'spec', artifact: 'spec.md', baseSha: '-bad' },
      process.cwd(),
      vi.fn() as never,
    );
    expect(out.findings[0]!.file).toBe('<codex>');
    expect(out.prior).toEqual([]);
  });
});

describe('spec-stage blocking in the codex prompt (Q-0263)', () => {
  function capture(): { spawn: Spawn; stdin: () => string } {
    let seen = '';
    const spawn: Spawn = vi.fn(async (opts: { stdin: string }) => {
      seen = opts.stdin;
      return {
        stdout: JSON.stringify({ blockers: [], suggestions: [], summary: 'ok', prior: [] }),
        stderr: '',
        exitCode: 0,
        timedOut: false,
      };
    }) as unknown as Spawn;
    return { spawn, stdin: () => seen };
  }

  it('asks for a basis and reads the FD as its summary, with no code-shaped blocking line', async () => {
    const { spawn, stdin } = capture();
    await runCodex({
      ctx: { kind: 'spec', artifact: 'SPEC TEXT', featureMd: 'THE SUMMARY', rules: 'R' },
      spawn,
    });
    expect(stdin()).toContain('"basis"');
    expect(stdin()).toContain('## Feature summary\nTHE SUMMARY');
    expect(stdin()).not.toContain('## Feature MD');
    expect(stdin()).not.toContain('would ship one of the defects below');
    expect(stdin()).not.toContain('must be resolved before implementation');
    expect(stdin()).toContain('set "line": null');
  });

  it('keeps the plan prompt as it was: code definition, whole-FD heading, no basis', async () => {
    const { spawn, stdin } = capture();
    await runCodex({
      ctx: { kind: 'plan', artifact: 'PLAN TEXT', featureMd: 'THE FD', rules: 'R' },
      spawn,
    });
    expect(stdin()).toContain('## Feature MD\nTHE FD');
    expect(stdin()).toContain('would ship one of the defects below');
    expect(stdin()).toContain('must be resolved before implementation');
    expect(stdin()).not.toContain(SPEC_BLOCKING_DEFINITION);
    expect(stdin()).not.toContain('"basis"');
  });
});

describe('the basis field of a codex record (Q-0263)', () => {
  const recordWith = (finding: Record<string, unknown>): Spawn =>
    vi.fn(async () => ({
      stdout: JSON.stringify({ blockers: [finding], suggestions: [], summary: 's', prior: [] }),
      stderr: '',
      exitCode: 0,
      timedOut: false,
    })) as unknown as Spawn;
  const finding = { file: 'spec.md', line: null, severity: 'high', message: 'm', suggestion: null };

  it.each(['requirement', 'feasibility', 'risk', null])(
    'accepts a finding whose basis is %s',
    async (basis) => {
      const out = await runCodex({ ctx, spawn: recordWith({ ...finding, basis }) });
      expect(out.blockers).toEqual([{ ...finding, basis }]);
    },
  );

  it.each([
    ['an unknown basis', { ...finding, basis: 'wording' }],
    ['no basis key', finding],
  ])('treats a record whose finding has %s as malformed', async (_shape, f) => {
    const out = await runCodex({ ctx, spawn: recordWith(f) });
    expect(out.blockers).toEqual([
      expect.objectContaining({
        file: '<codex>',
        message: expect.stringMatching(/malformed CR record/),
      }),
    ]);
  });
});

describe('toFindings basis demotion (Q-0263)', () => {
  const record = (blockers: Record<string, unknown>[]) =>
    ({ summary: 's', blockers, suggestions: [], prior: [] }) as never;
  const blocker = (over: Record<string, unknown> = {}) => ({
    file: 'spec.md',
    line: null,
    severity: 'high',
    message: 'the retry owner is never named',
    suggestion: null,
    basis: null,
    ...over,
  });

  // Must still report: a spec blocker with a basis stays a blocker and keeps it.
  it('keeps a spec-kind blocker with a basis as a blocker, basis recorded', () => {
    expect(toFindings(record([blocker({ basis: 'feasibility' })]), 'spec.md', 'spec')).toEqual([
      {
        file: 'spec.md',
        message: 'the retry owner is never named',
        severity: 'high',
        basis: 'feasibility',
      },
    ]);
  });

  // Must drop: a spec blocker whose basis is null becomes a suggestion.
  it('demotes a spec-kind blocker whose basis is null to a suggestion', () => {
    expect(toFindings(record([blocker()]), 'spec.md', 'spec')).toEqual([
      { file: 'spec.md', message: 'the retry owner is never named', severity: 'med' },
    ]);
  });

  it('never demotes a lane-failure blocker filed against <codex>', () => {
    const failed = blocker({ file: '<codex>', message: 'codex exited with exit code 1' });
    expect(toFindings(record([failed]), 'spec.md', 'spec')).toEqual([
      { file: '<codex>', message: 'codex exited with exit code 1', severity: 'high' },
    ]);
  });

  it.each(['plan', 'code'] as const)(
    'ignores the basis at kind %s: a null basis still blocks and none is recorded',
    (kind) => {
      const out = toFindings(record([blocker(), blocker({ basis: 'risk' })]), 'x', kind);
      expect(out.map((f) => f.severity)).toEqual(['high', 'high']);
      expect(out.some((f) => 'basis' in f)).toBe(false);
    },
  );
});

describe('reviewWithCodex at kind spec (Q-0263)', () => {
  const FD =
    '---\nname: X\n---\n\n## Summary\n\nTHE INTENT.\n\n## Usage\n\n<!-- TODO: UI steps, keyboard shortcut, agent API call. -->\n';
  function repo(fd?: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'rwc-spec-'));
    writeFileSync(join(dir, 'spec.md'), '# Spec');
    if (fd !== undefined) {
      mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
      writeFileSync(join(dir, 'docs', 'features', 's.md'), fd);
    }
    return dir;
  }
  function answering(stdout: string): { spawn: Spawn; stdin: () => string } {
    let seen = '';
    const spawn: Spawn = vi.fn(async (opts: { stdin: string }) => {
      seen = opts.stdin;
      return { stdout, stderr: '', exitCode: 0, timedOut: false };
    }) as unknown as Spawn;
    return { spawn, stdin: () => seen };
  }
  const CLEAN = JSON.stringify({ blockers: [], suggestions: [], summary: 'ok', prior: [] });

  it("hands codex the FD's Summary and none of its scaffold stubs", async () => {
    const { spawn, stdin } = answering(CLEAN);
    await reviewWithCodex({ kind: 'spec', artifact: 'spec.md', slug: 's' }, repo(FD), spawn);
    expect(stdin()).toContain('THE INTENT.');
    expect(stdin()).not.toContain('## Usage');
    expect(stdin()).not.toContain('<!-- TODO');
  });

  it('hands codex the drafted FD at kinds plan and code, minus the stubs still unfilled (Q-0284)', async () => {
    const drafted =
      '---\nname: X\n---\n\n## Summary\n\nTHE INTENT.\n\n## Diagram\n\n<!-- TODO: one mermaid fence at the C4 level that fits this feature, and a sentence or\ntwo on what it shows. -->\n\n## User Story\n\nAs a user, I want X.\n\n## Usage\n\n- run `x`\n';
    for (const kind of ['plan', 'code'] as const) {
      const { spawn, stdin } = answering(CLEAN);
      const dir = repo(drafted);
      // The code kind builds its context from git, so the scratch repo needs a commit.
      if (kind === 'code') {
        for (const args of [
          ['init', '-q', '-b', 'main'],
          ['add', '.'],
          ['commit', '-qm', 'init'],
        ]) {
          execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir });
        }
      }
      await reviewWithCodex({ kind, artifact: 'spec.md', slug: 's' }, dir, spawn);
      expect(stdin()).toContain('THE INTENT.');
      expect(stdin()).toContain('## User Story\n\nAs a user, I want X.');
      expect(stdin()).toContain('## Usage\n\n- run `x`');
      expect(stdin()).not.toContain('## Diagram');
      expect(stdin()).not.toContain('<!-- TODO');
    }
  });

  it('reviews with an empty FD section when the FD file is missing', async () => {
    const { spawn, stdin } = answering(CLEAN);
    const out = await reviewWithCodex(
      { kind: 'spec', artifact: 'spec.md', slug: 's' },
      repo(),
      spawn,
    );
    expect(out.findings).toEqual([]);
    expect(stdin()).toContain('## Feature summary\n\n');
  });

  it('fails into a blocking <codex> finding when the FD has no Summary', async () => {
    const { spawn } = answering(CLEAN);
    const out = await reviewWithCodex(
      { kind: 'spec', artifact: 'spec.md', slug: 's' },
      repo('---\nname: X\n---\n\n## Usage\n\nsteps\n'),
      spawn,
    );
    expect(out.findings).toEqual([expect.objectContaining({ file: '<codex>', severity: 'high' })]);
  });

  it('keeps a malformed codex record blocking at kind spec', async () => {
    const { spawn } = answering('!!! not json');
    const out = await reviewWithCodex(
      { kind: 'spec', artifact: 'spec.md', slug: 's' },
      repo(FD),
      spawn,
    );
    expect(out.findings).toEqual([expect.objectContaining({ file: '<codex>', severity: 'high' })]);
  });
});
