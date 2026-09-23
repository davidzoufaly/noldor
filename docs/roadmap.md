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

### Path Pick Cannot See the Shared-File Block

- id: Q-0244
- area: tooling
- type: fix
- since: 2026-09-16
- size: S
- impact: med
- confidence: high

An XS entry whose whole diff is `.claude/skills/**` routes to `fast-track`, and the worktree then refuses the commit. `sizeToPath()` keys on size alone, so `/noldor-gate` Step 0 stamps `suggestedPath: fast-track` on a pure-prose skill edit; `checks shared-files` blocks `^\.claude/skills/[^/]+` from a feature worktree, so the whole fast-track scaffold is wasted — worktree created, roadmap block retired and committed on the branch, then the real commit is refused. Shipping Q-0222 that cost a full worktree teardown and redo on `main`. The evidence that micro-chore is the intended lane is already in `MICRO_CHORE_GLOBS`, which lists `.claude/**` *and* `templates/.claude/**` with the comment "template-sync forces editing both, so the twin must share the micro-chore lane". The gate's own Step 0 prose says "downgrade to `micro-chore` only when the diff is pure-doc", but nothing computes that: the operator is asked to predict the diff before writing it. Wanted: make the shared-files block list and the micro-chore allowlist reachable from the path pick — either `split-check --entry` warns when an entry's `Touches:` is entirely inside `MICRO_CHORE_GLOBS`, or `worktrees create` refuses up front for a slug whose expected paths are all shared-root. Deletion test: picking `fast-track` for an entry that only touches `.claude/skills/**` surfaces the conflict before the worktree is built. (found 2026-09-15 shipping Q-0222)

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

### CR Re-Round Cap Overrun

- id: Q-0251
- area: tooling
- type: fix
- since: 2026-09-22
- size: S
- impact: high
- confidence: low
- parent: cr-re-round-cap-enforcement-and-oscillation-detector

