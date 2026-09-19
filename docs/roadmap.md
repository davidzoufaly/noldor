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

### Shipped-Skill Commands Must Run in a Consumer

- id: Q-0239
- area: tooling
- type: fix
- since: 2026-09-16
- size: S
- impact: med
- confidence: high

Nothing stops a shipped skill from growing a command block that only runs inside the noldor repo. The `noldor-release-sweep` skill had four — a session-marker write that imported `./src/core/session.ts` by relative path, two `pnpm toon` blocks naming a script the consumer does not define, and the same for the clear at step 10 — and they were only caught by an operator hitting them while releasing charuy v0.7.0. The prose half is fixed: every block in that skill is now written against `pnpm noldor …`, and the two remaining repo-script forms (`pnpm verify`, `pnpm release`) are marked in a "Commands in this skill" section. What is still missing is the guard. Wanted: a check that reads the fenced command blocks out of `.claude/skills/**` and fails on a `pnpm <script>` form that is neither a framework CLI command nor marked `<!-- noldor-skill-drift-ignore -->`. `src/cli/validate-script-catalog.ts` and `src/cli/command-registry.ts` already carry the catalog machinery, and `src/docs/readme-content.ts` already does the same scan for README (Q-0148), so this is a third consumer of existing parts rather than new infrastructure. Deletion test: adding a `pnpm <made-up-script>` block to any shipped skill fails a check, not a consumer's release. (found 2026-09-15 releasing charuy v0.7.0; prose half shipped 2026-09-18)

### mtime Graph-Freshness Is Poisoned by Test Artifacts

- id: Q-0240
- area: tooling
- type: fix
- since: 2026-09-16
- size: S
- impact: high
- confidence: high

Running the test suite silently changes `docs/sdd-report.md`, so a release that runs e2e poisons its own next attempt. The report's `probable owner:` hints come from `requireFreshGraph` → `loadFreshGraphOrWarn`, which judges freshness by **mtime**: `newestMtimeInRoots(cwd, srcRoots) > statSync(graphPath).mtimeMs`, over `consumer.scanPaths` (`apps`, `packages`, `scripts`). Playwright writes its artifacts to `apps/web/test-results/` — inside a scanned root — so one `pnpm test:e2e` leaves ~112 files newer than `graphify-out/graph.json`, the detector drops into degraded mode, every hint vanishes, and the regenerated report no longer matches the committed copy. Charuy hit the full loop: release attempt 2 aborted on e2e, and attempt 3 then aborted on `sdd-report` with nobody having touched a file — attempt 2's own e2e run had staled the graph. `git status` is clean throughout, because the directory is gitignored, so the operator is told a committed doc is wrong with no diff to explain it. The workaround was `touch graphify-out/graph.json`. Wanted: judge freshness by the same git-commit comparison `evaluateGraphFreshness` already uses, or at minimum exclude gitignored paths from `newestMtimeInRoots` — a freshness check that a test run can invalidate is measuring the wrong thing. Deletion test: running the full suite twice in a row leaves `docs/sdd-report.md` byte-identical. (found 2026-09-15 releasing charuy v0.7.0)

### Full-Suite Flake: route-sweep and sdd-report Still Unexplained

- id: Q-0238
- area: testing
- type: fix
- since: 2026-09-15
- size: M
- impact: med
- confidence: low
- split-from: Q-0171

Q-0171 removed one sufficient cause of the shifting full-suite failures — unbounded `gh`/`npm` I/O in `preflight.test.ts` — but explains neither of the other two observed red files, and it is honest about that rather than claiming the flake fixed. `src/dashboard/__tests__/route-sweep.test.ts` (8 of the 10 reds on 2026-08-20) performs no external I/O at all: it binds an ephemeral port and renders live-repo pages in-process at 949–1472 ms per route against a 10s bound, so nothing in Q-0171 makes it faster or more deterministic. `src/garden/__tests__/sdd-report.test.ts` shells `tsx src/garden/sdd-report.ts` against the live repo four times (`cwd: process.cwd()`, plus a `pnpm fmt:check`), 17.4s for the file. Both sit in the measured slow tail under a 10s per-test bound, which is the surviving hypothesis, but neither has been reproduced on demand — two full-suite runs on 2026-09-15, one under six busy-loop CPU hogs, were green. Wanted first: a way to reproduce, or per-file evidence of what a red run actually reported (timeout vs assertion). Only then a remedy. Deletion test: a documented reproduction, or a retired hypothesis. (found 2026-09-15 shipping Q-0171)

