# Roadmap

Flat priority-ordered list (file order = priority). Every entry is a `### <Entry Name>` heading — **one fixed level, no grouping categories**. Writers (`/noldor-triage`, `/noldor-promote` residue, the dashboard add API) may never mint an `### <Category>` container with `#### <Entry>` children; a group heading carrying no entry is a `validate:triage` error (`empty-group-heading`).

Each entry carries a `- id: Q-NNNN` bullet — a stable ID minted at triage and never rewritten; it survives heading renames and roadmap ↔ backlog moves, so `blocked-by:` references target it, not the rename-fragile slug (the slug is a human-readable alias). See [triage.md → Stable entry IDs](noldor/triage.md#stable-entry-ids).

File order tracks the **`pnpm noldor triage score`** ranking, not the raw `impact:` label. `effort` divides in that formula, so a cheap low-impact entry can outrank an expensive high-impact one — `XS/low/med` scores 150 against `M/med/med`'s 75. The score guides the insert position rather than enforcing it (nothing in `validate:triage` checks order, and the operator may override), so read a file-order question against the score before calling it an inversion. Weights, formula and range are documented once in [triage.md → Scoring rubric](noldor/triage.md#scoring-rubric); the implementation is [`scoreEntry()`](../src/triage/score.ts).

An entry may declare dependencies with a `- blocked-by: <slug|Q-id, …>` bullet (comma-separated) — the entries this work waits on. It feeds dependency-weight scoring, and `validate:triage` flags refs that resolve to no known entry (`unknown-blocked-by-ref`; advisory, error under `--strict` or the refs-only `--strict-refs`) while `/noldor-garden` flags circular chains. Retired entries stay resolvable: promotion carries `- id:` into the FD's `entry-id:`, and the no-FD paths (fast-track, attach) forward it via `.noldor/retired-entry-ids.json`, maintained by `roadmap remove-block`. `- deps:` is the legacy alias, still accepted during the migration window and unioned with `blocked-by:`; prefer `blocked-by:` in new entries.

> **Routing policy — prep scales with `size:`. Don't spec the small ones.**
>
> - **XS / S** → no spec, no plan. `/noldor-gate` routes these to `fast-track` (code) or `micro-chore` (pure-doc) and retires the entry on ship — the drain-runner's bread and butter.
> - **M** → `specs-only` (spec, no plan).
> - **L / XL** → `full` (spec + plan), and only when there's real design risk — a mechanical L can still fast-track.
>
> Encoded once in [`sizeToPath()`](../src/core/size-routing.ts); `/noldor-gate` Step 0 surfaces the verdict as each entry's `suggestedPath`. Full matrix in [complexity-gating.md](noldor/complexity-gating.md).

### Drain Lock Atomic Publish and Safe Reclaim

- id: Q-0286
- area: tooling
- type: fix
- since: 2026-09-24
- size: S
- impact: med
- confidence: med

`acquireLock` in `src/autonomous/drain-lock.ts` has two races that can leave two supervisors draining one repo. Both are rare, because supervisors seldom start in the same instant, and the Q-0238 suite lock (`src/testing/suite-lock.ts`, PR #538) already solves both.

- **Payload window.** The lock is created with `openSync(path, 'wx')` and its `{ pid, startedAt }` payload is written in a second call. A second supervisor that reads the file between the two sees an empty payload, treats the holder as dead, renames the live lock aside and takes it — the reclaim path turns "unparseable" into "dead" with no age check. Fix: publish the lock with its content in one step (write a temp file, then `linkSync` it into place — `EEXIST` means held).
- **Stale-read reclaim.** The reclaim renames a dead holder's `.noldor/drain.lock` aside and unlinks it without reading what it moved, so a supervisor that judged an older holder dead can move and delete a lock another supervisor has just taken. The suite lock's `replaceDead` is the pattern: hard-link the dead lock to a claim named after its inode (one holder per inode), judge the holder again through the claim, confirm the lock is still that inode, then rename the new lock over it so the path is never free.

Deletion tests: several processes calling `acquireLock` at the same instant leave exactly one holder; and while a claim on the dead lock's inode is held, `acquireLock` leaves the lock alone. (found 2026-09-24 in the Q-0238 spec review and fixing PR #538's review blocker)

### Design Links Open From a Terminal

- id: Q-0288
- area: tooling
- type: fix
- since: 2026-09-24
- size: S
- impact: med
- confidence: med

Spec and plan links do not open when the operator runs Claude Code in iTerm2 rather than the VS Code extension. `pnpm noldor design open` prints a `link:` line built by `buildArtifactLink` (`src/design/open-artifact.ts`) as a markdown link to a workspace-relative path — which the VS Code extension resolves against the workspace folder, but a terminal has no workspace to resolve against, so the link is dead there. The harness is knowable: `CLAUDE_CODE_ENTRYPOINT` is `cli` in a terminal and `claude-vscode` under the extension (`checks pen-bridge` already reads it). Wanted: in a terminal harness, `design open` prints something the terminal can open — an absolute path or a `file://` URL (iTerm2 opens both on ⌘-click) — and keeps today's workspace-relative link under the extension. Deletion test: under `CLAUDE_CODE_ENTRYPOINT=cli`, the `link:` line names an absolute path that exists. (operator report, 2026-09-24)

### Upgrade Restarts the Dashboard

- id: Q-0289
- area: tooling
- type: feat
- since: 2026-09-24
- size: S
- impact: med
- confidence: med

After `noldor upgrade` (or `init --update`), a dashboard server that was already running keeps serving the old code from memory, so new features and fixes do not show until someone restarts it by hand. `watchInstall` (`src/dashboard/server.ts`, PR #476) only exits a zombie whose file routes have started to 500; an upgrade that leaves every file route valid is never noticed. Wanted: the update flow restarts the project's dashboard when one is running — or `watchInstall` treats a changed installed version as a reason to exit so the SessionStart hook brings up a fresh one. Deletion test: after an upgrade that changes a dashboard page, the next request to that page serves the new version without a manual restart. (operator request, 2026-09-24)

### Graph Freshness Reads Git, Not mtime

- id: Q-0290
- area: tooling
- type: fix
- since: 2026-09-24
- size: S
- impact: med
- confidence: med

The graph freshness gate can read a current graph as stale after an ordinary pull. `loadFreshGraphOrWarn` compares `graph.json`'s mtime with the newest mtime under the scan roots, and a pull that brings a code merge together with its `update-knowledge-graph.yml` refresh writes files in index order — `graphify-out/` sorts before `src/`, so `graph.json` lands a few milliseconds before the code. Measured on main on 2026-09-24 after pulling #539 + #540: `src/design/design-approval.ts` was 7 ms newer than `graph.json` (that graph really was one merge behind, but the write order alone gives the same reading when it is current). Every graph consumer (the co-tag detector, detectors 9 and 10, `propose-pointers`, `features seed-test-tags`) then degrades or refuses until a local regen. Since #501 regenerates the graph after every code merge, the fitting measure is git rather than the clock: stale when a scan-root file changed in a commit after `graph.json`'s last commit, or has uncommitted changes. Deletion test: after a pull that brings code and its graph refresh together, `pnpm noldor features seed-test-tags` runs without a local regen. (found 2026-09-24 shipping PR #542)

### Geometry-Compare Lane — the Automated Half

- id: Q-0180
- area: tooling
- type: feat
- since: 2026-08-25
- size: L
- impact: low
- confidence: high
- split-from: Q-0145
- parent: ui-design-review-lane
- blocked-by: Q-0145

The `geometry-compare` comparison engine shipped as two hand-runnable commands (`design geometry-validate`, `design geometry-diff`) — plain JSON in, per-family layout drift out, no pen and no browser required. Parked here is the automation around it: the `geometryCommand` recipe field with per-family tolerance and budget knobs, the scaffolded Playwright reference producer, the `geometry-extract` pencil-MCP child that reads a `FINAL:` page's resolved geometry, the `geometry-export` / `geometry-review` commands, and the lane itself with its orchestrate wiring and boot sequencing. Parked on evidence rather than doubt: neither existing UI-design review lane is enabled anywhere. This repo declares no `consumer.uiPaths` at all, and charuy declares `uiPaths` but no `uiSurfaces` and no `uiBoot`, with `crLanes.code` at `[reviewer]` — so `render-compare` (PR #366) has zero enabled installs, and `geometry-compare`'s prerequisites are strictly heavier (a boot recipe, a JSON-emitting capture script, playwright in the consumer). Unpark when a repo actually configures `uiBoot` and enables one of the two existing lanes; until then the parked half only automates a workflow the two shipped commands already perform by hand. The full spec is committed at `docs/design/specs/archive/2026-08-25-ui-design-review-lane-geometry-compare-design.md`, and the four remaining plan parts (config + capture template, the extraction child, the review function, the lane) live in git at commit `3ce77e3` — recover them with `git show 3ce77e3 -- docs/design/plans/` rather than re-planning. One contract detail to carry forward: `geometryDocSchema` requires a non-empty `text` on every `kind: 'text'` node — spec D4 and the shipped code agree on this — so the extraction child's prompt must emit it or every surface containing text lands `geometry-unparseable`. Deletion test: a consumer with a `uiBoot` recipe gets a code-stage lane that reds on real layout drift without a human running two commands. (carved 2026-08-25 after shipping parts 1-2)

- The operator restated the shape of the comparison on 2026-08-25: a SECOND verification mode alongside pixel comparison, not a replacement. Pen cannot reproduce some rendered effects (SVG filters among them), so pixel-perfect matching is the wrong instrument here and should stay reserved for cases where it holds; this lane's job is element alignment, font-size, and margins/paddings. The shipped `design geometry-validate` / `design geometry-diff` pair already reads that way — carry the framing into the lane's own prose and tolerance defaults when it unparks, so nobody re-derives it as pixel-diff with loose thresholds.

### Entrypoint-Guard Choke-Point Enforcement

- id: Q-0221
- area: tooling
- type: feat
- since: 2026-09-08
- size: M
- impact: med
- confidence: med
- split-from: Q-0126

Q-0126 swept all 42 direct-invocation guards under `src/` behind `isEntrypoint` in `src/core/cli-entry.ts`, but shipped **no enforcement**: nothing mechanical stops a new entrypoint from hand-rolling the comparison again, and when that comparison is wrong the module runs nothing and exits 0, so the failure is invisible. The class is known to regrow — over the three weeks Q-0126 sat filed, two sites migrated away from the broken template and two new ones arrived carrying it.

A blocking `src/invariants/entrypoint-guard-choke-point.ts` was built during Q-0126 and descoped after three code-review rounds failed to converge. Do not restart from scratch; the rounds are the spec. What was falsified, in order:

- **Keying on an equality operator near the mention.** Missed `import.meta.url.startsWith(...)` / `.endsWith(...)` — the most literal way to reintroduce the swept template, carrying no operator at all — missed a comparison whose operator opened the next line, and *rejected* the sanctioned `isEntrypoint(import.meta.url) && argv.length === 2`, where an unrelated equality merely shared the line.
- **Judging a window of lines.** Proximity cut both ways: one sanctioned call exempted every hand-rolled guard within two lines of it (including one pasted from the check's own violation message), while an innocent `const script = process.argv[1]` two lines from a `new URL(…, import.meta.url)` asset read was refused.
- **Per-line co-occurrence of `import.meta.url` and an indexed argv read.** Refused `isEntrypoint(import.meta.url, argv1)` — the helper's own documented two-argument form, i.e. the exact API the check exists to steer people toward — and refused ordinary one-line `/** … */` doc comments; widening the argv match from `argv[1]` to `argv[` also made `argv[0]`, the node executable, count as the entrypoint ingredient.
- **Whole-line comment blanking** is needed either way (the helper's TSDoc, the router's dispatch note and the plugin's own header all discuss both ingredients and otherwise self-report), but blanking any line *starting* with `/*` lets `/* note */ if (…) {}` through, and blanking only unclosed openers reports one-line doc comments. Stripping closed `/* … */` spans first, then applying a whole-line test, satisfies both.
- Comment **tails** must not be cut: truncating a line at `//` eats `'file://' + argv[1]`, the literal shape being hunted.

Two constraints on the shape of a fix. A text scan is what the earlier attempts kept failing at, and TypeScript 7 dropped the in-process compiler API (see `src/invariants/public-api-tsdoc.ts`), so an AST route means the `unstable/*` API-server surface or `@swc/core` — worth pricing before choosing. Second, whatever lands must satisfy the *diff-scoped* clone gate rather than the ratchet: modelling a new plugin on `slug-path-choke-point.ts` reproduced 135 shared tokens, and `abstraction-cost`'s prescribed remedy ("decline the wrapper and rebaseline") has no answer there, because no baseline silences a diff-scoped red. Extracting a shared `defineSourceScanInvariant` did clear it, at +1 indirection for −270 duplicated tokens — that extraction is also reverted here and is the obvious first move.

Two sanctioned spellings, not one. Besides `isEntrypoint(import.meta.url)`, 22 modules reach `invokedDirectly(stem)` — 21 through `runIfDirect(stem, label, main)`, one directly (`src/checks/check-invariants.ts`) — and that predicate matches on basename. Q-0126 left them deliberately: re-signing `runIfDirect` to take `import.meta.url` is a change at every one of those sites and a different feature, and no stem among them collides with a second same-named file under `src/`, so nothing is broken today. Enforcement has to allow both spellings, or that re-signing becomes its prerequisite.

Deletion test: a file added under `src/` that derives direct invocation from `import.meta.url` without going through `isEntrypoint` makes `pnpm noldor checks invariants` exit non-zero and name the file and line, while every guard and non-guard shape listed above is classified correctly in both directions.

(descoped from Q-0126 on 2026-09-08 after three red code-stage rounds; the 14 findings above are the input)

### Fast-Track Changes Can Obsolete an Unattached FD

- id: Q-0233
- area: tooling
- type: feat
- since: 2026-09-08
- size: M
- impact: med
- confidence: low

A fast-track ships without attaching to any feature MD, so when one or more fast-tracks change the business logic, files, or behaviour an FD documents, that FD silently goes stale — the doc-tracked invariant holds only for paths that scaffold an artifact. Worth exploring whether fast-track should optionally attach to an FD the way the attach paths do (carrying the parent slug, refreshing the FD's Usage on ship), or whether a detector should flag an FD whose `links.code` paths moved under a fast-track commit it never records. The first is a gate change, the second a garden detector; they are not exclusive. (surfaced 2026-09-08)

### Extract the Shared tsconfig Reader

- id: Q-0234
- area: tooling
- type: refactor
- since: 2026-09-08
- size: M
- impact: low
- confidence: med

Extract the shared tsconfig reader into a neutral module. `src/invariants/toolchain-floor.ts` and `src/indirection/detect.ts` each carry their own tsconfig discovery — `findPackageManifests`/`isTsconfigName` on one side, `findTsconfigFiles`/`readTsconfig`/`resolveExtends` on the other — and `detect.ts` already imports `stripJsonc` from `toolchain-floor.ts`, so importing discovery back would close a module cycle. PR #436 duplicated it deliberately and promised this entry in the spec's Risks section. The two walks are not a clean lift (async `readdir` + `WORKSPACE_SCAN_DEPTH` here, sync `readdirSync` + configured scan roots there), so the shared helper has to be designed rather than moved, and it touches the indirection ratchet. `clones check` was green on #436, so this is cohesion debt rather than a live gate failure. Deletion test: both modules import their tsconfig discovery from one place, and neither declares a private copy. (surfaced 2026-09-05, spec CR on nested-tsconfig-lib-floor)

### UI Baseline Validity, Not Just Recency

- id: Q-0247
- area: tooling
- type: fix
- since: 2026-09-16
- size: M
- impact: med
- confidence: med
- blocked-by: Q-0184

`ui-design-freshness` only asks whether the baseline is RECENT, so a `.pen` that is fresh, invalid and half-covered passes. It compares commit shas. charuy's `app.pen` read `fresh` for a month while all four of these were true: its `variables` block was **empty** (`tokensFromCss` matched nothing once the theme axis moved every `--color-*` behind a `var()`), so the canvas emitted `$viewport-bg` and rendered as `pen-render`'s `#FF00FF` miss marker — a 0.8971 diff against a 0.10 ceiling, i.e. no baseline had actually been written since 2026-09-03; it declared `version: "2.13"` against an installed schema of **2.17**; it carried a page for a surface deleted two PRs earlier, whose driver timed out and failed the whole run; and it covered only the dark theme, though light is a shipped, contrast-tested axis. The capture's own fidelity gate cannot catch any of it, by construction: it re-renders the emitted document through `pen-render` — a browser, same fonts the extractor measured — so it agrees with itself, scoring 0.008 on pages Pencil drew with text stacked on top of itself. The schema pass that would have caught the version drift never ran either, because the harness looked only in `/Applications/Pencil.app` while the pen.dev VS Code extension ships the same schema as plain files, so every run printed `schema: skipped` and nobody noticed. Wanted: freshness as one of three checks rather than the only one — (a) the committed `.pen` parses and validates against the INSTALLED pen schema, (b) a declared coverage set is present as pages, so a surface can say "these states, in these modes" and be held to it, (c) the sha comparison it already does. A stale baseline is obvious to its owner; a fresh, invalid, dark-only one is not. Deletion test: a baseline whose variables block is empty, or which carries only one of the modes its surface declares, is reported by `checks ui-design-freshness` rather than passing it. (found 2026-09-16 regenerating charuy's UI baseline)

- The same coverage hole bites a *feature's* `.pen`, not only a baseline, and the one page-level rule is a count the agent executes by hand. The enforced set is existence (`no-design-artifact`, `ambiguous-design`), ratification (`design-unapproved`) and freshness (`pen-modified`); `noldor-spec` step 1.5(b) adds "exactly one `FINAL:` page per surface", which is prose and counts pages rather than asking what is in them. Shipping Q-0275 the first design drew only the happy path — rest, keyboard focus, empty scene, engine error, in-flight and the folded-bar layout were all missing until the operator asked where the interactions were, and three of those states are pinned by acceptance criteria. This sharpens wanted-item (b) above: the declared coverage set should be **derived from the spec's acceptance criteria**, not hand-written, and the verdict step should check against that list rather than a page count. `render-export-dispatch` / `render-compare` already export `.pen` pages to images, so a model-driven check can read them even where a static one cannot. (found 2026-09-22 shipping Q-0275)

### Milestone Membership Has No Tagger and No Counter

- id: Q-0255
- area: tooling
- type: feat
- since: 2026-09-22
- size: M
- impact: med
- confidence: med

Milestone membership rots by omission at both ends of the chain, so an active milestone cannot answer how far through it is. **Entry side:** `validate:triage` catches a *typo'd* milestone slug well — an injected bad slug produced 11 `unknown-milestone-ref` errors, and `lefthook/noldor.yml` runs the check on every roadmap/backlog commit — but nothing notices an entry carrying **no** `milestone:` at all. In a consumer mid-milestone, 50 of 54 roadmap entries had none, so `milestones show <active>` listed 4 queued items. The only related command, `features attach-milestone`, is a *verdict* (entry vs parent FD) rather than a tagger, so the fix today is hand-editing N blocks. **Feature side:** `Features (n/n done)` is structurally always `0/0`, because nothing writes a milestone onto a feature MD — `milestones show` renders the section and the schema supports it, but no command sets the field and `/noldor-milestone` only manages the milestone *files*. Candidates: a `milestones assign <slug> <entry…>` for the entry side; have the gate stamp the milestone onto the FD at attach time for the feature side (`attach-milestone` already computes the verdict, so it knows the value) and let `phase-flip-done` move the counter; and surface an unassigned-entry count from `milestones show` or the sdd-report so the gap is visible without a bespoke script. Deletion test: `milestones show <active>` reports a non-zero feature count and names how many queued entries carry no milestone. (found 2026-09-22)

### partially-blocked-by for Partial Dependencies

- id: Q-0256
- area: tooling
- type: feat
- since: 2026-09-22
- size: M
- impact: med
- confidence: med

`blocked-by` is all-or-nothing, so a partial dependency degrades into prose the scorer cannot see. Several entries in a real consumer can start, and two-thirds ship, while one part waits — a bar whose five sections are independently blocked; a panel where one row needs a concept that does not exist yet. Marking the whole entry `blocked-by` divides its score by `1 + unshipped_dep_count` for work that is mostly doable today; leaving it off loses the dependency from the graph entirely, so `/noldor-garden` cannot see it and a reader has to find it in a paragraph. Wanted: a `partially-blocked-by:` that joins the blocked-by graph for cycle detection and `show` output but is **excluded from the dependency factor** in `scoreEntry()` — the semantics being "cannot finish" rather than "cannot start". Open question for the spec: whether `/noldor-gate` should surface the partial blocker at pickup so the agent knows which slice to leave alone, or whether that belongs in the entry body. Deletion test: an entry with only `partially-blocked-by` refs scores as unblocked while still appearing in the dependency graph. (found 2026-09-22)

### Suite Lock Follow-Ups

- id: Q-0291
- area: testing
- type: fix
- since: 2026-09-24
- size: S
- impact: low
- confidence: med

Suite lock follow-ups from PR #538's review, all `low`: (a) `vitest run -t <name>` queues behind another worktree's full suite for up to 15 minutes, though a `-t` run is the dev loop the skip rule exists for — `suiteLockSkipReason` reads only vitest's `filenamePattern`, and `-t` sets `testNamePattern` (the reviewer says `--changed` and `--shard` runs queue too). (b) The real-vitest-CLI test in `src/testing/__tests__/suite-lock.test.ts` starts two nested vitest CLIs with a 9s exec timeout under the default 10s `testTimeout`, one of the heaviest tests in the suite it protects. (c) A stranded reclaim claim (the `noldor:cut` in `replaceDead`) makes later runs wait 15 minutes without a word and then print `still held by pid unknown`; naming the dead holder or the claim file would say what is stuck. Deletion test for (a): `vitest run -t probe` on the test's fixture project never sees the lock. (found 2026-09-24, PR #538 review)

### UI Baseline .pen Layout and Id Contract

- id: Q-0292
- area: tooling
- type: feat
- since: 2026-09-24
- size: M
- impact: med
- confidence: med
- parent: pendev-ui-design-phase

A UI baseline `.pen` has no layout or id contract, so every consumer invents one, and charuy's first attempt was unusable. `design capture` only runs the consumer's `uiCapture` command and vouches for the blob (`src/design/ui-capture.ts`); nothing says how the pages inside are arranged or named. Charuy's `app.pen` was two unordered rows (full pages / overlays) with counter ids (`n1`, `n2`…) that all shifted when one control was added, so no review, spec or agent could reference an id. Charuy's local fix (2026-09-23, branch `fast/baseline-structure`): one labelled row per area, dark page beside its light twin, page id `<state>-<theme>`, element id = parent id + `.<segment>` where the segment is `data-testid`, else icon, `aria-label`, slot, role, layer name, with `-2`/`-3` only on a repeated sibling. Constraints that must hold for any consumer: pages stay TOP-LEVEL frames (the ui-review / render-compare lanes enumerate only top-level `FINAL:<surface>:` frames, so a row frame would hide them — labels go in as sibling text nodes), and ids never contain `/` (the Pencil schema's `entity.id` pattern is `^[^/]+$`; `/` is its descendant-path separator). Wanted: the convention written down as noldor's baseline contract (area rows, twin order, id grammar), plus a check `design capture` runs on the written file — ids unique, no `^n\d+$`-style positional ids, no `/`, every `FINAL:` page top-level, every page in exactly one labelled row. Deletion test: a baseline with a counter id or a nested `FINAL:` page fails `design capture` naming the node. (found 2026-09-23 recapturing charuy's app baseline)

- Operator ask, 2026-09-24: the baseline `.pen` — and other `.pen` files too — should carry huge section titles, so each app area is readable on the canvas without zooming in. The row labels above are where they go; the contract should fix their size, not just their presence.

### One Graph Builder for the Sweep and CI

- id: Q-0293
- area: tooling
- type: refactor
- since: 2026-09-24
- size: M
- impact: med
- confidence: low
- parent: self-refreshing-compact-knowledge-graph

The release sweep and the `update-knowledge-graph` workflow build the committed graph two different ways, so they fight over community ids. Both extract the same nodes and edges (0 diffs, rebuilt from 140ff63), but the sweep's `/graphify --ast-only` clusters with no fixed hash seed and names communities with an LLM, while the workflow pins `PYTHONHASHSEED=0`, sorts its input and writes `Community N`. Two unseeded runs on one tree gave 205 and then 204 communities. So the first graph PR after every release reshuffles every community id and relabels the report. Wanted: one builder both call — a `pnpm noldor graphify build` running the workflow's heredoc (clean AST pass over code files, seeded, sorted, `parallel=False`) — with release-sweep steps 1 and 5 switched to it. Deletion test: the sweep's graph step, run right after a graph PR merges, leaves `graphify-out/` byte-identical. (found 2026-09-23 shipping Q-0260 part 3, PR #501)

- A shared recipe alone will not make the sweep byte-identical to CI. The v1.13.0 sweep ran the workflow's exact recipe on the operator Mac (`PYTHONHASHSEED=0`, sorted input, `parallel=False`, graphifyy 0.7.8 on both sides) and rebuilt 48415a0 with the same 3885 nodes and 10328 edges as CI, but found 222 communities where CI found 215. The rest of the dependency set (networkx, the Leiden backend, the Python patch version) has to match too — so either the builder pins those, or the sweep keeps CI's committed graph whenever the extraction matches (the current workaround, in `docs/noldor/graph-integration.md` → Pre-release sweep). (2026-09-24, PR #537)
