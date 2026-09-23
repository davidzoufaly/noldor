# Self-Refreshing, Compact Knowledge Graph Implementation Plan — Part 1: the v3 renderer

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** `pnpm toon` emits a v3 `graph.brainstorm.toon` that is roughly 60% smaller than today's and carries a table of contents, so an agent can `Read offset/limit` one community instead of loading 697 KB — and emits the same bytes on a `cs_CZ` laptop as on an `en_US` CI runner.

**Architecture:** `src/graphify/graph-to-toon.ts` keeps its single-file shape and gains the seam `src/graphify/enrich-doc-nodes.ts` already uses — exported pure functions (parsed graph in, text out) plus a `main()` guarded by an `invokedDirect` check that does all the IO. Tests assert on returned strings and never touch disk.

**Tech Stack:** TypeScript (ESM, Node >= 24), vitest.

---

## File Structure

- `src/graphify/graph-to-toon.ts` — **Modify.** Exports `byCodeUnit`, `buildContext`, `renderBrainstormToon`, `renderBrainstormSummary` and the types they use; `main()` reads the file, calls the two renderers, writes the two outputs. Single responsibility: turn a parsed graph object into `.toon` text.
- `src/graphify/__tests__/graph-to-toon.test.ts` — **Create.** The v3 contract: community-local indices, `REL_OMIT`, TOC line arithmetic, `## cross` / `## hyperedges`, code-unit ordering under two locales, byte-identical re-render.

---

## Task 1: Give the emitter a pure seam

**Files:**

- Modify: `src/graphify/graph-to-toon.ts`
- Test: `src/graphify/__tests__/graph-to-toon.test.ts`

Behaviour-preserving. Today `main()` runs at module scope and every path ends in `writeFileSync`, so nothing can be asserted without touching disk. This task changes that and nothing else — the output bytes stay v2.

- [x] **Step 1: Write the failing test file.**

  Create `src/graphify/__tests__/graph-to-toon.test.ts`:

  ```ts
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
  ```

- [x] **Step 2: Run the test and verify it FAILS.**

  ```bash
  pnpm vitest run src/graphify/__tests__/graph-to-toon.test.ts
  ```

  Expected output: `Test Files  1 failed (1)` and `Tests  no tests`, over `Error: process.exit unexpectedly called with "1"`. Not a missing-export error: `main()` still runs at module scope, so importing the module from a test runs it with no `graph.json` argument and it exits before the missing exports are ever reached. Step 5 is what turns that into a normal import.

- [x] **Step 3: Export the types.**

  In `src/graphify/graph-to-toon.ts`, change each of `interface GraphNode`, `interface GraphLink`, `interface Hyperedge`, `interface GraphData` and `interface GraphContext` to `export interface …`. Leave every field as it is.

- [x] **Step 4: Add `buildContext` and turn the two writers into renderers.**

  Replace the body of `writeBrainstormToon` and `writeBrainstormSummary` so each builds `lines` exactly as before but ends with `return lines.join('\n');` instead of `writeAndLog(path, lines.join('\n'))`, rename them to `renderBrainstormToon` / `renderBrainstormSummary`, export both, and drop the `path` parameter. Then add, above `main()`:

  ```ts
  /** Build the shared render context from a parsed graph.json — the only place
   *  the `community_labels` fallback and the two hyperedge locations are resolved. */
  export function buildContext(data: GraphData): GraphContext {
    const { nodes, links, directed = false } = data;
    return {
      communityLabels: data.community_labels ?? deriveCommunityLabels(groupByCommunity(nodes)),
      directed,
      hyperedges: data.hyperedges ?? data.graph?.hyperedges ?? [],
      idToLabel: buildIdToLabel(nodes),
      links,
      nodes,
    };
  }
  ```