### Co-Tag Detector: Degraded-Mode Honesty + Mechanical Seeding

- id: Q-0172
- area: tooling
- type: fix
- since: 2026-08-23
- size: M
- impact: high
- confidence: med
- parent: sdd-co-tag-detector

The co-tag detector's degraded mode hides the real number. With a 3-day-stale `graphify-out/graph.json` it emitted ONE row ("ran in degraded mode … perform a manual co-tag audit"); the moment the release sweep regenerated the graph the same detector emitted **139** concrete rows naming test files whose `// @tests:` tag omits an FD that owns a file they import. So a stale graph does not merely weaken the signal, it collapses a 139-row backlog into a single advisory line that reads like one small chore — and the graph goes stale on its own between sweeps. Two things wanted: make the degraded row state the count it *cannot* compute (or refuse to substitute for the real scan), and give `@tests:` co-tags the mechanical seeding that `features migrate-code-tags` gives `@fd:` tags, because the prescribed remedy today is a by-hand audit of 139 files and nothing will ever do it. Note the coupling: every file added to an FD's `links.code` creates co-tag obligations for every test importing that file, so closing links.code gaps *manufactures* co-tag gaps — the two detectors need to be drained together or the second one grows every time the first shrinks. (found 2026-08-23 in the pre-1.5.0 release sweep)

### fill-links-code-gaps Emits Zero Candidates

- id: Q-0173
- area: tooling
- type: fix
- since: 2026-08-23
- size: S
- impact: med
- confidence: med
- parent: feature-md-links-overhaul

`pnpm noldor features fill-links-code-gaps` is inert exactly when it is needed: against 31 unreferenced files it reported `0 assigned, 95 unassigned` with `(LLM low confidence: candidates [])` on every single row — not one candidate for any file. The whole proposal was noise and the 31 assignments had to be derived by hand (test-import graph → `links.tests` owner → FD). Either the candidate generator is broken for a standalone `src/` layout, or it silently depends on a graph state nothing checks; either way a tool that emits an empty candidate list for 100% of rows should say so instead of writing a proposal file. Deletion test: running it on a repo with known unreferenced files produces at least one non-empty candidate list. (found 2026-08-23 closing SDD gaps before the 1.5.0 release)

### Hand-Edited Code Links Drift Against FD Tags

- id: Q-0174
- area: tooling
- type: fix
- since: 2026-08-23
- size: S
- impact: med
- confidence: med
- parent: feature-md-links-overhaul

Hand-editing an FD's `links.code` is only safe on an FD that carries **no** `// @fd:` tags. Add a `src/**` path to a tagged FD and `code-links-drift` immediately reports `links.code is stale vs // @fd: tags`, because the tag scan is the projection source and `sync code-links` will drop the hand-added row on the next write. Nothing surfaces that split at edit time — `validate features` passes, and the drift only appears from `garden detect`. Two candidate fixes: have `features validate` warn when `links.code` names a path under a scan root that carries no `@fd:` tag while the FD has tags elsewhere, or teach `sync code-links` to preserve untagged manual entries the way it already preserves whole tagless FDs. (found 2026-08-23 closing SDD gaps before the 1.5.0 release)

- Consider deriving an FD's test and source links dynamically rather than storing them statically — the static projection drifts too easily, and every drift is a garden finding rather than a compile error. (surfaced 2026-09-08)

### Spec-Lint Prior-Art Requirement

- id: Q-0067
- area: tooling
- type: feat
- since: 2026-08-05
- size: S
- impact: med
- confidence: med
- parent: de-superpowers-vendor-spec-plan-and-worktree-flows

