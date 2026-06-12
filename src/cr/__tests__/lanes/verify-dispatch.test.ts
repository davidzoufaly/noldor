// @tests: acceptance-verify-lane
import { describe, expect, it } from 'vitest';
import { buildVerifyPrompt, parseVerifyVerdict } from '../../lanes/verify-dispatch.js';

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
