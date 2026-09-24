// @tests: acceptance-verify-lane, cr-lane-verdicts-blocked-by-serialization-not-substance
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentResult, SpawnAgentOpts } from '../../../core/agent-runner/types.js';
import { DEFAULT_DISPATCH_TIMEOUT_MS } from '../../../core/config.js';
import type { Slug } from '../../../core/slug.js';
import { setLaneSpawn } from '../../lane-spawn.js';
import {
  buildVerifyPrompt,
  buildVerifyRepairPrompt,
  dispatchVerify,
  verifyVerdictSchema,
} from '../../lanes/verify-dispatch.js';

describe('buildVerifyPrompt', () => {
  it('carries acceptance text, range, concrete commands, and the no-source-reading rule', () => {
    const p = buildVerifyPrompt({
      acceptance: 'GET /x returns an object',
      baseSha: 'aaa',
      headSha: 'bbb',
      surfaces: [
        {
          name: 'dashboard',
          command: 'pnpm dev --port {port}',
          kind: 'server',
          healthPath: '/',
          readyTimeoutMs: 30_000,
        },
      ],
      port: 4321,
    });
    expect(p).toContain('GET /x returns an object');
    expect(p).toContain('aaa..bbb');
    expect(p).toContain('pnpm dev --port 4321');
    expect(p).not.toContain('{port}');
    expect(p).toMatch(/never conclude from reading source/i);
  });

  it('requires the child to remove every worktree and temp directory it creates', () => {
    const p = buildVerifyPrompt({
      acceptance: 'x',
      baseSha: 'a',
      headSha: 'b',
      surfaces: [],
      port: 4000,
    });
    expect(p).toMatch(/remove every git worktree and temp directory you create/i);
    expect(p).toContain('git worktree remove --force');
    expect(p).toMatch(/git worktree list.*must show exactly what it showed before/i);
  });

  it('tells the agent to emit cannot-verify when no surfaces are configured', () => {
    const p = buildVerifyPrompt({
      acceptance: 'x',
      baseSha: 'a',
      headSha: 'b',
      surfaces: [],
      port: 4000,
    });
    expect(p).toContain('none configured');
  });
});

describe('buildVerifyRepairPrompt', () => {
  it('asks for a transcription of the rejected answer, never a second verification', () => {
    const p = buildVerifyRepairPrompt({
      stdout: 'Verified end-to-end. I forgot to write the file.',
      rejected: null,
      error: 'no answer file was written',
    });
    expect(p).toContain('Verified end-to-end. I forgot to write the file.');
    expect(p).toContain('no answer file was written');
    expect(p).toMatch(/do not re-verify/i);
    expect(p).toMatch(/never upgrade/i);
    expect(p).not.toContain('Boot surfaces');
  });
});

describe('verifyVerdictSchema', () => {
  it('ties the verdict to its mismatches', () => {
    expect(verifyVerdictSchema.safeParse({ verdict: 'pass', mismatches: [] }).success).toBe(true);
    expect(verifyVerdictSchema.safeParse({ verdict: 'pass', mismatches: ['m'] }).success).toBe(
      false,
    );
    expect(verifyVerdictSchema.safeParse({ verdict: 'fail', mismatches: [] }).success).toBe(false);
    expect(
      verifyVerdictSchema.safeParse({ verdict: 'cannot-verify', reason: 'no boot path' }).success,
    ).toBe(true);
  });
});

describe('default dispatcher', () => {
  const dispatchBase = { acceptance: 'x', baseSha: 'a', headSha: 'b', surfaces: [], port: 4000 };
  const at = (): { repoRoot: string; slug: Slug; kind: 'code' } => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'noldor-verify-dispatch-'));
    mkdirSync(join(repoRoot, '.noldor'), { recursive: true });
    writeFileSync(join(repoRoot, '.noldor', 'config.json'), '{}');
    return { repoRoot, slug: 'feat-x' as Slug, kind: 'code' };
  };
  const calls: Array<{ prompt: string; opts: SpawnAgentOpts }> = [];
  const answer = (text: string): void =>
    setLaneSpawn(async (prompt, opts): Promise<AgentResult> => {
      calls.push({ prompt, opts });
      const path = /write your answer to the file `([^`]+)`/.exec(prompt)?.[1];
      if (path) writeFileSync(path, text);
      return { exitCode: 0, stdout: '', stderr: '', stderrBytes: 0, timedOut: false };
    });
  afterEach(() => {
    calls.length = 0;
    setLaneSpawn(undefined);
  });

  it('applies DEFAULT_DISPATCH_TIMEOUT_MS when the caller omits timeoutMs', async () => {
    answer('{"verdict":"pass","evidence":[],"mismatches":[]}');
    await dispatchVerify(dispatchBase, at());
    expect(calls[0]!.opts.timeoutMs).toBe(DEFAULT_DISPATCH_TIMEOUT_MS);
  });

  it('honors an explicit timeoutMs from the lane', async () => {
    answer('{"verdict":"pass","evidence":[],"mismatches":[]}');
    await dispatchVerify({ ...dispatchBase, timeoutMs: 55_000 }, at());
    expect(calls[0]!.opts.timeoutMs).toBe(55_000);
  });

  it('routes a rejected answer to the repair prompt instead of the primary one', async () => {
    answer('Verified end-to-end, no JSON.');
    await dispatchVerify(dispatchBase, at());
    expect(calls).toHaveLength(2);
    expect(calls[1]!.prompt).toMatch(/do not re-verify/i);
    expect(calls[1]!.prompt).toContain('Verified end-to-end, no JSON.');
    expect(calls[1]!.prompt).not.toContain('Boot surfaces');
  });
});