`pnpm noldor design log --support` (Q-0053) already captures prior art into the design ledger, but nothing enforces that it was used — a spec whose ledger renders `Existing support (0) - (none recorded)` passes silently, which means the reuse question was never asked. Spec-lint should reject an approved spec with zero support anchors unless the operator records an explicit `--support "none: <reason>"`. The side benefit is that the CR `reuse` dimension gains a falsifiable claim to check against instead of reviewing in the dark.

### Bugfix Lane in the Priority Suggestions

- id: Q-0201
- area: tooling
- type: feat
- since: 2026-09-02
- size: S
- impact: med
- confidence: med
- parent: gate-flow-rework

The gate's Step 0 pickup offers three substantive buckets — `Top priority`, `Quick win` (`size ∈ {XS,S}` AND `impact ∈ {high,critical}`) and `Milestone-aligned` — built by [`getSuggestions()`](../src/core/next-priority.ts). None of them is a bugfix lane, so a `type: fix` entry surfaces only if it happens to win on score or size, and the roadmap's fix backlog (Q-0166, Q-0171 through Q-0174, Q-0183, Q-0192, Q-0193 as of today) is never offered *as* a repair queue. Wanted: a fourth bucket that filters on `type: fix` and sorts by `impact` descending, so the operator can choose to fix rather than to build. **The constraint that makes this S and not XS:** the bucket question is already at its ceiling — the gate skill records that the worst case (`in-progress + top + quick + milestone + path picker`) is five options against `AskUserQuestion`'s four, resolved by dropping `Milestone-aligned` ([SKILL.md:34](../.claude/skills/noldor-gate/SKILL.md)). A fifth bucket needs an explicit budget policy, not another ad-hoc drop, and the change spans the skill plus its `templates/` twin. Deletion test: with a roadmap holding several `type: fix` entries, the gate offers them as one impact-ordered bucket. (found 2026-09-02)

### Autonomous Address-Blockers Without an Operator Confirm

- id: Q-0206
- area: tooling
- type: feat
- since: 2026-09-02
- size: S
- impact: med
- confidence: med
- parent: autonomous-plan-to-pr-merge

The `address-blockers` branch of the gate's continue-dialog stops for the operator even in an otherwise autonomous run, which breaks the plan-confirm-to-merge chain at exactly the point a drain most needs to keep going. Part of the machinery already exists: `autonomous.onBlockers: 'auto-fix'` turns on the autofix seam, so a fully-mechanical round applies its `M<n>` blockers, records the ledger entry and re-rounds with no human in the loop. The remaining stops are deliberate and each needs an answer before the confirm can go: a MIXED round exits 11 `apply-then-stop` and surfaces the `D<n>` design blockers for arbitration; a decline exits 10 with a `reason:` (`prior-deferred`, `round-cap`, `no-progress`, `no-mechanical`, `no-base-sha`); the seam is capped at 2 rounds per artifact kind; and the split-back sub-question (`fix-in-place / split-back / back`) is itself a judgment call. So this is a policy change, not a default flip — decide what an autonomous session does with a design blocker (escalate to the inbox and park the slug is the obvious candidate, since `autonomous` already owns both) and what it does at the cap, then default the knob on for autonomous sessions only. Deletion test: an autonomous drain hitting a mechanical-only blocker round reaches the PR with no operator prompt, and hitting a design blocker lands in the escalation inbox rather than waiting on a prompt nobody will answer. (found 2026-09-02)

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

### Parent-Feature Opt-In Check Before Sizing

- id: Q-0184
- area: tooling
- type: feat
- since: 2026-08-25
- size: S
- impact: med
- confidence: med

