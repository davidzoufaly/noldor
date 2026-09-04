// @tests: specs-cr-gate-multi-reviewer
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CUT_MARKER } from '../../core/structural-context-contract.js';
import { findMarkers, scanSource } from '../cut-scan.js';

describe('scanSource', () => {
  it('reports balanced depth for ordinary code', () => {
    expect(scanSource('function a() {\n  return 1;\n}\n').ok).toBe(true);
  });

  it('ignores braces inside a string and a template', () => {
    expect(scanSource('const a = "{";\nconst b = `${x}}`;\n').ok).toBe(true);
  });

  it('ignores braces inside a line comment and a block comment', () => {
    expect(scanSource('// {\n/* { */\nconst a = 1;\n').ok).toBe(true);
  });

  it('ignores an unbalanced brace inside a regex literal', () => {
    expect(scanSource('const RE = /[*?[{]/;\nconst a = 1;\n').ok).toBe(true);
  });

  it('treats a slash after a value as division, not a regex', () => {
    expect(scanSource('const a = (1) / 2;\nconst b = x / y;\nconst c = { d: 1 };\n').ok).toBe(true);
  });

  it('re-enters code inside a template substitution', () => {
    expect(scanSource('const a = `x${ { y: 1 } }z`;\n').ok).toBe(true);
  });

  it('marks a file unscannable when depth ends non-zero', () => {
    expect(scanSource('function a() {\n').ok).toBe(false);
  });

  it('marks a file unscannable when depth goes negative', () => {
    expect(scanSource('}\nfunction a() {}\n').ok).toBe(false);
  });

  it('records comment lines', () => {
    const r = scanSource('const a = 1;\n// hi\n/* there\n   friend */\n');
    expect([...r.commentLines].sort((x, y) => x - y)).toEqual([2, 3, 4]);
  });

  // The two files tokenize() gets wrong today. This is the regression the whole
  // custom pass exists for.
  it.each(['src/core/ui-predicate.ts', 'src/invariants/public-api-tsdoc.ts'])(
    'scans %s cleanly',
    (path) => {
      expect(scanSource(readFileSync(path, 'utf8')).ok).toBe(true);
    },
  );
});

describe('findMarkers', () => {
  it('finds a line-comment marker with its reason', () => {
    const src = 'const a = 1;\n// noldor:cut stdout unbounded — cap it later\n';
    expect(findMarkers(src)).toEqual([{ line: 2, reason: 'stdout unbounded — cap it later' }]);
  });

  it('finds a JSDoc marker', () => {
    const src = '/**\n * noldor:cut a RELATIVE scan root — probe git\n */\nfunction a() {}\n';
    expect(findMarkers(src)).toEqual([{ line: 2, reason: 'a RELATIVE scan root — probe git' }]);
  });

  it('does not match noldor:cut-section', () => {
    expect(findMarkers('// noldor:cut-section Architecture — covered elsewhere\n')).toEqual([]);
  });

  it('does not match noldor:cutlery', () => {
    expect(findMarkers('// noldor:cutlery is not a marker\n')).toEqual([]);
  });

  it('does not match a marker inside a string or template', () => {
    expect(findMarkers('const s = "noldor:cut fake";\nconst t = `noldor:cut fake`;\n')).toEqual([]);
  });

  it('finds every marker in document order', () => {
    const src = '// noldor:cut one\nconst a = 1;\n// noldor:cut two\n';
    expect(findMarkers(src).map((m) => m.line)).toEqual([1, 3]);
  });

  it('returns nothing for an unscannable file', () => {
    expect(findMarkers('// noldor:cut one\nfunction a() {\n')).toEqual([]);
  });

  // Spec AC8. The scanner and the prose contract must share one spelling: a
  // rename of CUT_MARKER has to fail the suite rather than silently split the
  // grammar between what authors write and what review lanes are told.
  it('recognises exactly the shared CUT_MARKER token', () => {
    expect(findMarkers(`// ${CUT_MARKER} why\n`)).toEqual([{ line: 1, reason: 'why' }]);
    expect(findMarkers('// noldor-cut why\n')).toEqual([]);
  });
});

describe('findMarkers backtick boundary', () => {
  // A comment discussing the marker grammar writes it fenced. Treating that as
  // a declaration invents a scope out of a sentence about scopes — measured on
  // this repo, `src/docs/architecture-form.ts` is exactly that comment.
  it('does not match a backtick-fenced mention in prose', () => {
    expect(findMarkers('// the token is `noldor:cut <ceiling>`, pinned by a test\n')).toEqual([]);
  });

  it('still matches a bare marker on a JSDoc continuation line', () => {
    expect(findMarkers('/**\n * noldor:cut why\n */\nconst a = 1;\n')).toEqual([
      { line: 2, reason: 'why' },
    ]);
  });
});
