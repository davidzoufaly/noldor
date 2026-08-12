# Roadmap

Flat priority-ordered list (file order = priority). Every entry is a `### <Entry Name>` heading — **one fixed level, no grouping categories**. Writers (`/noldor-triage`, `/noldor-promote` residue, the dashboard add API) may never mint an `### <Category>` container with `#### <Entry>` children; a group heading carrying no entry is a `validate:triage` error (`empty-group-heading`).

Each entry carries a `- id: Q-NNNN` bullet — a stable ID minted at triage and never rewritten; it survives heading renames and roadmap ↔ backlog moves, so `blocked-by:` references target it, not the rename-fragile slug (the slug is a human-readable alias). See [triage.md → Stable entry IDs](noldor/triage.md#stable-entry-ids).

File order tracks the **`pnpm noldor triage score`** ranking, not the raw `impact:` label. `effort` divides in that formula, so a cheap low-impact entry can outrank an expensive high-impact one — `XS/low/med` scores 150 against `M/med/med`'s 75. The score guides the insert position rather than enforcing it (nothing in `validate:triage` checks order, and the operator may override), so read a file-order question against the score before calling it an inversion. Weights, formula and range are documented once in [triage.md → Scoring rubric](noldor/triage.md#scoring-rubric); the implementation is [`scoreEntry()`](../src/triage/score.ts).

An entry may declare dependencies with a `- blocked-by: <slug|Q-id, …>` bullet (comma-separated) — the entries this work waits on. It feeds dependency-weight scoring, and `validate:triage` flags refs that resolve to no known entry (`unknown-blocked-by-ref`; advisory, error under `--strict`) while `/noldor-garden` flags circular chains. `- deps:` is the legacy alias, still accepted during the migration window and unioned with `blocked-by:`; prefer `blocked-by:` in new entries.

> **Routing policy — prep scales with `size:`. Don't spec the small ones.**
>
> - **XS / S** → no spec, no plan. `/noldor-gate` routes these to `fast-track` (code) or `micro-chore` (pure-doc) and retires the entry on ship — the drain-runner's bread and butter.
> - **M** → `specs-only` (spec, no plan).
> - **L / XL** → `full` (spec + plan), and only when there's real design risk — a mechanical L can still fast-track.
>
> Encoded once in [`sizeToPath()`](../src/core/size-routing.ts); `/noldor-gate` Step 0 surfaces the verdict as each entry's `suggestedPath`. Full matrix in [complexity-gating.md](noldor/complexity-gating.md).

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

### Docs Link Gate Is Red and Blind to Design Artifacts

- id: Q-0098
- area: docs
- type: fix
- since: 2026-08-12
- size: S
- impact: high
- confidence: high

A fresh `pnpm noldor docs check` reports 15 markdown files with broken internal links, so the repo's own completion gate is red while build, typecheck, lint and the full test suite pass. The failures are mostly path-ownership drift after code moves (`src/features/feature-schema.ts` → `src/core/feature-schema.ts`, `src/cr/config.ts` and `review-profile.ts` → core), removed garden files, design artifacts archived without inbound-link rewrites, a missing `.claude/CLAUDE.md`, one bad skill-catalog anchor, a missing generated how-to index, and `docs/release-notes.md:117` walking one directory too far to `src/core/session.ts`. Repair through the doc-gardening and migration flow rather than blanket string replacement, then add relocation tests or link-rewrite tooling for source-module moves and design archival. Acceptance is a clean `docs check` from a fresh checkout plus targeted assertions that the relocated targets resolve. Do not paper over historical links by creating fake compatibility files.

- Settle the checker's blind spot in the same pass, because widening coverage changes what the repair has to fix: `src/docs/docs-check.ts:8` puts the bare directory name `design` in `EXCLUDED_DIRS`, so the walk skips both active `docs/design/specs/` and `docs/design/plans/` and their archives, while the script catalog claims the input is the whole `docs/` tree. A direct check of the 11 active non-archive design documents found 13 broken links in `2026-07-15-registry-distribution-for-the-noldor-package-public-npm-cutover-design.md` that the normal command stays silent about. Archives may intentionally preserve old locations — dropping the exclusion outright would surface roughly 195 findings across 32 archived files — so make the policy path-specific: validate active specs and plans by default, decide and document whether archives are exempt or reported separately, and never use a basename exclusion that can suppress an unrelated nested `design/`.

(confirmed by fresh docs-check run and direct checker invocation in the read-only audit 2026-08-12)

### Codex Lane Cannot Review Code

- id: Q-0099
- area: tooling
- type: fix
- since: 2026-08-12
- size: S
- impact: high
- confidence: high
- parent: specs-cr-gate-multi-reviewer

`src/cr/lanes/codex.ts:58` maps `kind === 'spec' ? '--spec' : '--plan'`, so `--kind code` passes `--plan` with a source path and `runPlanReview` applies plan-review heuristics to TypeScript. Observed by opting codex into the code stage while shipping Q-0089: it returned five high "blockers" complaining that `src/cr/codex-spawn.ts` lacks an explicit goal, scope, affected files, implementation steps, TODO checklist and output location, and labelled every finding's file `Plan to review`. Not review output at all. This is the live blocker behind Q-0091 — wiring codex into `crLanes.code` today yields nonsense on every run. Fix: give the lane a code path that builds a diff context the way `buildContext` does for the gate lane and passes the code-review prompt (`run-codex.ts` already carries `CodeReviewCtx` for exactly this), rather than falling through to `--plan`. The deeper seam is Q-0112. (surfaced shipping Q-0089)

### CR Aggregate Reads a Missing Sink as Green

- id: Q-0100
- area: tooling
- type: fix
- since: 2026-08-12
- size: S
- impact: high
- confidence: high
- parent: specs-cr-gate-multi-reviewer

`cr aggregate` discovers sinks by listing `.noldor/cr/` and prefix-matching (`src/cr/aggregate.ts:36-40`) and holds no expected-lane set, so a lane that never wrote a sink is invisible rather than `unresolved` — that list is only populated for a sink that exists and lacks `finishedAt` (`aggregate.ts:107`). With no other blockers, `ok: blockers.length === 0 && unresolved.length === 0` is therefore true, and a lane killed before it could write is indistinguishable from a lane that passed. Affects every lane and every kind. Fix: pass `aggregate` the lane set orchestrate resolved, and report a missing expected sink as `unresolved`. The deeper seam is Q-0112. (surfaced designing Q-0089)

### Package Engines Runtime Floor

- id: Q-0101
- area: tooling
- type: chore
- since: 2026-08-12
- size: XS
- impact: med
- confidence: high
- parent: registry-distribution-for-the-noldor-package

README and the adoption guide require Node 20 or newer and pnpm 9 or newer, and runtime source uses modern methods such as `toSorted`, but `package.json` carries no `engines` field — only `packageManager: pnpm@9.7.1`, which gives no install-time compatibility warning. Consumers on older Node install successfully and fail later inside a gate, hook, or release command. Add precise `engines.node` and, if the floor is genuinely enforced, `engines.pnpm`; make CI test the minimum version rather than only a newer development version; decide whether `engine-strict` belongs in the templates or whether warnings serve adoption better. Acceptance: packed-package metadata carries the declared floor, install under the minimum supported Node succeeds, and a below-floor fixture produces the intended deterministic warning or failure before Noldor executes. (confirmed by package/README contract comparison in the read-only audit 2026-08-12)

### Dashboard Roadmap-Add Route Writes Invalid Entries

- id: Q-0102
- area: tooling
- type: fix
- since: 2026-08-12
- size: XS
- impact: med
- confidence: high
- parent: project-tracking-dashboard

`buildRoadmapBlock()` emits area, type, since, size, impact and body but never a stable `- id:`; `handleAdd()` treats type, size and impact as optional, and `src/dashboard/__tests__/api-blocks.test.ts:407-410` explicitly blesses a bare roadmap block containing only area and since. In any consumer with `.noldor/id-counter.json`, `validate triage` requires an ID on every queue entry and roadmap validation requires type, size and impact, so those writes land already-invalid. The UI add forms were removed, but `src/dashboard/server.ts:239-240` keeps the unauthenticated loopback route callable, so scripts and stale clients can still corrupt queue validity. Make the product decision explicit: delete the dead route and its tests, or route it through the same ID allocator, required-field schema and strict validation that triage and promotion use. Acceptance submits the minimum accepted payload through the HTTP handler and then runs `validateTriageInputs` with `strict: true, counterExists: true` on the written file, expecting zero errors; parallel adds must also prove ID uniqueness. (confirmed by cross-checking writer and validator contracts in the read-only audit 2026-08-12)

### Diff-Scoped Clone Gate Flags Mere Adjacency

- id: Q-0095
- area: tooling
- type: fix
- since: 2026-08-12
- size: S
- impact: high
- confidence: high
- parent: code-clone-detector

`flaggedGroups` ([`src/clones/diff-scope.ts:187`](../src/clones/diff-scope.ts)) reds when **any single instance of a clone group overlaps a changed line at all**, so a three-line graze counts the same as writing the whole copy. Against the module's own stated intent ("did you just write a copy of something that already exists?") that is a false positive, and it fired three times in one session: a one-line `desc:` edit inside the `src/cli/manifest.ts` data table (Q-0094, which had to abandon the edit and ship `noldor help` stale); three added import lines landing inside an import block that matches `src/cr/lanes/verify.ts`; and the tail of a newly inserted function abutting the lane sink-path prologue in `src/cr/lanes/subagent.ts`. Registering a CLI subcommand necessarily edits the manifest table, so the gate blocks a whole class of legitimate change with no ignore knob and no per-finding override — the author-side-rule-injection PR had to push with `LEFTHOOK_EXCLUDE=noldor-clones`.

**The naive fix is wrong**: requiring ≥2 overlapping instances would break the primary case, since pasting an existing block into a new file changes exactly one instance. The predicate needs to be coverage-based — flag when changed lines cover a substantial fraction of some instance, so "I wrote this copy" fires and "my edit abuts a pre-existing clone" does not. Pick the threshold against the three recorded cases (37%, 25%, ~55% coverage) plus a real paste (100%). Worth considering alongside: an inline `// noldor:clone-ok <reason>` marker for the irreducible cases (data tables, import blocks), mirroring how `noldor:cut` waives minimalism findings.

### PR Summary Rule: Why, How, What

- id: Q-0103
- area: tooling
- type: feat
- since: 2026-08-12
- size: XS
- impact: med
- confidence: med
- parent: rules-cascade-v1

Nothing states what a PR summary has to contain, so summaries drift between a bare changelog and a design essay. Add a cascade rule requiring the why before the how before the what, and requiring each to land in both technical and non-technical register — the reviewer needs the mechanism, the operator reading release notes needs the plain-language reason. Scope it to the PR-body seam (`pr-flow`) rather than to commit messages, which `noldor-scope` and the trailer contract already govern.

### Dashboard Docs-Flag Path Contract

- id: Q-0104
- area: tooling
- type: fix
- since: 2026-08-12
- size: S
- impact: med
- confidence: high
- parent: project-tracking-dashboard

`README.md:34` publishes `pnpm noldor dashboard server --port 4321 --docs ./docs`, and the original extraction design describes the flag as a docs-directory override containing `roadmap.md`, `features/` and `milestones/`. `setDocRootsOverride()` still stores that value as `getDocRoot()`, but `loadDocRoots(cwd)` now treats its argument as a repository root and appends `docs/` (`src/core/doc-roots.ts:47-56`), so the documented command resolves `docs/docs/roadmap.md`, and a focused `setDocRootsOverride('./docs')` followed by a roadmap load fails with ENOENT. Pick and name one contract: keep `--docs <docs-directory>` and teach the dashboard adapter not to append `docs`, preserving the published command and the historical design, or replace it with `--root <repository-root>` and migrate README, help and tests. Acceptance must exercise the packaged CLI against a scratch consumer whose repository root and docs directory carry distinguishable sentinel content — parsing the flag alone proves nothing. (confirmed by runtime probe and design-history comparison in the read-only audit 2026-08-12)

### Milestone YAML Scalar Writer Emits Unreadable Frontmatter

- id: Q-0105
- area: tooling
- type: fix
- since: 2026-08-12
- size: S
- impact: med
- confidence: high
- parent: decouple-milestones-from-semver

`yamlScalar()` quotes only characters such as colon, hash, braces, brackets and quotes, but YAML implicit scalars also cover booleans, null, numbers and multiline values. Reproduced in a temp consumer: `draftMilestone('true', 'false')` writes `name: true` and `description: false`, and `loadMilestones()` then reports both fields as booleans where `milestoneFrontmatterSchema` requires strings. A shell argument containing a real newline can also inject malformed or additional frontmatter, since newline is neither quoted nor normalized. Stop hand-serializing YAML: adopt the same serializer and parser policy the other frontmatter uses, or implement a scalar encoder proven against the full YAML 1.2 implicit-type set and control characters. Regression matrix: `true`, `false`, `null`, numeric-looking text, dates, leading hyphen, hash, colons, quotes, backslashes, newlines — each must round-trip byte-exact through draft, read and validate. (confirmed by runtime probe in the read-only audit 2026-08-12)

### Dashboard Favicon Shows the Project Initial

- id: Q-0106
- area: tooling
- type: feat
- since: 2026-08-12
- size: XS
- impact: low
- confidence: high
- parent: project-tracking-dashboard

The dashboard favicon renders a literal `N` in every consumer, so two dashboards open in adjacent browser tabs are indistinguishable — exactly the case the multi-project adoption goal makes routine. Derive the glyph from the consumer's own project name (first letter) instead of hardcoding the framework's initial.

### Attach Retires an Entry ID and Leaves Dangling Refs

- id: Q-0107
- area: tooling
- type: fix
- since: 2026-08-12
- size: S
- impact: med
- confidence: med
- parent: stable-entry-ids-for-roadmap-backlog

`pnpm noldor validate triage` exits 0 with an advisory that Q-0091 declares `blocked-by: Q-0089` while no roadmap entry, backlog entry, feature slug or feature `entry-id` resolves that reference. The cause is structural, not a typo: Q-0089 was retired into the `specs-cr-gate-multi-reviewer` attach session (`docs/design/specs/archive/2026-08-11-specs-cr-gate-multi-reviewer-codex-headless-dispatch-design.md`), and attach removes the queue block without carrying its ID into the parent FD frontmatter — so every reference to an attached entry dangles permanently. That spec's D9 asked whether removing the Q-0089 block strands Q-0091 and answered no; the validator now disagrees. Give attach a durable forwarding record (carry the ID into the parent FD, or keep a retired-ID map), repair the live ref — Q-0091's real blocker is now Q-0099 — and make self-host CI strict on unknown refs even while consumer validation stays advisory by default. (confirmed by fresh triage validation in the read-only audit 2026-08-12)

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

### Doctor Ahead-Anchor Dead End

- id: Q-0082
- area: tooling
- type: fix
- since: 2026-08-10
- size: S
- impact: med
- confidence: med
- parent: version-aware-upgrade-and-migration-chain

`doctor`'s framework-skew check compares the anchor by string `!==` (`src/cli/commands/doctor.ts:63`), so an anchor _ahead_ of the installed version prints `run 'noldor upgrade'` forever while `upgrade` correctly refuses to rewrite it backwards — an advisory dead end with no CLI exit, the same shape as Q-0076 in the opposite direction. Reachable after a downgrade (`pnpm add @david.zoufaly/noldor@<older>`) or a hand-edited anchor. Fix: compare with `semver.lt(anchored, installed)` and give the ahead case its own message (`anchored <a> is ahead of installed <i> — the install is behind, not the anchor`) rather than pointing at a command that cannot help. (surfaced in the code-stage CR of Q-0076, PR #270)

### Triaged-Bullet Archive Section

- id: Q-0090
- area: tooling
- type: feat
- since: 2026-08-11
- size: XS
- impact: low
- confidence: med

Triaged bullets should stay in `ideas.md` for traceability but drop out of the live phase sections into their own heading, so a `#### Later` scan shows only what is still raw instead of a mixed pile where every stamped bullet has to be skipped by eye. Have `/noldor-triage` relocate a bullet under a dedicated archive heading as it stamps `[triaged … → slug]`. Adjacent seam worth settling in the same pass: the `extractUntriagedBullets` JSDoc (`src/triage/triage-list-untriaged.ts`) already documents skipping `## Not groomed` as deliberate ("not triage material"), yet the 2026-08-11 batch triaged six bullets straight out of that section and had to scan it by hand — so practice contradicts the recorded decision. Reconcile the two in prose: either the section is a staging area `list-untriaged` should surface, or operators must park raw bullets under a phase heading instead. No parser change is implied by this entry; if the resolution turns out to need one, split it out.

### Oversize Task Split: Which Phase Owns It

- id: Q-0108
- area: tooling
- type: feat
- since: 2026-08-12
- size: M
- impact: high
- confidence: low
- parent: framework-auto-split-suggestion-for-big-features-and-plans

Split-check flags an oversize feature or plan, but nothing says at which phase the split should actually happen — triage, promote, spec, or plan — so an L/XL entry can travel the whole pipeline intact and only get decomposed once an agent is already holding the largest possible context. The goal is the inverse: work with the smallest context that can still ship a slice. Settle where the decomposition belongs, what it produces (sibling queue entries, attach children, or plan-level tasks), and how the pieces stay traceable to the original entry ID. Confidence is low because the phase choice is the actual design question, not an implementation detail.

### Repository Mutation Module

- id: Q-0109
- area: tooling
- type: refactor
- since: 2026-08-12
- size: L
- impact: high
- confidence: med

Durable read-modify-write transitions are scattered across dashboard queue routes, core state writers, CR JSON writers, milestone activation and roadmap/backlog movement, and they disagree on temp-name uniqueness, serialization, schema checks, multi-file recovery and concurrency — "atomicity" is a temp-file helper re-derived at each call site. Deepen one module that acquires repository- and file-scoped serialization, re-reads and compares expected state inside the critical section, computes the transition without side effects, validates successor invariants, persists with unique temp files, and recovers or rolls back multi-document transitions after interruption; adapters keep the domain-specific transforms for queues, milestones, sessions and review sinks. **Leverage:** the three confirmed symptoms below close through one seam. **Deletion test:** callers lose their own ETag choreography, temp naming, sequential multi-file write blocks and manual `git restore` recovery hints. **Risk:** a global lock would be shallow and would needlessly serialize independent repositories and files — scope the locking and the crash recovery deliberately. Start with queue and milestone mutations where the correctness benefit is measurable, and migrate state files only when the semantics match.

- Dashboard queue writes have a reproducible lost-update race despite advertising optimistic concurrency through `If-Match`. Every mutator in `src/dashboard/api/blocks.ts` does read, sha256 and If-Match check, transform, then `atomicWriteFile`, with no critical section — so two requests read the same contents, both pass the same ETag, and both prepare different successor states. `src/dashboard/api/atomic.ts:17` makes it worse by always using a temp name of the form basename plus `.tmp.` plus the process pid, so every concurrent write in one dashboard process targets the same temporary file. Launching two `handleMove` calls concurrently with the same valid ETag ended, in all 50 trials, as one 200 plus one thrown ENOENT from `rename`, with the final file retaining a single user action. A unique temp suffix stops the ENOENT but not the stale overwrite: compare and write must become one serialized operation per target file, with the re-read and ETag recheck inside it. Regression tests need a barrier that makes two calls pass the initial read simultaneously, then assert exactly one 200, exactly one 412, no thrown filesystem error, no leftover temp file, and no silent loss. (confirmed by runtime probe)
- Roadmap and backlog promotion/demotion can leave queue state half-applied by design. `crossSection()` (`src/dashboard/api/blocks.ts:329-357`) removes the block from the source with an atomic rename and then writes the destination; if the second write fails, the entry is already gone, the route returns 500 and logs `git restore docs/roadmap.md docs/backlog.md`, which also discards unrelated concurrent edits and is not a transactional recovery mechanism. The combined ETag stops some stale clients but does not make two renames atomic, and the lost-update race can interleave further mutations between them. Needs a recoverable multi-document transition: serialize queue mutations, precompute and schema-validate both successor files, persist enough journal or backup information to finish or roll back after any failure, and expose success only once both documents represent the same transition. Inject failures before and after each durable step, then prove an entry is never missing from both files nor duplicated in both after recovery. (confirmed by failure-path inspection)
- Milestone activation is documented as atomic but performs three ordinary sequential writes. `activateMilestone()` (`src/milestones/lib.ts:149-167`) preflights, writes the target `status: active`, writes vision's `current-milestone`, then writes the prior active milestone as `shipped` — no temp and rename, no journal, no rollback, no post-write validation. Failing at step two leaves an active milestone invisible to vision; failing at step three leaves two active milestones. Separately, an already-active target returns at line 155 before ensuring vision points at it, so `noldor milestone activate foo` can print success while the dashboard still shows no current milestone. Model activation as a pure transition plan plus one recoverable multi-document application, and make idempotent re-activation repair all derived state. Fault-injection tests must fail each durable step, reopen the repository as a fresh process would, run recovery, and assert exactly one active file with vision pointing at it. (confirmed by code inspection and temp-consumer probe)

(architecture candidate, Strong recommendation from the read-only audit 2026-08-12)

### Repository Context and Snapshot Module

- id: Q-0110
- area: tooling
- type: refactor
- since: 2026-08-12
- size: L
- impact: high
- confidence: med
- parent: project-tracking-dashboard

`src/dashboard/data.ts` is 2,533 LOC and mixes module-global override state, document paths, cwd-relative scanners, git subprocesses, graph and package discovery, parsing, and page-specific aggregation. `handleOverview` concurrently invokes loaders that reload features and rescan repository state several times, so one response can be slow and internally inconsistent even without `--docs`; the git timeout increase after hot zones blanked under load was a symptom. Deepen an immutable repository context that anchors every adapter to one resolved root and exposes a coherent snapshot of docs, configuration, scan roots, git identity and history, and traceability inputs for a request or report run. **Leverage:** mixed-root results disappear, two-dashboard execution becomes truthful, duplicate IO and git processes drop, and tests gain deterministic injected snapshots. **Deletion test:** remove `docRootsOverride`, the dashboard `process.cwd()` literals, the default-cwd milestone and git calls, the repeated `loadFeatures()` within one page, and the dashboard-specific reconstruction of SDD input. Preserve streaming and refresh behaviour with an explicit snapshot lifetime rather than an unbounded global cache.

- The confirmed symptom: even reinterpreting `--docs` as a repository-root override (Q-0104) leaves the dashboard building mixed-repository views, because many loaders ignore it. `loadSddInput()` (`src/dashboard/data.ts:1124-1177`) hardcodes `docs/features`, `ideas.md`, `docs/backlog.md`, the design dirs, README, the graph path and the scan roots; `scanRoots()` and `actualPackageNames()` default to cwd; git helpers run without an override-aware `cwd`; milestone groups call `loadMilestones()` and `loadMilestoneBySlug()` with their defaults; feature-body VS Code link rewriting uses `process.cwd()`. Setting the dashboard root to `/private/tmp/not-the-cwd` and calling `loadSddInput()` still returned this checkout's 75 features, `graphify-out/graph.json` and `src` scan root. The failure mode is worse than a clean error: counts, gaps, git activity, milestone state and documents can silently describe different repositories on one page. Test with two complete fixtures whose feature counts, git histories, package layouts and milestone names are deliberately incompatible, and assert no value from fixture A appears while rendering fixture B. (confirmed by runtime probe)

(architecture candidate, Strong recommendation from the read-only audit 2026-08-12)

### Prose Rules → Enforce Cascade Rules

- id: Q-0069
- area: tooling
- type: refactor
- since: 2026-08-05
- size: M
- impact: med
- confidence: med
- parent: rules-cascade-v1

The dimensions that are prose-only today sit buried in a 181-line baseline: error flow (result types, throw only for programmer errors, catch external at the boundary, never swallow) is at line 137 and is machine-unchecked. Migrate them into scoped rule files — `.noldor/rules/error-result-types.md` with `applies-to: ["src/**/*.ts"]`, `stage: [code]`, `enforce: true` — so the rule lands in the enforce bucket exactly on the files being edited rather than in a wall of text the author has to filter mentally. Same treatment for state discipline and concurrency.

### Traceability Projection Module

- id: Q-0111
- area: tooling
- type: refactor
- since: 2026-08-12
- size: M
- impact: med
- confidence: med
- parent: feature-md-links-overhaul

Clone detection measured large repeated groups (roughly 223 and 216 tokens) across `sync code-links`, `sync test-links`, `sync doc-links` and `sync spec-links` — tag extraction, filesystem walking, slug grouping, feature-frontmatter loading, array comparison, writing, warnings and CLI summaries — while the behaviour has already diverged between them. Define one projection implementation around source adapters (tag syntax, eligible paths, destination `links.*` key) plus one policy for authoritative empty scans, cached-only slugs, unknown feature tags, deterministic sorting, dry/check/write modes and atomic validated frontmatter writes. **Leverage:** a fix to deletion, scan failure or reporting applies to every traceability kind at once. **Deletion test:** the three or four grouping loops, the `updateFeatureMd` copies, the independent walker exclusion sets and the inconsistent main/report code all go, leaving small readable adapters. Do not over-generalize code-sync's directory-entry preservation into every kind — make such differences explicit strategy data.

- The confirmed symptom: `sync doc-links` and `sync test-links` cannot clear a feature's last removed tag, so stale `links.docs` and `links.tests` survive forever. Both scanners build a map holding only slugs found in the fresh scan and then update only over that map's entries. While some tagged files remain, removed paths disappear correctly; when the last tag or the last tagged file goes, the slug drops out of the map and its cached frontmatter array is never visited. `sync code-links` already documents and implements the correct scanned-union-cached iteration plus an explicit empty-projection policy — that is the intended shape. Tests must start from one cached path, remove the final source tag, run sync, assert the array becomes empty, and prove a missing or unreadable scan root does not masquerade as authoritative emptiness. (confirmed by control-flow comparison)

(architecture candidate, Worth exploring from the read-only audit 2026-08-12)

### Mandatory Codex Review Round

- id: Q-0091
- area: tooling
- type: feat
- since: 2026-08-11
- size: S
- impact: med
- confidence: med
- blocked-by: Q-0089
- parent: specs-cr-gate-multi-reviewer

The codex lane is opt-in per `crLanes` today, so a big change can ship having been reviewed by exactly one model family. Require at least one codex round on bigger tasks — gate it on the same `size:` signal the routing policy already uses (L/XL, or the split-check verdict) rather than on operator memory. Blocked until the codex lane actually works headlessly again.

### Review-Run Lifecycle Module

- id: Q-0112
- area: tooling
- type: refactor
- since: 2026-08-12
- size: L
- impact: med
- confidence: med
- parent: specs-cr-gate-multi-reviewer

Expected work, process ownership, bounded output, sink persistence and aggregation have no shared source of truth: orchestrate resolves lanes but aggregate later rediscovers only existing filenames (Q-0100), the codex lane shells through pnpm and owns neither the grandchild process group nor a bounded stream, code/spec/plan dispatch mode is inferred in a lossy ternary (Q-0099), and feature capability is guessed by shelling out to intercepted help. Record a run manifest before dispatch carrying expected lanes, kind, artifact and base; let one process owner handle timeout, signal and group cleanup plus capped diagnostics; write every terminal outcome to an expected sink; aggregate against the manifest rather than directory contents. **Leverage:** missing lanes become explicit red, timeouts cannot burn quota invisibly, code cannot fall into plan heuristics, and delta review stops depending on help prose. **Deletion test:** filename discovery as the expected-set oracle, `codexSupportsBaseSha`, nested pnpm timeout ownership, per-lane error-shape normalization and the duplicated process-kill implementations all go; lane adapters keep only prompt and result semantics.

- `codexSupportsBaseSha()` can never return true, so codex artifact review is always full-scope. It runs `pnpm --silent noldor cr codex --help` and greps for `--base-sha`, but the dispatcher intercepts `--help` first (`src/cli/help.ts:25` prints a one-line usage plus the manifest desc and returns), so the detailed usage string in `src/cr/codex.ts` — which does list `--base-sha` — is unreachable and `runCli`'s `inv.help` branch is dead code. Measured: the probe exits 0 in 307 ms with zero matches, every run logs the unsupported-fallback line, and `baseSha` never lands in a sink. This is the live mechanism behind Q-0089's symptom (a); that spec's account of a bad sha throwing in `git diff` is true but describes a different path. The correct fix touches the shared CLI help surface (Q-0115) or replaces the grep with a version check.
- The codex CR lane orphans codex when the outer `execFile` cap fires. The lane shells out through `pnpm`, and `execFile`'s timeout signals only its direct child, so the codex grandchild survives, runs to self-completion and burns ChatGPT quota — unattended, in drain mode. Codex-specific: `reviewer` and `verifier` dispatch through `spawnAgent` (`subagent-dispatch.ts:137`, `verify-dispatch.ts:74`), which already spawns detached and group-kills. Three CR rounds on Q-0089 established that an inner cap inside `spawnCodex` drags in a kill path, detached spawning, a Ctrl-C signal reaper and two out-of-process fixture harnesses; routing this lane through `spawnAgent` like the other two is the likelier shape than a second kill implementation.
- `spawnCodex` accumulates stdout and stderr unbounded in memory. Fine for codex's measured 326 KB, but a runaway child could grow the node heap without limit, and the bounding that exists (`formatStderrTail`, 4000 chars) applies only to what reaches the sink. No measured case yet — the outer `execFile` stopped bounding it once the inner spawn took ownership of the streams — so cap it when the lifecycle owner lands.

(architecture candidate, Strong recommendation from the read-only audit 2026-08-12)

### Queue-Document Grammar Module

- id: Q-0113
- area: tooling
- type: refactor
- since: 2026-08-12
- size: L
- impact: med
- confidence: med

Queue semantics are spread across `src/utils/parse-blocks.ts`, `src/utils/write-blocks.ts`, the dashboard block scanners and writers, triage's `pushEmptyGroupIssues`, next-priority and route-specific description sanitization, and each implementation recognizes a slightly different subset of headings, fences, fields, categories and duplicates. Deepen one grammar that parses and serializes schema-C markdown once, owning entry and group recognition, the canonical field vocabulary, stable IDs and dependencies, exact source spans, comment and body preservation, and serialization; read adapters project roadmap and backlog models, write adapters do range-based insert, move and remove against the same parse. **Leverage:** parser and writer can no longer disagree, and every mutation runs the same strict invariant before persistence. **Deletion test:** the duplicate fence toggles, field regex construction, heading split scans, `countEntries` and `scanBlocks` structure guesses and most route sanitization all go. Preserve untouched formatting outside modified ranges — full-document pretty-printing would create noisy queue diffs and destroy locality.

- The confirmed symptom: queue parsing and docs-link checking implement an incomplete fenced-code grammar, recognizing triple backticks but not CommonMark/GFM tilde fences or varying fence lengths. A roadmap holding a tilde-fenced block that contains `### Phantom` plus `- area: tooling`, followed by a real entry, parses as two entries; a markdown link inside that same tilde fence is extracted as a live internal link by `docs-check`. This can fabricate queue entries and dependencies, make writers remove or reorder example text, and produce false broken-link failures. Because `parseRoadmap`, `parseEntries`, `pushEmptyGroupIssues` and `stripCodeRegions` each toggle independently on a triple-backtick prefix, patching one leaves semantic drift. One fence scanner must understand marker character, opening length, up-to-three-space indentation, info strings and a closing fence of sufficient length. Paired fixtures: backticks and tildes, three- and four-character fences, embedded shorter runs, indented fences, unclosed fences. (confirmed by pure-function runtime probe)

(architecture candidate, Worth exploring from the read-only audit 2026-08-12)
