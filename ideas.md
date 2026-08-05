# Ideas

Raw entry point for human-generated ideas. `/triage` promotes bullets into `docs/roadmap.md` (flat priority-ordered list) or `docs/backlog.md` (parking lot).

- 3 verticals: tooling, business, core product
- roadmap: flat priority-ordered list (file order = priority); H3 categories group related entries

## Notes

## Priority

## Not groomed

## Lessons

Raw capture point for operator/agent lessons + gotchas. `/noldor-absorb` classifies each unfiled bullet (`drop | gotcha | actionable | feedback`), files it into framework docs, and stamps `[absorbed YYYY-MM-DD → <dest>]`. Stamped bullets may be pruned — git history is the audit trail.

## Verticals

### Tooling

#### Now

- make the reviewer subagent CR lane mandatory for every spec and plan artifact in both manual and autonomous flows — gate Step 2.5's lane picker currently allows `proceed-without-review` or a lane selection without `reviewer`, and autonomous `crLanes.<kind>` config can drop it; enforce reviewer as an always-on lane (union it into any selection, remove/guard the skip option) so no spec/plan reaches implementation unreviewed. [triaged 2026-08-04 → mandatory-reviewer-lane-spec-plan-cr]
- add `reuse` to the built-in `fast-track` review profile (`src/core/review-profile.ts` — today `['correctness','security']`) — fast-track is the XS/S no-FD lane, exactly where copy-paste lands, and it is the one lane with no reuse review at all; cost is one extra dimension line in a low-effort pass. (surfaced consumer reuse-story audit 2026-08-04) [triaged 2026-08-05 → cr-review-dimension-coverage]
- `noldor clones check --against <base-sha>`: diff-scoped clone gate that fails only on clone groups with ≥1 instance inside the diff and ≥1 outside it, reporting the duplicated span (`src/foo.ts:12-40`) — the current whole-corpus `thresholdPct` gate is unusable for consumers (pct drifts as the repo grows, nobody tunes it, so it stays unset = always green); diff-scoping needs zero tuning and is safe to default-on in `templates/lefthook.yml` pre-push. (surfaced consumer reuse-story audit 2026-08-04) [triaged 2026-08-05 → diff-scoped-clone-gate]
- ship a checked-in `.oxlintrc.json` (self-host + `templates/`) with `correctness`/`suspicious`/`perf` categories explicit — `.claude/engineering-rules.md` line 8 claims alignment with `.oxlintrc.json` but no such file exists in the repo, so `pnpm lint` (`oxlint --deny-warnings`) runs on bare defaults; a real config also buys free machine coverage for error-flow (`no-empty` catch blocks) and concurrency (`no-async-promise-executor`, `require-atomic-updates`), both of which are prose-only today. (surfaced code-dimension coverage audit 2026-08-05) [triaged 2026-08-05 → checked-in-oxlint-config]
- add `concurrency` and `effects` to `reviewDimensionSchema` (`src/core/review-profile.ts`) + one `DIMENSION_GUIDE` line each in `src/cr/lanes/subagent-dispatch.ts` — `ALL_DIMENSIONS` is derived from the enum so the `default` profile picks new dimensions up automatically; today side-effect/purity discipline is React-only prose and concurrency is a single clause inside the `correctness` guide string, despite the parallel drain running locks + PID liveness + worktree contention. (surfaced code-dimension coverage audit 2026-08-05) [triaged 2026-08-05 → cr-review-dimension-coverage]

#### Next

- migrate the prose-only dimensions out of the 181-line `engineering-rules.md` baseline into scoped `enforce: true` cascade rules — error flow (result types, throw only for programmer errors, catch external at the boundary, never swallow) sits at line 137 of a wall of text and is machine-unchecked; as `.noldor/rules/error-result-types.md` with `applies-to: ["src/**/*.ts"] / stage: [code] / enforce: true` it lands in the enforce bucket exactly on the files being edited. Same treatment for state discipline and concurrency. (surfaced code-dimension coverage audit 2026-08-05) [triaged 2026-08-05 → prose-rules-to-enforce-cascade-rules]

