// @tests: dashboard-blocked-by-graph-view
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBlockedByGraph, setDocRootsOverride } from '../data';
import { renderBlockedBy } from '../views';

function fixtureRepo(roadmap: string, backlog = '# Backlog\n'): string {
  const repo = mkdtempSync(join(tmpdir(), 'noldor-blocked-by-'));
  mkdirSync(join(repo, 'docs'), { recursive: true });
  writeFileSync(join(repo, 'docs', 'roadmap.md'), roadmap, 'utf8');
  writeFileSync(join(repo, 'docs', 'backlog.md'), backlog, 'utf8');
  setDocRootsOverride(repo);
  return repo;
}

afterEach(() => setDocRootsOverride(undefined));

const entry = (name: string, bullets: string[]): string =>
  `### ${name}\n\n${bullets.map((b) => `- ${b}`).join('\n')}\n\nBody.\n`;

describe('loadBlockedByGraph', () => {
  it('builds an edge from a blocked-by slug ref and counts the rest unlinked', async () => {
    fixtureRepo(
      [
        '# Roadmap',
        entry('Alpha', ['id: Q-0001', 'area: tooling', 'blocked-by: beta']),
        entry('Beta', ['id: Q-0002', 'area: tooling']),
        entry('Gamma', ['id: Q-0003', 'area: tooling']),
      ].join('\n'),
    );
    const g = await loadBlockedByGraph();
    expect(g.edges).toEqual([{ from: 'alpha', to: 'beta' }]);
    expect(g.nodes.map((n) => n.slug).sort()).toEqual(['alpha', 'beta']);
    expect(g.unlinked).toBe(1); // gamma
    expect(g.cycles).toEqual([]);
  });

  it('resolves Q-id refs and the legacy deps: alias', async () => {
    fixtureRepo(
      [
        '# Roadmap',
        entry('Alpha', ['id: Q-0001', 'area: tooling', 'blocked-by: Q-0002']),
        entry('Beta', ['id: Q-0002', 'area: tooling', 'deps: alpha']),
      ].join('\n'),
    );
    const g = await loadBlockedByGraph();
    expect(g.edges).toContainEqual({ from: 'alpha', to: 'beta' });
    expect(g.edges).toContainEqual({ from: 'beta', to: 'alpha' });
    // a↔b is a cycle; both nodes flagged
    expect(g.cycles).toHaveLength(1);
    expect([...(g.cycles[0] ?? [])].sort()).toEqual(['alpha', 'beta']);
    expect(g.nodes.every((n) => n.inCycle)).toBe(true);
  });

  it('marks backlog entries with source backlog', async () => {
    fixtureRepo(
      ['# Roadmap', entry('Alpha', ['id: Q-0001', 'area: tooling', 'blocked-by: parked'])].join(
        '\n',
      ),
      ['# Backlog', entry('Parked', ['id: Q-0009', 'area: tooling'])].join('\n'),
    );
    const g = await loadBlockedByGraph();
    const parked = g.nodes.find((n) => n.slug === 'parked');
    expect(parked?.source).toBe('backlog');
    expect(g.nodes.find((n) => n.slug === 'alpha')?.source).toBe('roadmap');
  });

  it('keeps dangling refs as edges without a target node', async () => {
    fixtureRepo(
      ['# Roadmap', entry('Alpha', ['id: Q-0001', 'area: tooling', 'blocked-by: ghost-ref'])].join(
        '\n',
      ),
    );
    const g = await loadBlockedByGraph();
    expect(g.edges).toEqual([{ from: 'alpha', dangling: 'ghost-ref' }]);
    expect(g.nodes.map((n) => n.slug)).toEqual(['alpha']);
  });

  it('missing files read as empty — no crash, empty graph', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'noldor-blocked-by-'));
    setDocRootsOverride(repo);
    const g = await loadBlockedByGraph();
    expect(g).toEqual({ nodes: [], edges: [], cycles: [], unlinked: 0 });
  });
});

describe('renderBlockedBy', () => {
  it('renders mermaid nodes, edges, and cycle styling', async () => {
    fixtureRepo(
      [
        '# Roadmap',
        entry('Alpha', ['id: Q-0001', 'area: tooling', 'blocked-by: beta']),
        entry('Beta', ['id: Q-0002', 'area: tooling', 'blocked-by: alpha, ghost']),
      ].join('\n'),
    );
    const html = renderBlockedBy(await loadBlockedByGraph());
    expect(html).toContain('<pre class="mermaid">');
    expect(html).toContain('Alpha (Q-0001)');
    expect(html).toContain('--&gt;'); // escaped edge arrow
    expect(html).toContain('-.-&gt;'); // dangling edge
    expect(html).toContain('class s_0,s_1 cycle;');
    expect(html).toContain('<h2>Cycles</h2>');
  });

  it('empty graph renders the empty state without a mermaid block', () => {
    const html = renderBlockedBy({ nodes: [], edges: [], cycles: [], unlinked: 5 });
    expect(html).toContain('dependency-free');
    expect(html).not.toContain('class="mermaid"');
    expect(html).toContain('<div class="v">5</div>');
  });
});
