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

### CR Re-Round Cap Enforcement and Oscillation Detector

- id: Q-0170
- area: tooling
- type: feat
- since: 2026-08-23
- size: M
- impact: high
- confidence: med
- parent: specs-cr-gate-multi-reviewer

Q-0130's re-round cap (2, controller prose) has no tooling enforcement and no oscillation detection — the Q-0146 code CR ran 12 rounds: the reviewer found one new med per round on a ~700-line lane indefinitely, and codex OSCILLATED against itself (round 4 demanded persist-failures downgrade the verdict; round 12 flagged that exact downgrade as a precedence violation) and re-flagged documented `noldor:cut` sites 5x (boot kill fire-and-forget) and 5x (zero-raster evidence retention, which the round-8 REVIEWER had mandated). Wanted: an orchestrate-level round counter that hard-stops re-rounds at the cap with an explicit arbitration sink, and a re-flag detector that compares a round's blockers against `noldor:cut` markers + prior-round fixes so contradictory or repeated findings are surfaced as such instead of consuming another full round. Q-0146 shipped via `Noldor-Path-Override` with the arbitration recorded in the trailer. (found 2026-08-22 shipping Q-0146, PR #366)

- Code-stage CR does not converge on a large diff at all: ~18 `cr orchestrate --kind code` rounds on charuy's `liquid-glass-ui`, each returning exactly one NEW finding, never green — so the `Noldor-Reviewed-Subagent` receipt is never earned and `pr-flow` cannot push without an override. The findings were real (a typecheck break, three shipped sub-AA regressions, several fail-open holes in a guard), so this is not reviewer noise: the loop simply has no fixed point, because each fix is fresh surface. This is the arithmetic the cap does not close — the bounded re-round rule caps operator *arbitration* rounds at 2, while the receipt still has to be earned by a green reviewer run over the final tree, so obeying the cap means never shipping. The cap enforcement this entry asks for must therefore also say what earns a receipt when review is genuinely unbounded. (surfaced in charuy by the liquid-glass-ui ship, 2026-08-25)

### Toolchain Floor Reads Root tsconfigs Only

- id: Q-0208
- area: tooling
- type: fix
- since: 2026-09-02
- size: S
- impact: med
- confidence: high
- parent: architecture-invariants

`toolchain-floor` checks the root tsconfigs and nothing else — `TSCONFIG_CANDIDATES` is `['tsconfig.base.json', 'tsconfig.json']` in [`src/invariants/toolchain-floor.ts`](../src/invariants/toolchain-floor.ts) — so a nested config sitting below the lib floor passes unseen. Found live in this repo: `src/dashboard/static/tsconfig.json` sat at `lib: ["ES2023", "DOM"]` while the `platform-over-dependency` and `deterministic-cleanup` rules both bind `**/*.ts` (which covers `drag.ts` and `agents.ts`) and mandate `Set.prototype.union` and `Symbol.dispose` — each a TS2550 under that lib. So two *enforced* rules were directing agents to write code a real config in the same repo rejects, and no gate said a word. The `lib-inherited` guard cannot cover this: it stays quiet because the root config does declare a `lib`, and it is decided repo-wide by design. Two candidate fixes: walk every tsconfig the workspace scan already finds (the manifest walk is right there), or assert that a nested config either declares no `lib` at all — inheriting the base — or meets the floor itself. Worth carrying forward that `lib` **replaces** rather than merges across `extends`, so putting the floor in a base config protects only those children that omit `lib` entirely — which is why the second option is the stronger invariant. Deletion test: a nested tsconfig whose `lib` sits below the floor reds the invariant. (found 2026-08-26, CR on the tsconfig-shared-base refactor; absorbed from a lesson)

### Milestone-Queue Linking

- id: Q-0083
- area: tooling
- type: feat
- since: 2026-08-10
- size: M
- impact: med
- confidence: low
- parent: decouple-milestones-from-semver

Milestones (`docs/milestones/<slug>.md`) currently live independent of the queue — no way to say which roadmap/backlog entries belong to which milestone, or see milestone progress from the queue side. Link entries to a milestone (e.g. add a `milestone:` field to the schema-C parser — feature-MD frontmatter has one, but `BacklogEntry` in `src/utils/parse-blocks.ts` does not — or have the milestone doc list entry IDs) and add the reverse roll-up: dashboard/status compute milestone completion from its tasks.

- Provázat milestone s featurama, backlogem a roadmapou — the operator raised this again on 2026-08-24: the link must run in both directions across all three surfaces (feature MDs, `docs/backlog.md`, `docs/roadmap.md`), not just feature frontmatter, so a milestone doc can enumerate its queue and the queue can name its milestone.

### Scoped Link Sync for the Projection Runners

- id: Q-0182
- area: tooling
- type: feat
- since: 2026-08-25
- size: S
- impact: med
- confidence: high
- parent: feature-md-links-overhaul

`pnpm noldor sync code-links` is repo-wide with no scope flag, so running it inside a feature worktree to populate one FD's links also rewrites every other FD the tag scan touches. On the liquid-glass-ui ship it reordered `coordinate-frame-and-measurement-tools.md` and added six entries to it, pulling unrelated FD churn into a feature PR that had to be reverted by hand. The gap is in `parseRunOptions()` (`src/sync/projection.ts`), which parses only `--check`, `--force` and `--quiet` — so all four projection runners (`code-links`, `test-links`, `doc-links`, `spec-links`) share it. Add `--slug <slug>` (repeatable, or comma-separated) that restricts the write set to the named FDs while still scanning the repo for their tags, since the tags themselves live outside the FD. Deletion test: a `sync code-links --slug <x>` run leaves every FD but `<x>` byte-identical. (surfaced in charuy by the liquid-glass-ui ship, 2026-08-25)

### writeJsonState Missing From the State-File Module

- id: Q-0204
- area: tooling
- type: refactor
- since: 2026-09-02
- size: S
- impact: med
- confidence: high
- parent: state-file-fail-open-hardening

`src/core/state-file.ts` owns the read half of JSON state (`readJsonState<T>`) and not the write half, so ten modules hand-roll the same two lines — `mkdirSync(dirname(p), { recursive: true })` then `atomicWriteFileSync(p, JSON.stringify(v, null, 2) + '\n')`. The sites: `src/design/ledger.ts`, `src/clones/baseline.ts`, `src/core/rollout-marker.ts`, `src/core/receipt-store.ts`, `src/core/session.ts`, `src/indirection/baseline.ts`, `src/autonomous/watch-state.ts`, `src/autonomous/escalations.ts`, `src/milestones/lib.ts`, and `atomic-write.ts` itself. The asymmetry is the whole bug: the module that exists to own this pattern owns one direction of it. Ten instances is far past rule-of-3, and the extraction costs no indirection — every one of those modules already imports from `src/core/`, so the closure count does not move; `indirection check` held at 882 across the abstraction-cost-ratchet branch. Deletion test: after the extraction, `grep -l atomicWriteFileSync src | xargs grep -l mkdirSync` returns only `state-file.ts`. Surfaced while judging the clone-ratchet rebaseline on the abstraction-cost-ratchet branch, where two of six new clone groups were real and four were façades. (found 2026-08-31)

### pr-flow Cannot Reuse an Existing Open PR

- id: Q-0166
- area: tooling
- type: fix
- since: 2026-08-23
- size: S
- impact: med
- confidence: high
- parent: framework-pr-flow-agent-auto-merge

`pnpm noldor pr-flow` cannot reuse an existing open PR: it always runs `gh pr create` and throws `gh pr create failed: exit 1` when one exists for the branch, leaving a green, receipted, mergeable branch unshipped until someone runs `gh pr merge <n> --squash` by hand. Hit on 2026-08-20 (Q-0134) after a stale-base rebase — the first `pr-flow` pushed and opened PR #353, died at the merge on a roadmap conflict, and every subsequent `pr-flow` then died earlier still, at create. The state is common precisely when it matters (a re-run after a failed ship), and the fallback is undocumented. Detect an open PR for the head branch and proceed to the merge step, updating its body rather than recreating it. Deletion test: `pr-flow` run twice on the same branch merges on the second run instead of erroring. (found 2026-08-20 draining the XS batch)

### Stale-Specs Detector Is Blind to Attach-Flow Orphan Specs

- id: Q-0167
- area: tooling
- type: fix
- since: 2026-08-23
- size: S
- impact: med
- confidence: high
- parent: doc-gardening-skill

`staleSpecs` is blind to attach-flow specs that no FD references. Twelve specs sit live in `docs/design/specs/` (dating back to 2026-06-07) whose parent features are all `phase: done` — `registry-distribution-*`, `make-noldor-agent-agnostic-runner-parity-followups`, `memory-intake-*-memories-migration`, `outcome-telemetry-*-metrics-page-ui`, two `de-superpowers-*` enhancement specs — and eleven of them are referenced by no FD's `links.spec` at all, because the attach flow names them `<parent>-<enhancement>` and the parent FD keeps pointing at its own original spec. The detector reports zero. `noldor design archive` only moves artifacts the *current gate session* owns, so an attach session that ended without running it leaves its spec live forever with nothing to notice. Flag a spec whose filename-derived parent slug resolves to a done FD and which appears in no `links.spec`, so `/noldor-garden` can offer the archive. (found 2026-08-23 in the pre-1.5.0 release sweep)

### Garden Skill Checklist Enumerates a Fixed Section List

- id: Q-0198
- area: tooling
- type: fix
- since: 2026-08-29
- size: S
- impact: med
- confidence: high
- split-from: Q-0185
- recovered: 2026-08-29

`/noldor-garden` step 1 orders "check every key the payload carries, not a fixed count — `structuralContextStubs` is a finding like any other, and a gate that enumerates a subset silently swallows whichever key it predates". Step 4 of the same skill then enumerates a fixed checklist: Stale plans, Stale specs, Manual sweep, Unused backlog, Rule contradictions, SDD gaps, Structural context stubs, Architecture invariant violations. The two steps contradict each other, and the cost is already live: `architectureAdvisories` (Q-0093) has no row — the checklist's "Architecture invariant violations" renders `invariantViolations`, a different key — so every module-advisory row `detectArchitectureAdvisories` produces is parsed by step 1 and then dropped by step 4. `structuralContextStubs` has a row only because it was added by hand when Q-0194 shipped, which is the pattern step 1 exists to end. The `fdDiagramStubs` key Q-0185 introduces will land in the same hole. Wanted: step 4 renders whatever non-empty keys the payload carries rather than a hand-maintained list, in the skill and its `templates/` twin. Note `garden detect` stdout is pure JSON by contract (step 1 parses it, and `--ci` deliberately routes its message to stderr), so the fix is in the skill's rendering, not a new text mode on the CLI. Deletion test: a new advisory `GardenFindings` key reaches the operator checklist with no edit to `/noldor-garden`. (carved out of Q-0185's spec dialogue, 2026-08-29 — D8, corrected at CR round 1)

### Clones Ratchet and Clone-Group Check Disagree on Attribution

- id: Q-0193
- area: tooling
- type: fix
- since: 2026-08-25
- size: S
- impact: med
- confidence: high
- parent: code-clone-detector

`clones check` printed `no clone group touches this change - green` and reddened in the same run on `duplicated tokens rose 27735 -> 27845 (+110)` — the standalone CLI disagreeing with itself. The rise came from a new test reusing its file's established 15-instance scaffold (`const commits: Commit[] = [...]` + `checkCrGate({...runGit: makeGitFake(commits)})`), i.e. exactly the idiom consistency the test rules ask for, so any PR that adds a case to a table-driven test file currently owes a baseline re-record commit. The check also declines to name what moved the total: the operator has to diff group lists between branches, and a green run prints no group list to diff against, so there is nothing to compare. Two candidate fixes, not exclusive: exempt `**/__tests__/**` from the token ratchet (or weight it separately from production code), and make `clones check` name the files that moved the total the way `microChoreOffenders` names its offenders. Related to Q-0165 (preflight vs hook disagreement) but distinct — that was two entry points diverging, this is one run contradicting itself. Deletion test: adding a case to a table-driven test file does not red the ratchet, and any ratchet rise names the files responsible. (found 2026-08-25 shipping Q-0164)

- The ratchet also counts thin typed façades as duplication, and this one blocked a release sweep. On the 2026-08-30 sweep the whole-corpus ratchet redded at +112 tokens over the baseline PR #406 recorded, and the largest new group was `src/design/design-approval.ts:63-92` vs `src/design/ui-capture.ts:76-108` (82 tokens). Neither site holds copied logic: both are one-line delegations to the already-shared receipt store (`parseReceiptWith`, `writeReceiptFile`, `readReceiptFile`), each binding a *different* schema, dir-segment tuple and return type. The tokenizer skips comments but normalizes identifiers to `ID` for Type-2 matching, so two same-shaped one-line delegations match structurally. The rest of the delta was import blocks (`src/design/ledger.ts` vs `src/cr/orchestrate.ts`, `src/metrics/compute.ts`, `src/garden/garden-detect.ts`). Extracting is strictly worse here — one generic untyped wrapper, indirection added, zero logic shared. Two more candidate fixes on the same axis as the ones above: skip a group whose every span is a single `return <call>(…)` statement, and exclude leading import runs from the token stream. Rebaselined to 28844 by hand to unblock the sweep, which is now the second forced re-record on this entry — hence the move up the file. Deletion test: a file pair whose only overlap is imports plus a delegating one-liner produces no group. (found 2026-08-30, release sweep)

### Main-Module Guard Fails on Percent-Encoded Paths

- id: Q-0126
- area: tooling
- type: fix
- since: 2026-08-14
- size: M
- impact: high
- confidence: med

35 module entrypoints gate their CLI body by comparing `import.meta.url` against a hand-built string of `file://` concatenated with `process.argv[1]`. That comparison is false whenever the repository path needs percent-encoding — one space in a directory name is enough — so the module exits 0 having run nothing, with no diagnostic. For the hook and validator entrypoints among them, that is a silently disabled gate: the framework reports success precisely when it checked nothing. `src/cli/index.ts` and `src/hooks/noldor-pre-push.ts` already use the correct `pathToFileURL(process.argv[1] ?? '').href` form; sweep every remaining site to it.

- Confirmed call sites — all 35, measured by grepping `src/` for the literal comparison on 2026-08-14. **`src/hooks/` (6, the material cluster — these are the gates):** `noldor-pre-commit.ts`, `noldor-validate-trailer.ts`, `noldor-inject-trailers.ts`, `noldor-enforce-review-receipt.ts`, `noldor-pre-edit-guard.ts`, `agent-rules-guard.ts`. **`src/worktrees/` (6):** `create-worktree.ts`, `down-worktree.ts`, `up-worktree.ts`, `launch-worktrees.ts`, `worktree-conflicts.ts`, `worktree-status.ts`. **`src/core/` (6):** `validate-noldor-scope.ts`, `validate-noldor.ts`, `validate-skill-catalog.ts`, `changelog.ts`, `rename-plan-only-tier.ts`, `pr-flow-cli.ts`. **`src/rules/` (3):** `cli-list.ts`, `cli-resolve.ts`, `cli-validate.ts`. **`src/features/` (3):** `fill-links-code-gaps.ts`, `migrate-changelog-unreleased.ts`, `migrate-fd-commits-to-prs.ts`. **`src/checks/` (2):** `check-template-sync.ts`, `check-shared-files.ts`. **`src/cr/` (2):** `orchestrate.ts`, `codex.ts`. **`src/design/` (2):** `context-cli.ts`, `log-cli.ts`. **Singles:** `src/triage/validate-triage.ts`, `src/cli/validate-script-catalog.ts`, `src/milestones/validate-milestones.ts`, `src/prep/print-format.ts`, `src/release/index.ts`.
- Two shape variants, one defect: `src/core/rename-plan-only-tier.ts:109` interpolates a destructured `argv[1]` and `src/milestones/validate-milestones.ts:61` assigns to a `const isMain` rather than branching inline. Both are the same template bug — do not read them as a second class.
- The regression test wants a fixture checkout whose path contains a space, asserting each swept entrypoint still executes its body — a unit test on the comparison helper alone would not have caught the class, since every site re-derives it inline.
- Sized M rather than S because the sweep is 35 files, not the ~10 the original report named. The work is still mechanical (one-line replacement per site plus the shared fixture), so the routing note's "a mechanical L can still fast-track" reasoning applies — do not over-prep it on the size label alone. At `M/high/med` it scores 150, a tie with Q-0067 (and, until it shipped, Q-0127); the file position above it is operator discretion, not a scoring claim.

(found by the code-stage CR on Q-0124, 2026-08-13; scope re-measured 2026-08-14)

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

### noldor commit SIGKILLed on a Long Message Body

- id: Q-0183
- area: tooling
- type: fix
- since: 2026-08-25
- size: S
- impact: med
- confidence: low

`pnpm noldor commit` was SIGKILLed (exit 137) on a commit carrying a long multi-paragraph `-m` body, with no output at all before the kill; plain `git commit -F <file>` with the identical message succeeded and every hook ran green. The wrapper (`src/core/commit-cli.ts`) is the documented path and its failure mode is silent, so an operator reads it as a hook failure and starts debugging the wrong layer. Reproduce first — whether the kill is the wrapper OOMing on large argv, the harness truncating it, or the platform's argv limit is unknown — then either fix the handling or spool a long body through a temp file the way `-F` does. Deletion test: a commit with a multi-kilobyte body succeeds through the wrapper, or fails with a message that names the cause. (surfaced in charuy by the liquid-glass-ui ship, 2026-08-25)
