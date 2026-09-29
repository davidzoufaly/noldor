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
