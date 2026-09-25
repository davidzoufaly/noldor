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

- compact the gate skill: `noldor-gate` SKILL.md is ~19k tokens and loads whole every session, a third of it branches a session never takes — split it into a short router plus on-demand branch files, move incident history to gotchas/runbooks, and add a skill-size ratchet so it cannot regrow (lost-in-the-middle risk) [triaged 2026-09-25 → gate-skill-loads-only-the-branch-a-session-takes]
- compact the spec skill the same way: `noldor-spec` SKILL.md is ~8k tokens, mostly the UI and architecture design steps, read in full even when both verdicts are `skip` [triaged 2026-09-25 → spec-skill-loads-its-design-steps-only-when-required]
- Drain the ~200 "Tests with incomplete co-tag" rows `garden detect` lists once the graph is fresh (they hid behind one degraded-mode row before). `pnpm noldor features seed-test-tags` names them; the work is adding the missing `// @tests:` co-tags per file family (autonomous, cr, dashboard, design, garden, release…), likely one PR per family. Follow-up to Q-0172, which built the seeder but filed no drain. (found 2026-09-25, garden pass) [triaged 2026-09-25 → drain-the-incomplete-test-co-tags]
- `migrationCoverage` fires on an additive, optional-only schema change: `src/core/consumer-config.ts` gained `uiCoverage` since v1.13.0, which no existing config can fail on, yet the detector demands a `src/migrations/<x.y.z>.ts`. Either teach `evaluateCoverage` an explicit "no migration needed" declaration (a commit trailer or a changelog line), or ship a no-op migration each time — the first keeps the gate honest without noise migrations. (found 2026-09-25, garden pass) [triaged 2026-09-25 → migration-coverage-fires-on-additive-only-schema-changes]
- Toolchain floor warns that `tsconfig.base.json` lacks `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Decide: schedule the migration (turn each on, fix the fallout, likely one PR per flag) or record a waiver in `.noldor/config.json` `consumer.toolchainFloor.waivers` with the reason. Until then the warn stays in every garden pass. (found 2026-09-25, garden pass) [triaged 2026-09-25 → nouncheckedindexedaccess-in-the-toolchain-floor]
