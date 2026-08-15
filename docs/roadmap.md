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

### Bounded CR Re-Rounds: Design-Only Blockers and a Round Cap

- id: Q-0130
- area: tooling
- type: fix
- since: 2026-08-15
- size: S
- impact: high
- confidence: high

The artifact-stage address-blockers loop has no termination rule: `cr orchestrate` exits 1 on ANY blocker, so a `[med]` wording nit forces the same fix-commit-re-review cycle as a design flaw, and delta review of freshly written prose near-guarantees a new finding — each fix is new surface, so the loop self-feeds. Q-0112 spec: rounds 1–3 caught real design flaws, rounds 4–11 were document self-consistency findings seeded by the previous round's fix. Precedent: Q-0073 = 14 rounds, Q-0078 = 11, Q-0124 = 10 ("never fully clean"). The reviewer already tags every blocker `[mechanical]`/`[design]` and autofix already caps at 2 rounds — the manual loop uses neither. Fix: only `[design]`-tagged blockers trigger a re-round; mechanical/wording findings are fixed-and-proceed (the next stage catches regressions); hard cap of 2–3 artifact-stage rounds mirroring autofix's, after which the remaining tail goes to the operator as one batched decision instead of round-by-round. Skill prose first; optional `crReview.maxArtifactRounds` knob later.

### Spec Size Governor

- id: Q-0131
- area: tooling
- type: feat
- since: 2026-08-15
- size: S
- impact: med
- confidence: high
- parent: framework-auto-split-suggestion-for-big-features-and-plans

split-check governs entries (`--entry`), FDs (`--fd`) and plans (`--plan`) but not specs — so Q-0112's spec grew to 677 lines with 22 acceptance criteria, and its self-consistency surface (criteria vs prose vs resolved-questions drift) generated most of an 11-round review tail. Add a `--spec` signal (word count + acceptance-criteria count thresholds), and teach the noldor-spec skill three rules: acceptance criteria pin behavior, not phrasing; budget ~12 criteria; never write review-history meta-narrative into the artifact (it is pure liability surface — Q-0112's spec narrated its own rounds three times and got flagged for it).

### Re-Round Reviewer Context

- id: Q-0132
- area: tooling
- type: feat
- since: 2026-08-15
- size: M
- impact: med
- confidence: med

Every delta re-round dispatches a stateless reviewer with no memory of prior rounds, so it re-litigates settled calls and proposes fixes already falsified by the content (Q-0112 round 12 suggested grep matchers the docblocks defeat, which then had to be corrected in yet another commit). Fix: orchestrate appends the prior sink's findings and their recorded resolutions to the delta-review prompt, so the fresh reviewer sees what was adjudicated and why before it flags. Touches: src/cr/orchestrate.ts, src/cr/lanes/subagent-dispatch.ts

### Consumer Architecture Doc Surface

- id: Q-0093
- area: docs
- type: feat
- since: 2026-08-11
- size: M
- impact: med
- confidence: low

Consumers get feature MDs, specs, and plans but no architecture surface — no place that answers "how is this system shaped" above the per-feature level. Idea: a dedicated folder of architecture file(s) in the consumer doc tree, with diagramming. Needs a scoping spike before promotion: whether the content is hand-authored or derived from the graphify AST graph (which already has communities and edges), whether the diagrams are generated or drawn, and how the surface avoids becoming the stalest page in the tree.

- The same gap holds for Noldor itself, and the scoping spike should decide whether one surface serves both or whether framework-internal architecture is a separate promotable item. The repo has rich feature docs and 107 design artifacts but no root `CONTEXT.md`, no module map and no `docs/adr/`, so maintainers and agents infer current architecture and rationale from 47k runtime LOC plus historical specs whose links are already stale (Q-0098). That makes unusual but intentional constraints — source-at-runtime packaging, adoption-safe advisories, sequential queue writes, graph fallbacks — read as accidental bugs, while genuine cross-module seams such as repository mutation (Q-0109) and snapshot ownership (Q-0110) stay implicit. Wanted: a concise current map in the project's own domain vocabulary showing major modules, dependency direction, durable state, entry points, and where each decision record lives, plus ADRs for active consequential choices rather than backfilled history. Deletion test: a new reader should not have to traverse archived plans to answer "which module owns repository paths, writes, and review completion?" (architecture candidate, Worth exploring from the read-only audit 2026-08-12)

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