- [x] **Step 5: Make `main()` the only code that touches disk, and stop it running on import.**

  Replace `main()` and the bare `main();` call at the bottom of the file with:

  ```ts
  function main(): void {
    const args = process.argv.slice(2);
    if (args.length === 0) {
      console.error(`Usage: noldor graphify graph-to-toon <graph.json> [graph.json ...]`);
      process.exit(1);
    }

    for (const inputPath of args) {
      const data: GraphData = JSON.parse(readFileSync(inputPath, 'utf8'));
      const nCommunities = new Set(data.nodes.map((n) => n.community)).size;
      console.log(
        `Loaded ${inputPath}: ${data.nodes.length} nodes, ${data.links.length} links, ${nCommunities} communities`,
      );

      const ctx = buildContext(data);
      const dir = dirname(inputPath);
      writeAndLog(join(dir, 'graph.brainstorm.toon'), renderBrainstormToon(ctx));
      writeAndLog(join(dir, 'graph.brainstorm-summary.toon'), renderBrainstormSummary(ctx));
    }
  }

  if (isEntrypoint(import.meta.url)) main();
  ```

  Add `import { isEntrypoint } from '../core/cli-entry.js';` to the imports at the top of the file. This is the repo's canonical guard — 44 modules use it, and the Q-0126 sweep moved them off hand-rolled stem regexes precisely because a stem match fires for any file with the same basename. The guard is what lets the test import the module: without it `main()` runs at import time, reads `process.argv[2]` (a vitest path), and exits 1.

- [x] **Step 6: Run the test and verify it PASSES.**

  ```bash
  pnpm vitest run src/graphify/__tests__/graph-to-toon.test.ts
  ```

  Expected output: `Test Files  1 passed (1)` and `Tests  1 passed (1)`.

- [x] **Step 7: Verify the CLI still produces the same bytes.**

  Render the pre-refactor emitter and the refactored one against the **same**
  `graph.json`, on the same machine, into a scratch directory. The committed
  `.toon` is not a valid baseline: it may have been generated from an older
  `graph.json`, or on a machine whose locale ordered v2's `localeCompare`
  differently — either would show a diff this task did not cause.

  ```bash
  mkdir -p /tmp/toon-parity && cp graphify-out/graph.json /tmp/toon-parity/
  git show HEAD:src/graphify/graph-to-toon.ts > /tmp/toon-parity/v2.ts
  npx tsx /tmp/toon-parity/v2.ts /tmp/toon-parity/graph.json
  mv /tmp/toon-parity/graph.brainstorm.toon /tmp/toon-parity/v2.brainstorm.toon
  npx tsx src/graphify/graph-to-toon.ts /tmp/toon-parity/graph.json
  diff -q /tmp/toon-parity/v2.brainstorm.toon /tmp/toon-parity/graph.brainstorm.toon && echo IDENTICAL
  ```

  Expected output: `IDENTICAL`. This task is a refactor; any diff means a behaviour change slipped in. Nothing under `graphify-out/` is touched.

- [x] **Step 8: Commit.**

  ```bash
  cat > /tmp/msg-task1.txt <<'EOF'
  refactor(graphify): give the toon emitter a pure render seam

  Why — src/graphify/graph-to-toon.ts had zero tests, and the reason was structural
  rather than negligent: main() ran at module scope and every code path ended in
  writeFileSync, so nothing could be asserted without touching the disk. The v3
  format rewrite that follows is exactly the kind of change that regresses silently
  without a test net, so the seam has to come first.

  How — Exports the types, turns the two writers into renderBrainstormToon and
  renderBrainstormSummary that return the text instead of writing it, adds
  buildContext to resolve the community_labels fallback and the two hyperedge
  locations in one place, and guards main() behind an invokedDirect check on
  process.argv[1] — the same shape enrich-doc-nodes.ts already uses.

  What — No output change. The emitted bytes are identical before and after; only
  the call graph moved.

  Noldor-FD: self-refreshing-compact-knowledge-graph
  EOF
  git add src/graphify/graph-to-toon.ts src/graphify/__tests__/graph-to-toon.test.ts
  git commit -F /tmp/msg-task1.txt
  ```

---

## Task 2: The v3 community block

**Files:**

- Modify: `src/graphify/graph-to-toon.ts`
- Test: `src/graphify/__tests__/graph-to-toon.test.ts`

Replaces the per-community body: `sig hubs=`, a prefix-factored path table, nodes addressed by community-local index, edges collapsed to adjacency lists, and the code-unit comparator that makes all of it reproducible.

