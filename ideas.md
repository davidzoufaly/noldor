# Ideas

Raw entry point for human-generated ideas. `/triage` promotes bullets into `docs/roadmap.md` (flat priority-ordered list) or `docs/backlog.md` (parking lot).

- 3 verticals: tooling, business, core product
- roadmap: flat priority-ordered list (file order = priority); H3 categories group related entries

## Notes

## Priority

- CR flow + Codex fix -> release -> move to standalone repo -> hardening

## Not groomed

## Verticals

### Business

#### Now

#### Next

#### Later

### Tooling

#### Now

- next priority -> be able to dispatch next priority via agent window
- when checking FD also consider checking backlog/if there might be other candidates for the same FD so it can suggest new FD with higher confidence so it will be usefull also later
- milestones to dashboard web
- where are milestones documented?
- is gate function properly documented
- add "remove" button from backlog and roadmap to action column rename it to "actions"
- is scaleforge docs up-to-date?
- test cr codex
- do not stop after development of plan ends [triaged 2026-05-23 → autonomous-plan-to-pr-merge]
- CR gate at Specs/plan level — multi-reviewer (manual + codex + claude-in-terminal-subagent + claude-standalone-spawned-terminal); reuse multiterminal-dev flow but fix its current bug [triaged 2026-05-23 → specs-cr-gate-multi-reviewer]
- after writing-plans confirm, flow must be autonomous through to PR merge [triaged 2026-05-23 → autonomous-plan-to-pr-merge]

^^^

- paraler development
- top ten items roadmap / backlog items noldor

^^^^

- move it to standalone repo -> package
- code reviewer 2.0 -> inspiration from MC Code Reviwer 
- code reviewer configuration for fast-track

rules-cascade v1 follow-ups:

- oxfmt `fmt` pre-commit step errors on `.md`-only commits ("Expected at least one target file") -> forces `--no-verify` on rule/doc-only commits; guard the unconditional `&& pnpm fmt` calls or skip when no formattable targets staged
- rule loader has no filename↔`id` consistency check -> `rules validate` should assert `frontmatter.id === basename(file, '.md')` to avoid confusing `rules resolve`/`list` output
- `.claude/engineering-rules.md:8` (+ `templates/.claude/engineering-rules.md`) references stale `tsconfig.base.json` which doesn't exist in standalone noldor (only `tsconfig.json`)

#### Next

- handoff pro autonomní vývoj -> vlastní writing plans skill? [triaged 2026-05-23 → autonomous-plan-to-pr-merge]
- still does it make sense to introduce SQL into a framework?
- get rid of superpowers -> and disable them + other skills
- framework should consist of mini skills supported by scripts and hooks, only little markdown files (supportive) -> framework docs should be there for me and other contributors not for a agent to use it

CLI standalone tool:

#### Later

### Core Product

#### Now


#### Next


#### Later
