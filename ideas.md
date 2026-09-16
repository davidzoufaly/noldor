# Ideas

Raw entry point for human-generated ideas. `/triage` promotes bullets into `docs/roadmap.md` (flat priority-ordered list) or `docs/backlog.md` (parking lot).

- 3 verticals: tooling, business, core product
- roadmap: flat priority-ordered list (file order = priority); every entry is a `### <Entry Name>` heading at one fixed level — never a `### <Category>` container (`validate:triage` errors on `empty-group-heading`)

## Notes

## Priority

## Not groomed

## Lessons

Raw capture point for operator/agent lessons + gotchas. `/noldor-absorb` classifies each unfiled bullet (`drop | gotcha | actionable | feedback`), files it into framework docs, and stamps `[absorbed YYYY-MM-DD → <dest>]`. Stamped bullets may be pruned — git history is the audit trail.

- v1.10.0 release aborted on the `sdd-report` gate minutes after a fully green `--preflight`, because the report's **override-record list is filtered by a 30-day rolling window** and commit `5c35053` (2026-08-17) aged out of it mid-sweep. The sweep's step 5.5 / 6.5 pre-empts cannot outrun a clock: they re-run the regen at a point in time, and any later clock-derived line can re-drift before `pnpm release` reaches its own gate. The adjacent `Review-skip count` line is already masked by `VOLATILE_METRIC_IDS` (`src/garden/sdd-report-format.ts`), but the override-record bullets it sits under are not, so only the bullets block. Candidate fixes: (a) mask the override-record section the same way `onlyVolatileSectionsChanged` masks the metric blocks, since both are clock-derived rather than content-derived; or (b) have the release gate re-run the regen itself and auto-commit a diff that is *only* window-aging. Cost this time: one extra micro-chore PR (#469) + a second `pnpm release` run.
- `pnpm release`'s npm-publish wait (290s) starts when the tag is pushed, but the publish workflow still has to queue and run, and npm then warns the package "may take a few minutes to become available". v1.10.0 published fine (`+ @david.zoufaly/noldor@1.10.0`, signed provenance, workflow green in 40s) yet the release still aborted on a registry-visibility timeout. `pnpm release --resume` finished it cleanly. Consider raising the wait, or starting the clock when the workflow reports success rather than at tag push.

## Verticals

### Core Product

#### Now

#### Next

#### Later

## Triaged