- One concrete state-discipline rule the migration should carry, earned over 14 CR rounds on Q-0073 (PR #268): the first cut of finish-mode kept a `finishable` Set that had to be mutated at every ship, skip, merge, retry and timeout leaf, and rounds 5, 10, 11 and 13 each found a different missed `delete`. Replacing it with a verdict recomputed fresh immediately before each spawn (`resolveFinishPrompt`) made the whole class of finding vanish with all 215 autonomous tests passing unchanged. State the rule as "prefer a recomputed decision over maintained state whenever the state has many mutation sites", and pair it with the reviewer-side reading: four rounds of "you missed another unwind" is the reviewer circling a design smell, not four separate bugs.

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
- blocked-by: Q-0099
- parent: specs-cr-gate-multi-reviewer

The codex lane is opt-in per `crLanes` today, so a big change can ship having been reviewed by exactly one model family. Require at least one codex round on bigger tasks — gate it on the same `size:` signal the routing policy already uses (L/XL, or the split-check verdict) rather than on operator memory. Blocked until the codex lane actually works headlessly again.

### Codex Lane Misreports a Model-Version 400 as Expired Auth

- id: Q-0125
- area: tooling
- type: fix
- since: 2026-08-14
- size: XS
- impact: med
- confidence: high
- parent: specs-cr-gate-multi-reviewer

The codex CR lane diagnoses a failed run as an auth problem regardless of what the API actually rejected, so a model-version error sends the operator to re-authenticate a session that never expired. Measured: `codex-cli 0.133.0` against a configured `gpt-5.6-sol` returns `400 invalid_request_error` carrying "The 'gpt-5.6-sol' model requires a newer version of Codex", and the lane reports `auth looks expired; run: codex login`. Parse the 400 body, or at minimum stop asserting auth whenever the payload names a model. Operator workaround today is `codex exec -c model=gpt-5.5`. The eventual home is Q-0112's per-lane error-shape normalization, which deletes this call site outright — queued standalone because that is an L entry and this is a fast-track-sized correction to a message the operator acts on immediately. (found 2026-08-14 running the codex lane on Q-0124)

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

### Queue-Drain Selection and Staleness Guards

- id: Q-0121
- area: tooling
- type: feat
- since: 2026-08-12
- size: XS
- impact: med
- confidence: high
- parent: autonomous-queue-drain-runner

A drain cannot see uncommitted triage: children branch from `origin/main`, so roadmap blocks that exist only in the local working tree are invisible to them while the supervisor's own eligibility read (the local tree) lists them happily. The failure mode is a child that finds no block to implement and a `remove-block` that no-ops — a full agent run burned on nothing. `queue-drain` can assert this cheaply: compare its selected entry set against `git show origin/main:docs/roadmap.md` and abort with `N entries not on origin/main` before spawning anything. (surfaced draining the 2026-08-12 XS batch)

- The same command's missing selection lever: `autonomous queue-drain` has no size filter. `--max-features` takes top-N in priority ORDER and eligibility is fast-track = XS **or** S, so "ship only the XS ones" is not expressible when XS entries sit below S entries in the queue. The 2026-08-12 batch had to bypass the supervisor entirely and spawn `claude --print "/noldor-gate --drain <slug>"` per slug (`NOLDOR_DRAIN=1`, `--disallowed-tools AskUserQuestion`, `--permission-mode bypassPermissions`), forfeiting the retry, skip, lock and escalation machinery. A `--size XS` and/or `--only <slug,slug>` flag makes the supervisor usable for a filtered batch. (surfaced draining the 2026-08-12 XS batch)

### Roadmap Has-Block Predicate

- id: Q-0119
- area: tooling
- type: feat
- since: 2026-08-12
- size: XS
- impact: med
- confidence: high
- parent: stable-entry-ids-for-roadmap-backlog

An entry's slug is `slugify(heading)` (`src/utils/parse-blocks.ts`) and never appears literally in the document, so any "is this entry still queued?" check written as `grep -q "$slug" docs/roadmap.md` returns FALSE for every live entry — and it fails silently in the safe-looking direction ("already shipped, skip"). It bit a hand-rolled XS drain runner into skipping all 6 eligible entries in 5 seconds with a clean exit, and it is the same root cause as the CR blocker on the 2026-08-12 triage commit, where 12 `[triaged → slug]` markers named shorthand slugs resolving to no block. Expose `pnpm noldor roadmap has-block <slug>` (exit 0/1, honouring the ID alias) so scripts and skills stop re-deriving the predicate, and point the docs at it wherever a slug-presence check is described. (surfaced draining the 2026-08-12 XS batch, PRs #297-#303)

### Main-Module Guard Fails on Percent-Encoded Paths

- id: Q-0126
- area: tooling
- type: fix
- since: 2026-08-14
- size: M
- impact: high
- confidence: med

35 module entrypoints gate their CLI body by comparing `import.meta.url` against a hand-built string of `file://` concatenated with `process.argv[1]`. That comparison is false whenever the repository path needs percent-encoding — one space in a directory name is enough — so the module exits 0 having run nothing, with no diagnostic. For the hook and validator entrypoints among them, that is a silently disabled gate: the framework reports success precisely when it checked nothing. `src/core/validate-summary-body.ts:380` and `src/hooks/noldor-pre-push.ts:164` already use the correct `pathToFileURL(process.argv[1] ?? '').href` form; sweep every remaining site to it.

- Confirmed call sites — all 35, measured by grepping `src/` for the literal comparison on 2026-08-14. **`src/hooks/` (6, the material cluster — these are the gates):** `noldor-pre-commit.ts`, `noldor-validate-trailer.ts`, `noldor-inject-trailers.ts`, `noldor-enforce-review-receipt.ts`, `noldor-pre-edit-guard.ts`, `agent-rules-guard.ts`. **`src/worktrees/` (6):** `create-worktree.ts`, `down-worktree.ts`, `up-worktree.ts`, `launch-worktrees.ts`, `worktree-conflicts.ts`, `worktree-status.ts`. **`src/core/` (6):** `validate-noldor-scope.ts`, `validate-noldor.ts`, `validate-skill-catalog.ts`, `changelog.ts`, `rename-plan-only-tier.ts`, `pr-flow-cli.ts`. **`src/rules/` (3):** `cli-list.ts`, `cli-resolve.ts`, `cli-validate.ts`. **`src/features/` (3):** `fill-links-code-gaps.ts`, `migrate-changelog-unreleased.ts`, `migrate-fd-commits-to-prs.ts`. **`src/checks/` (2):** `check-template-sync.ts`, `check-shared-files.ts`. **`src/cr/` (2):** `orchestrate.ts`, `codex.ts`. **`src/design/` (2):** `context-cli.ts`, `log-cli.ts`. **Singles:** `src/triage/validate-triage.ts`, `src/cli/validate-script-catalog.ts`, `src/milestones/validate-milestones.ts`, `src/prep/print-format.ts`, `src/release/index.ts`.
- Two shape variants, one defect: `src/core/rename-plan-only-tier.ts:109` interpolates a destructured `argv[1]` and `src/milestones/validate-milestones.ts:61` assigns to a `const isMain` rather than branching inline. Both are the same template bug — do not read them as a second class.
- The regression test wants a fixture checkout whose path contains a space, asserting each swept entrypoint still executes its body — a unit test on the comparison helper alone would not have caught the class, since every site re-derives it inline.
- Sized M rather than S because the sweep is 35 files, not the ~10 the original report named. The work is still mechanical (one-line replacement per site plus the shared fixture), so the routing note's "a mechanical L can still fast-track" reasoning applies — do not over-prep it on the size label alone. At `M/high/med` it scores 150, a tie with Q-0067 and Q-0127; the file position above them is operator discretion, not a scoring claim.

(found by the code-stage CR on Q-0124, 2026-08-13; scope re-measured 2026-08-14)

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

### Prefer Noldor Wait Over Harness Monitor Tools

- id: Q-0127
- area: tooling
- type: docs
- since: 2026-08-14
- size: XS
- impact: low
- confidence: med
- parent: noldor-native-wait-primitive

Nothing tells an agent to reach for the framework's own wait primitive, so a session running inside a harness that ships a generic monitor or polling tool suggests that instead, and `noldor wait` (PR #183) stays invisible at exactly the moment it applies. Record the preference where the agent actually reads it — a scoped rule under `.noldor/rules/` that lands on the relevant stage — rather than as prose in a guide nobody re-reads mid-task. The point is runner-independence: a harness-specific monitor tool is not available when the runner is codex or opencode, while the framework's primitive is.

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
