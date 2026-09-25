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

### Sync fd-resources Honours --slug

- id: Q-0302
- area: tooling
- type: fix
- since: 2026-09-25
- size: XS
- impact: med
- confidence: high

`noldor sync fd-resources` has no `--slug`: `sync fd-resources --slug <slug>` synced all 95 FDs and updated 15 (`src/sync/sync-fd-resources.ts` never reads the flag), while `sync code-links` / `test-links` / `doc-links` honour it. From a feature worktree that drags unrelated Resources churn (`sdd-co-tag-detector.md`) into the tree; the workaround is `git checkout --` the unrelated FDs. Wanted: `fd-resources` takes `--slug` like its siblings, or refuses a flag it ignores. Deletion test: `sync fd-resources --slug <a>` writes only `docs/features/<a>.md`. (found 2026-09-25, Q-0297)

### Module Map Drops Arrows No Import Backs

- id: Q-0303
- area: tooling
- type: docs
- since: 2026-09-25
- size: XS
- impact: med
- confidence: med

`docs/architecture/modules.md` draws 4 arrows that no import backs, found by `checks arch-baseline` on its first run: `src/autonomous -> src/cr`; `src/cli -> Workflow` and `src/cli -> Projection and reporting` (the CLI reaches them through a computed `import(path)` off the manifest, which a static graph cannot see); `src/hooks -> Quality gates`. They were left out of the architecture baseline, but the mermaid page still draws them. Correct `modules.md`, or generate it from the baseline (the architecture-design-phase spec's follow-up slice). Deletion test: every arrow `modules.md` draws is one `checks arch-baseline` accepts. (found 2026-09-25)

### Validate Flags a Queue Id Carried Twice

- id: Q-0304
- area: tooling
- type: fix
- since: 2026-09-25
- size: S
- impact: med
- confidence: high

Nothing catches a queue id carried twice. Two ways it happened on 2026-09-25: (1) `architecture-design-phase` minted Q-0274 for its FD `entry-id` on its branch while main spent Q-0274 on `fd-resources-hook-skips-flat-feature-docs` (retired in PR #545) — the rebase showed only an `.noldor/id-counter.json` conflict, and it was re-minted as Q-0296; (2) `pendev-ui-design-phase-baseline-validity` then minted Q-0296 for a split-out roadmap block from the same counter the same day, and after #578 merged the rebase had no conflict at all (both sides moved the counter from 296 to 297), `validate triage` stayed green, and only a `git grep Q-0296` showed the FD `entry-id` and the roadmap `- id:` sharing it (re-minted as Q-0297). Wanted: `validate triage` / `validate features` flag an id carried by two live blocks or FDs, or equal to a retired id in `.noldor/retired-entry-ids.json`. Deletion test: a roadmap block and an FD `entry-id` with the same `Q-NNNN` fail validation naming both. (found 2026-09-25)

### Unknown-Command Message Echoes Its Argv

- id: Q-0305
- area: tooling
- type: fix
- since: 2026-09-25
- size: XS
- impact: low
- confidence: high

The unknown-command message (`src/core/framework-skew.ts`) should echo the argv it received. Under zsh, `pnpm noldor $c` with `c="checks template-sync"` passes one argument, and the reply blames framework version skew and prescribes `noldor upgrade`, which points the wrong way (the trap itself is in `docs/noldor/gotchas.md` → Shell & tooling traps). Deletion test: an unknown command whose one argument contains a space is reported with that argument quoted, and without the upgrade advice. (found 2026-09-25)

### Resync sdd-co-tag-detector Resources

- id: Q-0306
- area: tooling
- type: chore
- since: 2026-09-25
- size: XS
- impact: low
- confidence: high

Main's `docs/features/sdd-co-tag-detector.md` has a stale Resources block since #542: the `src/features/seed-test-tags.ts` code link and its test links are missing, plus a blank line after the frontmatter. So the fd-resources hook rewrites it on every commit in a worktree, and the rewrite has to be discarded each time. Commit the resync on main. Still true on 2026-09-25 at b790f51. Deletion test: `pnpm noldor sync fd-resources` on a clean main changes no file. (found 2026-09-25)

### Drain-Lock Readers Share readHolder

- id: Q-0307
- area: tooling
- type: refactor
- since: 2026-09-25
- size: XS
- impact: low
- confidence: high

Code-review low declined on Q-0286 (PR #582), filed so it is not lost: `liveLockPid` and `releaseLock` in `src/autonomous/drain-lock.ts` still hand-parse the lock payload with `JSON.parse`, though the file now exports `readHolder`, which requires a positive-integer pid. Moving them onto it would stop the three readers drifting on what counts as a valid pid. `releaseLock` must keep swallowing read errors, since it runs in crash handlers. Deletion test: `drain-lock.ts` parses the payload in one place. (found 2026-09-25)

### Load-Timeout Tests in Dashboard and sdd-report

- id: Q-0308
- area: testing
- type: fix
- since: 2026-09-25
- size: S
- impact: med
- confidence: med

Two full-suite reds are load timeouts that plain `origin/main` shows too, so a branch that hits them has not broken anything. `src/dashboard/__tests__/dashboard-server.test.ts` → `GET /wip-age?limit=999 clamps to 100…` timed out at 10 s in two full runs of the Q-0286 branch and in two full runs after rebasing Q-0292 onto 26665b4; alone it passes in 3.9 s (three sequential `/wip-age` requests over the live repo history). One `src/garden/__tests__/sdd-report.test.ts` case also timed out; a detached `origin/main` at 519e461 redded the same dashboard case and a different `sdd-report.test.ts` case. Each file passes alone. Same family as Q-0171 (suites that read live repo state). Raise those tests' budgets or cut their cost; until then, compare against an `origin/main` run before blaming the branch. Deletion test: both files pass in three concurrent full-suite runs. (found 2026-09-25 shipping Q-0286 and Q-0292)

### Design Archive Repoints a Folded links.spec

- id: Q-0309
- area: tooling
- type: fix
- since: 2026-09-25
- size: S
- impact: med
- confidence: med

`design archive` cannot repoint a folded `links.spec`. The pre-commit FD sync rewrote a new FD's long spec path as a folded YAML scalar (`spec: >-`, path on the next line), and the archive's textual rewrite only matches the one-line form: it moved the spec, printed `its YAML form could not be rewritten textually; repoint it … by hand` and exited 1. Any slug long enough to push `links.spec` past the YAML line width hits this at gate Step 4. What worked: edit the path under `>-` by hand, then `sync fd-resources`. Wanted: the archive rewrites the key through the YAML parser, or matches the folded form. Deletion test: archiving a spec whose FD holds `links.spec` as a folded scalar repoints it and exits 0. (found 2026-09-25, Q-0297)

### Lane-Error Rounds and the Round Cap

- id: Q-0310
- area: tooling
- type: feat
- since: 2026-09-25
- size: S
- impact: med
- confidence: low

Decide whether a CR round whose only blockers are lane errors (timeouts) counts against the round cap, and whether the drain supervisor should take the no-sleep assertion itself (`caffeinate -is -w <pid>`). On the 2026-09-24 overnight drain a sleeping Mac turned three code rounds red on timeouts alone, and `gate-skill-leftovers-from-q-0192` stopped at the cap without one finding about the change; it shipped on its last retry (PR #549). The operator workaround is in `docs/noldor/autonomy.md` → Operator gotchas. Deletion test: a round red only on lane timeouts leaves the round count unchanged. (found 2026-09-25)

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