- [x] **Step 1: Write the failing tests.**

  Append to `src/graphify/__tests__/graph-to-toon.test.ts`, inside the existing `describe`:

  ```ts
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
    expect(block).not.toContain('sig hubs=');   // under SIG_MIN_NODES, no edges
    expect(block).toContain('p[1]');
    expect(block).not.toContain('prefix=');      // a single path factors nothing
    expect(block).not.toMatch(/\ne\n/);          // no surviving edges
  });
  ```

- [x] **Step 2: Run the tests and verify they FAIL.**

  ```bash
  pnpm vitest run src/graphify/__tests__/graph-to-toon.test.ts
  ```

  Expected output: `Tests  7 failed | 1 passed (8)`, the failures reporting that the received block still carries the v2 `nodes:` / `edges:` shape.

- [x] **Step 3: Add the comparator, the relation tables and the line helpers.**

  In `src/graphify/graph-to-toon.ts`, replace the `PATH_STRIP_PREFIXES` block with:

  ```ts
  const PATH_STRIP_PREFIXES = ['packages/', 'apps/', 'docs/'];

  /**
   * Ordering pinned to raw code units. `localeCompare` resolves against the
   * machine locale — under `cs_CZ` Czech collates `ch` after `h`, so the same
   * graph would emit a different node order on an operator's laptop than on an
   * `en_US` CI runner, and the two producers would churn against each other.
   * Every ordering in both emitted files goes through this.
   */
  export function byCodeUnit(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  /** Single-letter relation codes. `p`/`s` cover `graphify enrich-docs` output. */
  const REL_CODE: Record<string, string> = {
    calls: 'f',
    imports: 'i',
    method: 'm',
    'plan-of': 'p',
    re_exports: 'e',
    references: 'r',
    'spec-of': 's',
  };

  /** Edges recoverable from node placement or from other edges — dropped to save tokens. */
  const REL_OMIT: ReadonlySet<string> = new Set(['contains', 'imports_from']);

  const HUB_MIN_DEGREE = 2;
  const HUB_TOP_N = 5;
  const SIG_MIN_NODES = 3;
  const PREFIX_MIN_LEN = 4;

  /** Collapse newlines and tabs: the format is line-oriented, so a multi-line label corrupts it. */
  function sanitizeLine(s: string): string {
    return s
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/ {2,}/g, ' ')
      .trim();
  }

  /** A trailing `()` becomes `!` — two characters saved on every function node. */
  function formatNodeLabel(label: string): string {
    const clean = sanitizeLine(label);
    return clean.endsWith('()') ? `${clean.slice(0, -2)}!` : clean;
  }

  /** Longest common prefix truncated at the last slash, or none when it buys under 4 characters. */
  function factorCommonPrefix(paths: readonly string[]): {
    prefix: string;
    stripped: string[];
  } {
    if (paths.length < 2) {
      return { prefix: '', stripped: [...paths] };
    }
    let cp = paths[0];
    for (let i = 1; i < paths.length; i++) {
      const p = paths[i];
      const lim = Math.min(cp.length, p.length);
      let j = 0;
      while (j < lim && cp[j] === p[j]) j++;
      cp = cp.slice(0, j);
      if (!cp) break;
    }
    const lastSlash = cp.lastIndexOf('/');
    cp = lastSlash >= 0 ? cp.slice(0, lastSlash + 1) : '';
    if (cp.length < PREFIX_MIN_LEN) {
      return { prefix: '', stripped: [...paths] };
    }
    return { prefix: cp, stripped: paths.map((p) => p.slice(cp.length)) };
  }
  ```

