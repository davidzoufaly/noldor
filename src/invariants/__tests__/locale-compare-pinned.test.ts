// @tests: architecture-invariants
import { describe, expect, it } from 'vitest';

import { scanSource } from '../locale-compare-pinned.js';

// Joined from parts so this file does not itself trip the scan it tests.
const LC = ['.locale', 'Compare('].join('');

describe('scanSource', () => {
  it('flags a call that names no locale', () => {
    const v = scanSource('src/x.ts', `const s = xs.sort((a, b) => a${LC}b));\n`);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(1);
    expect(v[0]?.message).toContain("'en'");
  });

  it('accepts a call pinned to a locale, with or without options', () => {
    expect(scanSource('src/x.ts', `a${LC}b, 'en');\n`)).toEqual([]);
    expect(scanSource('src/x.ts', `a${LC}b, 'en', { numeric: true });\n`)).toEqual([]);
  });

  it('reads a trailing comma as formatting, not as a locale argument', () => {
    const src = `\nx${LC}\n  get(a, b) as string,\n);\n`;
    const v = scanSource('src/x.ts', src);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(2);
  });

  it('does not count a comma nested inside the first argument', () => {
    expect(scanSource('src/x.ts', `a${LC}labelOf(byId, b));\n`)).toHaveLength(1);
    expect(scanSource('src/x.ts', `a${LC}labelOf(byId, b), 'en');\n`)).toEqual([]);
  });

  it('does not flag a prose mention with no call', () => {
    expect(scanSource('src/x.ts', '// `localeCompare` resolves against the machine\n')).toEqual([]);
  });
});
