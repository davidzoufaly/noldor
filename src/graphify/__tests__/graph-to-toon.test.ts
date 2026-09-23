import { describe, expect, it } from 'vitest';

import { buildContext, renderBrainstormToon, type GraphData } from '../graph-to-toon.js';

// @tests: self-refreshing-compact-knowledge-graph

/** Two communities, one cross edge, one omitted `contains` edge, one hyperedge. */
export function fixture(): GraphData {
  return {
    directed: true,
    nodes: [
      { id: 'a', label: 'alpha()', community: 1, source_file: 'src/core/alpha.ts' },
      { id: 'b', label: 'beta', community: 1, source_file: 'src/core/beta.ts' },
      { id: 'c', label: 'gamma', community: 1, source_file: 'src/core/alpha.ts' },
      { id: 'd', label: 'delta', community: 2, source_file: 'src/web/delta.ts' },
      { id: 'e', label: 'Charlie', community: 2, source_file: 'src/web/charlie.ts' },
      { id: 'f', label: 'dup', community: 2, source_file: 'src/web/f.ts' },
      { id: 'g', label: 'dup', community: 2, source_file: 'src/web/g.ts' },
    ],
    links: [
      { source: 'a', target: 'b', relation: 'imports' },
      { source: 'a', target: 'c', relation: 'calls' },
      { source: 'b', target: 'c', relation: 'imports' },
      { source: 'a', target: 'b', relation: 'contains' },
      { source: 'a', target: 'd', relation: 'imports' },
    ],
    hyperedges: [{ label: 'boot path', relation: 'flow', nodes: ['a', 'd'] }],
  };
}

/**
 * One section, from its `## <key>` header to the blank line that closes it.
 * Every later task reads blocks through this rather than splitting the file on
 * blank runs — the number of blank lines around a section changes three times
 * across this plan, and a test keyed on that shape breaks on each change for a
 * reason that has nothing to do with what it is asserting.
 */
export function blockOf(text: string, key: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === `## ${key}` || l.startsWith(`## ${key} `));
  if (start < 0) return '';
  const rest = lines.slice(start + 1);
  const stop = rest.findIndex((l) => l === '' || l.startsWith('## '));
  return [lines[start], ...(stop < 0 ? rest : rest.slice(0, stop))].join('\n');
}

describe('graph-to-toon', () => {
  it('renders without touching the disk', () => {
    const text = renderBrainstormToon(buildContext(fixture()));
    expect(typeof text).toBe('string');
    expect(text.endsWith('\n')).toBe(true);
  });
});
