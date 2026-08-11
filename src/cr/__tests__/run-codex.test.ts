// @tests: acceptance-verify-lane, make-noldor-agent-agnostic, noldor
import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { runCodex, type Spawn } from '../run-codex.js';

const ctx = { diff: 'D', featureMd: 'F', rules: 'R' };

describe('runCodex', () => {
  it('returns the parsed CR record on valid JSON', async () => {
    const spawn: Spawn = vi.fn(async () => ({
      stdout: JSON.stringify({ blockers: [], suggestions: [], summary: 'ok' }),
      stderr: '',
      exitCode: 0,
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
    const withVersion: Spawn = vi.fn(async ({ args }) =>
      args[0] === '--version'
        ? { stdout: 'codex-cli 0.133.0\n', stderr: '', exitCode: 0 }
        : { stdout: '', stderr: 'boom', exitCode: 3 },
    );
    expect((await runCodex({ ctx, spawn: withVersion })).blockers[0].message).toContain(
      'codex-cli 0.133.0',
    );

    const probeThrows: Spawn = vi.fn(async ({ args }) => {
      if (args[0] === '--version') throw new Error('probe exploded');
      return { stdout: '', stderr: 'boom', exitCode: 3 };
    });
    const out = await runCodex({ ctx, spawn: probeThrows });
    expect(out.blockers[0].message).toMatch(/version unknown/);
    expect(out.blockers[0].message).toMatch(/exit code 3/);
  });

  it('recovers the CR record from stdout wrapped in non-JSON noise', async () => {
    const spawn: Spawn = vi.fn(async () => ({
      stdout: `> some banner\n${JSON.stringify({ blockers: [], suggestions: [], summary: 'ok' })}\ntrailing chatter`,
      stderr: '',
      exitCode: 0,
    }));
    const out = await runCodex({ ctx, spawn });
    expect(out.summary).toBe('ok');
    expect(out.blockers).toEqual([]);
  });

  it('spawns codex with exec --sandbox read-only --output-schema pointing at an existing schema file', async () => {
    const spawn: Spawn = vi.fn(async () => ({
      stdout: JSON.stringify({ blockers: [], suggestions: [], summary: 'ok' }),
      stderr: '',
      exitCode: 0,
    }));
    await runCodex({ ctx, spawn });
    expect(spawn).toHaveBeenCalledTimes(1);
    const call = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.cmd).toBe('codex');
    expect(call.args).toEqual([
      'exec',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--output-schema',
      expect.any(String),
      // Trailing `-` is the documented explicit spelling of "prompt on stdin".
      '-',
    ]);
    expect(call.args.at(-1)).toBe('-');
    const schemaPath = call.args[5];
    expect(schemaPath).toMatch(/cr-record\.schema\.json$/);
    expect(existsSync(schemaPath)).toBe(true);
  });

  it('embeds the JSON-only directive at the top of the prompt', async () => {
    const spawn: Spawn = vi.fn(async () => ({
      stdout: JSON.stringify({ blockers: [], suggestions: [], summary: 'ok' }),
      stderr: '',
      exitCode: 0,
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
