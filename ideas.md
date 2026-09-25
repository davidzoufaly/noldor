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
