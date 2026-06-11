// @tests: project-tracking-dashboard

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  LOW_COHESION_THRESHOLD,
  graphHealthSchema,
  loadGraphHealth,
  parseGraphReport,
  setDocRootsOverride,
} from '../data.js';
import { renderGraphHealth } from '../views.js';

import type { GraphHealth } from '../data.js';

const FIXTURE = `# Graph Report - src  (2026-06-01)

## Corpus Check
- Large corpus: 318 files.

## Summary
- 1036 nodes · 2318 edges · 52 communities (46 shown, 6 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS

## God Nodes (most connected - your core abstractions)
1. \`loadDocRoots()\` - 21 edges
2. \`loadConsumerConfig()\` - 20 edges
3. \`collectGaps()\` - 18 edges

## Communities (52 total, 6 thin omitted)

### Community 0 - "garden"
Cohesion: 0.06
Nodes (61): loadAreaCategories(), loadConsumerConfig() (+59 more)

### Community 1 - "core"
Cohesion: 0.1
Nodes (27): runCrRetryLoop(), discoverAddedFiles() (+25 more)

## Knowledge Gaps
- **6 thin communities (<3 nodes) omitted from report**
`;

describe('parseGraphReport', () => {
  it('parses header, summary, god nodes and communities from a report body', () => {
    const h = parseGraphReport(FIXTURE);
    graphHealthSchema.parse(h);
    expect(h.scope).toBe('src');
    expect(h.generatedOn).toBe('2026-06-01');
    expect(h.nodes).toBe(1036);
    expect(h.edges).toBe(2318);
    expect(h.communitiesTotal).toBe(52);
    expect(h.thinOmitted).toBe(6);
    expect(h.godNodes).toEqual([
      { name: 'loadDocRoots()', edges: 21 },
      { name: 'loadConsumerConfig()', edges: 20 },
      { name: 'collectGaps()', edges: 18 },
    ]);
    expect(h.communities).toEqual([
      { label: 'garden', cohesion: 0.06, nodeCount: 61 },
      { label: 'core', cohesion: 0.1, nodeCount: 27 },
    ]);
  });

  it('returns null dead-export count when the report has no Dead Exports section', () => {
    expect(parseGraphReport(FIXTURE).deadExports).toBeNull();
  });

  it('counts dead-export list items when the section exists', () => {
    const withDead = `${FIXTURE}\n## Dead Exports\n- \`unusedHelper()\`\n- \`legacyParse()\`\n`;
    expect(parseGraphReport(withDead).deadExports).toBe(2);
  });

  it('sorts communities worst-cohesion first', () => {
    const reordered = FIXTURE.replace('Cohesion: 0.06', 'Cohesion: 0.42');
    const h = parseGraphReport(reordered);
    expect(h.communities[0]).toEqual({ label: 'core', cohesion: 0.1, nodeCount: 27 });
  });

  it('skips a community with a malformed cohesion value instead of throwing', () => {
    const drifted = FIXTURE.replace('Cohesion: 0.06', 'Cohesion: ...');
    const h = parseGraphReport(drifted);
    expect(h.communities).toEqual([{ label: 'core', cohesion: 0.1, nodeCount: 27 }]);
  });

  it('yields nulls and empty arrays for a body with no recognizable sections', () => {
    const h = parseGraphReport('just prose, no report here');
    expect(h.scope).toBeNull();
    expect(h.nodes).toBeNull();
    expect(h.godNodes).toEqual([]);
    expect(h.communities).toEqual([]);
    expect(h.deadExports).toBeNull();
  });
});

describe('loadGraphHealth', () => {
  it('reads a report from the doc root and stamps the file mtime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'graph-health-'));
    try {
      await mkdir(join(root, 'graphify-out'));
      await writeFile(join(root, 'graphify-out', 'GRAPH_REPORT.md'), FIXTURE, 'utf8');
      setDocRootsOverride(root);
      const h = await loadGraphHealth();
      expect(h).not.toBeNull();
      graphHealthSchema.parse(h);
      expect(h!.reportMtime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(h!.godNodes).toHaveLength(3);
      expect(h!.scope).toBe('src');
    } finally {
      setDocRootsOverride(undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('smoke: tolerates whatever the live tracked report contains', async () => {
    // Live-tree smoke only — no assertions on parsed content, so a /graphify
    // format drift can never break the dashboard suite (score.test trap class).
    const h = await loadGraphHealth();
    if (h !== null) graphHealthSchema.parse(h);
  });

  it('returns null when no graphify-out report exists under the doc root', async () => {
    setDocRootsOverride('/nonexistent-graph-health-root');
    try {
      expect(await loadGraphHealth()).toBeNull();
    } finally {
      setDocRootsOverride(undefined);
    }
  });
});

describe('renderGraphHealth', () => {
  const base: GraphHealth = {
    scope: 'src',
    generatedOn: '2026-06-01',
    reportMtime: '2026-06-01T10:30:00.000Z',
    nodes: 1036,
    edges: 2318,
    communitiesTotal: 52,
    thinOmitted: 6,
    godNodes: [{ name: 'loadDocRoots()', edges: 21 }],
    communities: [
      { label: 'garden', cohesion: 0.06, nodeCount: 61 },
      { label: 'core', cohesion: 0.1, nodeCount: 27 },
    ],
    deadExports: null,
  };

  it('renders empty state with a /graphify hint when no report exists', () => {
    const html = renderGraphHealth(null);
    expect(html).toContain('No <code>graphify-out/GRAPH_REPORT.md</code>');
    expect(html).toContain('/graphify');
  });

  it('renders counters, snapshot stamp, god-node and community tables', () => {
    const html = renderGraphHealth(base);
    expect(html).toContain('<h1>Graph health</h1>');
    expect(html).toContain('god nodes');
    expect(html).toContain('low-cohesion communities');
    expect(html).toContain('report dated 2026-06-01');
    expect(html).toContain('last /graphify run 2026-06-01 10:30 UTC');
    expect(html).toContain('loadDocRoots()');
    expect(html).toContain('garden');
  });

  it('flags communities under the cohesion threshold and counts them', () => {
    const html = renderGraphHealth(base);
    expect(base.communities[0].cohesion).toBeLessThan(LOW_COHESION_THRESHOLD);
    expect(base.communities[1].cohesion).toBeGreaterThanOrEqual(LOW_COHESION_THRESHOLD);
    expect(html).toContain('low cohesion');
    expect(html).toContain('row-stale');
    expect(html).toContain('<div class="v">1</div><div class="l">low-cohesion communities</div>');
  });

  it('renders a dash for dead exports when the report carries no section', () => {
    const html = renderGraphHealth(base);
    expect(html).toContain('dead exports (not in report)');
    expect(renderGraphHealth({ ...base, deadExports: 4 })).toContain(
      '<div class="v">4</div><div class="l">dead exports</div>',
    );
  });

  it('escapes HTML in node and community labels', () => {
    const html = renderGraphHealth({
      ...base,
      godNodes: [{ name: '<script>x()</script>', edges: 3 }],
      communities: [{ label: '<b>bad</b>', cohesion: 0.01, nodeCount: 2 }],
    });
    expect(html).not.toContain('<script>x()');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;bad&lt;/b&gt;');
  });
});