- spec-lint should reject an approved spec whose design ledger has zero `Existing support` anchors — `pnpm noldor design log --support` (Q-0053) already captures prior art but nothing enforces it, so `Existing support (0) - (none recorded)` passes silently; require at least one anchor or an explicit `--support "none: <reason>"`, which also gives the CR reuse dimension a falsifiable claim to check against. (surfaced consumer reuse-story audit 2026-08-04) [triaged 2026-08-05 → spec-lint-prior-art-requirement]
- `pnpm noldor design prior-art --slug <s> --query "<description>"` — deterministic prior-art seeding that writes `--support` entries from three substrates that already exist (FD `links.code` reverse lookup via `buildFileToFdsMap`, graphify community membership + export names, clone-corpus near-signature match via `src/clones/tokenize.ts`); today `/noldor-spec` step 3 leaves prior-art discovery to agent discretion ("one `--support` per anchor you found while grounding"), which is unauditable. (surfaced consumer reuse-story audit 2026-08-04) [triaged 2026-08-05 → design-prior-art-seeder]

#### Later

- clone-duplication ratchet instead of an absolute threshold — record a baseline in `.noldor/clones-baseline.json` and fail only on an increase, so consumers adopt the gate with no tuning and the number can only go down. Alternative to / complement of the diff-scoped `clones check --against`. (surfaced consumer reuse-story audit 2026-08-04) [triaged 2026-08-05 → diff-scoped-clone-gate]
- make the graph staleness gate loud in non-interactive contexts — graph-consuming detectors currently skip with a single meta-gap when `graphify-out/graph.json` is older than the newest source file, which nobody reads during an autonomous drain; at minimum `garden-detect` should exit non-zero on the meta-gap in CI mode (or auto-regen). (surfaced consumer reuse-story audit 2026-08-04) [triaged 2026-08-05 → graph-staleness-gate-loud-in-ci]

- `noldor commit` wrapper: run the commit and surface the REAL git exit + post-commit status — `$?` after `git commit ... | tail` is `tail`'s exit, so a failed commit looks successful (files silently stay staged); the trap is documented in git-and-commits.md but a wrapper removes the foot-gun. (surfaced PR #216) [triaged 2026-08-05 → noldor-commit-wrapper]
- make the fmt pre-commit job auto-fix + `stage_fixed` instead of check-only — oxfmt reflows multi-line `import { ... }` to a single line, so a hand-written multi-line import fails `fmt --check` and blocks the commit. (surfaced PR #216) [triaged 2026-08-05 → fmt-pre-commit-auto-fix]
- `release --preflight` / first-rung aggregate that reports ALL failing release-prep gates at once (stale `.noldor/session.json` → stale graph → stale garden receipt → stale `docs/sdd-report.md`) and offers auto-remediation — today each abort costs a full re-run to discover the next gate. (surfaced open-source publish, PRs #230-#237) [triaged 2026-08-05 → release-preflight-aggregate]
- assert `--access public` as a publish-workflow invariant (npm `--provenance` on a never-published package REQUIRES it, even unscoped — EUSAGE "Can't generate provenance for new or private package"; our spec/test wrongly asserted it absent) + consider a CI dry-run publish on the release PR so it fails before a real `v*` tag. (surfaced v1.0.1 publish) [triaged 2026-08-05 → publish-access-public-invariant]
- `noldor doctor` / release-preflight should probe npm name availability + moderation early (before tagging) — npm new-package moderation blocks unscoped names too similar to popular packages (unscoped `noldor` rejected: "too similar to `color`", forcing `@david.zoufaly/noldor`); init/docs must not promise an unscoped name without checking. (surfaced v1.0.1 publish) [triaged 2026-08-05 → release-preflight-aggregate]
- pr-flow should detect worktree context and skip/redirect the post-merge `git checkout main` sync — running from a feature worktree fails with `fatal: 'main' is already used by worktree at <main-workspace>`; cosmetic (PR still merges) but noisy + leaves local main unsynced. (surfaced repeatedly, PRs #230-#237) [triaged 2026-08-05 → pr-flow-worktree-checkout-skip]

### Core Product

#### Now

- better unit tests rules on top of https://github.com/gooddata/gdc-mastercard-panther/pull/2542 [triaged 2026-08-05 → better-unit-test-rules]

#### Next

#### Later
