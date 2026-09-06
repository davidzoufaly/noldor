# Ideas

Raw entry point for human-generated ideas. `/triage` promotes bullets into `docs/roadmap.md` (flat priority-ordered list) or `docs/backlog.md` (parking lot).

- 3 verticals: tooling, business, core product
- roadmap: flat priority-ordered list (file order = priority); every entry is a `### <Entry Name>` heading at one fixed level — never a `### <Category>` container (`validate:triage` errors on `empty-group-heading`)
- noUncheckedIndexedAccess: true v baseconfig?

## Notes

## Priority

- when spec or plan is done written -> do real implementation in subagent for clean context? -> can we observe the work? -> some better context magamenent!
- dynamic imports tests, source codes into FD's? Afraid of drift?
- even fast-track could 

## Not groomed

- Extract the shared tsconfig reader into a neutral module. `src/invariants/toolchain-floor.ts` and `src/indirection/detect.ts` each carry their own tsconfig discovery — `findPackageManifests`/`isTsconfigName` on one side, `findTsconfigFiles`/`readTsconfig`/`resolveExtends` on the other — and `detect.ts` already imports `stripJsonc` from `toolchain-floor.ts`, so importing discovery back would close a module cycle. PR #436 duplicated it deliberately and promised this entry in the spec's Risks section. The two walks are not a clean lift (async `readdir` + `WORKSPACE_SCAN_DEPTH` here, sync `readdirSync` + configured scan roots there), so the shared helper has to be designed rather than moved, and it touches the indirection ratchet. `clones check` was green on #436, so this is cohesion debt rather than a live gate failure. Deletion test: both modules import their tsconfig discovery from one place, and neither declares a private copy. (surfaced 2026-09-05, spec CR on nested-tsconfig-lib-floor)

## Lessons

Raw capture point for operator/agent lessons + gotchas. `/noldor-absorb` classifies each unfiled bullet (`drop | gotcha | actionable | feedback`), files it into framework docs, and stamps `[absorbed YYYY-MM-DD → <dest>]`. Stamped bullets may be pruned — git history is the audit trail.

- **CR round cap: the sink goes stale once the cap refuses.** On Q-0083 (PR #437) `cr orchestrate` exited 3 at the cap without dispatching, so `cr aggregate` re-read the *previous* round's sink and reported 3 blockers of which 2 were already fixed in a later commit. The arbitration skeleton `orchestrate` writes is built from those same stale findings, so the operator writes dispositions against a list that no longer matches the tree — I had to hand-verify each blocker against the code before disposing of it. Either the skeleton should re-resolve each blocker's claim against `HEAD` before writing, or `aggregate` should refuse to report a sink whose `baseSha` is behind `HEAD` rather than printing it as current. (found 2026-09-06) [absorbed 2026-09-06 → ideas]

- **CR round ledger records `0 applied, 0 deferred` on every round `orchestrate` writes itself.** Same session: round 1 at code stage had 4 fixes applied, but the ledger shows all four rounds as `0 applied, 0 deferred`. Cause: `cr autofix record --applied 4 --deferred 1` refused with `--deferred 1 disagrees with the sinks: 5 design + 0 unapplied mechanical = 5` and exited non-zero, after which `orchestrate` recorded the round itself with zeros. The strict count check has no escape hatch for "I applied some of the design blockers by hand too", which is the normal shape of an operator round — so the accounting the cap reports back to the operator is silently wrong. Either accept `--deferred` below the sink count when `--applied` covers the difference, or count applied design blockers as applied. (found 2026-09-06) [absorbed 2026-09-06 → ideas]

- **Oscillation detector R3 is pure noise on a greenfield feature.** Nine R3 signals on PR #437, every one of the form "blocker at `<file>:<line>` is about line N, which this series introduced". On a feature that adds new files, *every* line is one the series introduced, so R3 fires on every finding and distinguishes nothing. Worth gating R3 on the file having existed before the series, or on the line having been touched by a *prior round in the same series* rather than by the series as a whole. (found 2026-09-06) [absorbed 2026-09-06 → ideas]

## Verticals

### Core Product

#### Now

#### Next

#### Later

## Triaged

- zabudovat archify do frameworku? [triaged 2026-09-06 → archify-diagrams-in-the-framework]

- **The CR sink goes stale once the round cap refuses.** On Q-0083 (PR #437) `cr orchestrate` exited 3 at the cap without dispatching, so `cr aggregate` re-read the *previous* round's sink and reported 3 blockers of which 2 were already fixed in a later commit. The arbitration skeleton `orchestrate` writes is built from those same stale findings, so the operator writes dispositions against a list that no longer matches the tree, and has to hand-verify each blocker against the code before disposing of it. Either the skeleton re-resolves each blocker's claim against `HEAD` before writing, or `aggregate` refuses to report a sink whose `baseSha` is behind `HEAD` rather than printing it as current. (surfaced 2026-09-06) [triaged 2026-09-06 → stale-cr-sink-reported-after-the-round-cap-refuses]

- **The CR round ledger records `0 applied, 0 deferred` on every round `orchestrate` writes itself.** Round 1 at code stage on PR #437 had 4 fixes applied, but the ledger shows all four rounds as `0 applied, 0 deferred`. Cause: `cr autofix record --applied 4 --deferred 1` refused with `--deferred 1 disagrees with the sinks: 5 design + 0 unapplied mechanical = 5` and exited non-zero, after which `orchestrate` recorded the round itself with zeros. The strict count check has no escape hatch for "I applied some of the design blockers by hand too", which is the normal shape of an operator round — so the accounting the cap reports back to the operator is silently wrong. Either accept `--deferred` below the sink count when `--applied` covers the difference, or count applied design blockers as applied. (surfaced 2026-09-06) [triaged 2026-09-06 → cr-autofix-polish-residue]

- **Oscillation detector R3 is pure noise on a greenfield feature.** Nine R3 signals on PR #437, every one of the form "blocker at `<file>:<line>` is about line N, which this series introduced". On a feature that adds new files, *every* line is one the series introduced, so R3 fires on every finding and distinguishes nothing. Gate R3 on the file having existed before the series, or on the line having been touched by a *prior round in the same series* rather than by the series as a whole. (surfaced 2026-09-06) [triaged 2026-09-06 → oscillation-detector-r3-fires-on-every-greenfield-finding]
