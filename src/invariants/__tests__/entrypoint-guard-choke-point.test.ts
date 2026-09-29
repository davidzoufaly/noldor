// @tests: entrypoint-guard-choke-point-enforcement, architecture-invariants
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  makeEntrypointGuardChokePointInvariant,
  scanSource,
} from '../entrypoint-guard-choke-point.js';
import { maskNonCode } from '../source-scan.js';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const flaggedLines = (text: string, relPath = 'src/x.ts'): number[] =>
  scanSource(relPath, text).map((v) => v.line ?? 0);

describe('maskNonCode', () => {
  it('keeps length and newlines, blanking only non-code text', () => {
    const src = "const a = 'x'; // note\n/* b */ f();\n";
    const { masked, clean } = maskNonCode(src);
    expect(clean).toBe(true);
    expect(masked).toHaveLength(src.length);
    expect(masked).toBe('const a =    ;        \n        f();\n');
  });

  it('keeps template holes as code, nested templates included', () => {
    const { masked, clean } = maskNonCode('`a${b(`c${d}`)}e`');
    expect(clean).toBe(true);
    expect(masked).toBe('    b(    d  )   ');
  });

  it('does not close a template at an escaped backtick', () => {
    const { masked, clean } = maskNonCode('const s = `x \\` y`; z();\n');
    expect(clean).toBe(true);
    expect(masked).toBe('const s =         ; z();\n');
  });

  it('masks regex literals, including ones carrying quotes and backticks', () => {
    const { masked, clean } = maskNonCode('const r = /`[\'"]/g; q();\n');
    expect(clean).toBe(true);
    expect(masked).toBe('const r =         ; q();\n');
  });

  it('reads / after a value as division, not a regex', () => {
    for (const src of [
      'a / b / c;\n',
      '(a) / b / c;\n',
      'i++ / n / 2;\n',
      'x[0] / y / z;\n',
      'xs.length! / 2 / n;\n',
    ]) {
      const { masked, clean } = maskNonCode(src);
      expect(clean).toBe(true);
      expect(masked).toBe(src);
    }
  });

  it('reads / after a prefix ! as a regex', () => {
    const { masked, clean } = maskNonCode("ok = !/'/.test(s);\n");
    expect(clean).toBe(true);
    expect(masked).toBe('ok = !   .test(s);\n');
  });

  it('reads / after a statement head as a regex', () => {
    const { masked, clean } = maskNonCode('if (ok) /`/.test(s);\n');
    expect(clean).toBe(true);
    expect(masked).toBe('if (ok)    .test(s);\n');
  });

  it('keeps a string line continuation inside the string', () => {
    const { masked, clean } = maskNonCode("const s = 'a\\\nb'; f();\n");
    expect(clean).toBe(true);
    expect(masked).toBe('const s =    \n  ; f();\n');
  });

  it('ends clean on a line comment with no trailing newline', () => {
    expect(maskNonCode('f(); // done').clean).toBe(true);
  });

  it('ends dirty when the file ends inside a literal or block comment', () => {
    for (const src of ['const s = `open', '/* open', "const s = 'a\nb';", 'x = /ab\nc/;']) {
      expect(maskNonCode(src).clean).toBe(false);
    }
  });
});