An observed session ran four CR review rounds against a cap of two. Reproduce before fixing, because the cap may be behaving as designed: Q-0170 (PR #431) counts **red rounds only** and exits 3 at the cap, so four *rounds* with two reds is legal — in which case the defect is that the surfaced round count and the enforced count are different numbers and nothing says so, and the remedy is reporting rather than enforcement. The adjacent observation that makes this worth an entry either way: the four rounds were non-convergent, each one finding defects in the fix the previous round demanded, which is precisely the oscillation the detector shipped to catch. Establish first which of the three it is — cap bypassed, cap counting a different thing than the operator sees, or the oscillation detector not firing on a chain it should have caught. Deletion test: a session that performs N rounds reports N against the same denominator the cap enforces, and a fix-defect-fix chain trips the oscillation record. (found 2026-09-22)

### Scaffold One Agent-Rules File, Not Two

- id: Q-0252
- area: tooling
- type: feat
- since: 2026-09-22
- size: M
- impact: high
- confidence: med

Claude now reads `AGENTS.md`, which is the same file codex and opencode already read, so the framework no longer needs to scaffold a Claude-specific `CLAUDE.md` alongside it. Collapse the two onto one file: `noldor init` should write `AGENTS.md` and not create `CLAUDE.md` in a fresh consumer, and an existing consumer should get a migration path rather than a silently duplicated rule set — this repo itself runs the split today (`AGENTS.md` for codex/opencode, `.claude/` for Claude Code), and charuy carries the same duplication, so both need propagating. Adoption-weighted per the vision's standing tie-breaker: one agent-rules file is one less thing a new consumer has to understand, and a duplicated one is a drift source the moment the two copies disagree. Open questions for the spec: what happens to `.claude/skills/**`, which has no AGENTS.md equivalent and stays Claude-primary; and whether the migration rewrites an existing `CLAUDE.md` or leaves it and stops regenerating it. Deletion test: `noldor init` in a clean repo produces `AGENTS.md` and no `CLAUDE.md`, and a consumer that had both ends with one. (found 2026-09-22)

### pen-bridge Check Does Not Count Editor Windows

- id: Q-0253
- area: tooling
- type: fix
- since: 2026-09-22
- size: XS
- impact: med
- confidence: high

`pnpm noldor checks pen-bridge` reports the entrypoint, the app pin and the extension, but never the one thing that explains its most confusing failure: how many VS Code windows are running. The pencil socket is global and owned by whichever window activated the extension first, so every `.pen` opened in any other window is invisible to the bridge and the error is `A file needs to be open in the editor` — which reads as "nothing is open" while the operator is looking straight at a rendered canvas. Shipping Q-0275 this cost two dead ends with six windows up and three pids on `pencil-visual_studio_code.sock`, while `checks pen-bridge` exited 0 reporting everything healthy. The whole diagnosis is two commands the check does not run: `pgrep -f vscode-window-config | wc -l` and `lsof -U | grep pencil-visual`. Add both as rows and, when the window count is greater than one, say plainly that the bridge has a single owner and name the remedy (quit all but one window). The trap itself is already written up in [gotchas.md → Pencil / UI design](noldor/gotchas.md); this entry is about the check knowing it. Deletion test: with two VS Code windows open, `checks pen-bridge` names the window count and the remedy. (found 2026-09-22 shipping Q-0275)

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

### Rules Must Not Snapshot Another Module's Shape

- id: Q-0245
- area: tooling
- type: docs
- since: 2026-09-16
- size: S
- impact: med
- confidence: med

A prose rule that audits the codebase's *current* shape is a self-feeding CR loop. Shipping Q-0223 (PR #457) the new `state-file-schema-additive` rule carried a paragraph characterising `config.json`'s schemas, and four consecutive review rounds each found one level deeper: round 1 said the break is required-ness not `.strict()`; round 2 said the `consumer:` block is strict and required-heavy; round 3 said `noldorConfigSchema`'s *nested* blocks are required-heavy too; round 4's verifier ran the real CLI and falsified the whole consequence claim (a rejected config makes `clones check` exit 0 and silently switch the gate off, because four call sites swallow the throw). Every round's finding was correct, and the round cap plus an arbitration override was the only way out. The rule only became stable once it stopped asserting what other schemas look like and said "audit the nesting level you are editing; establish the consequence by running the command". Wanted: a line in the rule-authoring guidance — a rule states a constraint and how to check it, never a snapshot of another module's field shapes, because the snapshot is wrong the moment it is written and every CR round finds the next exception. Deletion test: a new enforce rule that names another module's field list is caught at authoring time, not at round four. (found 2026-09-15 shipping Q-0223)

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

- The same coverage hole bites a *feature's* `.pen`, not only a baseline, and the one page-level rule is a count the agent executes by hand. The enforced set is existence (`no-design-artifact`, `ambiguous-design`), ratification (`design-unapproved`) and freshness (`pen-modified`); `noldor-spec` step 1.5(b) adds "exactly one `FINAL:` page per surface", which is prose and counts pages rather than asking what is in them. Shipping Q-0275 the first design drew only the happy path — rest, keyboard focus, empty scene, engine error, in-flight and the folded-bar layout were all missing until the operator asked where the interactions were, and three of those states are pinned by acceptance criteria. This sharpens wanted-item (b) above: the declared coverage set should be **derived from the spec's acceptance criteria**, not hand-written, and the verdict step should check against that list rather than a page count. `render-export-dispatch` / `render-compare` already export `.pen` pages to images, so a model-driven check can read them even where a static one cannot. (found 2026-09-22 shipping Q-0275)

### Milestones Have No Explicit Order

- id: Q-0254
- area: tooling
- type: feat
- since: 2026-09-22
- size: S
- impact: med
- confidence: med

`milestones show` and the `/milestones` dashboard page sort drafts alphabetically and therefore paint the ladder wrong. `buildMilestoneGroupBases` (`src/milestones/lib.ts`) orders by status then `name.localeCompare`, and the frontmatter schema carries only `name` / `status` / `description` — no date, no rank. In a consumer with four drafts the list read `community, energy-addon, garden-addon, public-release`: two paid post-GA addons rendered *above* the GA milestone whose `## Out of Scope` explicitly defers them, and the only place the real sequence lived was prose. Git birth date does not rescue it either — in that consumer one milestone was born 2026-05-13 and the other four all on 2026-07-11, so git order puts milestone 2 first and leaves a four-way tie. Two shapes, pick one in the spec: `since: <YYYY-MM-DD>` stamped by `/noldor-milestone draft` and sorted within each status, falling back to name when absent — the zero-thought default; or an explicit `after: <slug>` honoured by `show`, the dashboard page and `milestones validate` (unknown slug, cycle, two milestones claiming the same predecessor) — right when the ladder disagrees with the calendar. Deletion test: a set of milestones whose alphabetical order contradicts their real sequence renders in the real sequence. (found 2026-09-22)

### Milestone Membership Has No Tagger and No Counter

- id: Q-0255
- area: tooling
- type: feat
- since: 2026-09-22
- size: M
- impact: med
- confidence: med

Milestone membership rots by omission at both ends of the chain, so an active milestone cannot answer how far through it is. **Entry side:** `validate:triage` catches a *typo'd* milestone slug well — an injected bad slug produced 11 `unknown-milestone-ref` errors, and `lefthook/noldor.yml` runs the check on every roadmap/backlog commit — but nothing notices an entry carrying **no** `milestone:` at all. In a consumer mid-milestone, 50 of 54 roadmap entries had none, so `milestones show <active>` listed 4 queued items. The only related command, `features attach-milestone`, is a *verdict* (entry vs parent FD) rather than a tagger, so the fix today is hand-editing N blocks. **Feature side:** `Features (n/n done)` is structurally always `0/0`, because nothing writes a milestone onto a feature MD — `milestones show` renders the section and the schema supports it, but no command sets the field and `/noldor-milestone` only manages the milestone *files*. Candidates: a `milestones assign <slug> <entry…>` for the entry side; have the gate stamp the milestone onto the FD at attach time for the feature side (`attach-milestone` already computes the verdict, so it knows the value) and let `phase-flip-done` move the counter; and surface an unassigned-entry count from `milestones show` or the sdd-report so the gap is visible without a bespoke script. Deletion test: `milestones show <active>` reports a non-zero feature count and names how many queued entries carry no milestone. (found 2026-09-22)

### partially-blocked-by for Partial Dependencies

- id: Q-0256
- area: tooling
- type: feat
- since: 2026-09-22
- size: M
- impact: med
- confidence: med

`blocked-by` is all-or-nothing, so a partial dependency degrades into prose the scorer cannot see. Several entries in a real consumer can start, and two-thirds ship, while one part waits — a bar whose five sections are independently blocked; a panel where one row needs a concept that does not exist yet. Marking the whole entry `blocked-by` divides its score by `1 + unshipped_dep_count` for work that is mostly doable today; leaving it off loses the dependency from the graph entirely, so `/noldor-garden` cannot see it and a reader has to find it in a paragraph. Wanted: a `partially-blocked-by:` that joins the blocked-by graph for cycle detection and `show` output but is **excluded from the dependency factor** in `scoreEntry()` — the semantics being "cannot finish" rather than "cannot start". Open question for the spec: whether `/noldor-gate` should surface the partial blocker at pickup so the agent knows which slice to leave alone, or whether that belongs in the entry body. Deletion test: an entry with only `partially-blocked-by` refs scores as unblocked while still appearing in the dependency graph. (found 2026-09-22)

### Always-Read Capability Index for Agents

- id: Q-0257
- area: docs
- type: feat
- since: 2026-09-22
- size: S
- impact: med
- confidence: low

An agent working in a Noldor consumer did not know the milestone commands existed, and proposed building by hand what the framework already ships. That is a blind spot with no floor under it: nothing guarantees an agent's context window holds a list of what Noldor can do, and `docs/noldor/script-catalog.md` is a doc an agent must think to open rather than one it always has. Wanted: a short, always-read capability index — one line per verb group with its entry doc — small enough to sit in every agent's context alongside the hard rules, and generated rather than hand-maintained so it cannot drift from the CLI the way a hand-written list would. Two things to settle in the spec: what makes it always-read for each runtime (`AGENTS.md` prose, a `.claude/` rule, or both — see Q-0252, which may collapse that question), and how it stays under a size that is actually cheap to carry. Parked at low confidence because the failure is one observation and the remedy is a guess at the mechanism; a second blind-spot sighting would raise it. Deletion test: an agent that has read only the always-read set can name the milestone commands without opening another doc. (found 2026-09-22)

### Design Approval Certifies Provenance, Not Content

- id: Q-0258
- area: tooling
- type: fix
- since: 2026-09-22
- size: M
- impact: high
- confidence: med
- parent: ui-design-review-lane

A `design verdict --approve` record can be internally valid, blob-bound and green while certifying something nobody approved. Two independent ways, both observed in one Q-0275 session. **(1) It signs whatever is on disk and cannot tell that the editor holds newer content.** The approval ran immediately after two new states were drawn and printed `approved: … @ 7f3cfb9cfbb7` — the pre-edit blob, because the editor had not flushed. The record covered six states where the operator had approved eight, and nothing in the output would tell a human that. Candidate: ask the bridge for the open document's top-level page names and refuse, or warn loudly, when the editor's page set differs from what the on-disk blob would produce; at minimum print the page names being signed, so "6 states" is visible when 8 were expected. **(2) The approval binds the `.pen` blob but not the spec, so a spec revision that changes a decision's *shape* silently invalidates a design that still hashes correctly.** Twice in that session a CR round rewrote what the UI *is* — "card withheld below `BESIDE_MIN_WIDTH`" became "card detaches and hangs below the readout"; "totals always pinned" became "the height cap outranks the pinning" — while the `.pen`, and therefore `penBlob`, stayed byte-identical and the approval stayed green. Only the reviewer lane caught it, by reading the spec's own claim that every state was drawn. The blob binding catches "someone edited the design"; the reverse case, "the spec moved under an unchanged design", has no detector at all. Candidate: record the spec's sha, or its decision-list digest, alongside `penBlob`, and have the `ui-reviewer` lane flag a design approved against an older spec. Deletion test: approving with unflushed editor content, and revising a spec decision after approval, each produce a warning or a refusal rather than a green record. (found 2026-09-22 shipping Q-0275)