- [x] **Step 4: Add the hub computation.**

  Insert after `factorCommonPrefix`:

  ```ts
  interface HubStats {
    readonly idx: number;
    readonly fanIn: number;
    readonly fanOut: number;
  }

  /** Top hubs by total degree, ties broken by label so the line is reproducible. */
  function computeHubs(
    commEdges: readonly GraphLink[],
    localIdx: Map<string, number>,
    sortedNodes: readonly GraphNode[],
  ): HubStats[] {
    const fanOut = new Map<number, number>();
    const fanIn = new Map<number, number>();
    for (const l of commEdges) {
      const s = localIdx.get(l.source);
      const t = localIdx.get(l.target);
      if (s !== undefined) fanOut.set(s, (fanOut.get(s) ?? 0) + 1);
      if (t !== undefined) fanIn.set(t, (fanIn.get(t) ?? 0) + 1);
    }
    const stats: HubStats[] = [];
    for (const idx of new Set<number>([...fanOut.keys(), ...fanIn.keys()])) {
      const fi = fanIn.get(idx) ?? 0;
      const fo = fanOut.get(idx) ?? 0;
      if (fi + fo < HUB_MIN_DEGREE) continue;
      stats.push({ fanIn: fi, fanOut: fo, idx });
    }
    return stats
      .toSorted(
        (a, b) =>
          b.fanIn + b.fanOut - (a.fanIn + a.fanOut) ||
          byCodeUnit(sortedNodes[a.idx].label, sortedNodes[b.idx].label),
      )
      .slice(0, HUB_TOP_N);
  }
  ```

