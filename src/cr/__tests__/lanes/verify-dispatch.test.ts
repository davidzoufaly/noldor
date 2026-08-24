// @tests: acceptance-verify-lane
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../core/agent-runner/registry.js', () => ({
  spawnAgent: vi.fn(async () => ({ stdout: 'verified', exitCode: 0, timedOut: false })),
}));

import {
  buildVerifyPrompt,
  buildVerifyRepairPrompt,
  dispatchVerify,
  parseVerifyVerdict,
} from '../../lanes/verify-dispatch.js';
import { DEFAULT_DISPATCH_TIMEOUT_MS } from '../../../core/config.js';

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
  it('asks for a transcription of the prose, never a second verification', () => {
    const p = buildVerifyRepairPrompt('Verified end-to-end. I forgot the fence.');
    expect(p).toContain('Verified end-to-end. I forgot the fence.');
    expect(p).toMatch(/do not re-verify/i);
    expect(p).toMatch(/never upgrade/i);
    expect(p).toContain('```json');
    // The boot surfaces and the no-source-reading rule belong to the primary
    // prompt only — this round runs nothing.
    expect(p).not.toContain('Boot surfaces');
  });
});

describe('parseVerifyVerdict', () => {
  it('parses a fenced JSON verdict', () => {
    const md =
      'Booted it.\n```json\n{"verdict":"fail","evidence":[{"command":"curl :4321/x","observed":"[]"}],"mismatches":["object promised, array observed"]}\n```\n';
    const v = parseVerifyVerdict(md);
    expect(v?.verdict).toBe('fail');
    expect(v?.mismatches).toEqual(['object promised, array observed']);
  });

  it('takes the LAST fenced json block when several exist', () => {
    const md =
      '```json\n{"verdict":"fail","evidence":[],"mismatches":["draft"]}\n```\nrechecked…\n```json\n{"verdict":"pass","evidence":[],"mismatches":[]}\n```\n';
    expect(parseVerifyVerdict(md)?.verdict).toBe('pass');
  });

  it('returns null on missing or malformed JSON', () => {
    expect(parseVerifyVerdict('no fence here')).toBeNull();
    expect(parseVerifyVerdict('```json\n{"verdict":"maybe"}\n```')).toBeNull();
  });
});

describe('default dispatcher timeout', () => {
  const dispatchBase = { acceptance: 'x', baseSha: 'a', headSha: 'b', surfaces: [], port: 4000 };
  const spawnMock = async (): Promise<ReturnType<typeof vi.fn>> => {
    const { spawnAgent } = await import('../../../core/agent-runner/registry.js');
    return spawnAgent as unknown as ReturnType<typeof vi.fn>;
  };

  it('applies DEFAULT_DISPATCH_TIMEOUT_MS when the caller omits timeoutMs', async () => {
    const spawnAgent = await spawnMock();
    spawnAgent.mockClear();
    await dispatchVerify(dispatchBase);
    expect(spawnAgent.mock.calls[0][1].timeoutMs).toBe(DEFAULT_DISPATCH_TIMEOUT_MS);
  });

  it('routes a repairOf input to the repair prompt instead of the primary one', async () => {
    const spawnAgent = await spawnMock();
    spawnAgent.mockClear();
    await dispatchVerify({ ...dispatchBase, repairOf: 'Verified end-to-end, no fence.' });
    const prompt = String(spawnAgent.mock.calls[0][0]);
    expect(prompt).toMatch(/do not re-verify/i);
    expect(prompt).toContain('Verified end-to-end, no fence.');
    expect(prompt).not.toContain('Boot surfaces');
  });

  it('honors an explicit timeoutMs from the lane', async () => {
    const spawnAgent = await spawnMock();
    spawnAgent.mockClear();
    await dispatchVerify({ ...dispatchBase, timeoutMs: 55_000 });
    expect(spawnAgent.mock.calls[0][1].timeoutMs).toBe(55_000);
  });
});
