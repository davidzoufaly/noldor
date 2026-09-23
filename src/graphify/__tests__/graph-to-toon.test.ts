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

  it('emits a community block with local indices and a prefix-factored path table', () => {
    const text = renderBrainstormToon(buildContext(fixture()));
    const block = blockOf(text, 'c1');

    // Nodes sort by code-unit label: alpha(), beta, gamma.
    expect(block).toContain('n\n  0 alpha! @');
    expect(block).toContain('\n  1 beta @');
    expect(block).toContain('\n  2 gamma @');
    // Two distinct paths under src/core/, factored to the last slash.
    expect(block).toContain('p[2] prefix=src/core/');
    expect(block).toContain('  0=alpha.ts');
    expect(block).toContain('  1=beta.ts');
  });

  it('collapses edges to adjacency lists and drops derivable relations', () => {
    const text = renderBrainstormToon(buildContext(fixture()));
    const block = blockOf(text, 'c1');

    // imports: alpha(0)->beta(1), beta(1)->gamma(2); calls: alpha(0)->gamma(2).
    expect(block).toContain('\n  f 0>2');
    expect(block).toContain('\n  i 0>1');
    expect(block).toContain('\n  i 1>2');
    // `contains` is derivable from node placement and must not appear.
    expect(block).not.toMatch(/\n {2}\? /);
  });

  it('names top hubs with fan-in/fan-out', () => {
    const text = renderBrainstormToon(buildContext(fixture()));
    const block = blockOf(text, 'c1');
    expect(block).toContain('sig hubs=');
    expect(block).toMatch(/sig hubs=alpha!\(0\/2\)/);
  });

  it('derives community labels when the graph carries none', () => {
    // noldor's graph.json has no `community_labels` key. Panther's script falls
    // back to `?? {}`, which would degrade every label to `Community 85`.
    const text = renderBrainstormToon(buildContext(fixture()));
    expect(text).not.toMatch(/## c\d+ \(\d+\) Community \d+$/m);
    expect(text).toMatch(/^## c1 \(3\) \S/m);
  });

  it('breaks equal labels by node id, so indices cannot drift', () => {
    // The real graph.json has 72 groups of same-labelled nodes inside one
    // community. Sorted by label alone their order is whatever graphify emitted,
    // so every edge row pointing at them shifts when that order changes.
    const text = renderBrainstormToon(buildContext(fixture()));
    const block = blockOf(text, 'c2');
    expect(block).toContain('  2 dup @');
    expect(block).toContain('  3 dup @');

    const base = fixture();
    const nodes = [...base.nodes];
    const i = nodes.findIndex((n) => n.id === 'f');
    const j = nodes.findIndex((n) => n.id === 'g');
    [nodes[i], nodes[j]] = [nodes[j], nodes[i]];
    expect(blockOf(renderBrainstormToon(buildContext({ ...base, nodes })), 'c2')).toBe(block);
  });

  it('keeps indices community-local', () => {
    // Index 0 means a different node in each block — the reason `## cross` has
    // to carry labels instead of indices.
    const text = renderBrainstormToon(buildContext(fixture()));
    const c1 = blockOf(text, 'c1');
    const c2 = blockOf(text, 'c2');
    expect(c1).toContain('  0 alpha! @');
    expect(c2).toContain('  0 Charlie @');
  });

  it('omits sig, prefix and e when their conditions do not hold', () => {
    const tiny: GraphData = {
      directed: true,
      links: [],
      nodes: [{ community: 9, id: 'x', label: 'solo', source_file: 'src/x.ts' }],
    };
    const block = blockOf(renderBrainstormToon(buildContext(tiny)), 'c9');
    expect(block).not.toContain('sig hubs='); // under SIG_MIN_NODES, no edges
    expect(block).toContain('p[1]');
    expect(block).not.toContain('prefix='); // a single path factors nothing
    expect(block).not.toMatch(/\ne\n/); // no surviving edges
  });

  it('puts every TOC entry on its own section header line', () => {
    const lines = renderBrainstormToon(buildContext(fixture())).split('\n');
    const tocStart = lines.indexOf('toc');
    expect(tocStart).toBeGreaterThan(0);

    const entries = lines
      .slice(tocStart + 1)
      .filter((l) => /^ {2}\S+: \d+-\d+$/.test(l))
      .map((l) => {
        const [key, range] = l.trim().split(': ');
        const [start, end] = range.split('-').map(Number);
        return { end, key, start };
      });

    expect(entries.map((e) => e.key)).toContain('c1');
    for (const e of entries) {
      expect(lines[e.start - 1]).toMatch(new RegExp(`^## ${e.key}( |$)`));
      expect(e.end).toBeGreaterThanOrEqual(e.start);
    }
  });

  it('declares the format version in the header', () => {
    const text = renderBrainstormToon(buildContext(fixture()));
    expect(text.startsWith('# Domain Knowledge Graph (v3 — compact)\n# version: 3\n')).toBe(true);
  });
});
