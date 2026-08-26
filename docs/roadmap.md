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

### Graph Evidence in Specs and ADRs

- id: Q-0194
- area: docs
- type: feat
- since: 2026-08-25
- size: M
- impact: med
- confidence: med
- parent: graphify-plan-of-edges-nodes-for-plans-specs

[`graph-integration.md`](noldor/graph-integration.md) tells every reader to open `graph.brainstorm-summary.toon` before any codebase exploration, but the two surfaces where architecture decisions actually get written — `/noldor-spec` and `docs/adr/` — never mention the graph, so nothing records whether the structure was consulted. `/noldor-refactor` is the only stage wired to it, and by then the decision is already made. Three moving parts: (1) `/noldor-spec` gains an explicit read step on the `specs-only-*` and `full-*` paths — check freshness, regen AST-only if stale (seconds), read the summary toon before drafting `## Design`; (2) the spec contract printed by `prep format spec` and the ADR template grow a short **Structural context** unit naming the communities, god nodes, and cross-package bridges the change lands in — the same evidence `/noldor-refactor` already keys off before it touches a god node; (3) a garden detector reports a spec on a `full`/`specs-only` path, or a new ADR, whose structural-context unit is still a stub. Advisory-with-teeth like Q-0185: report it, let a `noldor:cut` marker record a deliberate skip, never block a ship. The risk to spec is stale-graph handling — reading a stale graph is worse than reading none, so the read step must reuse [`loadFreshGraphOrWarn()`](../src/garden/graph-fd-lookup.ts)'s gate rather than trusting the file's presence, and a missing graph must stay a clean skip (graphify is optional). Deletion test: a spec that reshapes a god node says so in writing, and a reader can tell from an ADR which part of the structure the decision moved. (found 2026-08-25)

### Better Unit-Test Rules

- id: Q-0071
- area: testing
- type: docs
- since: 2026-08-05
- size: S
- impact: low
- confidence: low

Extend the project's unit-testing rules beyond what `docs/noldor/testing-principles.md` and the Tests section of `.claude/engineering-rules.md` cover today, using the review discussion on `gooddata/gdc-mastercard-panther#2542` as the source material. Fuzzy one-liner — the linked PR sits in a private repo and has not been read, so the actual delta is unknown. Trigger: read the PR and extract the concrete rules before promoting; without that, there is nothing to implement.

### Design Approval Step Before Implementation

- id: Q-0186
- area: tooling
- type: feat
- since: 2026-08-25
- size: M
- impact: med
- confidence: low
- parent: pendev-ui-design-phase

The `.pen` lifecycle has no approval seam. The baseline half works well, but a feature's design artifact goes straight to `docs/design/ui/archive/` — archived before anyone confirmed the design was the one to build. What the flow is missing is a step inside the implementation path: the agent opens (or creates) the feature's `.pen`, edits it, and the operator confirms THAT design before code starts, with the archive move happening after the confirmation rather than instead of it. The pieces exist — `design pen-bridge` already opens a `.pen` in the declared editor (Q-0179), and the UI-design stage already computes whether a session is UI-bearing — so this is sequencing and a recorded verdict more than new machinery. Sizing is loose because the seam touches the gate's stage order; spec it before planning. Deletion test: a UI-bearing session cannot reach the code stage without a recorded design verdict, and an approved `.pen` archives with the approval attached. (found 2026-08-25)

### Mandatory C4 Diagram for New Feature MDs

- id: Q-0185
- area: docs
- type: feat
- since: 2026-08-25
- size: M
- impact: med
- confidence: med
- parent: consumer-architecture-doc-surface

A full new FD should carry a mermaid diagram at the C4 level that fits it, semi-mandatory rather than optional: prose alone is what lets an FD's shape stay implicit until a reader has to reconstruct it from `links.code`. Q-0178 prescribes form for the four `docs/architecture/` registry pages; this is the per-feature counterpart — the FD template grows a diagram section, `/noldor-new-feature` and `/noldor-promote` scaffold the fence, and a check reports an FD on a `full` path whose diagram section is still a stub. Semi-mandatory means advisory-with-teeth: report it, let a `noldor:cut` marker record a deliberate skip, do not block a ship on it. Scope the requirement by path tier (`full` earns a diagram; `fast-track` and `micro-chore` never do) so it does not tax the XS drain. Deletion test: a reader gets the shape of a newly shipped `full` feature from its FD without opening a source file. (found 2026-08-25)

### UI Baseline Freshness Must Run the Capture

