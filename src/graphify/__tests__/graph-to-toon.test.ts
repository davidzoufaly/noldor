import { describe, expect, it } from 'vitest';

import {
  buildContext,
  renderBrainstormSummary,
  renderBrainstormToon,
  type GraphData,
} from '../graph-to-toon.js';

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

  it('emits cross edges with labels and community tags, ordered reproducibly', () => {
    const lines = renderBrainstormToon(buildContext(fixture())).split('\n');
    const start = lines.indexOf('## cross');
    expect(start).toBeGreaterThan(0);
    expect(lines[start + 1]).toBe('  i alpha!@c1>delta@c2');
  });

  it('emits hyperedges as a named block', () => {
    const lines = renderBrainstormToon(buildContext(fixture())).split('\n');
    const start = lines.indexOf('## hyperedges');
    expect(start).toBeGreaterThan(0);
    expect(lines[start + 1]).toBe('  boot path [flow]: alpha(), delta');
  });

  it('lists cross and hyperedges in the TOC only when they exist', () => {
    const withBoth = renderBrainstormToon(buildContext(fixture()));
    expect(withBoth).toMatch(/\n {2}cross: \d+-\d+\n/);
    expect(withBoth).toMatch(/\n {2}hyperedges: \d+-\d+\n/);

    const onlyOne: GraphData = {
      directed: true,
      links: [{ relation: 'imports', source: 'a', target: 'b' }],
      nodes: [
        { community: 1, id: 'a', label: 'alpha', source_file: 'src/a.ts' },
        { community: 1, id: 'b', label: 'beta', source_file: 'src/b.ts' },
      ],
    };
    const text = renderBrainstormToon(buildContext(onlyOne));
    expect(text).not.toContain('## cross');
    expect(text).not.toContain('## hyperedges');
    expect(text).not.toMatch(/\n {2}cross: /);
    expect(text).not.toMatch(/\n {2}hyperedges: /);
  });

  it('renders byte-identical output twice from the same graph', () => {
    const first = renderBrainstormToon(buildContext(fixture()));
    const second = renderBrainstormToon(buildContext(fixture()));
    expect(second).toBe(first);
  });

  it('orders every line by code unit, not by locale', () => {
    // Czech collation sorts `ch` after `h`, so `Charlie` lands after `delta`
    // under cs_CZ and before it under en_US. Code-unit ordering is uppercase-first
    // and locale-independent, so `Charlie` precedes `delta` either way.
    const text = renderBrainstormToon(buildContext(fixture()));
    const block = blockOf(text, 'c2');
    expect(block).toContain('  0 Charlie @');
    expect(block).toContain('  1 delta @');
    expect('Charlie'.localeCompare('delta', 'cs')).toBeGreaterThan(0);
  });

  it('renders a v3 summary with the community index and shared cross rows', () => {
    const text = renderBrainstormSummary(buildContext(fixture()));
    expect(text.startsWith('# Domain Knowledge Graph — Summary (v3)\n# version: 3\n')).toBe(true);
    expect(text).toContain('## community index (top 20 by size)');
    expect(text).toContain('  c1 (3): ');
    expect(text).toContain('## cross-community edges (top 25)');
    expect(text).toContain('  i alpha!@c1>delta@c2');
    expect(text).toContain('## hyperedges');
    expect(text).toContain('  boot path (2 nodes, flow)');
  });

  it('does not mistake a test folder for a feature', () => {
    const graph: GraphData = {
      directed: true,
      links: [],
      nodes: [
        { community: 1, id: 'a', label: 'a', source_file: 'src/features/__tests__/a.test.ts' },
      ],
    };
    // The only `/features/` match in noldor's own graph is this shape. A
    // `## features` block naming it would be wrong, so there must be no block.
    expect(renderBrainstormSummary(buildContext(graph))).not.toContain('## features');
  });

  it('renders a byte-identical summary twice, ties included', () => {
    const graph: GraphData = {
      directed: true,
      links: [],
      nodes: [
        { community: 1, id: 'a', label: 'a', source_file: 'packages/beta/src/a.ts' },
        { community: 1, id: 'b', label: 'b', source_file: 'packages/alpha/src/b.ts' },
        { community: 2, id: 'c', label: 'c', source_file: 'src/features/zeta/c.ts' },
        { community: 3, id: 'd', label: 'd', source_file: 'src/features/gamma/d.ts' },
      ],
    };
    const first = renderBrainstormSummary(buildContext(graph));
    expect(renderBrainstormSummary(buildContext(graph))).toBe(first);

    // One node each: the counts tie, so only the code-unit tie-break decides.
    expect(first.indexOf('  alpha (1 nodes)')).toBeLessThan(first.indexOf('  beta (1 nodes)'));
    expect(first.indexOf('  gamma: 1 nodes')).toBeLessThan(first.indexOf('  zeta: 1 nodes'));
    // Equal-size communities fall back to ascending id.
    expect(first.indexOf('  c2 (1): ')).toBeLessThan(first.indexOf('  c3 (1): '));
  });

  it('renders a graph whose nodes carry no community', () => {
    // `community` is optional on the type and `?? -1` is honoured everywhere
    // else, so bucket -1 must be emittable — its TOC key is `c-1`.
    const text = renderBrainstormToon(
      buildContext({
        links: [],
        nodes: [
          { id: 'a', label: 'A' },
          { community: 0, id: 'b', label: 'B' },
        ],
      }),
    );
    expect(text).toContain('## c-1 (1) ');
    expect(text).toMatch(/\n {2}c-1: \d+-\d+\n/);
  });

  it('keeps the TOC honest when a field carries a newline', () => {
    // validateToc must see the text that gets written, not the pre-join array —
    // one element holding a newline shifts every later range by one.
    const text = renderBrainstormToon(
      buildContext({
        links: [],
        nodes: [
          { community: 0, id: 'a', label: 'A', source_file: 'src/x\ny.ts' },
          { community: 1, id: 'b', label: 'B', source_file: 'src/b.ts' },
        ],
      }),
    );
    const lines = text.split('\n');
    for (const entry of lines.filter((l) => /^ {2}c-?\d+: /.test(l))) {
      const [key, range] = entry.trim().split(': ');
      expect(lines[Number(range.split('-')[0]) - 1]).toMatch(new RegExp(`^## ${key}( |$)`));
    }
  });

  it('breaks hub ties by index, not by insertion order', () => {
    // Two nodes sharing a label and a total degree tie on both sort keys, and
    // the leftover order came from a Set built in graphify's edge order. Their
    // fan-in/fan-out split differs, so the rendered line exposes the swap.
    const nodes = [
      { community: 1, id: 'p', label: 'p', source_file: 'src/p.ts' },
      { community: 1, id: 'x', label: 'dup', source_file: 'src/x.ts' },
      { community: 1, id: 'y', label: 'dup', source_file: 'src/y.ts' },
      { community: 1, id: 'z', label: 'z', source_file: 'src/z.ts' },
    ];
    const links = [
      { relation: 'calls', source: 'y', target: 'p' },
      { relation: 'calls', source: 'y', target: 'z' },
      { relation: 'calls', source: 'x', target: 'p' },
      { relation: 'calls', source: 'p', target: 'x' },
    ];
    const forward = blockOf(renderBrainstormToon(buildContext({ links, nodes })), 'c1');
    const reversed = blockOf(
      renderBrainstormToon(buildContext({ links: links.toReversed(), nodes })),
      'c1',
    );
    expect(forward).toContain('sig hubs=p(2/1) dup(1/1) dup(0/2)');
    expect(reversed).toBe(forward);
  });

  it('keeps two distinct unmapped relations apart', () => {
    // Both render `?`, but they are different edges — collapsing them into one
    // adjacency set loses an edge and undercounts the header.
    const text = renderBrainstormToon(
      buildContext({
        links: [
          { relation: 'inherits', source: 'a', target: 'b' },
          { relation: 'implements', source: 'a', target: 'b' },
        ],
        nodes: [
          { community: 1, id: 'a', label: 'a', source_file: 'src/a.ts' },
          { community: 1, id: 'b', label: 'b', source_file: 'src/b.ts' },
        ],
      }),
    );
    expect(
      blockOf(text, 'c1')
        .split('\n')
        .filter((l) => l.startsWith('  ? ')).length,
    ).toBe(2);
    expect(text).toContain('# 2 nodes, 2 edges');
  });

  it('reports hub degrees the block actually contains', () => {
    // Parallel links under one relation collapse into a single adjacency entry,
    // so counting the input links makes `sig` describe edges the block omits.
    const text = renderBrainstormToon(
      buildContext({
        links: [
          { relation: 'calls', source: 'A', target: 'B' },
          { relation: 'calls', source: 'A', target: 'B' },
          { relation: 'calls', source: 'C', target: 'B' },
        ],
        nodes: [
          { community: 1, id: 'A', label: 'A', source_file: 'src/a.ts' },
          { community: 1, id: 'B', label: 'B', source_file: 'src/b.ts' },
          { community: 1, id: 'C', label: 'C', source_file: 'src/c.ts' },
        ],
      }),
    );
    expect(text).toContain('sig hubs=B(2/0)');
    expect(text).toContain('# 3 nodes, 2 edges');
  });

  it('does not let a relation name reach Object.prototype', () => {
    // REL_CODE is keyed lookup over attacker-adjacent data: graph.json relations
    // are free-form on a semantic run, and `constructor` on an object literal
    // returns the Object constructor's source.
    for (const relation of ['constructor', 'toString', 'hasOwnProperty']) {
      const text = renderBrainstormToon(
        buildContext({
          links: [{ relation, source: 'A', target: 'B' }],
          nodes: [
            { community: 1, id: 'A', label: 'A', source_file: 'src/a.ts' },
            { community: 1, id: 'B', label: 'B', source_file: 'src/b.ts' },
          ],
        }),
      );
      expect(text).toContain('  ? 0>1');
      expect(text).not.toContain('native code');
    }
  });

  it('keeps edges among community-less nodes inside their own block', () => {
    // `## cross` promises two DIFFERENT communities. The -1 bucket is a real
    // block now, so its internal edges belong in it, not in cross.
    const text = renderBrainstormToon(
      buildContext({
        links: [{ relation: 'calls', source: 'A', target: 'B' }],
        nodes: [
          { id: 'A', label: 'A', source_file: 'src/a.ts' },
          { id: 'B', label: 'B', source_file: 'src/b.ts' },
        ],
      }),
    );
    expect(blockOf(text, 'c-1')).toContain('  f 0>1');
    expect(text).not.toContain('## cross');
  });

  it('drops a link whose endpoint is not a node in the graph', () => {
    // A dangling target rendered as `@c-1`, which reads as membership of the
    // community-less block rather than as the missing node it is.
    const text = renderBrainstormToon(
      buildContext({
        links: [{ relation: 'calls', source: 'A', target: 'ghost' }],
        nodes: [
          { community: 0, id: 'A', label: 'A', source_file: 'src/a.ts' },
          { community: 1, id: 'B', label: 'B', source_file: 'src/b.ts' },
        ],
      }),
    );
    expect(text).not.toContain('ghost');
    expect(text).not.toContain('## cross');
    expect(text).toContain('# 2 nodes, 0 edges');
  });

  it('reports the same edge count in both files, and collapses duplicate cross edges', () => {
    const graph: GraphData = {
      directed: true,
      links: [
        { relation: 'imports', source: 'a', target: 'd' },
        { relation: 'imports', source: 'a', target: 'd' },
        { relation: 'calls', source: 'a', target: 'b' },
        { relation: 'contains', source: 'a', target: 'b' },
      ],
      nodes: [
        { community: 1, id: 'a', label: 'a', source_file: 'src/a.ts' },
        { community: 1, id: 'b', label: 'b', source_file: 'src/b.ts' },
        { community: 2, id: 'd', label: 'd', source_file: 'src/d.ts' },
      ],
    };
    const ctx = buildContext(graph);
    // `contains` dropped, the duplicate cross link collapsed: 2 edges encoded.
    expect(renderBrainstormToon(ctx)).toContain('# 3 nodes, 2 edges');
    expect(renderBrainstormSummary(ctx)).toContain('# 3 nodes, 2 edges');
    // And the cross block carries that one row once, not twice.
    const rows = renderBrainstormToon(ctx)
      .split('\n')
      .filter((l) => l === '  i a@c1>d@c2');
    expect(rows).toHaveLength(1);
  });

  it('ends the file with exactly one newline whichever block came last', () => {
    const withCross = renderBrainstormToon(buildContext(fixture()));
    const noCross = renderBrainstormToon(
      buildContext({
        directed: true,
        links: [],
        nodes: [{ community: 1, id: 'a', label: 'a', source_file: 'src/a.ts' }],
      }),
    );
    for (const text of [withCross, noCross]) {
      expect(text.endsWith('\n')).toBe(true);
      expect(text.endsWith('\n\n')).toBe(false);
    }
  });

  it('derives the same community label whatever order the nodes arrive in', () => {
    // This is the production path: noldor's graph.json carries no
    // `community_labels`, so every heading in the file comes from here.
    const mk = (order: string[]): GraphData => ({
      directed: false,
      links: [],
      nodes: order.map((id) => ({
        community: 1,
        id,
        label: id,
        source_file: `packages/${id}/src/${id}.ts`,
      })),
    });
    const heading = (g: GraphData): string =>
      renderBrainstormToon(buildContext(g))
        .split('\n')
        .find((l) => l.startsWith('## c1 ')) ?? '';
    expect(heading(mk(['beta', 'alpha']))).toBe(heading(mk(['alpha', 'beta'])));
    expect(heading(mk(['alpha', 'beta']))).toBe('## c1 (2) alpha');
  });

  it('renders a hyperedge that carries no label', () => {
    // `label` is required on the type but graph.json is external data.
    const text = renderBrainstormToon(
      buildContext({
        directed: false,
        hyperedges: [{ nodes: ['a'], relation: 'flow' } as unknown as { label: string }],
        links: [],
        nodes: [{ community: 1, id: 'a', label: 'A', source_file: 'src/a.ts' }],
      }),
    );
    expect(text).toContain('## hyperedges');
    expect(text).not.toContain('undefined');
  });
});
