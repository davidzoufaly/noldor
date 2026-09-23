# Self-Refreshing, Compact Knowledge Graph Implementation Plan — Part 2: the v3 summary

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** `graph.brainstorm-summary.toon` joins the brainstorm file at v3 — a `## features` block, the same compact cross-edge row the brainstorm file uses, and every ordering pinned so equal counts cannot reshuffle between runs.

**Architecture:** Part 1 left `renderBrainstormSummary` at v2 and kept `formatCrossEdgeLine` alive for it. This part rewrites the renderer, routes its cross list through Part 1's `crossRows`, and retires the old formatter — so one row builder serves both files and the two formats cannot drift apart.

**Tech Stack:** TypeScript (ESM, Node >= 24), vitest.

---

## File Structure

- `src/graphify/graph-to-toon.ts` — **Modify.** `renderBrainstormSummary` rewritten to v3; `extractFeatures` added; `extractPackages` and `extractConceptsAndRationales` gain code-unit tie-breaks; `formatCrossEdgeLine` deleted.
- `src/graphify/__tests__/graph-to-toon.test.ts` — **Modify.** Summary-shape assertions and its own determinism pair.

---

## Task 1: Bring the summary file to v3

**Files:**

- Modify: `src/graphify/graph-to-toon.ts`
- Test: `src/graphify/__tests__/graph-to-toon.test.ts`

The summary gains panther's `## features` block and the shared compact cross-edge row, and keeps the `community index (top 20 by size)` block panther dropped — noldor has 206 communities with far weaker derived labels, so the size-ranked index is the only place a reader sees which are worth opening.

- [ ] **Step 1: Write the failing tests.**

  Append inside the existing `describe`, and extend the import at the top of the file to `import { buildContext, renderBrainstormSummary, renderBrainstormToon, type GraphData } from '../graph-to-toon.js';`:

  ```ts
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
  ```

- [ ] **Step 2: Run the test and verify it FAILS.**

  ```bash
  pnpm vitest run src/graphify/__tests__/graph-to-toon.test.ts
  ```

  Expected output: `Tests  1 failed | 9 passed (10)`, the failure showing the v2 summary header `# Domain Knowledge Graph — Summary`.

- [ ] **Step 3: Add feature extraction and pin the existing extractors' ordering.**

  Delete `formatCrossEdgeLine` — Part 1 left it in place only because the v2
  summary still called it, and this task is what replaces that call. Then replace
  `extractPackages` and `extractConceptsAndRationales` with:

  ```ts
  interface FeatureInfo {
    readonly name: string;
    readonly nodeCount: number;
    readonly subfolders: string;
  }

  function extractPackages(nodes: readonly GraphNode[]): readonly (readonly [string, number])[] {
    const counts = new Map<string, number>();
    for (const n of nodes) {
      const parts = (n.source_file ?? '').split('/');
      if (parts.length >= 2 && (parts[0] === 'packages' || parts[0] === 'apps')) {
        counts.set(parts[1], (counts.get(parts[1]) ?? 0) + 1);
      }
    }
    return [...counts.entries()].toSorted((a, b) => b[1] - a[1] || byCodeUnit(a[0], b[0]));
  }

  /** Feature folders, read from any `…/features/<name>/…` path segment. */
  function extractFeatures(nodes: readonly GraphNode[]): FeatureInfo[] {
    const counts = new Map<string, number>();
    const subfolders = new Map<string, Map<string, number>>();

    for (const n of nodes) {
      const sf = n.source_file ?? '';
      if (!sf.includes('/features/')) continue;
      const parts = sf.split('/features/')[1].split('/');
      const name = parts[0];
      if (name.includes('.')) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
      if (parts.length > 1 && !parts[1].includes('.')) {
        if (!subfolders.has(name)) subfolders.set(name, new Map());
        const subs = subfolders.get(name)!;
        subs.set(parts[1], (subs.get(parts[1]) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .toSorted((a, b) => b[1] - a[1] || byCodeUnit(a[0], b[0]))
      .map(([name, nodeCount]): FeatureInfo => {
        const subs = subfolders.get(name);
        return {
          name,
          nodeCount,
          subfolders: subs
            ? [...subs.entries()]
                .toSorted((a, b) => b[1] - a[1] || byCodeUnit(a[0], b[0]))
                .slice(0, 4)
                .map(([s]) => s)
                .join(', ')
            : '',
        };
      });
  }

  function extractConceptsAndRationales(nodes: readonly GraphNode[]): {
    concepts: string[];
    rationales: string[];
  } {
    const CONCEPT_PREFIXES = ['concept:', 'feature:', 'sdk:', 'component:', 'tool:'];
    const RATIONALE_PREFIX = 'rationale:';

    const concepts: string[] = [];
    const rationales: string[] = [];

    for (const n of nodes) {
      const nid = n.id ?? '';
      if (nid.startsWith(RATIONALE_PREFIX)) {
        rationales.push(
          n.label.startsWith('Rationale: ') ? n.label.slice('Rationale: '.length) : n.label,
        );
      } else if (CONCEPT_PREFIXES.some((p) => nid.startsWith(p))) {
        concepts.push(n.label);
      }
    }

    return {
      concepts: concepts.toSorted(byCodeUnit),
      rationales: rationales.toSorted(byCodeUnit),
    };
  }
  ```

