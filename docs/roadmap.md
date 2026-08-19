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

### pen.dev UI Design Phase

- id: Q-0144
- area: tooling
- type: feat
- since: 2026-08-17
- size: L
- impact: high
- confidence: low

The framework has no UI-design stage: `/noldor-spec` produces prose, and a frontend feature's visual design is either absent from the artifact trail or pasted in as a screenshot nobody validates. Wanted, driven by a live consumer need: a pen.dev-backed design step inside the spec phase where several UI versions can be described, drafted and compared while the spec is still being written, converging on one final design that the spec carries as its own artifact by the time the spec phase closes — design decisions adjudicated with the rest of the spec rather than after it. Two surfaces follow from that. A pipeline stage, so `/noldor-gate` routes UI-bearing work through the design step and the resulting artifact is gate-visible the way specs and plans are (`sizeToPath()` and the path set both move). And a review lane that checks the implemented UI against the chosen pen.dev design, sitting beside the codex and verifier lanes rather than duplicating them. Open questions dominate, hence `confidence: low`: how a pen.dev artifact is referenced and pinned so a spec's design cannot silently change under it; whether version drafts live in pen.dev with only the winner referenced, or all candidates are recorded as the spec's considered alternatives; whether the review lane can compare rendered output to a design mechanically or only prompt a reviewer with both; and what a non-UI feature does with the stage (skipped by predicate, not by operator memory). Related but distinct: Q-0116's design-artifact detector module governs how design artifacts are discovered once they exist, not where they come from. Consumer-blocking, which is why this outranks internal-polish entries below it per the vision's adoption tie-breaker.

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

### Spec Floor for S-Sized Entries

- id: Q-0143
- area: tooling
- type: feat
- since: 2026-08-17
- size: S
- impact: med
- confidence: med

`sizeToPath()` (`src/core/size-routing.ts`) currently exempts both XS **and** S from any written artifact — `fast-track` for code, `micro-chore` for pure docs — so an S entry can ship with no spec, no plan and no recorded design reasoning at all. The question this entry decides: should XS be the *only* band that escapes a spec, moving S to `specs-only`? Evidence that it should is accumulating from the drain batches. The 2026-08-13 S/med/fix batch found S entries routinely running real CR rounds with genuine design findings, and the 30-minute `--iteration-timeout` sized for XS work killed Q-0107 mid-CR — an S entry doing spec-shaped work under a no-spec tier. A spec floor at S would also give the reviewer lanes the prior context that Q-0132 shipped for, which is worthless on a path that produces no spec to carry context in. Evidence against is the whole point of the routing policy: the drain runner's throughput depends on XS/S needing no prep, and forcing a spec on a genuinely mechanical S fix is the "don't spec the small ones" failure the policy exists to prevent. Decide it as a policy change with a stated rationale rather than a silent constant edit, then land it in one place: `sizeToPath()`, the routing block at the top of this file, [complexity-gating.md](noldor/complexity-gating.md), and every `templates/` twin of those documents (the Q-0093 lesson — a count or policy asserted in prose has no single source of truth, so the sweep must be exhaustive on the first pass). A middle option worth costing before committing to either pole: keep S on `fast-track` but require a spec when the split-check or CR verdict says the entry is spec-shaped, so the floor is earned by signal rather than by band.

### Codex Lane Misreports a Model-Version 400 as Expired Auth

- id: Q-0125
- area: tooling
- type: fix
- since: 2026-08-14
- size: XS
- impact: med
- confidence: high
- parent: specs-cr-gate-multi-reviewer

The codex CR lane diagnoses a failed run as an auth problem regardless of what the API actually rejected, so a model-version error sends the operator to re-authenticate a session that never expired. Measured: `codex-cli 0.133.0` against a configured `gpt-5.6-sol` returns `400 invalid_request_error` carrying "The 'gpt-5.6-sol' model requires a newer version of Codex", and the lane reports `auth looks expired; run: codex login`. Parse the 400 body, or at minimum stop asserting auth whenever the payload names a model. Operator remedy, verified 2026-08-17: `npm install -g @openai/codex@latest` (0.133.0 → 0.147.0) clears it — note the binary is npm-global and only symlinked into `/opt/homebrew/bin`, so `brew upgrade codex` silently no-ops and reads as "the fix didn't work". `codex exec -c model=gpt-5.5` also works as a pin. Either way the lane's message sends the operator to the wrong place: surfacing the stderr tail, which already carries the real 400 body, would have answered it immediately. The eventual home is Q-0112's per-lane error-shape normalization, which deletes this call site outright — queued standalone because that is an L entry and this is a fast-track-sized correction to a message the operator acts on immediately. (found 2026-08-14 running the codex lane on Q-0124)

### Feature-Doc Links Point at Code Deleted in PR #328

- id: Q-0138
- area: docs
- type: fix
- since: 2026-08-17
- size: XS
- impact: med
- confidence: high

`pnpm noldor docs check` is red on `main` right now: `docs/features/specs-cr-gate-multi-reviewer.md` links `src/cr/codex-spawn.ts` (line 142) and `src/cr/__tests__/codex-spawn.test.ts` (line 162), both deleted when PR #328 collapsed the codex shell-out into an in-process lane call. The link checker is the only gate that catches this class and it now fails for a reason unrelated to whatever a contributor is changing, which trains people to ignore it. Repoint both links at the surviving `src/cr/lanes/codex.ts` and its test, or drop them if nothing replaced the symbol. Worth checking the same PR's other FDs in one pass — this is link rot from a rename, not a one-off. (found 2026-08-17 shipping Q-0093, PR #333)