Neither UI-design review lane is enabled anywhere, four days after the second one shipped: this repo declares no `consumer.uiPaths` at all, and charuy declares `uiPaths` but no `uiSurfaces`, no `uiBoot`, and `crLanes.code: [reviewer]`. Q-0144's design phase has traction (3 `.pen` files tracked in charuy) but Q-0145 `ui-reviewer` and Q-0146 `render-compare` have zero installs — which is why Q-0180, a third sibling lane, was carved back to the roadmap rather than built. The habit worth mechanising: for an entry that extends a feature, check whether the feature it extends is switched on in any known repo BEFORE sizing the work. A `pnpm noldor doctor` row or a triage-time hint reporting "the parent feature's opt-in is unset in every known consumer" turns a remembered check into a reported one. The input is already there — `- parent:` on the block, and the consumer config keys the parent feature reads. Deletion test: triaging an extension of a feature no consumer has enabled surfaces the fact in the proposal table without anyone remembering to look. (found 2026-08-25 deciding to park Q-0180)

### Gate Prose Should Pre-Empt the Sibling-Scope Trailer

- id: Q-0192
- area: tooling
- type: fix
- since: 2026-08-25
- size: S
- impact: low
- confidence: high
- parent: scope-sibling-trailer-for-doc-sync-commits