- [ ] **Step 4: Rewrite `renderBrainstormSummary`.**

  Replace the whole function with:

  ```ts
  export function renderBrainstormSummary(ctx: GraphContext): string {
    const { nodes, links, communityLabels, directed, hyperedges } = ctx;
    const communityGroups = groupByCommunity(nodes);
    const nodeCommunityMap = buildNodeCommunityMap(nodes);
    const { cross } = classifyEdges(links, nodeCommunityMap);

    const lines: string[] = [
      '# Domain Knowledge Graph — Summary (v3)',
      '# version: 3',
      `# ${nodes.length} nodes, ${links.length} edges, ${communityGroups.size} communities, directed=${directed}`,
      '# Deep dive: graph.brainstorm.toon (TOC at top — use Read offset/limit per community)',
      '# Compact format used in brainstorm.toon:',
      '#   Rels: i=imports f=calls e=re_exports r=references m=method p=plan-of s=spec-of  (contains/imports_from omitted — derivable)',
      '#   Node row: <local_id> <label>[!=function] @<path_id>',
      '#   Edge row: <rel> <src>><t1,t2,...>',
      '#   Cross-edge row (this file + brainstorm.toon ## cross): <rel> <label>@c<src_comm>><label>@c<tgt_comm>',
    ];

    const packages = extractPackages(nodes);
    if (packages.length > 0) {
      lines.push('', '## packages');
      for (const [pkg, count] of packages) {
        lines.push(`  ${pkg} (${count} nodes)`);
      }
    }

    const features = extractFeatures(nodes);
    if (features.length > 0) {
      lines.push('', '## features');
      for (const { name, nodeCount, subfolders } of features) {
        lines.push(subfolders ? `  ${name}: ${nodeCount} nodes — ${subfolders}` : `  ${name}: ${nodeCount} nodes`);
      }
    }

    const { concepts, rationales } = extractConceptsAndRationales(nodes);
    if (concepts.length > 0) {
      lines.push('', '## concepts');
      for (const c of concepts) lines.push(`  ${sanitizeLine(c)}`);
    }
    if (rationales.length > 0) {
      lines.push('', '## rationales');
      for (const r of rationales) lines.push(`  ${sanitizeLine(r)}`);
    }

    const hyperLines = hyperedges.map(
      (he) =>
        `  ${sanitizeLine(he.label)} (${hyperedgeMembers(he).length} nodes, ${he.relation ?? 'related'})`,
    );
    if (hyperLines.length > 0) {
      lines.push('', '## hyperedges', ...hyperLines);
    }

    lines.push('', '## community index (top 20 by size)');
    const ranked = [...communityGroups.entries()]
      .toSorted((a, b) => b[1].length - a[1].length || a[0] - b[0])
      .slice(0, 20);
    for (const [commId, commNodes] of ranked) {
      const label = communityLabels[String(commId)] ?? `Community ${commId}`;
      lines.push(`  c${commId} (${commNodes.length}): ${sanitizeLine(label)}`);
    }

    const top25 = crossRows(cross, ctx.idToLabel, nodeCommunityMap).slice(0, 25);
    if (top25.length > 0) {
      lines.push('', '## cross-community edges (top 25)', ...top25);
    }

    lines.push('');
    return lines.join('\n');
  }
  ```

- [ ] **Step 5: Run the test and verify it PASSES.**

  ```bash
  pnpm vitest run src/graphify/__tests__/graph-to-toon.test.ts
  ```

  Expected output: `Tests  10 passed (10)`.

- [ ] **Step 6: Commit.**

  ```bash
  cat > /tmp/msg-part2-task1.txt <<'EOF'
  feat(graphify): bring the summary toon to v3

  Adds the `## features` block, and routes the top-25 cross list through the same
  row builder the brainstorm file's `## cross` block uses so the two formats cannot
  drift apart. Every ordering that was a bare `.sort()` or a count comparison with
  no tie-break now falls back to the code-unit comparator, so equal counts do not
  reshuffle between runs.

  The `community index (top 20 by size)` block stays, where panther dropped it:
  noldor has 206 communities against panther's 233 with much weaker derived
  labels, so the size-ranked index is the only place a reader sees which
  communities are worth opening.

  Noldor-FD: self-refreshing-compact-knowledge-graph
  EOF
  git add src/graphify/graph-to-toon.ts src/graphify/__tests__/graph-to-toon.test.ts
  git commit -F /tmp/msg-part2-task1.txt
  ```

---

## Task 2: Pin the summary's determinism

**Files:**

- Modify: `src/graphify/__tests__/graph-to-toon.test.ts`

Part 1 proved the brainstorm file is reproducible. The summary needs the same guarantee for its own orderings — the count-ranked blocks are where an unpinned tie shows up, and a tie is invisible until two runs disagree.

- [ ] **Step 1: Write the failing test.**

  Append inside the existing `describe`:

  ```ts
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
  ```

- [ ] **Step 2: Run the test and verify it PASSES, then prove it pins something.**

  ```bash
  pnpm vitest run src/graphify/__tests__/graph-to-toon.test.ts
  ```

  Expected output: `Tests  13 passed (13)`. It passes on the first run because Task 1 added the tie-breaks — so make it fail on purpose: drop the `|| byCodeUnit(a[0], b[0])` from `extractPackages` and re-run. Expected: the package ordering assertion goes red, reporting `beta` before `alpha`. Restore the tie-break.

- [ ] **Step 3: Run the whole suite.**

  ```bash
  pnpm verify
  ```

  Expected output: lint, typecheck and the full vitest run all green, ending in the summary line with no failures.

- [ ] **Step 4: Commit.**

  ```bash
  cat > /tmp/msg-part2-task2.txt <<'EOF'
  test(graphify): pin the summary toon's tie-breaks

  The summary's blocks rank by count, and an unpinned tie is invisible until two
  runs disagree — which is exactly what happens once CI becomes a second producer.
  The test builds a graph where every count ties, so only the code-unit fallback
  decides the order, and asserts a second render returns the same bytes.

  Noldor-FD: self-refreshing-compact-knowledge-graph
  EOF
  git add src/graphify/__tests__/graph-to-toon.test.ts
  git commit -F /tmp/msg-part2-task2.txt
  ```
