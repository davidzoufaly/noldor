# Ideas

Raw entry point for human-generated ideas. `/triage` promotes bullets into `docs/roadmap.md` (flat priority-ordered list) or `docs/backlog.md` (parking lot).

- 3 verticals: tooling, business, core product
- roadmap: flat priority-ordered list (file order = priority); H3 categories group related entries

## Notes

## Priority

- fix e2e pipeline ci
- framework top bar position -> move to the last position and standalone section [shipped 2026-07-14 → PR #224 dashboard-nav-reorg]
- vision, milestones, roadmap, backlog -> separe section [shipped 2026-07-14 → PR #224 dashboard-nav-reorg]
- then features, docs, releases [shipped 2026-07-14 → PR #224 dashboard-nav-reorg]
- blocked-by to gaps, velocity,.. another section [shipped 2026-07-14 → PR #224 dashboard-nav-reorg]
- pr-flow direct-merge fallback (fires when repo auto-merge is disabled) is buggy: (1) attempts a local `main` checkout/merge that fails from a worktree with `fatal: 'main' is already used by worktree` — should merge via the gh API with no local checkout; (2) never deletes the remote `fast/<slug>` branch (the auto-merge path does), so orphan branches accumulate and must be `git push origin --delete`d by hand. Fix both in the `openAndAutoMerge` fallback in src/core/pr-flow.ts. (surfaced shipping PR #216)

## Not groomed

## Lessons

Raw capture point for operator/agent lessons + gotchas. `/noldor-absorb` classifies each unfiled bullet (`drop | gotcha | actionable | feedback`), files it into framework docs, and stamps `[absorbed YYYY-MM-DD → <dest>]`. Stamped bullets may be pruned — git history is the audit trail.

- fast-track carries no FD, so a `// @tests: <fast-track-slug>` tag makes `validate features` fail repo-wide (`unknown feature slug`) and blocks EVERY commit until removed — only tag tests with slugs that have a `docs/features/<slug>.md`. Either the validator error should hint "no FD? remove the tag (fast-track has none)" or testing-principles.md should warn. (surfaced PR #216)
- never read `$?` right after `git commit ... | tail` — it's `tail`'s exit, not git's, so a failed commit looks successful (files silently stay staged). Use `${PIPESTATUS[0]}` or drop the pipe. Candidate for a `noldor commit` wrapper that surfaces the real exit + post-commit status. (surfaced PR #216)
- oxfmt reflows multi-line `import { ... }` to a single line, so a hand-written multi-line import fails `fmt --check` and blocks the commit. Consider making the fmt pre-commit job auto-fix + `stage_fixed` instead of check-only. (surfaced PR #216)
- (feedback) operator preference: when a trap/gotcha is found, fix it in the framework directly (code fix, or file into framework docs via `## Lessons` → `/noldor-absorb`) rather than journaling it in the agent's private memory dir. Noldor is a product — lessons belong in the shared framework, not a personal sidecar. Reserve private memory for what the framework can't hold.

## Verticals

### Business

#### Now

#### Next

#### Later

### Tooling

#### Now

#### Next

#### Later

### Core Product

#### Now

#### Next

#### Later
