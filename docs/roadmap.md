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

### Release CR Gate Glob Union for Sweep Squashes

- id: Q-0164
- area: tooling
- type: fix
- since: 2026-08-23
- size: S
- impact: med
- confidence: high
- parent: release-bypass-retirement

The release CR gate makes `release.crGateExemptCommits` grow one entry per release. `checkCrGate` (`src/release/release-cr-gate.ts`) exempts a squash by path only when EVERY embedded `Noldor-Path` is exempt (correct — it stops a mixed squash laundering a feature commit), and its file fallback consults `isMicroChoreAllowed(files)` alone, never a sweep equivalent. But `ideas.md` sits in `BOOKKEEPING_GLOBS` and `MICRO_CHORE_GLOBS` while `graphify-out/**` sits only in `RELEASE_SWEEP_GLOBS` — so a sweep squash that carries any `ideas.md` capture alongside sweep output matches neither allowlist wholly and reds the gate. Hit on 2026-08-20 releasing v1.4.0: the sweep PR #354 squashed one micro-chore `ideas.md` commit with three release-sweep commits, and the only way through was a per-SHA waiver for a diff containing zero code. An `isMicroChoreAllowed(files) || isReleaseSweepAllowed(files)` OR does NOT fix it (each half of the diff fails the other predicate) — the fix is a union of the two glob sets for the fallback, or adding `ideas.md` to `RELEASE_SWEEP_GLOBS`. Deletion test: a sweep squash whose diff is entirely bookkeeping passes the gate without a config entry. (found 2026-08-20 by the CR reviewer on the waiver commit itself)

### Push-Gate Preflight Must Replay the Real Hook

- id: Q-0165
- area: tooling
- type: fix
- since: 2026-08-23
- size: S
- impact: med
- confidence: high
- parent: gate-flow-rework

The author-side push-gate preflight (gate Step 4, added by Q-0129 to stop receipt churn) does not actually replay the gate that fails. It prescribes `pnpm noldor clones check`, which exits 0 while lefthook's `noldor-clones` pre-push step reds on the same tree: standalone reports "N group(s) duplicated in this change" as information, the hook treats it as a failure. Cost it twice on 2026-08-20 (Q-0119, Q-0134): preflight green → review green → receipt earned → push refused → fix commit → receipt invalidated → re-earn dispatch, which is precisely the sequence Q-0129 exists to prevent. The preflight should invoke the hook step itself (as it already does for `summary-body` via the `printf … | noldor hooks pre-push` replay) rather than a differently-behaving CLI sibling — or `clones check` should grow a `--as-gate` exit contract so the two cannot disagree. Deletion test: a change that the pre-push clones step will refuse is refused author-side, before the review round. (found 2026-08-20 draining the XS batch)

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

### Typed Advisory and Blocking Gap Channels

- id: Q-0136
- area: tooling
- type: refactor
- since: 2026-08-17
- size: M
- impact: med
- confidence: med
- parent: doc-gardening-skill

Routing a `Gap` into `sddGaps` blocks a release, and nothing at the push site says so. The chain is four hops: `detectAll` appends to `sddGaps`, `sddGaps` is listed in `FINDING_CATEGORIES` (`src/garden/garden-detect-runner.ts`), that list is the clean test for the release auto-restamp (`src/release/preflight-fix.ts` → `auto-restamp.ts`), and an unstamped garden receipt is a `blocking` preflight row. Q-0093 shipped a detector documented as advisory that blocked releases through exactly this path; the code-stage reviewer caught it, and the fix was a second hand-rolled `GardenFindings` key deliberately kept out of `FINDING_CATEGORIES`. That works but does not generalize — the next detector author faces the same invisible cliff, and `Gap` itself carries no signal about which channel it belongs to. Make the distinction structural: separate the advisory and blocking gap types (or tag the category), let `detectAll` route by type rather than by which array a caller happened to push into, and let `FINDING_CATEGORIES` derive from that rather than being a hand-maintained parallel list. Deletion test: a new detector cannot block a release without saying so in its type. Verify by adding a deliberately-advisory detector and asserting a release still cuts with it firing. (found 2026-08-17 shipping Q-0093, PR #333)

### Route Every Frontmatter Read Through readFrontmatter

- id: Q-0175
- area: tooling
- type: refactor
- since: 2026-08-23
- size: M
- impact: med
- confidence: med

`matter()` writes its cache entry *before* parsing (`node_modules/gray-matter/index.js`: `matter.cache[file.content] = file` runs ahead of `parseMatter`), so once any call throws on a given string, every later `matter(sameString)` in that process returns the cached un-parsed file — empty `data`, the whole file as `content`. Broken YAML therefore reads as *valid-but-empty* frontmatter on the second and subsequent reads, silently, and the effect crosses module boundaries because the cache is module-global. Q-0116 fixed this for the FD path by routing reads through `readFrontmatter` in `src/core/fd-load.ts`, which passes an options object to take gray-matter's uncached path. Every other direct `matter(raw)` caller still inherits it — ~25 sites across `src/release`, `src/triage`, `src/dashboard`, `src/docs`, `src/features` and `src/cr` (`grep -rn 'matter(' src --include='*.ts' | grep -v __tests__`). Route them all through `readFrontmatter` (or a doc-kind sibling for ADR/vision/milestone frontmatter) so the cache trap has exactly one place it can bite, and consider whether any caller actually benefits from the cache at all. Deletion test: a repo with one broken-YAML markdown file produces the same message from every command that reads it, no matter the order commands run in. (raised 2026-08-20 while fixing Q-0116's malformed-FD policy)

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
