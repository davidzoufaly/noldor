// @tests: project-tracking-dashboard

import { describe, expect, it } from 'vitest';

import {
  LOW_COHESION_THRESHOLD,
  graphHealthSnapshotSchema,
  loadGraphHealth,
  parseGraphReport,
} from '../data.js';
import { renderGraphHealth } from '../views.js';

import type { GraphHealthSnapshot } from '../data.js';

const FIXTURE = `# Graph Report - src  (2026-06-01)

## Corpus Check
- Large corpus: 318 files.

## Summary
- 1036 nodes · 2318 edges · 52 communities (46 shown, 6 thin omitted)
- Extraction: 90% EXTRACTED

## Community Hubs (Navigation)
- [[_COMMUNITY_garden|garden]]

## God Nodes (most connected - your core abstractions)
1. \`loadDocRoots()\` - 21 edges
2. \`loadConsumerConfig()\` - 20 edges
3. \`collectGaps()\` - 18 edges

## Surprising Connections (you probably didn't know these)
- \`main()\` --calls--> \`loadConfig()\`  [INFERRED]

## Communities (52 total, 6 thin omitted)

### Community 0 - "garden"
Cohesion: 0.06
Nodes (61): loadAreaCategories(), loadConsumerConfig() (+59 more)

### Community 1 - "release"
Cohesion: 0.05
Nodes (45): loadCategories() (+44 more)

### Community 9 - "utils"
Cohesion: 0.14
Nodes (10): foo() (+9 more)

### Community 17 - "graphify"
Cohesion: 0.28
Nodes (12): bar() (+11 more)

### Community 27 - "features"
Cohesion: 0.54
Nodes (8): baz() (+7 more)

## Knowledge Gaps
- something
`;

describe('parseGraphReport', () => {
  it('parses header scope + run date', () => {
    const s = parseGraphReport(FIXTURE);
    expect(s.scope).toBe('src');
    expect(s.reportDate).toBe('2026-06-01');
  });

  it('parses summary node / edge / community totals', () => {
    const s = parseGraphReport(FIXTURE);
    expect(s.nodeCount).toBe(1036);
    expect(s.edgeCount).toBe(2318);
    expect(s.communityCount).toBe(52);
  });

  it('tracks scanned community count (detailed blocks) separately from the Summary total', () => {
    const s = parseGraphReport(FIXTURE);
    // 5 "### Community" blocks present; Summary total is 52 (incl. thin/omitted).
    expect(s.scannedCommunityCount).toBe(5);
    expect(s.communityCount).toBe(52);
  });

  it('counts god nodes and captures name + edges', () => {
    const s = parseGraphReport(FIXTURE);
    expect(s.godNodeCount).toBe(3);
    expect(s.godNodes[0]).toEqual({ name: 'loadDocRoots()', edges: 21 });
  });

  it('flags communities at or below the cohesion threshold, sorted ascending', () => {
    const s = parseGraphReport(FIXTURE);
    // 0.06, 0.05, 0.14 are ≤ 0.15; 0.28 and 0.54 are not.
    expect(s.lowCohesionCount).toBe(3);
    expect(s.lowCohesionCommunities.map((c) => c.cohesion)).toEqual([0.05, 0.06, 0.14]);
    expect(s.lowCohesionThreshold).toBe(LOW_COHESION_THRESHOLD);
  });

  it('reports dead exports as null when graphify emits no such section', () => {
    expect(parseGraphReport(FIXTURE).deadExportCount).toBeNull();
  });

  it('parses a dead-export section when one is present (forward-compat)', () => {
    const withDead = `${FIXTURE}\n## Dead Exports\n- \`unusedA()\`\n- \`unusedB()\`\n`;
    expect(parseGraphReport(withDead).deadExportCount).toBe(2);
  });

  it('degrades to nulls / empties on a report missing every section', () => {
    const s = parseGraphReport('# not a graph report\n');
    expect(s.scope).toBeNull();
    expect(s.reportDate).toBeNull();
    expect(s.nodeCount).toBeNull();
    expect(s.communityCount).toBeNull();
    expect(s.godNodeCount).toBe(0);
    expect(s.lowCohesionCount).toBe(0);
    expect(s.scannedCommunityCount).toBe(0);
    graphHealthSnapshotSchema.parse(s);
  });
});

describe('loadGraphHealth', () => {
  it('returns a Zod-valid snapshot (or null when no report exists)', async () => {
    const s = await loadGraphHealth();
    if (s !== null) graphHealthSnapshotSchema.parse(s);
  });
});

describe('renderGraphHealth', () => {
  const snapshot: GraphHealthSnapshot = {
    scope: 'src',
    reportDate: '2026-06-01',
    nodeCount: 1036,
    edgeCount: 2318,
    communityCount: 52,
    scannedCommunityCount: 41,
    godNodeCount: 2,
    godNodes: [
      { name: 'loadDocRoots()', edges: 21 },
      { name: 'loadConsumerConfig()', edges: 20 },
    ],
    lowCohesionThreshold: 0.15,
    lowCohesionCount: 1,
    lowCohesionCommunities: [{ id: 1, label: 'release', cohesion: 0.05 }],
    deadExportCount: null,
  };

  it('renders counters for god nodes, low-cohesion communities, and dead exports', () => {
    const html = renderGraphHealth(snapshot);
    expect(html).toContain('<h1>Graph health</h1>');
    expect(html).toContain('>2</div><div class="l">god nodes</div>');
    expect(html).toContain('low-cohesion communities');
    expect(html).toContain('>—</div><div class="l">dead exports</div>');
  });

  it('labels the snapshot with the report run date', () => {
    expect(renderGraphHealth(snapshot)).toContain('Snapshot as of 2026-06-01');
  });

  it('notes when dead exports are not reported by graphify', () => {
    expect(renderGraphHealth(snapshot)).toContain('Dead exports not reported by graphify');
  });

  it('renders an empty state when no report exists', () => {
    const html = renderGraphHealth(null);
    expect(html).toContain('class="empty"');
    expect(html).toContain('/graphify');
  });
});
