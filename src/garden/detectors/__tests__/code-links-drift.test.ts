// @tests: dynamic-fd-file-pointers-via-frontmatter, outcome-telemetry-and-effectiveness-metrics

import { describe, expect, it } from 'vitest';

import { detectCodeLinksDrift } from '../code-links-drift.js';

describe('detectCodeLinksDrift', () => {
  it('flags an FD whose file-level links.code differs from the scan', () => {
    const scanned = new Map<string, string[]>([['foo', ['src/a.ts', 'src/b.ts']]]);
    const cached = new Map<string, string[]>([['foo', ['src/a.ts']]]);
    const gaps = detectCodeLinksDrift(scanned, cached);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].message).toContain('foo');
    expect(gaps[0].message).toContain('links.code');
  });

  it('returns no gaps when arrays match', () => {
    const m = new Map<string, string[]>([['foo', ['src/a.ts']]]);
    expect(detectCodeLinksDrift(m, new Map(m))).toEqual([]);
  });
});
