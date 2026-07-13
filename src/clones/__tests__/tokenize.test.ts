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

  it('never throws on malformed source', () => {
    expect(() => tokenize('const § = @@ `unterminated')).not.toThrow();
    expect(() => tokenize("'unterminated string")).not.toThrow();
  });
});
