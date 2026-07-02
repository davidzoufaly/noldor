// @tests: acceptance-verify-lane, make-noldor-agent-agnostic, noldor
import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { runCodex, type Spawn } from '../run-codex.js';

const ctx = { diff: 'D', featureMd: 'F', rules: 'R' };

describe('runCodex', () => {
  it('returns the parsed CR record on valid JSON', async () => {
    const spawn: Spawn = vi.fn(async () => ({
      stdout: JSON.stringify({ blockers: [], suggestions: [], summary: 'ok' }),
      exitCode: 0,
    }));
    const out = await runCodex({ ctx, spawn });
    expect(out.summary).toBe('ok');
    expect(out.blockers).toEqual([]);
  });

  it('treats non-JSON as a synthetic blocker', async () => {
    const spawn: Spawn = vi.fn(async () => ({ stdout: '!!! not json', exitCode: 0 }));
    const out = await runCodex({ ctx, spawn });
    expect(out.blockers).toHaveLength(1);
    expect(out.blockers[0].message).toMatch(/malformed CR record/i);
  });

  it('treats schema-failed JSON as a synthetic blocker', async () => {
    const spawn: Spawn = vi.fn(async () => ({
      stdout: JSON.stringify({ blockers: 'oops', suggestions: [], summary: '' }),
      exitCode: 0,
    }));
    const out = await runCodex({ ctx, spawn });
    expect(out.blockers[0].message).toMatch(/malformed CR record/i);
  });

  it('propagates non-zero exit as a synthetic blocker', async () => {
    const spawn: Spawn = vi.fn(async () => ({ stdout: '', exitCode: 2 }));
    const out = await runCodex({ ctx, spawn });
    expect(out.blockers[0].message).toMatch(/exit code 2/);
  });

  it('spawns codex with exec --sandbox read-only --output-schema pointing at an existing schema file', async () => {
    const spawn: Spawn = vi.fn(async () => ({
      stdout: JSON.stringify({ blockers: [], suggestions: [], summary: 'ok' }),
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
    ]);
    const schemaPath = call.args[5];
    expect(schemaPath).toMatch(/cr-record\.schema\.json$/);
    expect(existsSync(schemaPath)).toBe(true);
  });

  it('embeds the JSON-only directive at the top of the prompt', async () => {
    const spawn: Spawn = vi.fn(async () => ({
      stdout: JSON.stringify({ blockers: [], suggestions: [], summary: 'ok' }),
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
