// @tests: rules-cascade-v1
import { describe, expect, it } from 'vitest';
import { renderBrief, unionResults } from '../brief';
import type { ResolveResult } from '../resolve';
import type { Rule } from '../types';

const rule = (over: Partial<Rule> & { id: string }): Rule => ({
  appliesTo: ['src/**/*.ts'],
  stage: ['code'],
  enforce: false,
  links: [],
  body: `body of ${over.id}`,
  ...over,
});

const result = (over: Partial<ResolveResult> = {}): ResolveResult => ({
  injected: [],
  enforce: [],
  ...over,
});

describe('unionResults', () => {
  it('dedupes by id and keeps the order resolveRules produced', () => {
    const a = rule({ id: 'a' });
    const b = rule({ id: 'b' });
    const c = rule({ id: 'c', enforce: true });
    const merged = unionResults([
      result({ injected: [a, b], enforce: [c] }),
      result({ injected: [b, a], enforce: [c] }),
    ]);
    expect(merged.injected.map((r) => r.id)).toEqual(['a', 'b']);
    expect(merged.enforce.map((r) => r.id)).toEqual(['c']);
  });

  it('is empty for no inputs', () => {
    expect(unionResults([])).toEqual({ injected: [], enforce: [] });
  });
});

describe('renderBrief', () => {
  it('puts the binding bucket first and marks it as not advisory', () => {
    const out = renderBrief(
      result({
        enforce: [rule({ id: 'ladder', enforce: true, appliesTo: ['**/*.ts'] })],
        injected: [rule({ id: 'specifiers', links: ['tsconfig.json'] })],
      }),
      { files: ['src/a.ts'], stage: 'code' },
    );
    expect(out).toContain('# Rules for src/a.ts (stage: code)');
    expect(out).toContain('ENFORCE — binding, not advisory (1)');
    expect(out).toContain('### ladder — applies to **/*.ts; stage code');
    expect(out).toContain('body of ladder');
    expect(out).toContain('ADVISORY — context (1)');
    expect(out).toContain('Links: tsconfig.json');
    expect(out.indexOf('ENFORCE')).toBeLessThan(out.indexOf('ADVISORY'));
  });

  it('names a stage-level rule scope rather than printing an empty glob list', () => {
    const out = renderBrief(result({ enforce: [rule({ id: 'r', appliesTo: [], stage: [] })] }), {
      files: ['src/a.ts'],
    });
    expect(out).toContain('applies to (stage-level); stage any');
    expect(out).toContain('(stage: any)');
  });

  it('enforceOnly drops the advisory bucket', () => {
    const out = renderBrief(
      result({ enforce: [rule({ id: 'ladder', enforce: true })], injected: [rule({ id: 'adv' })] }),
      { files: ['src/a.ts'], stage: 'code', enforceOnly: true },
    );
    expect(out).toContain('ladder');
    // Match the rendered heading, not the bare id: the ENFORCE header itself
    // contains the word "advisory" ("binding, not advisory").
    expect(out).not.toContain('### adv');
    expect(out).not.toContain('ADVISORY — context');
  });

  it('says so out loud when nothing matches — never an empty string', () => {
    const out = renderBrief(result(), { files: ['src/a.ts', 'src/b.ts'], stage: 'code' });
    expect(out.trim()).toBe('no rules match src/a.ts, src/b.ts (stage: code)');
  });

  // Pins the contract the CR caller depends on: it must decide from the resolved
  // buckets, because an empty-enforce render is NOT an empty string.
  it('still returns the no-match line under enforceOnly with an empty enforce bucket', () => {
    const out = renderBrief(result({ injected: [rule({ id: 'adv' })] }), {
      files: ['src/a.ts'],
      enforceOnly: true,
    });
    expect(out).toContain('no rules match');
    expect(out.length).toBeGreaterThan(0);
  });
});
