# Backlog

Parking lot for items not on the roadmap. Each entry carries a `- id: Q-NNNN` bullet — a stable ID minted at triage and never rewritten; it survives heading renames and the roadmap ↔ backlog move, so references target it, not the rename-fragile slug (the slug is a human-readable alias). See [triage.md → Stable entry IDs](noldor/triage.md#stable-entry-ids).

Dependencies are declared with a `- blocked-by: <slug|Q-id, …>` bullet (the entries this work waits on); `- deps:` is the legacy alias, still accepted and unioned with `blocked-by:` during the migration window. Prefer `blocked-by:` in new entries.

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

### Route Every Frontmatter Read Through readFrontmatter

- id: Q-0175
- area: tooling
- type: refactor
- since: 2026-08-23
- size: M
- impact: med
- confidence: med

`matter()` writes its cache entry *before* parsing (`node_modules/gray-matter/index.js`: `matter.cache[file.content] = file` runs ahead of `parseMatter`), so once any call throws on a given string, every later `matter(sameString)` in that process returns the cached un-parsed file — empty `data`, the whole file as `content`. Broken YAML therefore reads as *valid-but-empty* frontmatter on the second and subsequent reads, silently, and the effect crosses module boundaries because the cache is module-global. Q-0116 fixed this for the FD path by routing reads through `readFrontmatter` in `src/core/fd-load.ts`, which passes an options object to take gray-matter's uncached path. Every other direct `matter(raw)` caller still inherits it — ~25 sites across `src/release`, `src/triage`, `src/dashboard`, `src/docs`, `src/features` and `src/cr` (`grep -rn 'matter(' src --include='*.ts' | grep -v __tests__`). Route them all through `readFrontmatter` (or a doc-kind sibling for ADR/vision/milestone frontmatter) so the cache trap has exactly one place it can bite, and consider whether any caller actually benefits from the cache at all. Deletion test: a repo with one broken-YAML markdown file produces the same message from every command that reads it, no matter the order commands run in. (raised 2026-08-20 while fixing Q-0116's malformed-FD policy)

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

### Graph-Freshness / Fmt-Collision Follow-Ups

- id: Q-0011
- area: tooling
- type: fix
- since: 2026-07-01
- size: S
- impact: low
- confidence: med
- parent: noldor

Residual design follow-ups from the v0.4.0 near-miss (`pnpm release` hard-gates on committed-fresh `graphify-out/graph.json` vs fmt lefthook erroring on an all-ignored file set; immediate fix PR #114, broader all-ignored no-op guard shipped as `noldor fmt` in PR #184). Trigger: pick up only if the fmt/graph gate collision class recurs despite the PR #184 guard.

- (b) ~~have the release-sweep own the graph commit end-to-end so the two gates can't deadlock~~ — DONE: release-sweep step 6 commits `graphify-out/` before `pnpm release`.
- (c) reconsider whether `graph.json` should be tracked at all vs regenerated in a release-time step. Still parked.

Verified 2026-07-14 (gate pickup): trigger not fired — `src/core/fmt-guard.ts` maps all-ignored→exit 0 + release-sweep pre-commits graph; no collision recurrence since PR #184. Remaining scope = (c) only.

### Real-Codex Integration Smoke Test

- id: Q-0005
- area: tooling
- type: test
- since: 2026-05-10
- size: M
- impact: low
- parent: noldor

`src/cr/__tests__/codex.test.ts` mocks the `Spawn` function, so all CI runs of the codex lane validate the wiring without ever invoking the real `codex` binary. The first real-codex run will surface integration bugs the mocked tests can't catch (codex CLI flag drift, JSON schema variance, stdin-pipe encoding edge cases). Add a manual / opt-in smoke test (`pnpm noldor cr codex --dry-run` against a fixture worktree, gated behind `NOLDOR_RUN_REAL_CODEX=1`) plus a documented operator-side pre-release dogfood step in `docs/noldor/cr-pipeline.md`. Trigger: when codex CLI grows a stable `cr --json` subcommand (currently absent).

### Does SQL in a Framework Make Sense?

- id: Q-0007
- area: tooling
- type: feat
- since: 2026-06-12
- size: M
- impact: low
- confidence: low

Open question — does it make sense to introduce SQL into the framework? Explore use cases (dashboard queries, metrics, entry indexing) before committing.

### Embeddings Infra for the Framework

- id: Q-0032
- area: tooling
- type: feat
- since: 2026-07-11
- size: L
- impact: low
- confidence: low

One shared vector-embedding capability with two consumers: (a) FD/feature-description similarity (the semantic idea-merge path detector-5 dropped because "AST graph has no feature embeddings"), and (b) semantic (Type-4) code-duplicate detection — same-behavior/different-code clones the token/AST clone detector can't catch. Build once: an embed step over FD prose + code units, a vector store, and cosine-similarity queries feeding both the `/triage` merge shortlist and the clone signal. Speculative — no active trigger; revisit if deterministic token/AST clone detection proves insufficient or triage-merge noise justifies semantic ranking.

### E2E Test Support

- id: Q-0034
- area: testing
- type: test
- since: 2026-07-11
- size: M
- impact: med
- confidence: low

Add end-to-end test support to the framework. Fuzzy one-liner — needs a spike to define scope (consumer-facing e2e harness vs self-host e2e coverage) before promotion.

- Deep-audit 2026-07-13 (batch `.noldor/research/2026-07-13-184850`) sharpens the scope: a cold-consumer e2e — scripted `noldor init` on an empty repo, per runner (claude/codex/opencode), in the contract-CI harness (PR #99) — would have caught every consumer-facing finding of the audit (broken `../superpowers/specs/` template links, missing pre-edit-guard hook wiring, codex CR lane reading `.claude/engineering-rules.md`).

### Design Prior-Art Seeder

- id: Q-0070
- area: tooling
- type: feat
- since: 2026-08-05
- size: M
- impact: med
- confidence: low
- parent: de-superpowers-vendor-spec-plan-and-worktree-flows

`/noldor-spec` step 3 leaves prior-art discovery to agent discretion — "one `--support` per anchor you found while grounding" — which is unauditable: nothing distinguishes a thorough search from no search at all. A `pnpm noldor design prior-art --slug <s> --query "<description>"` subcommand would seed `--support` entries deterministically by unioning three substrates that already exist: FD `links.code` reverse lookup via `buildFileToFdsMap`, graphify community membership plus export names, and clone-corpus near-signature matching via `src/clones/tokenize.ts`. Parked rather than queued because the ranking quality of that union is unproven — spike it before committing. Trigger: pick up once Q-0067 (spec-lint prior-art requirement) is shipped and the manual `--support` path proves too noisy or too easily satisfied.

- Operator framing of the same want, which widens the target past prior-art seeding: graphify integration is currently good enough for auditing an existing codebase but is not reached for while a design is being written, so the graph's community structure and export names inform nothing at spec time. Prior-art `--support` seeding is the one concrete use named so far, and the substrate it needs (community membership plus export names) is already in `graphify-out/graph.json`. Worth deciding, when this entry is spiked, whether the seam is only the seeder subcommand above or a broader "graph-at-spec-time" surface — the second is a different and larger entry, and inventing it before the seeder proves its ranking would be speculative. (raised 2026-08-17)

### CR-Autofix Polish Residue

- id: Q-0084
- area: tooling
- type: fix
- since: 2026-08-10
- size: S
- impact: low
- confidence: med
- parent: specs-cr-gate-multi-reviewer

Residue from the Q-0075 ship (PR #276, CR rounds 9–16): (a) `DecideResult.baseSha` doc overstates its invariant — it is empty on ANY decline with git unreachable, not only `no-base-sha`; say "non-empty whenever verdict is auto-fix". (b) `no-base-sha` fires before `next` is known, so a MIXED round with git unreachable declines to operator even though `apply-then-stop` never needs a base-sha — forfeits an applicable mechanical subset on an unrelated failure. (c) `round: 3/2` prints on the round-cap decline (`priorRounds.length + 1` unconditionally) — clamp or relabel. (d) `prior-deferred` scanning every round leaves the seam dead for the rest of the session after one MIXED round, including the operator's own full-review follow-up where the laundering path cannot occur; the only reset is session end — deliberate, but say so in the docs or narrow it. (e) drain-mode/SKILL twins mention `record` without naming the exit-2 `--deferred` cross-check. All in `src/cr/autofix.ts` / `autofix-cli.ts`.

- `cr autofix record --since` rejects a ref that `cr orchestrate --base-sha` accepts: `--since origin/main` exits 2 with `--since must be a hex sha (4-40 chars)`. The gate skill says to pass "the printed base-sha", so the asymmetry only bites a controller re-deriving the value — but then every caller needs `$(git rev-parse origin/main)` for one command and not the other. Accept any `git rev-parse`-able ref in `record` (resolve it, store the sha). (absorbed from a lesson, surfaced shipping Q-0107, PR #317)

### Upgrade Empty-Chain Dirty-Tree Guard

- id: Q-0085
- area: tooling
- type: chore
- since: 2026-08-10
- size: XS
- impact: low
- confidence: med
- parent: version-aware-upgrade-and-migration-chain

`noldor upgrade` writes the framework anchor on the empty-chain path before the dirty-tree guard (`src/cli/commands/upgrade.ts:90` vs the `isDirty` check below it), so a dirty tree silently gets `.noldor/config.json` mutated while the non-empty-chain path refuses with `refusing to upgrade on a dirty git tree`. Pre-existing for the bootstrap case, broadened to the stale-advance case by Q-0076; deliberately left as-is because hoisting `isDirty` would make a pure `nothing to do` invocation throw on any dirty tree, and gating only the write would re-strand the very consumer Q-0076 unstrands. Decide whether the asymmetry is intended and say so in the code, or gate the write with a narrower guard. (surfaced in the code-stage CR of Q-0076, PR #270)

### Multiagent Parallel Session Visibility

- id: Q-0114
- area: tooling
- type: feat
- since: 2026-08-12
- size: L
- impact: med
- confidence: low
- parent: parallel-worktree-workflow

Multiagent operation already works in practice — several branches, several worktrees, several terminal tabs at once — but nothing surfaces it: the dashboard and the agents tab still describe a single-session world, so the operator cannot see which agent holds which worktree or branch. Make that state visible and keep it model-agnostic, so a claude, codex or opencode session all register the same way. Parked at the operator's explicit request rather than on score.

### CLI Command Definitions and Trusted-Input Adapters

- id: Q-0115
- area: tooling
- type: refactor
- since: 2026-08-12
- size: L
- impact: med
- confidence: low

`src/cli/manifest.ts` knows dispatch targets and one-line descriptions, while individual handlers separately own detailed usage, flags, defaults, capabilities and validation. The dispatcher intercepts subcommand `--help`, which makes handler usage strings unreachable and breaks the base-SHA probe (Q-0112); ad-hoc argv loops differ silently; several path-building commands omit the shared slug guard (Q-0097). Move enough metadata and parse policy into a single command definition that help, dispatch, capability introspection and validation cannot drift, keeping implementation modules behind a stable seam, and route every external slug-shaped value through the same canonical adapter before any IO regardless of whether the caller is the packaged CLI or a library consumer. Deletion test: handler-local usage copies, copied slug regexes, `process.argv.find` loops and self-shelling help probes all go. Avoid a framework-heavy parser dependency unless the current manifest cannot generate the required behaviour with less code. (architecture candidate, Worth exploring from the read-only audit 2026-08-12)

### Portable Timeout Audit for Supervisor Loops

- id: Q-0120
- area: tooling
- type: chore
- since: 2026-08-12
- size: XS
- impact: low
- confidence: med

macOS ships no `timeout` and no `gtimeout` unless coreutils is installed, so any hand-written supervisor loop that copies the drain's per-iteration timeout gets `command not found` and — with `set -uo pipefail` but no `-e` — silently runs its children UNBOUNDED. The portable shape is to background the child, background a `( sleep N; kill -0 $child && pkill -P $child; kill -TERM $child )` watchdog, `wait $child`, then kill the watchdog. Two deliverables: audit whether `src/autonomous` (or any shipped script, hook or template) depends on a GNU-only binary for the same reason, and record the portable watchdog recipe in `docs/noldor/gotchas.md` so the next hand-rolled runner starts from it. Parked rather than queued because no framework code path is confirmed affected — the failure was in an ad-hoc runner. (surfaced draining the 2026-08-12 XS batch)

### Caveman Output Mode in Noldor

- id: Q-0128
- area: tooling
- type: feat
- since: 2026-08-14
- size: S
- impact: low
- confidence: low

Open question — should the terse, article-free "caveman" response style become a Noldor-owned concern rather than one operator's user-level global skill? The argument for is reproducibility: the token-compression posture would survive a fresh machine, apply to any consumer, and hold across claude, codex and opencode instead of depending on private config. The argument against is that Noldor's posture is about discipline and traceability, not about an agent's voice, and presentation policy inside the framework invites every consumer to want their own. Speculative with no trigger — park until a consumer actually asks for it, or until the global-skill version demonstrably fails to carry into an autonomous drain.

### Single Static Binary Distribution

- id: Q-0133
- area: tooling
- type: chore
- since: 2026-08-17
- size: L
- impact: med
- confidence: low
- blocked-by: Q-0117

Adoption assumes a TS/JS consumer with Node already present — `pnpm add`, `npx noldor`, `engines.node >=20` — which covers the entire current market. A self-contained executable (`bun build --compile`, Node SEA, or `deno compile`) removes that floor so a Go, Python or Rust repository could adopt the framework at all, and cuts hook startup further than a `dist` entrypoint alone. This is a packaging change and not a rewrite: 100% of the TypeScript source survives. Distinct from Q-0117 because all three of that entry's options answer which TS representation ships inside the npm tarball, and every one of them still requires Node on the consumer machine; this removes the requirement. Blocked on Q-0117 because the compiled-entrypoint decision is the prerequisite — there is nothing coherent to embed while `bin/noldor.mjs` boots `src` through `tsx`. Costs to weigh before promoting: a cross-platform release matrix (darwin and linux × arm64 and amd64) with per-target smoke tests, keeping the npm package as a thin wrapper so `npx noldor` and every existing consumer keep working, and deciding what happens to the `templates/` payload and any other file the CLI reads from its own package at runtime — an embedded filesystem or an extraction step, neither free. **Explicitly not sufficient for cross-language adoption on its own:** the checks still hardcode the TypeScript toolchain (`CODE_FILE_RE = /\.(ts|tsx|js|jsx)$/` in `src/core/repo-paths.ts:63`, `**/*.tsx` in `src/core/allowlist.ts:90`, the oxlint / oxfmt / vitest / tsc wrappers, dependency-cruiser import graphs), so pluggable per-language check adapters are the separate and larger prerequisite for a non-TS consumer to get value. Park until either that adapter work is on the queue or a concrete non-Node consumer asks. (raised 2026-08-17 assessing a Go-rewrite question)

### Consumer Root README Check

- id: Q-0140
- area: tooling
- type: feat
- since: 2026-08-17
- size: S
- impact: med
- confidence: low
- blocked-by: Q-0139

An adopted consumer gets no root README scaffold and no root README validation. `templates/` ships `docs/`, `AGENTS.md`, `lefthook/`, `lefthook.yml`, `opencode.json`, `.claude/` and `.opencode/` — there is no `templates/README.md` — and `docs/noldor/doc-conventions.md` states the README carries no auto-generated listing, so the file is unmanaged by design. Of the four mechanisms that touch a root README today only two reach a consumer at all: the internal-link check and the warn-only `pnpm test` rule-pair, plus SDD detector 12 if and only if the repository is a `packages/<prefix>-*` monorepo (live in charuy with 8 packages and a `### Packages` table, dead for every single-package consumer). That leaves the first document a human or a review agent opens as the one adopted surface the framework never inspects. Wanted, without taking ownership of the prose: a structural `doctor` or garden check asserting the README exists, its links resolve, it references the framework entry point (`docs/noldor/README.md`), and it names the repository's own registered doc surfaces. This is the consumer-side generalisation of Q-0139 and should follow it — the checks there are written against this repository's README shape first, and only the ones that survive contact with a foreign README belong in a consumer-facing gate. Park until Q-0139 ships or a consumer's stale README actually costs something. (found 2026-08-17 asking why PR #333 left the root README untouched)

### Module and Plugin Extension Model

- id: Q-0141
- area: tooling
- type: refactor
- since: 2026-08-17
- size: L
- impact: med
- confidence: low

Every framework surface is baked in, and each new one costs the same hand-wired set of touchpoints. Q-0093's architecture doc surface is the measured case: it shipped a page registry in code, a presence validator, a garden detector, an SDD gap slot, a release probe, a CLI subcommand in `src/cli/manifest.ts` and a dashboard route entry (Q-0134) — seven coupled edits for one surface, with the count restated across prose in six documents plus their `templates/` twins (the four-CR-round sweep recorded in `ideas.md`). The design surface, the queue documents and the traceability kinds each carry their own copy of that wiring. Wanted: one extension contract a surface declares itself through — identity, owned paths, validators, detectors, gap channel (advisory versus blocking, per Q-0136), CLI verbs, dashboard route, release probe — so registering a surface is data plus a small adapter rather than edits fanned across the runtime, and so prose counts derive from the registry instead of being asserted by hand. Scope questions to answer before promoting: whether third-party or consumer-authored modules are in scope at all or only first-party ones (the former drags in a stability contract, versioning and a trust boundary the framework has no story for); which existing surfaces are genuinely uniform enough to migrate versus which differences must stay explicit strategy data; and whether the seam is an internal registry only, since a public plugin API is a much larger commitment than the internal deduplication that motivates it. Related but distinct: Q-0133's pluggable per-language check adapters are a parallel adapter axis over the toolchain wrappers, not this registry, and Q-0109 to Q-0113 deepen individual internal seams rather than defining how a surface plugs in. Park until a third surface addition makes the repeated wiring cost concrete or the internal registry is wanted independently. (raised 2026-08-17 from an untriaged ideas bullet)

### Infra in the Framework — Deploy, Release Channels, Rollback

- id: Q-0151
- area: tooling
- type: feat
- since: 2026-08-20
- size: XL
- impact: med
- confidence: low

Noldor today owns the change up to the merge commit — gate, spec, plan, CR lanes, receipts, `pnpm release` for its own npm package — and stops there. Nothing in the framework models what happens to a consumer app or package *after* the merge: how it deploys, to which environment, on which channel, and how a bad deploy is undone. Open question worth exploring: should the framework grow an infra surface at all, and if so how thin. Candidate scope to argue about before promoting — (a) a declared deploy target set per consumer (`noldor.config` already carries `consumers`/paths, so environments could hang off the same schema); (b) release channels beyond the current single-track semver: `alpha` / `beta` / `next` prereleases for packages, plus a hotfix path that ships a patch off a release tag rather than off `main`; (c) rollback as a first-class verb — the inverse of a release, with the same receipt discipline (what was rolled back, from which sha to which, by whom, why), which the framework's trailer/receipt machinery is already shaped for; (d) whether deploys are *executed* by Noldor or merely *recorded* by it — recording is cheap, portable across CI systems and enough to feed metrics, executing drags in per-platform credentials, an environment model and a blast radius the framework has no story for. Strong prior that (d) should land on record-only first. Overlaps deliberately with Q-0152 (DORA metrics) — a deploy event stream is the shared substrate: the metrics entry consumes what this entry would emit. Park until a consumer's deploy pain is concrete rather than hypothetical; the framework has no deployed consumer app driving requirements yet.

### DORA Metrics

- id: Q-0152
- area: tooling
- type: feat
- since: 2026-08-20
- size: L
- impact: med
- confidence: low

Implement the four DORA metrics over the data Noldor already accumulates, surfaced on the dashboard alongside the existing metrics page. Sketch of where each measure comes from — **lead time for changes**: first commit on a `fast/<slug>` branch (or the FD's spec commit) to the squash-merge on `main`, both already in git history; **deployment frequency**: needs a deploy event stream, which is exactly what Q-0151 would emit — until then the closest honest proxy is `pnpm release` tags, i.e. package releases, not deploys, and the distinction has to be labelled rather than blurred; **change failure rate**: needs a failure signal to divide by — candidates are revert commits, hotfix releases, and red CI on `main` after merge, each with different noise; **time to restore**: interval from that failure signal to the fixing merge or rollback. Two design questions decide whether this is worth building: whether the framework's own repo plus a couple of dogfood consumers is enough sample size for the numbers to mean anything (a metric computed over ten merges a week mostly measures noise), and whether the failure signal can be derived or has to be operator-declared (a `Noldor-Incident:`-style trailer or an explicit CLI verb, which shifts cost onto the operator and decays the moment someone forgets). Prefer deriving from git plus CI first and adding a declared channel only where derivation demonstrably lies. Loosely blocked by Q-0151 for the deploy-frequency half; the other three metrics are computable from git and CI alone, so a first slice need not wait.

### Fence-Scanner Convergence

- id: Q-0153
- area: tooling
- type: chore
- since: 2026-08-21
- size: M
- impact: low
- confidence: high

Nine hand-rolled fenced-code scanners live in the repo and every one of them recognizes a literal triple backtick and nothing else: `stripCodeRegions` in `src/docs/docs-check.ts:39`, `src/utils/parse-blocks.ts:144`, `src/utils/write-blocks.ts:36`, `src/prep/scaffold.ts:24`, `src/garden/backlog-demote.ts:85`, `src/garden/detectors/skill-code-drift.ts:227`, `src/triage/validate-triage.ts:159`, `src/core/lint-plan-snippets.ts:25` (`parseOpenFence`/`isCloseFence`) and `src/triage/entry-id.ts:133` (three `startsWith('```')` toggle sites). None handles a tilde fence, a run longer than three, up-to-three-space indentation, or an info-string rule, so a CommonMark-legal document can fabricate a queue entry, hide a real one, or produce a false broken-link failure — the roadmap's schema-C grammar entry documents that failure class concretely. `src/utils/markdown-sections.ts` now holds one capable scanner with all four rules and a test matrix; converge the incumbents onto it. **Two things make this bigger than a mechanical swap.** First, `lint-plan-snippets` treats an unclosed fence as ending at its opening line while the capable scanner runs it to end of input, so its convergence is a deliberate behaviour change and needs its own fixtures. Second, the incumbents do not share one shape — some strip regions, some toggle a boolean mid-loop, some need the fence's info string — so the capable module probably has to export a lower-level line-classifier alongside `listHeadings`/`extractSection` before the call sites can move. Do the classifier extraction first, then convert one call site per commit with paired backtick/tilde fixtures, and expect the `parse-blocks`/`write-blocks` pair to move together since the parser and writer must agree.

### Autonomous Park CLI and Operator-Hold Escalation Reason

- id: Q-0155
- area: tooling
- type: feat
- since: 2026-08-23
- size: XS
- impact: low
- confidence: med

`autonomous` has an `unpark` CLI but no `park` counterpart, and no `operator-hold` EscalationReason: parking a slug means hand-editing `.noldor/drain-park.json`, and borrowing `run-aborted` for a scope hold makes `autonomous inbox` read as repo-level failures for the whole batch. The original driver — the park map being the only working selection filter for a subset drain — is gone: Q-0121 (`queue-drain-selection-and-staleness-guards`, retired 2026-08-20) shipped the `--only <slug,…>` / `--size` narrowing, so a subset drain no longer needs the hack. What remains is honest reporting for a deliberate hold, which is why the park half survives and the selection half does not. (absorbed from a lesson, surfaced draining the 2026-08-13 S/med/fix batch, PRs #315-#319)

### Cross-Family Mandatory Review Lane

- id: Q-0176
- area: tooling
- type: refactor
- since: 2026-08-23
- size: M
- impact: med
- confidence: med
- parent: make-noldor-agent-agnostic

The M/L/XL mandatory codex round (Q-0091, PR #341) hardcodes `codex` as the second model family, which is wrong the moment the *driving runner* is not claude: in a setup where codex runs the whole noldor flow (implementer + reviewer), a "mandatory codex round" reviews codex with codex — the mandate should instead force a mandatory **claude** review there. And opencode as the driving runner is a completely different use case again. Generalize the mandate from "force lane `codex`" to "force at least one review lane whose model family differs from the session's driving runner" — the runner registry (`agents` config, three-runner runtime from PR #71) already knows who is driving, so `withMandatoryCodex` should become runner-aware (e.g. `withMandatoryCrossFamilyReview`) and pick the forced lane from that, not from a constant. Parked: claude is the only driving runner in practice today — pick up when a non-claude driving runner is real. (raised 2026-08-20 from an untriaged ideas bullet)

### Doc Text Duplication and Text Imports

- id: Q-0191
- area: docs
- type: refactor
- since: 2026-08-25
- size: M
- impact: med
- confidence: low

PR #372 carried the same prose in several places at once — the skill, its `templates/` twin, the runner-neutral `docs/noldor/` page, and the FD — so one edit has four homes and three of them go stale silently. The twin-copy rule makes this structural rather than accidental: `doctor` reds when a skill and its template diverge, which enforces that the duplication STAYS in sync but does nothing about the fact that it exists. Worth deciding what the framework's answer is: a text-import/transclusion mechanism with a generated-file marker (the `sync` projections already establish the generated-from-source pattern), a single canonical page every twin links to instead of restating, or an accepted duplication with a stronger mechanical diff than `doctor`'s presence check. Parked rather than roadmapped because the answer changes the shape of every skill file — it wants a spike before a size. Deletion test: correcting a sentence about a rule touches exactly one file. (found 2026-08-25 reviewing PR #372)
