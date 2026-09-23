// @tests: release-sweep-process-hardening

import { describe, expect, it } from 'vitest';

import { decideRefactor, parseReportShape } from '../refactor-precondition.js';

function report(godNodes: string[], cohesions: number[]): string {
  return [
    '# Graph Report',
    '',
    '## God Nodes (most connected - your core abstractions)',
    ...godNodes.map((n, i) => `${i + 1}. \`${n}\` - ${90 - i} edges`),
    '',
    "## Surprising Connections (you probably didn't know these)",
    '- `a()` --calls--> `b()`  [INFERRED]',
    '',
    '## Communities (2 total)',
    '',
    ...cohesions.flatMap((c, i) => [`### Community ${i} - "C${i}"`, `Cohesion: ${c}`, '']),
  ].join('\n');
}

describe('parseReportShape', () => {
  it('reads god-node names and the lowest cohesion', () => {
    expect(parseReportShape(report(['loadDocRoots()', 'parseSlug()'], [0.07, 0.06]))).toEqual({
      godNodes: ['loadDocRoots()', 'parseSlug()'],
      minCohesion: 0.06,
    });
  });

  it('does not read backticked names outside the God Nodes section', () => {
    const shape = parseReportShape(report(['loadDocRoots()'], [0.1]));
    expect(shape?.godNodes).toEqual(['loadDocRoots()']);
  });

  it('is null when a section is missing', () => {
    expect(parseReportShape('# Graph Report\n\nCohesion: 0.1\n')).toBeNull();
    expect(parseReportShape(report(['a()'], []))).toBeNull();
  });
});

describe('decideRefactor', () => {
  const base = { godNodes: ['a()', 'b()'], minCohesion: 0.06 };

  it('skips when the god-node set and cohesion are unchanged, edge counts aside', () => {
    const current = parseReportShape(report(['b()', 'a()'], [0.06, 0.2]))!;
    expect(decideRefactor(current, base).run).toBe(false);
  });

  it('runs when a god node joins or leaves the set', () => {
    const d = decideRefactor({ godNodes: ['a()', 'c()'], minCohesion: 0.06 }, base);
    expect(d).toEqual({ run: true, reason: 'god-node set changed: +c(); -b()' });
  });

  it('runs when the lowest cohesion falls past noise, not on a wobble or a rise', () => {
    expect(decideRefactor({ ...base, minCohesion: 0.04 }, base).run).toBe(true);
    expect(decideRefactor({ ...base, minCohesion: 0.05 }, base).run).toBe(false);
    expect(decideRefactor({ ...base, minCohesion: 0.2 }, base).run).toBe(false);
  });

  it('runs when there is no baseline to compare against', () => {
    expect(decideRefactor(base, null).run).toBe(true);
  });
});
