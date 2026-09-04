// @tests: specs-cr-gate-multi-reviewer
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { scanSource } from '../cut-scan.js';

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
