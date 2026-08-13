// @tests: code-clone-detector
import { describe, expect, it } from 'vitest';
import { tokenize } from '../tokenize';

describe('tokenize', () => {
  it('skips comments and collapses string/template literals to one LIT', () => {
    const src = [
      '// line comment',
      "const a = 'hello'; /* block",
      'still comment */ const b = `tpl ${a + 1} end`;',
    ].join('\n');
    const toks = tokenize(src);
    expect(toks.map((t) => t.norm)).toEqual([
      'const',
      'ID',
      '=',
      'LIT',
      ';',
      'const',
      'ID',
      '=',
      'LIT',
      ';',
    ]);
    expect(toks[3]!.text).toBe("'hello'");
    expect(toks[8]!.text).toBe('`tpl ${a + 1} end`');
  });

  it('keeps keywords verbatim, normalizes identifiers and numbers', () => {
    const toks = tokenize('function foo(x) { return x + 42; }');
    expect(toks.map((t) => t.norm)).toEqual([
      'function',
      'ID',
      '(',
      'ID',
      ')',
      '{',
      'return',
      'ID',
      '+',
      'LIT',
      ';',
      '}',
    ]);
    expect(toks[1]!.text).toBe('foo');
    expect(toks[9]!.text).toBe('42');
  });

  it('tracks line numbers across newlines, comments, and multiline literals', () => {
    const src = 'const a = 1;\n/*\n\n*/\nconst tpl = `x\ny`;\nconst b = 2;';
    const toks = tokenize(src);
    const byText = (t: string) => toks.find((x) => x.text === t)!;
    expect(byText('a').line).toBe(1);
    expect(byText('tpl').line).toBe(5);
    expect(byText('b').line).toBe(7);
  });

  it('collapses a literal-only builder chain to one token, methods verbatim', () => {
    const toks = tokenize('const s = z.number().int().nonnegative();');
    expect(toks.map((t) => t.norm)).toEqual([
      'const',
      'ID',
      '=',
      'CHAIN:ID.number().int().nonnegative()',
      ';',
    ]);
    expect(toks[3]!.text).toBe('z.number().int().nonnegative()');
    expect(tokenize('z.string().min(1)')[0]!.norm).toBe('CHAIN:ID.string().min(LIT)');
  });

  it('normalizes the chain head but not its method names', () => {
    const normOf = (src: string) => tokenize(src)[0]!.norm;
    expect(normOf('zod.string().min(1)')).toBe(normOf('z.string().min(1)'));
    expect(normOf('z.number().int()')).not.toBe(normOf('z.number().min()'));
  });

  it('leaves a chain expanded when any call takes a non-literal argument', () => {
    for (const src of [
      'rows.filter((r) => r.ok).map(pick)',
      'z.record(z.string(), s).default({})',
      // literal-only PREFIX of a real pipeline — the prefix must not collapse
      // either, or a duplicated pipeline loses token weight
      'rows.slice().reverse().map(fn)',
      'builder.select().from().where(cond).orderBy(x)',
    ]) {
      const toks = tokenize(src);
      expect(toks.some((t) => t.norm.startsWith('CHAIN:'))).toBe(false);
      expect(toks.length).toBeGreaterThan(8);
    }
  });

  it('a trailing property access ends the chain without disqualifying it', () => {
    const toks = tokenize('z.number().int().description');
    expect(toks.map((t) => t.norm)).toEqual(['CHAIN:ID.number().int()', '.', 'ID']);
  });

  it('leaves a single call and a property path expanded', () => {
    expect(tokenize('foo.bar()').map((t) => t.norm)).toEqual(['ID', '.', 'ID', '(', ')']);
    expect(tokenize('a.b.c').map((t) => t.norm)).toEqual(['ID', '.', 'ID', '.', 'ID']);
  });

  it('never throws on malformed source', () => {
    expect(() => tokenize('const § = @@ `unterminated')).not.toThrow();
    expect(() => tokenize("'unterminated string")).not.toThrow();
  });
});