### Verify Lane Fail-Closes on Its Own Malformed Output

- id: Q-0137
- area: tooling
- type: fix
- since: 2026-08-17
- size: S
- impact: med
- confidence: high
- parent: acceptance-verify-lane

Three separate code-stage rounds on Q-0093 returned `verify lane errored: malformed verifier output` wrapping payloads that began "Verified all clauses through real CLI/HTTP/API" and "Verified end-to-end" — the verification had passed and only the serialization broke. In blocking mode the aggregate reads that as red, so `cr orchestrate` withholds the `Noldor-Reviewed-Subagent` receipt and the branch cannot pass its own pre-push gate. A green verification must never block a ship on a formatting failure. Two candidate fixes, not exclusive: have the lane re-request a structured payload once before giving up, and treat a malformed payload whose prose clearly reports success as `warn` rather than `error` so it degrades instead of blocking. Whichever is chosen, the sink should keep the raw payload — the current message truncates the very evidence needed to tell a real failure from a serialization one. (found 2026-08-17 shipping Q-0093, PR #333)

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

### Root README Content Validator

- id: Q-0139
- area: tooling
- type: feat
- since: 2026-08-17
- size: M
- impact: med
- confidence: med
- blocked-by: Q-0136

Root `README.md` is the one doc surface the framework never inspects for content, so every capability it adds drifts out of the README silently. Four mechanisms touch the file and none of them read what it says: `pnpm noldor docs check` includes it but only resolves internal links (`src/docs/docs-check.ts:223`), the `bootstrap commands` rule-pair asserts a `pnpm test` mention at `severity: 'warn'` (`src/invariants/rule-pairs.ts:63`, soft by design because the README is consumer-owned), SDD detector 12 `detectReadmePackageDrift` (`src/garden/sdd-report.ts:489`) keys on `packages/<prefix>-*` directories and is therefore dead in this repository, and release-sweep step 4 is prose asking an LLM to eyeball the architecture, stack and command sections. The miss is concrete: Q-0093 added a `docs architecture` subcommand to `src/cli/manifest.ts` plus a four-page `docs/architecture/` surface carrying its own presence validator, garden detector, SDD gap and release probe, and the README's `## CLI reference` and `## Docs` sections both stayed silent — the string "architecture" appears nowhere in it. Wanted: three structural checks mirroring the registry Q-0093 already built — `src/cli/manifest.ts` against the README CLI-reference section, every registered doc surface reachable from `## Docs`, and every command quoted in `## Quick start` / `## Daily workflow` present in root `package.json` `scripts`. Two constraints bind the design. The README sits deliberately outside `RELEASE_SWEEP_GLOBS` (`src/core/allowlist.ts:20`), so a finding is always operator-fixed in a separate micro-chore rather than repaired in place by the sweep. And the finding must land on a non-blocking channel — routing it to `sddGaps` would let a README typo withhold a release through the four-hop chain Q-0136 exists to make structural, which is why this is blocked on that entry. Deletion test: adding a CLI subcommand or a doc surface without touching the README fails a check that names the missing section. (found 2026-08-17 asking why PR #333 left the root README untouched)

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

### Dashboard Route for the Architecture Doc Surface

- id: Q-0134
- area: tooling
- type: feat
- since: 2026-08-17
- size: XS
- impact: low
- confidence: high
- split-from: Q-0093
- blocked-by: Q-0093

The dashboard already renders mermaid (`src/dashboard/data.ts:218` swaps a fenced block into a `div.mermaid` container, `src/dashboard/layout.ts:400` loads mermaid 11 with the theme following `prefers-color-scheme`), but its GET table serves only `/framework/<slug>`, `/skills/<slug>` and `/docs/(tutorials|how-to|reference|explanation)/<slug>` — no route reaches `docs/architecture/`, so the diagrams that surface ships render on GitHub and nowhere else locally. Add a route plus handler for the architecture pages and extend the route-sweep regression test that reads `GET_ROUTES` from the same map the router dispatches on. Carved out of Q-0093 at spec review: adding a dashboard subsystem to a docs feature was scope creep, while the claim that the dashboard renders the pages was simply untrue as written.

### Spec Brainstorming Depth Parity

- id: Q-0092
- area: tooling
- type: feat
- since: 2026-08-11
- size: M
- impact: med
- confidence: low
- parent: de-superpowers-vendor-spec-plan-and-worktree-flows

Brainstorming through the vendored `/noldor-spec` question-first loop does not reach the depth the superpowers `brainstorming` skill gets to — the de-superpowers vendoring preserved the flow's shape but apparently not its interrogative pressure. Fuzzy one-liner: the actual delta between the two prompts has not been diffed, so there is nothing concrete to implement yet. Trigger: run both over the same idea, diff the transcripts, and extract the specific moves the vendored version drops before promoting.

- Promoted from the backlog on 2026-08-17: the trigger above is satisfied, because the operator named a concrete move rather than a suspected delta. The vendored brainstorming step should render its output as part of the spec plan — a written summary section per part of the design, each one to two paragraphs rather than a single sentence, confirmed with the operator part by part before the spec is written. The point is decision quality, not verbosity: a one-line answer per section gives the operator nothing to judge, while a short prose account of how each part will actually work exposes the product and technical choices while they are still cheap to change. That makes this implementable without first diffing the two prompts, though the diff remains the way to find the *other* moves the vendoring dropped. Sequencing note: this is adjacent to Q-0144's requirement that UI design versions be drafted and settled inside the spec phase — both push judgment earlier, into spec writing, and both add a per-section confirmation beat, so check whether they want one shared mechanism before implementing either in isolation.
