# Ideas

Raw entry point for human-generated ideas. `/triage` promotes bullets into `docs/roadmap.md` (flat priority-ordered list) or `docs/backlog.md` (parking lot).

- 3 verticals: tooling, business, core product
- roadmap: flat priority-ordered list (file order = priority); every entry is a `### <Entry Name>` heading at one fixed level — never a `### <Category>` container (`validate:triage` errors on `empty-group-heading`)

## Notes

## Priority

## Not groomed

## Lessons

Raw capture point for operator/agent lessons + gotchas. `/noldor-absorb` classifies each unfiled bullet (`drop | gotcha | actionable | feedback`), files it into framework docs, and stamps `[absorbed YYYY-MM-DD → <dest>]`. Stamped bullets may be pruned — git history is the audit trail.

## Verticals

### Core Product

#### Now

#### Next

#### Later

## Triaged

- SDD report ignores ADR 0009 (surfaced 2026-09-26, PR #640). ADR 0009 says a shared helper may have no owner, but detector 9 ("Code files not referenced by any feature") still counts every ownerless file, and detector 19 ("Done features without code") counts FDs that #636 emptied on purpose because their code lives in shared files (the five dashboard page FDs, `scripts-reorganization-by-feature-area`, `self-boundaries-declaration-and-cycle-break`). After #640 that leaves 17 + 7 rows that are honest, not gaps. Needs a way to say "ownerless on purpose" (a config list or an FD sentinel stronger than `['n/a']`) so the counts mean something. Two fast-track follow-ups from the same pass: (a) add `// @fd:` headers to `src/design/editor-launch.ts` (auto-open-design-artifacts), `src/autonomous/drain-eligibility.ts` + `src/autonomous/status-cli.ts` (autonomous-queue-drain-runner), `src/cr/lanes/codex.ts` (review-run-lifecycle-module), `src/garden/detectors/fd-command-rot.ts` (skill-vs-code-drift-detector) — those FDs build links.code from headers, so a links.code-only edit gets dropped; (b) the new owners raised "Tests with incomplete co-tag" 1 → 33 — run `pnpm noldor features seed-test-tags` and add the tags. Also: `fill-links-code-gaps --apply` leaves `.cache/backfill-backups/` untracked and not gitignored. [triaged 2026-09-29 → fd-headers-for-five-ownerless-files, gitignore-cache-backfill-backups, seed-missing-test-co-tags, sdd-report-honours-ownerless-on-purpose]
- Session retro auto-capture (follow-up to Q-0026 memory-intake): today nothing makes an agent write what it learned. The `## Lessons` + `/noldor-absorb` loop only fires when someone asks, so lessons leak into the assistant's private memory instead (charuy, Q-0321, PR #346: the `Why:`-vs-`Why —` PR-summary trap went to memory, three follow-ups only reached `ideas.md` on request). Add a gate step after merge (Step 4.11, before the Step 5 handoff), on every path: the agent appends (1) follow-ups and unfixed findings — verifier notes, deferred review lows, spec drift, unpriced or skipped bits — as raw bullets under `## Not groomed`, and (2) traps that cost a debugging cycle under `## Lessons`, each with slug + PR + date, and never names the next roadmap entry (always-clear stays intact). Open: (a) scaffold `## Lessons` when a consumer's `ideas.md` lacks it (charuy's has none); (b) `ideas.md` is gitignored in some consumers (charuy) and tracked in others (noldor), so the step writes the file and never commits it; (c) an empty retro is fine and should say so, not pad; (d) a drain child needs the same step, headless. Noted 2026-10-05 (David), needs triage. [triaged 2026-10-07 → session-retro-auto-capture]
- Give owners to the last five real-gap code orphans (surfaced 2026-09-29, PR #670). With `consumer.ownerless` in place, "Code files not referenced by any feature" lists only files that are about one feature and lack a `// @fd:` header: `src/cr/cut-scan.ts`, `src/cr/geometry/geometry-export-cli.ts`, `src/cr/lanes/geometry-extract-dispatch.ts`, `src/design/arch-draw.ts`, `src/release/index.ts`. Add a header naming each file's FD (the report's probable-owner hint is a start), then re-run `pnpm noldor features seed-test-tags` for the co-tags the new owners raise. [triaged 2026-10-07 → fd-headers-for-five-real-gap-orphans]
- Optional jscpd backend for `noldor clones` in non-TS/JS repos. Today `src/clones/tokenize.ts` only scans TS/JS, so a consumer with mostly Python, Go or other code gets no clone signal. jscpd covers 150+ languages. It was turned down as a dependency in 2026-07 (code-clone-detector spec, D1: big dependency tree shipped to every consumer). So: keep our detector as the default, and add an opt-in `clones.engine: jscpd` that runs jscpd only when the consumer has it installed, maps its JSON into `CloneReport`, and feeds the same baseline ratchet and diff-scoped `check`. Not needed until a non-TS consumer shows up (charuy is TS). Noted 2026-10-07 (David), needs triage. [triaged 2026-10-07 → optional-jscpd-backend-for-clones]
- Dead-code detection with knip (unused files, unused exports, unused and unlisted dependencies). Nothing in the framework finds dead code today. `noldor clones` finds code that exists twice, not code that should not exist. The `/noldor-refactor` report's "Dead Code" section is filled in by hand. The dashboard already looks for an "Unused Exports" count (`src/dashboard/data.ts:2125`) that nothing produces. Two steps, both wanted: (1) noldor itself: add knip as a devDependency, run it in pre-push or CI, and ratchet it like `clones` (a recorded baseline; the count may not rise). This ships nothing to consumers. (2) Consumers: an opt-in check that runs only when the consumer has knip installed, feeds the same ratchet, and surfaces the counts in `sdd-report`, the dashboard slot above, and the `/noldor-refactor` Dead Code section. Do (1) first and let it prove itself, then (2). Noted 2026-10-07 (David), needs triage. [triaged 2026-10-07 → dead-code-detection-with-knip]
- sometimes I got during priority pick 2 q sometimes only 1 at it immediattely starts working on the highest priority -> confusing for the user [triaged 2026-10-07 → priority-pickup-always-asks-the-same-way]
- Graph freshness is checked once per session, at the spec's structural-read step, and never again (surfaced 2026-10-04, charuy Q-0145). `noldor-spec` step 1.7 runs `design graph-context`, rebuilds on `stale`,
  reads the digest, then restores `graphify-out/`. Nothing re-checks before implementation starts, during it, or before the code-stage CR, so a long session (spec → 3 review rounds → code) can plan and code against
  a graph the tree has moved past, and other sessions' merges to `origin/main` mid-session are never pulled in. Worktrees branch from `origin/main` at create time and `pr-flow` fetches at the end, but nothing
  fetches in between. Options: (a) gate Step 3.5 (rule brief before the first edit) also runs `design graph-context` over the files about to be touched and rebuilds locally on `stale` (~15 s, restored afterwards,
  never committed); (b) a `git fetch origin main` + "main moved N commits since worktree create" notice at the same seam, so the operator can merge main in before coding rather than at push. [triaged 2026-10-07 → graph-and-main-freshness-before-coding]
- if feature is e2e tested on UI end -> attach screenshot to the PR [triaged 2026-10-07 → ui-proof-screenshots-on-the-pr]
- when features is UI ship working screenshot as a proof to PR [triaged 2026-10-07 → ui-proof-screenshots-on-the-pr]
- When done agent should report the PR with the link to the PR [triaged 2026-10-07 → gate-final-report-names-the-pr-url]