- id: Q-0190
- area: tooling
- type: fix
- since: 2026-08-25
- size: M
- impact: high
- confidence: med
- parent: pendev-ui-design-phase

`design:capture-ui` had been broken for days while both the freshness check and CI reported healthy. Two capture states drove through buttons that `ai-first-ui-hide-low-level-tools-by-default` had moved behind a disclosure, so the run died on state 8 of 10; the temp-then-rename write left the committed baseline in place, describing a toolbar that no longer existed. `checks ui-design-freshness` said `fresh` throughout, because it compares commit ordering rather than content and cannot see that the generator itself fails. The block surfaced only because a UI-bearing session tried to seed from the baseline. Wanted: the freshness check runs the capture (or a cheap dry-run of its drivers) instead of trusting timestamps, or capture runs in CI on any `uiPaths` diff so the recorder breaks loudly at the commit that breaks it. Consumer-side residue worth carrying into the same fix: charuy's `scripts/design/__tests__/validate.test.ts` opens a hardcoded `/Applications/Pencil.app/...` path unguarded and fails wherever Pencil is installed elsewhere, while the capture script guards the same path — so the one test that would have covered the schema was already red and ignored. Deletion test: a UI change that breaks a capture driver reds at that commit, not at the next session that tries to read the baseline. (found 2026-08-25)

### Attach-Path UI Verdict Reads Touches

- id: Q-0189
- area: tooling
- type: fix
- since: 2026-08-25
- size: S
- impact: med
- confidence: high
- parent: pendev-ui-design-phase

On attach paths the UI verdict is computed from the parent FD's entire `links.code`, so an enhancement inherits `required` from files it does not touch. `agent-camera-control` matched six paths — `App.tsx`, `ViewportArea.tsx`, three `packages/viewport/src/*` files and `useMeshData.ts` — none of which the enhancement had to touch to add two agent verbs; the source roadmap block carried no `Touches:` clause, so `sessionUiVerdict` had nothing narrower to read. The verdict happened to be right that time (the work grew a toolbar control), but it was right by accident. On `*-attach`, take the candidate paths from the source block's `Touches:` and fall back to the parent's `links.code` only when the block has none. The step should also say that a `required` verdict with no visual delta is legitimately answered by recording that, rather than by seeding a `.pen` that documents an unchanged surface. Deletion test: an attach session whose `Touches:` names only non-UI files gets `not-required` while its parent FD stays UI-bearing. (found 2026-08-25)

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

### UI-Design Step Pencil Recipe Corrections

- id: Q-0188
- area: docs
- type: fix
- since: 2026-08-25
- size: S
- impact: med
- confidence: high
- parent: pendev-ui-design-phase

Two instructions in the UI-design step are wrong against the tool, and each cost a session before the tool was believed over the prose. **Seeding is not implementable as written**: the step says to copy the baseline's pages "via pencil MCP, naming them `BASE:<surface>: <name>`", but `execute` has no cross-file copy (`Copy(path, parent)` is within one document) and the baseline is ~1500 nodes, so `Get`-then-`Insert` is not a real option either. What works is a filesystem `cp` of the baseline followed by page renames — say that, or ship a `design ui-seed <slug>` that does it. The naming half is stale too: `capture-ui` emits `FINAL:app: <state>` (`PAGE_PREFIX`, `scripts/design/states.ts`), so a freshly captured baseline carries `FINAL:` pages that must be renamed to `BASE:` before they can seed anything — and the committed baseline carried `BASE:` names plus three hand-authored `VAR:` pages and a `FINAL:`, i.e. a file documented as generated-never-hand-edited had already been renamed and hand-edited. Reconcile who owns page prefixes between the recorder and the design step. **Fresh nodes render blank in their own call**: new `text` and `path` nodes come back invisible in a `TakeScreenshot` issued from the same `execute` (frames with a `fill` render, and `Copy` of an existing node renders immediately) — the pen skill claims the opposite ("screenshots reflect the changes made earlier in the same execute call"), so the guidance actively misleads and an agent diagnoses its own correct schema as broken. One line telling the author to verify in a FOLLOW-UP call, or to build from copies, pays for itself. Deletion test: a first-time author seeds a `.pen` from the baseline and screenshots a fresh node without a wrong conclusion in between. (found 2026-08-25)

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

### Architecture Doc Prose Form and Structure

- id: Q-0178
- area: docs
- type: docs
- since: 2026-08-24
- size: M
- impact: med
- confidence: med
- parent: consumer-architecture-doc-surface

