---
name: noldor-refactor
description: Guides structured refactoring of the codebase with full traceability. Produces a report showing changed files, diffs, rationale, test/typecheck results, import impact, breaking changes, dead code, and complexity delta. Use when user says "refactor", "clean up", "restructure", "simplify module", "extract function", "rename across codebase", "reduce complexity", "split this file", or invokes /noldor-refactor. Also use when the user identifies code smells, asks to improve code organization, or wants to consolidate duplicate logic — even if they don't say "refactor" explicitly.
---

# Refactor

Structured refactoring workflow for the consumer codebase. Every refactoring produces a traceable report so the user sees exactly what changed, why, and whether anything broke.

## Why this workflow exists

Refactoring without structure leads to silent breakage — a renamed export breaks a downstream consumer, a moved function orphans its tests, a "cleanup" introduces a type error that only surfaces in CI. This workflow forces verification at each stage so problems surface immediately, not three commits later.

## Before you start

1. **Read the knowledge graph** — `graphify-out/GRAPH_REPORT.md` and `graphify-out/graph.json`. Understand community structure, god nodes, cross-package bridges. Refactoring a god node (like `evaluateNode()` with 8 edges) has much higher blast radius than refactoring a leaf function.

2. **Read CLAUDE.md** — the project rules are the source of truth for naming, imports, error handling, and testing conventions. The refactoring must conform to these rules, not drift from them.

