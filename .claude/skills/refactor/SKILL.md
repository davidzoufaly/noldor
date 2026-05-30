---
name: refactor
description: Guides structured refactoring of the Charuy codebase with full traceability. Produces a report showing changed files, diffs, rationale, test/typecheck results, import impact, breaking changes, dead code, and complexity delta. Use when user says "refactor", "clean up", "restructure", "simplify module", "extract function", "rename across codebase", "reduce complexity", "split this file", or invokes /refactor. Also use when the user identifies code smells, asks to improve code organization, or wants to consolidate duplicate logic — even if they don't say "refactor" explicitly.
---

# Refactor

Structured refactoring workflow for the Charuy monorepo. Every refactoring produces a traceable report so the user sees exactly what changed, why, and whether anything broke.

## Why this workflow exists

Refactoring without structure leads to silent breakage — a renamed export breaks a downstream consumer, a moved function orphans its tests, a "cleanup" introduces a type error that only surfaces in CI. This workflow forces verification at each stage so problems surface immediately, not three commits later.

## Before you start

1. **Read the knowledge graph** — `graphify-out/GRAPH_REPORT.md` and `graphify-out/graph.json`. Understand community structure, god nodes, cross-package bridges. Refactoring a god node (like `evaluateNode()` with 8 edges) has much higher blast radius than refactoring a leaf function.

2. **Read CLAUDE.md** — the project rules are the source of truth for naming, imports, error handling, and testing conventions. The refactoring must conform to these rules, not drift from them.

3. **Capture the baseline** — run typecheck and tests BEFORE any changes:

   ```bash
   cd /Users/davidzoufaly/code/3d && pnpm typecheck 2>&1 | tail -5
   cd /Users/davidzoufaly/code/3d && pnpm test 2>&1 | tail -20
   ```

   Record pass/fail counts and any pre-existing failures. This is your "before" snapshot.

4. **Save graph baseline** — snapshot current graph metrics for post-refactor comparison:
   ```bash
   cd /Users/davidzoufaly/code/3d && cp graphify-out/graph.json graphify-out/.graphify_pre_refactor.json
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

Run typecheck and tests AFTER changes:

```bash
cd /Users/davidzoufaly/code/3d && pnpm typecheck 2>&1 | tail -5
cd /Users/davidzoufaly/code/3d && pnpm test 2>&1 | tail -20
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

#### Step 1 — Regenerate the graph

Run `/graphify` on the project root. This rebuilds AST extraction (picks up renamed/moved/split functions), re-clusters, and produces a fresh `GRAPH_REPORT.md`.

#### Step 2 — Compare before vs after

Load the pre-refactor snapshot and the new graph. Evaluate these metrics:

```bash
cd /Users/davidzoufaly/code/3d && $(cat graphify-out/.graphify_python) -c "
import json
from pathlib import Path
from networkx.readwrite import json_graph

old = json.loads(Path('graphify-out/.graphify_pre_refactor.json').read_text())
new = json.loads(Path('graphify-out/graph.json').read_text())

G_old = json_graph.node_link_graph(old, edges='links')
G_new = json_graph.node_link_graph(new, edges='links')

print(f'Nodes: {G_old.number_of_nodes()} -> {G_new.number_of_nodes()}')
print(f'Edges: {G_old.number_of_edges()} -> {G_new.number_of_edges()}')

# God node comparison
from collections import Counter
old_deg = Counter({n: G_old.degree(n) for n in G_old.nodes()})
new_deg = Counter({n: G_new.degree(n) for n in G_new.nodes()})
top_old = sorted(old_deg.items(), key=lambda x: -x[1])[:5]
top_new = sorted(new_deg.items(), key=lambda x: -x[1])[:5]
print('Top 5 god nodes (before):', [(G_old.nodes[n].get('label',n), d) for n,d in top_old])
print('Top 5 god nodes (after):', [(G_new.nodes[n].get('label',n), d) for n,d in top_new])
"
````

Clean up: `rm -f graphify-out/.graphify_pre_refactor.json`

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
- **If `/graphify` is not installed**: skip with a note recommending install for future refactors.

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