Q-0093 shipped the `docs/architecture/` registry — four pages, a presence validator, an advisory staleness check and scaffold-only templates — but left the *content* contract open, so the pages drift into long narrative prose instead of the terse technical reading the surface exists to give. Wanted: prescribe the form as well as the existence — a fixed section structure per page in `templates/docs/architecture/`, stricter C4 fidelity (each page answers its own C4 level and only that level: context = system + actors + externals, containers = runnable units, modules = internal dependency direction and state ownership, flows = load-bearing runtime paths), and a prose contract that favours diagram + labelled fact over paragraphs. Consider an advisory bloat check alongside the existing staleness one (prose-to-diagram ratio, or per-page word budget) so the drift is visible without blocking a release. Deletion test: a reader answers "how is this system shaped" from the four pages without reading a single full paragraph, and a page that has grown into an essay is flagged rather than merely stale.

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

### Pen Write-Target Guard

- id: Q-0187
- area: tooling
- type: fix
- since: 2026-08-25
- size: S
- impact: high
- confidence: high
- parent: pendev-ui-design-phase

The pencil MCP ignores `filePath` and edits whatever canvas the app currently has open, and nothing in the UI-design step says to check — so a path that does not exist is a silent write to the wrong file rather than an error. Passing a worktree path while the app held `docs/design/ui/baseline/app.pen` edited the baseline instead, deleting four pages from it, and the app later auto-saved that same session document over two tracked files: the baseline and `docs/design/ui/archive/2026-08-24-liquid-glass-ui.pen`, another feature's archived artifact. They were byte-identical afterwards, which is how it was caught; `git status` in the main workspace was the only signal, and the worktree's own status stayed clean throughout. Wanted: the UI-design step opens with a `get_app_state` assertion that the active canvas IS the file about to be written (the tool already reports it), stated plainly as a silent-wrong-write hazard, plus a `.pen` write-guard in `checks shared-files` for the second half — an edit to `baseline/` or to any `archive/` `.pen` from a feature session is never intentional. Deletion test: a wrong `filePath` fails the step before any node is written, and a feature session that touches a baseline or archived `.pen` is rejected at commit time. (found 2026-08-25, gate Step 1.5 on agent-camera-control)

### Design Archive Leaves the Spec Link Stale

- id: Q-0181
- area: tooling
- type: fix
- since: 2026-08-25
- size: XS
- impact: med
- confidence: high

`pnpm noldor design archive` repoints `links.design` to the archive path but leaves `links.spec` pointing at the pre-archive location, so every FD it touches ends the session with a broken spec link. `src/design/archive-cli.ts` rewrites only the `links.design` pointer even though the same run moves the spec and the plan. It was caught by the code-stage CR, not by `features validate` — which does not resolve link targets at all. Fix either side or both: repoint every `links.*` the command moves, and/or make `features validate` resolve declared link paths so a dangling pointer reds before review has to find it. Deletion test: `design archive` on an FD with a spec, a plan and a pen leaves all three pointers resolvable, and a hand-broken pointer reds `features validate`. (surfaced in charuy by the liquid-glass-ui ship, 2026-08-25)

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

### fd-command-rot Needs an Ignore Marker

- id: Q-0168
- area: tooling
- type: fix
- since: 2026-08-23
- size: XS
- impact: low
- confidence: high
- parent: doc-gardening-skill

`fd-command-rot` (`src/garden/detectors/fd-command-rot.ts`) has no ignore marker, unlike its sibling `skill-code-drift` which honours `noldor-skill-drift-ignore`. A done FD's Summary routinely names design options that were *rejected* — `portable-gate-entrypoint-for-non-claude-runners` documents "(a) a portable `noldor gate --drain <slug>` CLI entrypoint" as the road not taken — and the detector reads any backticked `noldor …` span as a live invocation, so recording why an option lost costs a permanent SDD gap. The only fix available today is to de-backtick the prose, which degrades the FD to make a detector happy. Give the detector the same ignore marker its sibling already has. (found 2026-08-23 closing SDD gaps before the 1.5.0 release)

### Architecture Module Advisory Fires on Generated Trees

- id: Q-0169
- area: tooling
- type: fix
- since: 2026-08-23
- size: XS
- impact: low
- confidence: high
- parent: consumer-architecture-doc-surface

The architecture module advisory fires on `src/graphify-out` — a gitignored generated AST cache (`.gitignore:54`), not a module. `docs/architecture/modules.md` is asked to name a directory that must never be documented, so the advisory can only be silenced by writing a lie into the registry. The module scan needs the same ignore-generated-trees treatment PR #360 gave the runtime-asset scan. Advisory-only, so it never blocks a release — which is also why it has sat there unfixed. (found 2026-08-23 closing SDD gaps before the 1.5.0 release)