3. **Climb the lazy decision ladder + scan for cut markers** — the `lazy-decision-ladder` rule (`.noldor/rules/lazy-decision-ladder.md`, enforce bucket for `**/*.ts` at stage `code`) applies to refactors too. Before restructuring anything, climb and stop at the first rung that holds: does this refactor need to exist at all (YAGNI — is the "smell" actually costing anything)? Does an existing helper already do what the extraction would create (reuse, don't rewrite)? Then `grep -rn "noldor:cut" <target files>` — each `// noldor:cut <ceiling> — <upgrade path>` marks a *deliberate, bounded* corner-cut carrying its own ceiling and upgrade path. Record every marker hit; Phase 2 disposes of them.

4. **Capture the baseline** — run typecheck and tests BEFORE any changes. `typecheck` and `test` name your repo's own `package.json` scripts, not framework commands — substitute whatever yours are called.

   <!-- noldor-skill-drift-ignore -->

   ```bash
   pnpm typecheck 2>&1 | tail -5
   pnpm test 2>&1 | tail -20
   ```

   Record pass/fail counts and any pre-existing failures. This is your "before" snapshot.

5. **Save graph baseline** — build the graph of HEAD, then snapshot it for post-refactor comparison. Build first: the committed `graphify-out/` can lag HEAD, and Phase 6 compares against a fresh build, so a stale baseline would credit the refactor with every change since the last graph refresh.
   ```bash
   pnpm noldor graphify build
   cp graphify-out/graph.json graphify-out/.graphify_pre_refactor.json
   ```
   Also note from `GRAPH_REPORT.md`: god node edge counts, community cohesion scores for affected communities, and any cross-package bridges touching the refactoring target.

## Refactoring phases

### Phase 1: Analyze

Read every file involved in the refactoring target. Understand:

- What does this code do? What's its public API?
- Who imports it? (Use `Grep` to find all import sites)
- What tests cover it? (Check `__tests__/` directories)
- Is it a god node or cross-package bridge from the knowledge graph?

Build a mental dependency map. If the refactoring touches exports consumed by other packages, flag this as high-risk.

### Phase 2: Plan

Before touching code, state:

- **What** you're refactoring (specific files, functions, types)
- **Why** (the code smell, duplication, complexity, naming issue)
- **Strategy** (extract, inline, rename, split, consolidate, move)
- **Ladder verdict** (which ladder rung the strategy stops at, and why no earlier rung held — "extract new helper" loses to "reuse existing helper" whenever one exists)
- **Cut-marker disposition** (for every `noldor:cut` hit from the pre-start scan): ceiling still holds → **leave it alone**, it is a decision, not a smell — out of scope for this refactor; ceiling broken (the bound was exceeded or the requirement changed) → execute the marker's stated upgrade path as part of this refactor and delete the marker — that is exactly what the marker was written for; ceiling wrong (was never right) → flag to the user before touching it
- **Risk assessment** (low/medium/high based on consumer count and cross-package impact)

If high-risk, present the plan to the user and wait for confirmation before proceeding.

### Phase 3: Execute

Apply changes. Follow CLAUDE.md conventions strictly:

- `camelCase` functions, `PascalCase` types, `UPPER_SNAKE` constants
- Import order: builtins → external → workspace → relative → type-only
- No `any`, no `// @ts-ignore` without explanation
- TSDoc on every exported symbol
- `.js` extensions in ESM imports

Make changes in a logical order:

1. Internal implementation changes first
2. Type/interface changes
3. Export changes
4. Consumer updates (files that import the changed code)
5. Test updates

### Phase 4: Verify

Run typecheck and tests AFTER changes — the same repo scripts as the baseline step:

<!-- noldor-skill-drift-ignore -->

```bash
pnpm typecheck 2>&1 | tail -5
pnpm test 2>&1 | tail -20
```

Compare against baseline. If new failures appear, fix them before proceeding.

### Phase 5: Report

This is the critical output. Generate the full refactoring report in the format below. Do NOT skip sections — every section provides signal that helps the user decide whether to keep or revert.

---

## Report format

After completing the refactoring, output the report using this exact structure:

````
## Refactoring Report

### Summary
[One-paragraph description of what was refactored and the primary motivation]

### Changed Files

| File | Change Type | Lines ±  |
|------|------------|----------|
| `path/to/file.ts` | modified | +12 / -8 |
| `path/to/new.ts` | added | +45 |
| `path/to/old.ts` | deleted | -30 |

### Diffs

For each changed file, show the diff:

#### `path/to/file.ts`
```diff
[git-style diff or before/after blocks]
````

**Rationale:** [Why this specific file changed. Not "cleanup" — be specific.
Example: "Extracted `calculateBounds()` from 40-line inline block to named function.
Reduces cognitive load in `evaluateNode()` and enables direct unit testing."]

[Repeat for each file]

### Verification

| Check            | Before     | After      | Status |
| ---------------- | ---------- | ---------- | ------ |
| TypeScript       | ✓ pass     | ✓ pass     | OK     |
| Tests (format)   | 24/24 pass | 24/24 pass | OK     |
| Tests (engine)   | 18/18 pass | 18/18 pass | OK     |
| Tests (viewport) | 5/5 pass   | 5/5 pass   | OK     |

### Import Impact

Which files consume the changed exports:

| Changed Export | Consumers               | Update Required    |
| -------------- | ----------------------- | ------------------ |
| `functionName` | `engine.ts`, `index.ts` | Yes — updated      |
| `TypeName`     | none                    | No (internal only) |

### Breaking Changes

[List any renamed exports, changed function signatures, removed public API.
If none: "No breaking changes. All public API preserved."]

### Dead Code

[List any functions, types, or constants orphaned by this refactoring.
If none: "No dead code introduced."]

### Complexity Delta

| Metric              | Before   | After    | Delta                 |
| ------------------- | -------- | -------- | --------------------- |
| Total lines         | 142      | 118      | -24                   |
| Functions           | 3        | 5        | +2 (smaller, focused) |
| Max function length | 45 lines | 18 lines | -27                   |
| Exported symbols    | 2        | 3        | +1                    |

### Suggested Commit

```
refactor(package): short description

Longer explanation of what changed and why.

Co-Authored-By: Claude <noreply@anthropic.com>
```

````

### Phase 6: Graph Impact Analysis

After the refactoring is verified and the report generated, regenerate the knowledge graph and evaluate structural impact. This closes the loop — you see not just "did tests pass" but "did the architecture actually improve."

#### Step 1 — Commit, then rebuild the graph

Commit the refactor first. `pnpm noldor graphify build` reads HEAD's tree, never the working tree, so an uncommitted refactor is invisible to it — the build would describe the code before the change. Then:

```bash
pnpm noldor graphify build
```

It rebuilds AST extraction (picks up renamed/moved/split functions), re-clusters, and writes a fresh `graphify-out/` — `graph.json` and `GRAPH_REPORT.md` included — with the same pinned packages the committed graph is built with, so before and after differ only by the refactor.

#### Step 2 — Compare before vs after

Load the pre-refactor snapshot and the new graph. Both are node-link JSON, so plain Node reads them — no Python needed:

```bash
node -e "
const fs = require('fs');
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const old = load('graphify-out/.graphify_pre_refactor.json');
const cur = load('graphify-out/graph.json');

console.log('Nodes:', old.nodes.length, '->', cur.nodes.length);
console.log('Edges:', old.links.length, '->', cur.links.length);

// God nodes: top 5 by degree (undirected, so an edge counts at both ends).
const top = (g) => {
  const deg = new Map();
  for (const l of g.links) for (const n of [l.source, l.target]) deg.set(n, (deg.get(n) ?? 0) + 1);
  const label = new Map(g.nodes.map((n) => [n.id, n.label ?? n.id]));
  return [...deg].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, d]) => [label.get(n) ?? n, d]);
};
console.log('Top 5 god nodes (before):', top(old));
console.log('Top 5 god nodes (after):', top(cur));
"
```

Clean up: `rm -f graphify-out/.graphify_pre_refactor.json`. The rebuilt `graphify-out/` is the graph of the refactor commit — commit it with the refactor, or `git restore graphify-out` when the repo refreshes its graph some other way.

#### Step 3 — Evaluate and report

Append a **Graph Impact** section to the refactoring report. Answer these questions:

| Question                          | Good outcome                                        | Bad outcome                                             |
| --------------------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| Did god node edge count decrease? | Target node lost edges (responsibility distributed) | Target node gained edges (more coupled)                 |
| Did community cohesion improve?   | Affected community cohesion score went up           | Cohesion dropped (nodes less related to each other)     |
| Did community count change?       | Split a low-cohesion community into focused ones    | Fragmented a cohesive community unnecessarily           |
| Any new cross-package bridges?    | Expected bridges from intentional shared utilities  | Surprise coupling introduced between unrelated packages |
| Any new surprising connections?   | None, or expected ones from the refactoring         | Unexpected transitive dependency chains                 |

Format for the report:

```
### Graph Impact