- [x] **Step 5: Replace `formatEdgeLine` / `formatCrossEdgeLine` with `emitCommunity`.**

  Delete `formatEdgeLine` — the community block was its only caller. Leave
  `formatCrossEdgeLine` in place: `renderBrainstormSummary` still calls it, and
  Part 2 is what retires it. Then add:

  ```ts
  /**
   * Push one community's v3 block onto `lines` and return the number of edge rows
   * it emitted. Indices are community-local and 0-based. The return value is what
   * the header's edge count is built from: adjacency collapses parallel links
   * between the same pair under one relation into a single entry, so counting the
   * input links instead would print a total the file does not encode.
   */
  function emitCommunity(
    lines: string[],
    commId: number,
    commNodes: readonly GraphNode[],
    commEdges: readonly GraphLink[],
    communityLabels: Record<string, string>,
  ): number {
    const label = communityLabels[String(commId)] ?? `Community ${commId}`;
    // Label, then id. Labels are not unique inside a community, and a tie left
    // to the input order makes every index in the block a function of how
    // graphify happened to emit its nodes.
    const sortedNodes = [...commNodes].toSorted(
      (a, b) => byCodeUnit(a.label, b.label) || byCodeUnit(a.id, b.id),
    );
    const localIdx = new Map<string, number>(sortedNodes.map((n, i) => [n.id, i]));

    const uniquePaths = [
      ...new Set(sortedNodes.map((n) => shortenPath(n.source_file ?? ''))),
    ].toSorted(byCodeUnit);
    const { prefix, stripped } = factorCommonPrefix(uniquePaths);
    const pathLocal = new Map<string, number>(uniquePaths.map((p, i) => [p, i]));

    lines.push(`## c${commId} (${commNodes.length}) ${sanitizeLine(label)}`);

    if (commNodes.length >= SIG_MIN_NODES && commEdges.length > 0) {
      const hubs = computeHubs(commEdges, localIdx, sortedNodes);
      if (hubs.length > 0) {
        const parts = hubs.map(
          (h) => `${formatNodeLabel(sortedNodes[h.idx].label)}(${h.fanIn}/${h.fanOut})`,
        );
        lines.push(`sig hubs=${parts.join(' ')}`);
      }
    }

    lines.push(prefix ? `p[${uniquePaths.length}] prefix=${prefix}` : `p[${uniquePaths.length}]`);
    for (let i = 0; i < stripped.length; i++) {
      lines.push(`  ${i}=${stripped[i]}`);
    }

    lines.push('n');
    for (let i = 0; i < sortedNodes.length; i++) {
      const n = sortedNodes[i];
      const pi = pathLocal.get(shortenPath(n.source_file ?? '')) ?? 0;
      lines.push(`  ${i} ${formatNodeLabel(n.label)} @${pi}`);
    }

    if (commEdges.length === 0) {
      return 0;
    }

    const byRel = new Map<string, Map<number, Set<number>>>();
    for (const l of commEdges) {
      const r = REL_CODE[l.relation ?? ''] ?? '?';
      const s = localIdx.get(l.source);
      const t = localIdx.get(l.target);
      if (s === undefined || t === undefined) continue;
      if (!byRel.has(r)) byRel.set(r, new Map());
      const bySrc = byRel.get(r)!;
      if (!bySrc.has(s)) bySrc.set(s, new Set());
      bySrc.get(s)!.add(t);
    }

    lines.push('e');
    let emitted = 0;
    for (const r of [...byRel.keys()].toSorted(byCodeUnit)) {
      const bySrc = byRel.get(r)!;
      for (const s of [...bySrc.keys()].toSorted((a, b) => a - b)) {
        const targets = [...bySrc.get(s)!].toSorted((a, b) => a - b);
        lines.push(`  ${r} ${s}>${targets.join(',')}`);
        emitted += targets.length;
      }
    }
    return emitted;
  }
  ```

- [x] **Step 6: Call `emitCommunity` from the renderer.**

  In `renderBrainstormToon`, replace the whole `for (const commId of sortedComms) { … }` body with:

  ```ts
  const sortedComms = [...communityGroups.keys()].toSorted((a, b) => a - b);
  for (const commId of sortedComms) {
    const commNodes = communityGroups.get(commId)!;
    const commEdges = (intra.get(commId) ?? []).filter((l) => !REL_OMIT.has(l.relation ?? ''));
    emitCommunity(lines, commId, commNodes, commEdges, communityLabels);
    lines.push('');
  }
  ```

- [x] **Step 7: Run the tests and verify they PASS.**

  ```bash
  pnpm vitest run src/graphify/__tests__/graph-to-toon.test.ts
  ```

  Expected output: `Tests  8 passed (8)`.

- [x] **Step 8: Commit.**

  ```bash
  cat > /tmp/msg-task2.txt <<'EOF'
  feat(graphify): compact the community block to v3

  Nodes are addressed by community-local index against a prefix-factored path
  table, edges collapse into per-relation adjacency lists, single-letter relation
  codes replace the spelled-out names, and a sig line names the top hubs by
  fan-in/fan-out. Dropping `contains` and `imports_from` removes 47% of noldor's
  edges without losing a fact: `contains` is carried by every node row's path
  index, and `imports_from` is the file-level projection of symbol-level `imports`.

  The comparator is pinned to raw code units rather than `localeCompare`, which
  resolves against the machine locale and would otherwise churn every index in the
  file between a cs_CZ laptop and an en_US runner.

  Noldor-FD: self-refreshing-compact-knowledge-graph
  EOF
  git add src/graphify/graph-to-toon.ts src/graphify/__tests__/graph-to-toon.test.ts
  git commit -F /tmp/msg-task2.txt
  ```

---

## Task 3: Header, `toc` block and `validateToc`

**Files:**

- Modify: `src/graphify/graph-to-toon.ts`
- Test: `src/graphify/__tests__/graph-to-toon.test.ts`

The TOC is the feature: without it a reader has no way to fetch less than the whole file. Line numbers are 1-based, absolute and inclusive at both ends, computed by emitting the body first and then shifting by a header whose length is known.

- [ ] **Step 1: Write the failing tests.**

  Append inside the existing `describe`:

  ```ts
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
  ```

- [ ] **Step 2: Run the tests and verify they FAIL.**

  ```bash
  pnpm vitest run src/graphify/__tests__/graph-to-toon.test.ts
  ```

  Expected output: `Tests  2 failed | 8 passed (10)` — `expect(tocStart).toBeGreaterThan(0)` receives `-1`, and the header assertion receives the v2 first line.

- [ ] **Step 3: Add the TOC entry type and `validateToc`.**

  Insert above `renderBrainstormToon`:

  ```ts
  interface TocEntry {
    readonly key: string;
    readonly startLine: number;
    readonly endLine: number;
  }

  /**
   * Re-reads the assembled lines and throws when a TOC entry does not land on its
   * `## ` header. Hand-computed line arithmetic is exactly the kind of thing that
   * drifts silently when the body emission changes, so the emitter checks itself.
   */
  function validateToc(lines: readonly string[], entries: readonly TocEntry[]): void {
    for (const e of entries) {
      const actual = lines[e.startLine - 1] ?? '';
      const expected = e.key.startsWith('c') && /^c\d+$/.test(e.key) ? `## ${e.key} ` : `## ${e.key}`;
      const ok = /^c\d+$/.test(e.key) ? actual.startsWith(expected) : actual === expected;
      if (!ok) {
        throw new Error(
          `TOC drift: ${e.key} expected at line ${e.startLine} ("${expected}"), got "${actual}"`,
        );
      }
    }
  }
  ```

- [ ] **Step 4: Rewrite `renderBrainstormToon` as two passes.**

  Replace the whole function with:

  ```ts
  export function renderBrainstormToon(ctx: GraphContext): string {
    const { nodes, links, communityLabels, directed } = ctx;
    const communityGroups = groupByCommunity(nodes);
    const nodeCommunityMap = buildNodeCommunityMap(nodes);
    const { intra, cross } = classifyEdges(links, nodeCommunityMap);

    // Pass 1 — body, with line ranges relative to the body's own first line.
    const body: string[] = [];
    const entries: TocEntry[] = [];
    let totalEdges = 0;

    for (const commId of [...communityGroups.keys()].toSorted((a, b) => a - b)) {
      const startLine = body.length + 1;
      const commNodes = communityGroups.get(commId)!;
      const commEdges = (intra.get(commId) ?? []).filter((l) => !REL_OMIT.has(l.relation ?? ''));
      totalEdges += emitCommunity(body, commId, commNodes, commEdges, communityLabels);
      entries.push({ endLine: body.length, key: `c${commId}`, startLine });
      body.push('');
    }

    // Pass 2 — a header whose length is known, then shift every range by it.
    const header: string[] = [
      '# Domain Knowledge Graph (v3 — compact)',
      '# version: 3',
      `# ${nodes.length} nodes, ${totalEdges} edges (contains/imports_from omitted), ${communityGroups.size} communities, directed=${directed}`,
      '# Per community: sig (top hubs by fan-in/out) | p (local paths, prefix-factored) | n (nodes) | e (edges)',
      '# Rels: i=imports f=calls e=re_exports r=references m=method p=plan-of s=spec-of',
      '# Node row: <local_id> <label>[!=function] @<path_id>',
      '# Edge row: <rel> <src>><t1,t2,...>',
      '# TOC: <key>: <startLine>-<endLine>  (use Read offset/limit to load a single section)',
      '',
      'toc',
    ];
    const totalHeaderLines = header.length + entries.length + 1;
    const shifted = entries.map(
      (e): TocEntry => ({
        endLine: e.endLine + totalHeaderLines,
        key: e.key,
        startLine: e.startLine + totalHeaderLines,
      }),
    );
    for (const e of shifted) {
      header.push(`  ${e.key}: ${e.startLine}-${e.endLine}`);
    }
    header.push('');

    const lines = [...header, ...body, ''];
    validateToc(lines, shifted);
    return lines.join('\n');
  }
  ```

  `totalHeaderLines` counts the lines already pushed, one line per entry, and the blank that closes the block — so it is known before the entries are written, which is what makes the arithmetic possible in one pass over the header.

- [ ] **Step 5: Run the tests and verify they PASS.**

  ```bash
  pnpm vitest run src/graphify/__tests__/graph-to-toon.test.ts
  ```

  Expected output: `Tests  10 passed (10)`.

- [ ] **Step 6: Commit.**

  ```bash
  cat > /tmp/msg-task3.txt <<'EOF'
  feat(graphify): give the brainstorm toon a table of contents

  The file is emitted in two passes — body first with body-relative ranges, then a
  header whose line count is known before its entries are written, then a shift.
  Each entry is `<key>: <startLine>-<endLine>`, 1-based, absolute and inclusive at
  both ends, so a reader can pass the range straight to Read offset/limit and load
  one community instead of the whole file.

  validateToc re-reads the assembled lines and throws when an entry does not land
  on its `## ` header, so a later change to the body emission fails loudly rather
  than shipping ranges that point at the wrong place. A `# version: 3` header line
  lets a future reader branch on the format without parsing prose.

  Noldor-FD: self-refreshing-compact-knowledge-graph
  EOF
  git add src/graphify/graph-to-toon.ts src/graphify/__tests__/graph-to-toon.test.ts
  git commit -F /tmp/msg-task3.txt
  ```

---

## Task 4: The cross and hyperedge blocks

**Files:**

- Modify: `src/graphify/graph-to-toon.ts`
- Test: `src/graphify/__tests__/graph-to-toon.test.ts`

Both blocks span communities, so local indices do not apply and both carry full labels. Both are addressable, so both get a TOC entry — and neither is emitted, nor listed, when empty.

- [ ] **Step 1: Write the failing tests.**

  Append inside the existing `describe`:

  ```ts
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
  ```

- [ ] **Step 2: Run the tests and verify they FAIL.**

  ```bash
  pnpm vitest run src/graphify/__tests__/graph-to-toon.test.ts
  ```

  Expected output: `Tests  3 failed | 10 passed (13)` — `lines.indexOf('## cross')` returns `-1` because Task 3's renderer drops the block entirely.

- [ ] **Step 3: Add the two row builders.**

  Insert above `renderBrainstormToon`:

  ```ts
  /** `<relCode> <srcLabel>@c<id>><tgtLabel>@c<id>`, shared by the brainstorm block
   *  and the summary's top-25 list so the two never drift apart. */
  function crossRows(
    cross: readonly GraphLink[],
    idToLabel: Map<string, string>,
    nodeCommunityMap: Map<string, number>,
  ): string[] {
    return cross
      .filter((l) => !REL_OMIT.has(l.relation ?? ''))
      .map((l) => ({
        rel: REL_CODE[l.relation ?? ''] ?? '?',
        src: formatNodeLabel(idToLabel.get(l.source) ?? l.source),
        srcComm: nodeCommunityMap.get(l.source) ?? -1,
        tgt: formatNodeLabel(idToLabel.get(l.target) ?? l.target),
        tgtComm: nodeCommunityMap.get(l.target) ?? -1,
      }))
      .toSorted(
        (a, b) =>
          byCodeUnit(a.rel, b.rel) ||
          byCodeUnit(a.src, b.src) ||
          byCodeUnit(a.tgt, b.tgt) ||
          // Labels are not unique across communities either — `main!` in c3 and
          // `main!` in c9 tie on all three keys above, and the leftover order is
          // graphify's.
          a.srcComm - b.srcComm ||
          a.tgtComm - b.tgtComm,
      )
      .map((r) => `  ${r.rel} ${r.src}@c${r.srcComm}>${r.tgt}@c${r.tgtComm}`);
  }

  /** Members are named rather than indexed: a hyperedge spans communities, so the
   *  local indices do not apply. Graph order is kept — it is already deterministic. */
  function hyperedgeRows(
    hyperedges: readonly Hyperedge[],
    idToLabel: Map<string, string>,
  ): string[] {
    return hyperedges.map((he) => {
      const members = hyperedgeMembers(he)
        .map((nid) => sanitizeLine(idToLabel.get(nid) ?? nid))
        .join(', ');
      return `  ${sanitizeLine(he.label)} [${he.relation ?? 'related'}]: ${members}`;
    });
  }
  ```

- [ ] **Step 4: Emit both blocks in pass 1.**

  In `renderBrainstormToon`, after the community loop and before the `// Pass 2` comment, insert:

  ```ts
    const crossLines = crossRows(cross, ctx.idToLabel, nodeCommunityMap);
    if (crossLines.length > 0) {
      const startLine = body.length + 1;
      body.push('## cross', ...crossLines);
      entries.push({ endLine: body.length, key: 'cross', startLine });
      totalEdges += crossLines.length;
    }

    const hyperLines = hyperedgeRows(ctx.hyperedges, ctx.idToLabel);
    if (hyperLines.length > 0) {
      if (crossLines.length > 0) {
        body.push('');
      }
      const startLine = body.length + 1;
      body.push('## hyperedges', ...hyperLines);
      entries.push({ endLine: body.length, key: 'hyperedges', startLine });
    }
  ```

  The community loop already leaves a blank line after the last community, so `## cross` is separated; the explicit blank is only needed between `## cross` and `## hyperedges`.