A commit touching `src/**` and `docs/noldor/**` needs a `Noldor-Sibling-Scope: noldor:<page>` trailer, and the `noldor-scope` hook only says so after the commit has already been rejected. The mechanism is fully documented in [git-and-commits.md](noldor/git-and-commits.md#sibling-doc-sync-commits-noldor-sibling-scope) — this is purely about when the operator meets it: every change whose fix spans code plus its runner-neutral doc twin hits the rejection first and reads the doc second. Pre-empt it in the gate prose for mixed-diff paths, or suggest the trailer at stage time from the staged file set rather than at reject time (the hook already computes the exact line it prints). Deletion test: an operator committing a code + `docs/noldor/` change is told about the trailer before the commit is attempted. (found 2026-08-24 shipping Q-0158)

- Same class, different missing step: the micro-chore recipe never says to check out the temp branch, and `pr-flow` reads `HEAD`. Step 2's handoff ends at `git stash pop` on rewound `main`, then hands off to "Step 4 end-of-flow takes over: `pr-flow.ts openAndAutoMerge()` pushes the temp branch" — which reads as though pr-flow resolves the branch from the session marker. It does not: `pr-flow-cli.ts:411` derives the branch from `git rev-parse --abbrev-ref HEAD` and exits at line 437 with `no commits ahead of origin/main on current branch` when run from `main`. A controller following the prose literally gets that error with a committed, pushed-nowhere temp branch and no obvious next move. Add `git checkout <temp-branch>` as an explicit step 5.5 in the micro-chore recipe, noting that the popped dirty files travel along harmlessly. (surfaced 2026-09-07 splitting Q-0193)

### noldor commit SIGKILLed on a Long Message Body

- id: Q-0183
- area: tooling
- type: fix
- since: 2026-08-25
- size: S
- impact: med
- confidence: low

`pnpm noldor commit` was SIGKILLed (exit 137) on a commit carrying a long multi-paragraph `-m` body, with no output at all before the kill; plain `git commit -F <file>` with the identical message succeeded and every hook ran green. The wrapper (`src/core/commit-cli.ts`) is the documented path and its failure mode is silent, so an operator reads it as a hook failure and starts debugging the wrong layer. Reproduce first — whether the kill is the wrapper OOMing on large argv, the harness truncating it, or the platform's argv limit is unknown — then either fix the handling or spool a long body through a temp file the way `-F` does. Deletion test: a commit with a multi-kilobyte body succeeds through the wrapper, or fails with a message that names the cause. (surfaced in charuy by the liquid-glass-ui ship, 2026-08-25)

### Heading Slugifier Drops Non-ASCII Letters

- id: Q-0218
- area: tooling
- type: fix
- since: 2026-09-07
- size: S
- impact: med
- confidence: high

The heading slugifier DELETES non-ASCII letters rather than transliterating them, and `remove-block --split-into` cannot detect the resulting mismatch. Splitting Q-0193 (PR #448) a sibling heading containing `Façades` derived the slug `...-faades-...`, not `...-facades-...`. The cost was not the ugly slug — the *guessed* slug had already been passed to `roadmap remove-block --split-into`, which accepts any string and records it verbatim in `.noldor/retired-entry-ids.json`, so the retired-ID map pointed at a slug no entry had. `split-check --entry <guess>` caught it (`no roadmap/backlog entry with slug`) by accident. Two fixes, both cheap: transliterate in the slugifier (`ç → c`, `é → e`) so a heading a human would write round-trips, and have `--split-into` verify each named slug resolves to a block that now exists — it is called immediately after the siblings are written, so the check is free and a typo'd slug is otherwise invisible until a `blocked-by:` ref dangles. Deletion test: a heading with a non-ASCII letter yields a slug containing its ASCII fold, and `--split-into` with an unresolvable slug exits non-zero. (surfaced 2026-09-07 splitting Q-0193)

### pr-flow Leaves a Stale Remote Branch per Micro-Chore

- id: Q-0219
- area: tooling
- type: fix
- since: 2026-09-07
- size: XS
- impact: low
- confidence: high
- parent: framework-pr-flow-agent-auto-merge

18 stale `origin/micro/*` branches on the remote, one per micro-chore PR ever shipped. `pr-flow` deletes the *local* temp branch after the direct squash-merge but never the remote one, so every micro-chore since PR #318-ish has left an `origin/micro/<epoch>` behind — `origin/micro/changelog-node24-breaking` among them, so the leak predates the epoch naming. Harmless in itself, but it makes `git branch -r` unreadable and any branch-shaped audit noisy. Add a `git push origin --delete <branch>` to pr-flow's post-merge cleanup, guarded on the merge having actually happened (a failed merge must keep the branch), plus a one-off sweep of the existing 18. Deletion test: after a micro-chore PR merges, no `origin/micro/*` branch for it remains. (surfaced 2026-09-07 splitting Q-0193)

### Release-Sweep Refactor Pass Needs a Precondition

- id: Q-0217
- area: tooling
- type: chore
- since: 2026-09-07
- size: S
- impact: med
- confidence: med
- parent: release-sweep-process-hardening

The `/noldor-release-sweep` refactor pass has been a no-op for the seventh release running. v1.9.0 produced an identical god-node profile again — `loadDocRoots` 86 edges, `parseSlug` 41, `loadConsumerConfig` 40, `parseBacklog` 35, `detectAll` 32, `atomicWriteFileSync` 30, `escapeHtml` 28 — all deliberate single-source-of-truth utilities, and the Surprising Connections were again all `INFERRED` test-file → CLI edges. Seven releases of a step that has never once produced a change is not a step, it is a ritual that costs a full graph read and a refactor-skill invocation every release. Either give the sweep a cheap precondition (skip the refactor pass unless the god-node set or a cohesion score moved since the last tagged graph) or drop it to an explicit `--refactor` opt-in. Deletion test: a sweep on a release whose graph shape is unchanged since the last tag does not invoke the refactor skill. (surfaced 2026-09-06 releasing v1.9.0)

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

### PR Summary at Flow End Is Sometimes Not a Link

- id: Q-0230
- area: tooling
- type: fix
- since: 2026-09-08
- size: XS
- impact: low
- confidence: med

The PR summary printed at the end of the flow is sometimes not a clickable link, so the operator has to go find the PR by hand at exactly the moment the flow claims to be done. Intermittent rather than always, which suggests one branch of the summary composition emits a bare number or title where the others emit the URL. Deletion test: every terminal path of the flow that mentions a PR prints its URL. (surfaced 2026-09-08)

### Roadmap Entry Show-More Not Rendered

- id: Q-0231
- area: tooling
- type: fix
- since: 2026-09-08
- size: XS
- impact: low
- confidence: med

The dashboard's roadmap entry rendering does not display the show-more control, so long entry bodies are truncated with no way to expand them — reproduced against Charuy's dashboard. Since every roadmap block now carries a full paragraph plus optional sub-bullets, truncation without an expander makes the roadmap view unusable for exactly the entries that need reading. Deletion test: a roadmap entry whose body exceeds the collapse threshold renders a working show-more control. (surfaced 2026-09-08)

- Still reproducing on charuy's dashboard as of 2026-09-16 — the bug has outlived one release on the consumer side, so it is not a transient render state.

### Self-Explanatory Code Over Comments Rule

- id: Q-0232
- area: docs
- type: docs
- since: 2026-09-08
- size: S
- impact: med
- confidence: med

Agents write far more in-code comments than the repo wants, and nothing states the preference, so every review re-litigates it. The house position is that code should be self-explanatory — naming and structure carry the intent, and a comment earns its place only when it records a why that the code cannot (a falsified alternative, an external constraint, a deliberate deviation). Wanted: an engineering rule stating it, so the expectation reaches the author rather than the reviewer. Pairs with the existing comment-density guidance in the harness prose, which is advisory and unenforced. (surfaced 2026-09-08)

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

### Path Pick Cannot See the Shared-File Block

- id: Q-0244
- area: tooling
- type: fix
- since: 2026-09-16
- size: S
- impact: med
- confidence: high

An XS entry whose whole diff is `.claude/skills/**` routes to `fast-track`, and the worktree then refuses the commit. `sizeToPath()` keys on size alone, so `/noldor-gate` Step 0 stamps `suggestedPath: fast-track` on a pure-prose skill edit; `checks shared-files` blocks `^\.claude/skills/[^/]+` from a feature worktree, so the whole fast-track scaffold is wasted — worktree created, roadmap block retired and committed on the branch, then the real commit is refused. Shipping Q-0222 that cost a full worktree teardown and redo on `main`. The evidence that micro-chore is the intended lane is already in `MICRO_CHORE_GLOBS`, which lists `.claude/**` *and* `templates/.claude/**` with the comment "template-sync forces editing both, so the twin must share the micro-chore lane". The gate's own Step 0 prose says "downgrade to `micro-chore` only when the diff is pure-doc", but nothing computes that: the operator is asked to predict the diff before writing it. Wanted: make the shared-files block list and the micro-chore allowlist reachable from the path pick — either `split-check --entry` warns when an entry's `Touches:` is entirely inside `MICRO_CHORE_GLOBS`, or `worktrees create` refuses up front for a slug whose expected paths are all shared-root. Deletion test: picking `fast-track` for an entry that only touches `.claude/skills/**` surfaces the conflict before the worktree is built. (found 2026-09-15 shipping Q-0222)

### Rules Must Not Snapshot Another Module's Shape

- id: Q-0245
- area: tooling
- type: docs
- since: 2026-09-16
- size: S
- impact: med
- confidence: med

A prose rule that audits the codebase's *current* shape is a self-feeding CR loop. Shipping Q-0223 (PR #457) the new `state-file-schema-additive` rule carried a paragraph characterising `config.json`'s schemas, and four consecutive review rounds each found one level deeper: round 1 said the break is required-ness not `.strict()`; round 2 said the `consumer:` block is strict and required-heavy; round 3 said `noldorConfigSchema`'s *nested* blocks are required-heavy too; round 4's verifier ran the real CLI and falsified the whole consequence claim (a rejected config makes `clones check` exit 0 and silently switch the gate off, because four call sites swallow the throw). Every round's finding was correct, and the round cap plus an arbitration override was the only way out. The rule only became stable once it stopped asserting what other schemas look like and said "audit the nesting level you are editing; establish the consequence by running the command". Wanted: a line in the rule-authoring guidance — a rule states a constraint and how to check it, never a snapshot of another module's field shapes, because the snapshot is wrong the moment it is written and every CR round finds the next exception. Deletion test: a new enforce rule that names another module's field list is caught at authoring time, not at round four. (found 2026-09-15 shipping Q-0223)

### Duplicate PR ID in the Changelog

- id: Q-0246
- area: tooling
- type: fix
- since: 2026-09-16
- size: XS
- impact: low
- confidence: med

A changelog entry renders its PR ID twice. The reference is carried into the entry from the commit subject and appended again by the link-rendering step, so a single squash commit comes out reading `(#444) (#444)`. Cosmetic, but it lands in the published release notes every release and every consumer sees it. Deletion test: a changelog generated from a squash commit whose subject already ends in `(#NNN)` renders that reference exactly once. (surfaced 2026-09-16)

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