### Unvalidated Slug Path Traversal Across CLI Entry Points

- id: Q-0097
- area: tooling
- type: fix
- since: 2026-08-12
- size: M
- impact: critical
- confidence: high

Three command families build filesystem paths from an unchecked positional argument, giving a local path-traversal read/write primitive in commands that automated gate flows invoke routinely. `src/core/slug.ts` already states that every external path-building entry point must use the canonical validator; these call sites do not. Validate at the start of each exported library function — not only in argv parsing — before any `exists`, read, process launch, kill, or git call, and return the same invalid-slug diagnostic worktree creation already uses. Then audit every other CLI that forms a path from argv, so the fix is not a three-call-site patch around a shared policy failure. Subprocess tests: slash, dot-dot, leading/trailing/doubled hyphens, uppercase, Unicode — assert no read or write spy fires and an outside sentinel file stays byte-identical.

- `worktrees up` / `worktrees down`: `upWorktree()` computes `join(opts.cwd, '.worktrees', opts.slug)` before validation and only calls the validating `createWorktree()` when that path does not already exist, so an existing outside directory — or `--no-create` — bypasses the sole guard, after which Noldor can open an editor, launch an agent, and boot configured commands there. `downWorktree()` builds the pid-file path the same way and, with `--remove`, hands `join('.worktrees', opts.slug)` to `git worktree remove --force`. A deep enough value in the prefixed pid filename also escapes `.noldor`, letting the command read a foreign `.pids` file and treat its second column as process-group IDs.
- `features phase-flip-done` / `features phase-revert`: both take the first non-flag token straight into `join(process.cwd(), 'docs', 'features', slug + '.md')` without importing the shared validator. From a consumer root `/consumer`, `../../../escape` resolves to `/escape.md`, and the command rewrites that file if it exists and contains the expected phase text.
- Milestone draft/load/activate: `src/milestones/lib.ts:55-76` and `:90-99` interpolate the slug into `docs/milestones/<slug>.md` and the CLI forwards `rest[0]` verbatim, so `draft` can create an outside file when its parent exists and `activate` can read and rewrite one carrying milestone-shaped frontmatter. `FeatureFrontmatterSchema.milestone` and vision's `current-milestone` are only non-empty strings, so repository-authored references feed non-slugs deeper into milestone readers — encode the slug schema in milestone, feature and vision validation so invalid state cannot load at all.

(all three confirmed by static path-resolution probe in the read-only audit 2026-08-12)

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

### Kind-Less `cr aggregate` Re-Reds on a Stale Addressed Spec Sink

- id: Q-0154
- area: tooling
- type: fix
- since: 2026-08-23
- size: XS
- impact: med
- confidence: high

Gate Step 4's "wait for in-flight" `cr aggregate --slug <slug>` (no `--kind`) re-reds on a stale addressed spec sink: fix-and-proceed at the re-round cap leaves the artifact-stage sink red by design (no re-dispatch), so the kind-less aggregate exits 1 on findings already fixed in commits and the controller has to recognise the staleness by hand and proceed on the Q-0069 precedent (code-stage green earns the receipt). Hit on Q-0131 and again on Q-0092. Either kind-scope the wait step to the running/standalone lanes, or have fix-and-proceed archive or annotate the sink it consciously leaves red. Deletion test: a session that fix-and-proceeds at the spec-stage cap reaches Step 4 without a manual override. (absorbed from a lesson, surfaced shipping Q-0131 attach, PR #331)

### Size-Aware `--iteration-timeout` for the Drain Runner

- id: Q-0156
- area: tooling
- type: fix
- since: 2026-08-23
- size: XS
- impact: med
- confidence: high

`--iteration-timeout` should scale with `size:` the way routing already does — XS entries finish in ~15 min while S entries with real CR rounds want 45-60, so a batch of S entries on the 30-minute default systematically burns one retry each (Q-0107 was killed mid-CR with 4 commits and green tests already produced). The operator workaround is documented in [`autonomy.md`](noldor/autonomy.md); the fix is a size-aware cap derived from the same `size:` field [`sizeToPath()`](../src/core/size-routing.ts) already reads. Deletion test: a drain batch of S entries completes without a timeout-induced retry at the default. (absorbed from a lesson, surfaced draining the 2026-08-13 S/med/fix batch, PRs #315-#319)

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