- [ ] **Step 5: Run the tests and verify they PASS.**

  ```bash
  pnpm vitest run src/graphify/__tests__/graph-to-toon.test.ts
  ```

  Expected output: `Tests  13 passed (13)`.

- [ ] **Step 6: Commit.**

  ```bash
  cat > /tmp/msg-task4.txt <<'EOF'
  feat(graphify): address the cross and hyperedge blocks from the TOC

  Cross-community edges and hyperedges both span communities, so neither can use
  the community-local indices the node and edge rows use — both carry full labels.
  Both are `## ` headers and both are therefore listed in the TOC, under the same
  exists-only-when-emitted rule: a graph with one community, or one whose every
  cross edge is contains/imports_from, gets a TOC of community entries alone.

  Cross rows are ordered by relation code, then source label, then target label,
  all through the code-unit comparator — an ordering left to the input's edge
  order would reshuffle whenever graphify reordered its output.

  Noldor-FD: self-refreshing-compact-knowledge-graph
  EOF
  git add src/graphify/graph-to-toon.ts src/graphify/__tests__/graph-to-toon.test.ts
  git commit -F /tmp/msg-task4.txt
  ```

---

## Task 5: Determinism, and the real graph

**Files:**

- Modify: `src/graphify/__tests__/graph-to-toon.test.ts`

The two properties the whole feature rests on: the same graph renders to the same bytes twice, and renders to the same bytes under two locales. Without these, CI and the operator's machine fight each other on every regeneration.

- [ ] **Step 1: Write the determinism tests.**

  Append inside the existing `describe`:

  ```ts
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
  ```

- [ ] **Step 2: Prove the ordering test actually pins something.**

  Both tests pass immediately, because Task 2 already pinned the comparator — a boundary test that passes either way pins nothing, so make it fail on purpose. Temporarily change `byCodeUnit`'s body to `return a.localeCompare(b);`, then:

  ```bash
  LANG=cs_CZ.UTF-8 pnpm vitest run src/graphify/__tests__/graph-to-toon.test.ts
  ```

  Expected output: the ordering test red, reporting `  0 delta @` where `  0 Charlie @` was expected. Revert `byCodeUnit` and re-run:

  ```bash
  pnpm vitest run src/graphify/__tests__/graph-to-toon.test.ts
  ```

  Expected output: `Tests  15 passed (15)`.

- [ ] **Step 3: Run the whole suite and the type checker.**

  ```bash
  pnpm verify
  ```

  Expected output: lint, typecheck and the full vitest run all green, ending in the summary line with no failures.

- [ ] **Step 4: Render the real graph and measure the reduction.**

  ```bash
  pnpm toon
  wc -c graphify-out/graph.brainstorm.toon
  head -20 graphify-out/graph.brainstorm.toon
  ```

  Expected output: a byte count materially below the current 697 KB — the spec's target is roughly 270 KB — and a header whose first two lines are `# Domain Knowledge Graph (v3 — compact)` and `# version: 3`, followed by a `toc` block.

- [ ] **Step 5: Discard the regenerated graph.**

  ```bash
  git checkout -- graphify-out/
  git status --short graphify-out/
  ```

  Expected output: no lines. The first real regeneration is Part 3's workflow doing its job; landing a 4 MB diff inside this PR is the exact cost this feature exists to remove.

- [ ] **Step 6: Commit.**

  ```bash
  cat > /tmp/msg-task5.txt <<'EOF'
  test(graphify): pin the brainstorm renderer's determinism

  Two regression tests for the two properties the feature rests on: the same graph
  renders byte-identical output twice, and node ordering follows code units rather
  than the machine locale. The second is the one that matters once CI becomes a
  second producer — Czech collation sorts `ch` after `h`, so a cs_CZ laptop and an
  en_US runner would otherwise emit different indices for the same graph and churn
  against each other on every regeneration.

  graphify-out/ is deliberately not regenerated here. The first real regeneration
  is the workflow's job, which is the feature proving itself.

  Noldor-FD: self-refreshing-compact-knowledge-graph
  EOF
  git add src/graphify/__tests__/graph-to-toon.test.ts
  git commit -F /tmp/msg-task5.txt
  ```
