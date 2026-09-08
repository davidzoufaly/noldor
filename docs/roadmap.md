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

### Test Suites Read Live Repo State — Shifting Full-Suite Failures

- id: Q-0171
- area: testing
- type: fix
- since: 2026-08-23
- size: M
- impact: high
- confidence: med

The full `npx vitest run` fails on a *shifting* set of files that each pass in isolation, so a green suite is currently a matter of timing. Observed twice within ten minutes on 2026-08-20: run one failed `src/garden/__tests__/sdd-report.test.ts` (2 tests), run two failed `src/release/__tests__/preflight.test.ts` + `src/dashboard/__tests__/route-sweep.test.ts` (8 tests) with sdd-report green; all three files passed together in isolation (141 tests). The common factor is tests that read live repository state — `.noldor/session.json`, which the same session's `noldor set-autonomous` rewrites mid-run, and the dashboard port — rather than a fixture. Identify which suites read live `.noldor/` state or bind a fixed port and give them a fixture or a temp root, since the alternative is that every future red suite gets retried instead of read. Deletion test: the full suite passes with a session marker present, an autonomous flag flip mid-run, and a dashboard already listening. (found 2026-08-20 draining the XS batch)

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
