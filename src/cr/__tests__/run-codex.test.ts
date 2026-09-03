// @tests: acceptance-verify-lane, make-noldor-agent-agnostic, noldor
import { describe, expect, it, vi } from 'vitest';
import { runCodex, type Spawn } from '../run-codex.js';
import { reviewWithCodex } from '../review-with-codex.js';
import { REV_RE } from '../cli-args.js';
import { CUT_MARKER_TOKEN } from '../../core/structural-context-contract.js';

const ctx = { diff: 'D', featureMd: 'F', rules: 'R' };

describe('runCodex', () => {
  it('returns the parsed CR record on valid JSON', async () => {
    const spawn: Spawn = vi.fn(async () => ({
      stdout: JSON.stringify({ blockers: [], suggestions: [], summary: 'ok' }),
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
      stdout: `> some banner\n${JSON.stringify({ blockers: [], suggestions: [], summary: 'ok' })}\ntrailing chatter`,
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
      stdout: JSON.stringify({ blockers: [], suggestions: [], summary: 'ok' }),
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
      stdout: JSON.stringify({ blockers: [], suggestions: [], summary: 'ok' }),
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
      stdout: JSON.stringify({ blockers: [], suggestions: [], summary: 'ok' }),
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
      stdout: JSON.stringify({ blockers: [], suggestions: [], summary: 'ok' }),
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
        stdout: JSON.stringify({ blockers: [], suggestions: [], summary: 'ok' }),
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