| Metric | Before | After | Verdict |
|--------|--------|-------|---------|
| God node: `evaluateNode()` edges | 8 | 5 | ✓ Reduced coupling |
| Community "Engine Core" cohesion | 0.14 | 0.22 | ✓ More focused |
| Total communities | 83 | 85 | Neutral — split was intentional |
| Cross-package bridges | 3 | 3 | No new coupling |

**Structural verdict:** [One sentence — did the architecture measurably improve, stay neutral, or get worse?]
```

If the graph shows the refactoring made things worse (higher god node degree, lower cohesion, surprise bridges), flag it explicitly. The refactoring may still be correct — but the user should know the structural cost.

#### When to skip Phase 6

- **Rename-only refactors** (no structural change): skip — the graph shape won't change meaningfully.
- **TSDoc/comment-only changes**: skip — AST extraction ignores comments.
- **If `pnpm noldor graphify build` reports `noldor: exit code 2`** (no usable Python environment): skip with a note naming the fix it printed — install the Python version it names, or point `NOLDOR_GRAPHIFY_PYTHON` at one.

For all other refactors (extract, split, move, consolidate, decompose), Phase 6 is mandatory.

## Edge cases

- **Cross-package refactoring** (format → engine): Change format first, update engine consumers, run both test suites. Report both packages in the verification table.
- **Rename across codebase**: Use `Grep` to find ALL occurrences before renaming. Include test files, comments, and TSDoc references. Miss one and the report will show a failing typecheck — which is the point.
- **Splitting a file**: Create the new file, move code, update all import sites, verify no circular dependencies introduced. Report the new file as "added" and old file as "modified" in the changed files table.
- **Test-only refactoring**: Still run the full verification. Even test refactors can accidentally change assertions.

## What NOT to do

- Don't refactor and add features in the same pass. Refactoring should be behavior-preserving.
- Don't skip the verification phase even if "it's just a rename."
- Don't suppress type errors with `any` or `@ts-ignore` to make the report look clean.
- Don't refactor test files to match new code patterns unless the tests actually broke — test churn with zero signal is noise.
- Don't clean up code that wasn't part of the refactoring target. Scope creep makes the diff harder to review.
- Don't "fix" a `noldor:cut` marked cut whose ceiling still holds — the marker records a deliberate decision with a bounded scope; treating it as a smell re-litigates a settled trade-off. Only a broken or wrong ceiling justifies touching it (see Phase 2 disposition).
- When the refactor itself deliberately stops short — a bounded simplification you'd otherwise be tempted to gold-plate — mark it: `// noldor:cut <ceiling> — <upgrade path>`. CR reviewer prompts respect the marker; an unmarked real cut is what gets flagged.
