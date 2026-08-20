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

### UI Render-Compare Lane

- id: Q-0146
- area: tooling
- type: feat
- since: 2026-08-20
- size: M
- impact: med
- confidence: low
- deps: ui-design-review-lane
- split-from: Q-0145
- recovered: 2026-08-20

Mechanical render-compare for the UI-design review lane: screenshot-diff the running app against the feature's committed `.pen` design instead of reasoning over the extracted design structure. Deferred out of Q-0145 because it needs a per-consumer app-boot recipe (how to start the app, which route renders a surface, how to reach a given state) that does not exist yet — the structural lane ships first and this earns its slice once boot recipes land. Depends on the structural lane for the sink shape and the `consumer.uiPaths` surface predicate.

### README Command Validation On The Existing Resolver

- id: Q-0148
- area: tooling
- type: feat
- since: 2026-08-20
- size: S
- impact: med
- confidence: high
- split-from: Q-0139
- recovered: 2026-08-20

Q-0139 shipped doc-surface reachability but cut its command half at code review, so nothing checks that a command the root `README.md` quotes still resolves. The cut was a reuse finding, not a scope objection: `src/garden/detectors/fd-command-rot.ts` already implements this capability and does it better — an exported `commandTokens()` whose `isTerminator` stops at the first flag, operator or placeholder; `PNPM_BUILTINS` with ~33 entries; `extractCommandRefs()` over inline spans and fenced blocks; `refResolves()` trying `<group> <sub>` then one token; and a registry unioning manifest leaves, bare group names, `package.json` scripts and script-catalog colon aliases. The second implementation in `readme-content.ts` filtered flags out instead of stopping at them, so a flag's value slid into the group slot (`pnpm --filter web run build` reported `pnpm web`; `pnpm noldor --root . checks readme` reported `pnpm noldor .`), listed 4 built-ins so `pnpm remove`, `pnpm publish`, `pnpm why`, `pnpm dedupe` and `pnpm up` all false-flagged, and reported `pnpm noldor docs --help` as needing a subcommand, contradicting its own acceptance criterion. Wanted: build the README command check on those helpers — `buildCommandRegistry` needs exporting, or lifting beside `commandTokens` — rather than a third copy (the `scripts?: Record<string, …>` read alone already has four). Two extras to decide in scope: the `## CLI reference` table quotes **bare** group names in table cells, not `pnpm …` invocations, so `commandTokens` returns null for every row and the most drift-exposed section of the README stays unchecked unless the extraction is widened for it; and `fd-command-rot` is FD-scoped today, so the seam that lets it target an arbitrary markdown file is part of the work. Deletion test: rename a manifest group the README quotes and the check names the stale invocation. (carved from Q-0139 at code review 2026-08-20, where the duplicate implementation's false positives were reproduced against the live manifest)

### Plan Split Guidance Permits A Part That Ships Nothing

- id: Q-0150
- area: tooling
- type: fix
- since: 2026-08-20
- size: S
- impact: med
- confidence: med

`noldor-plan` step 6 requires each `-part<N>` file to be "independently shippable software", but the P1 signal it reacts to is a row count, and the obvious way to halve a row count is a horizontal cut along the task list — which yields a first part of pure library units that ship no capability at all. Q-0139 hit this twice: the monolith tripped P1 at 1336 rows, the horizontal cut left part one at 1081 and still over, and a second horizontal cut would have produced exactly such a part. The working split was vertical — part one shipped the doc-surface check end to end including its CLI, part two extended the same command — which took two extra restructuring passes to discover because nothing in the guidance says so. Wanted: state the vertical rule explicitly (each part must move a user-visible capability, so cut along capability, never along the unit list), and give the P1 remedy prose a worked example of both cuts so the wrong one is visibly wrong. Consider also whether the checker can say anything useful here — a part whose tasks touch no entry-point or CLI file is a candidate signal, though a false-positive-prone one. Deletion test: a plan split into parts where part one registers no runnable surface is flagged or documented as wrong. (found 2026-08-20 splitting the Q-0139 plan)

### Manifest Aliases Escape Both CLI Documentation Gates

- id: Q-0147
- area: tooling
- type: fix
- since: 2026-08-20
- size: S
- impact: med
- confidence: high
- split-from: Q-0139
- recovered: 2026-08-20

A subcommand added to an existing `MANIFEST` group and pointed at an already-catalogued entrypoint is checked by nothing. `validate script-catalog` (`src/cli/validate-script-catalog.ts`) joins the manifest against `docs/noldor/script-catalog.md` on the `src` path, and `manifestSrcSet`'s own docstring (`src/cli/validate-script-catalog.ts:26-31`) states that aliases sharing an entrypoint collapse so "documenting that source once satisfies every alias" — so `missingFromCatalog` stays empty. Q-0139's README check runs README → registry only (its `## CLI reference` section declares itself a non-exhaustive journey-critical subset), so it does not fire either. The live example is `autonomous run` and `autonomous queue-drain`, which share `autonomous/queue-drain.ts`: a third alias on that entrypoint would be invisible to both gates. Q-0139's FD deletion test read "adding a CLI subcommand or a doc surface without touching the README fails a check that names the missing section"; the doc-surface half ships there, and this entry is the CLI half. Wanted: make the catalog diff join on the leaf `command` as well as `src`, so every `<group> <sub>` needs a mention even when its entrypoint is already documented — deciding first whether an alias deserves its own catalog row or a shared row that must name every alias it covers. Deletion test: add an alias to an existing entrypoint and `validate script-catalog` names it. (found 2026-08-20 at Q-0139 spec review, where it was recorded as a risk rather than claimed as covered)

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