describe('scanSource — reports', () => {
  it.each([
    ['an index read', 'const s = process.argv[1];\n'],
    ['an optional index read', 'const s = process.argv?.[1];\n'],
    ['spaced member access', 'const s = process . argv [ 1 ];\n'],
    ['at(1)', 'const s = process.argv.at(1);\n'],
    ['optional at(1)', 'const s = process.argv?.at(1);\n'],
    ['slice(1)', 'const rest = process.argv.slice(1);\n'],
    ['slice(1, n)', 'const one = process.argv.slice(1, 2)[0];\n'],
    ['a write', 'process.argv[1] = p;\n'],
    ['destructuring past a hole', 'const [, script] = process.argv;\n'],
    ['destructuring two names', 'const [node, script] = process.argv;\n'],
    ['destructuring a rest after a hole', 'const [, ...rest] = process.argv;\n'],
    ['destructuring a leading rest', 'const [...all] = process.argv;\n'],
    ['a file:// template hole', 'if (import.meta.url === `file://${process.argv[1]}`) main();\n'],
    ['string concatenation', "if (import.meta.url === 'file://' + process.argv[1]) main();\n"],
    [
      'startsWith with no operator',
      'if (import.meta.url.endsWith(process.argv[1] ?? "")) main();\n',
    ],
    ['a read after a comment on the same line', '/* note */ if (process.argv[1]) main();\n'],
  ])('%s', (_label, src) => {
    expect(flaggedLines(src)).toEqual([1]);
  });

  it('reports the line of each read', () => {
    const src = 'a();\n\nconst x = process.argv[1];\nb();\nconst y = process.argv.at(1);\n';
    expect(flaggedLines(src)).toEqual([3, 5]);
  });

  it('still sees a read that follows a regex with an odd number of backticks', () => {
    const src = 'const r = /`[^`]+`/g;\nconst s = process.argv[1];\n';
    expect(flaggedLines(src)).toEqual([2]);
  });

  it('still sees a read after a statement-head regex', () => {
    const src = 'if (ok) /`/.test(s);\nconst x = process.argv[1];\n';
    expect(flaggedLines(src)).toEqual([2]);
  });

  it('reports a file it cannot lex instead of passing it', () => {
    const v = scanSource('src/x.ts', 'const s = `never closed\nprocess.argv[1];\n');
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain('could not lex');
  });
});

describe('scanSource — accepts', () => {
  it.each([
    ['isEntrypoint', 'if (isEntrypoint(import.meta.url)) main();\n'],
    [
      'isEntrypoint with an unrelated equality',
      'if (isEntrypoint(import.meta.url) && argv.length === 2) main();\n',
    ],
    ['isEntrypoint two-argument form', 'const direct = isEntrypoint(import.meta.url, argv1);\n'],
    ['invokedDirectly', "if (invokedDirectly('wait-cli')) main();\n"],
    ['runIfDirect', "runIfDirect('clones-cli', 'clones', main);\n"],
    ['slice(2)', 'main(process.argv.slice(2));\n'],
    ['slice(10)', 'const tail = process.argv.slice(10);\n'],
    ['argv[0]', 'const node = process.argv[0]!;\n'],
    ['argv[10]', 'const x = process.argv[10];\n'],
    ['a hole in slot 1', 'const [, , group, sub, ...rest] = process.argv;\n'],
    ['a single slot-0 binding', 'const [node] = process.argv;\n'],
    ['whole-array reassignment', 'process.argv = [process.argv[0]!, modPath, ...rest];\n'],
    ['a local argv parameter', 'function main(argv: string[]) { return argv[1]; }\n'],
    [
      'an asset URL next to an argv read',
      "const p = new URL('./x.json', import.meta.url);\nconst s = argv[1];\n",
    ],
    [
      'a one-line doc comment',
      '/** Compares import.meta.url with process.argv[1]. */\nexport const x = 1;\n',
    ],
    ['a line comment', '// process.argv[1] is the script path\n'],
    ['a string', "const hint = 'use process.argv[1] via isEntrypoint';\n"],
    ['template text', 'const child = `const m = await import(process.argv[1]);`;\n'],
    ['a regex literal', 'const re = /process\\.argv\\[1\\]/;\n'],
  ])('%s', (_label, src) => {
    expect(flaggedLines(src)).toEqual([]);
  });

  it('skips the helper module and test files', () => {
    const src = 'const s = process.argv[1];\n';
    expect(flaggedLines(src, 'src/core/cli-entry.ts')).toEqual([]);
    expect(flaggedLines(src, 'src/core/__tests__/cli-entry.test.ts')).toEqual([]);
    expect(flaggedLines(src, 'src/core/x.test.ts')).toEqual([]);
  });
});

describe('entrypoint-guard-choke-point on this repo', () => {
  it('finds no hand-written argv[1] read and no file it cannot lex', async () => {
    const result = await makeEntrypointGuardChokePointInvariant(REPO_ROOT).run();
    expect(result.violations).toEqual([]);
  });
});
