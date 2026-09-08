// @tests: code-clone-detector
import { describe, expect, it } from 'vitest';
import { tokenize } from '../tokenize.js';

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

const norms = (src: string): string[] => tokenize(src).map((t) => t.norm);

/** The one statement every header case below is measured against. */
const BODY = 'const x = 1;';
const BODY_NORMS = ['const', 'ID', '=', 'LIT', ';'];

describe('tokenize head-of-file import exclusion', () => {
  it.each([
    ['named', "import { readFileSync } from 'node:fs';"],
    ['named, no semicolon', "import { readFileSync } from 'node:fs'"],
    ['from clause on its own line', "import { readFileSync }\n  from 'node:fs';"],
    ['default', "import readFile from 'node:fs';"],
    ['default plus named', "import fs, { readFileSync } from 'node:fs';"],
    ['default plus namespace', "import fs, * as path from 'node:path';"],
    ['namespace', "import * as path from 'node:path';"],
    ['type-only', "import type { Stats } from 'node:fs';"],
    ['side-effect', "import './register.js';"],
    ['re-export named', "export { a } from './a.js';"],
    ['re-export namespace', "export * from './a.js';"],
    ['re-export renamed namespace', "export * as ns from './a.js';"],
    ['re-export type-only', "export type { A } from './a.js';"],
    ['with import attributes', "import data from './d.json' with { type: 'json' };"],
    ['with legacy assert clause', "import data from './d.json' assert { type: 'json' };"],
  ])('emits nothing for a %s import declaration', (_label, decl) => {
    expect(norms(`${decl}\n${BODY}`)).toEqual(BODY_NORMS);
  });

  it('excludes every declaration in a mixed header, including after an attributed one', () => {
    const src = [
      "import './register.js';",
      "import data from './d.json' with { type: 'json' };",
      "import { join } from 'node:path';",
      "export * from './a.js';",
      BODY,
    ].join('\n');
    expect(norms(src)).toEqual(BODY_NORMS);
  });

  it('skips a leading shebang so the header still starts at the first import', () => {
    const src = ['#!/usr/bin/env npx tsx', "import { join } from 'node:path';", BODY].join('\n');
    expect(norms(src)).toEqual(BODY_NORMS);
  });

  it('reports the body line correctly after a shebang and header', () => {
    const src = ['#!/usr/bin/env npx tsx', "import { join } from 'node:path';", BODY].join('\n');
    expect(tokenize(src)[0]!.line).toBe(3);
  });

  it('discards a trailing semicolon-free import even with no final newline', () => {
    expect(norms("import { a } from './a.js'")).toEqual([]);
  });

  it.each([
    ['a dynamic import call', "import('./x.js');", ['import', '(', 'LIT', ')', ';']],
    ['an import.meta reference', 'import.meta.url;', ['import', '.', 'ID', '.', 'ID', ';']],
    [
      'a bare export declaration',
      'export const a = 1;',
      ['export', 'const', 'ID', '=', 'LIT', ';'],
    ],
    ['an export default', 'export default a;', ['export', 'default', 'ID', ';']],
    ['a local re-export with no specifier', 'export { a };', ['export', '{', 'ID', '}', ';']],
  ])('keeps %s at full weight, and the body after it', (_label, stmt, expected) => {
    expect(norms(`${stmt}\n${BODY}`)).toEqual([...expected, ...BODY_NORMS]);
  });

  it('keeps `export const from` and does not swallow the statement after it', () => {
    // `from` is a keyword here, so a from-token search would discard this
    // declaration AND leave the exclusion running into the next statement.
    const src = ['export const from = startOfDay(x);', BODY].join('\n');
    expect(norms(src)).toEqual([
      'export',
      'const',
      'from', // verbatim, being a keyword — which is why a from-search misfires
      '=',
      'ID',
      '(',
      'ID',
      ')',
      ';',
      ...BODY_NORMS,
    ]);
  });

  it('ends the header at the first non-import, so a later import keeps its tokens', () => {
    const src = [
      "import { join } from 'node:path';",
      BODY,
      "import { readFileSync } from 'node:fs';",
    ].join('\n');
    expect(norms(src)).toEqual([...BODY_NORMS, 'import', '{', 'ID', '}', 'from', 'LIT', ';']);
  });

  it('emits a truncated import that never reaches its module specifier', () => {
    expect(norms('import { a } from')).toEqual(['import', '{', 'ID', '}', 'from']);
    expect(norms('import { a, b')).toEqual(['import', '{', 'ID', ',', 'ID']);
  });
});
