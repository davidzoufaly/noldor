# Ideas

Raw entry point for human-generated ideas. `/triage` promotes bullets into `docs/roadmap.md` (flat priority-ordered list) or `docs/backlog.md` (parking lot).

- 3 verticals: tooling, business, core product
- roadmap: flat priority-ordered list (file order = priority); H3 categories group related entries

## Notes

## Priority

## Not groomed

## Lessons

Raw capture point for operator/agent lessons + gotchas. `/noldor-absorb` classifies each unfiled bullet (`drop | gotcha | actionable | feedback`), files it into framework docs, and stamps `[absorbed YYYY-MM-DD → <dest>]`. Stamped bullets may be pruned — git history is the audit trail.

- fast-track carries no FD, so a `// @tests: <fast-track-slug>` tag makes `validate features` fail repo-wide (`unknown feature slug`) and blocks EVERY commit until removed — only tag tests with slugs that have a `docs/features/<slug>.md`. Either the validator error should hint "no FD? remove the tag (fast-track has none)" or testing-principles.md should warn. (surfaced PR #216)
- never read `$?` right after `git commit ... | tail` — it's `tail`'s exit, not git's, so a failed commit looks successful (files silently stay staged). Use `${PIPESTATUS[0]}` or drop the pipe. Candidate for a `noldor commit` wrapper that surfaces the real exit + post-commit status. (surfaced PR #216)
- oxfmt reflows multi-line `import { ... }` to a single line, so a hand-written multi-line import fails `fmt --check` and blocks the commit. Consider making the fmt pre-commit job auto-fix + `stage_fixed` instead of check-only. (surfaced PR #216)
- (feedback) operator preference: when a trap/gotcha is found, fix it in the framework directly (code fix, or file into framework docs via `## Lessons` → `/noldor-absorb`) rather than journaling it in the agent's private memory dir. Noldor is a product — lessons belong in the shared framework, not a personal sidecar. Reserve private memory for what the framework can't hold.
- `pnpm release` surfaces its release-prep gates ONE AT A TIME (stale `.noldor/session.json` → stale graph → stale garden receipt → stale `docs/sdd-report.md`), each abort costing a full re-run to discover the next. Add a `release --preflight` / first-rung aggregate that reports ALL failing gates at once and offers auto-remediation (clear stale session, stamp receipt, point to the sweep). (surfaced open-source publish, PRs #230-#237)
- `docs/sdd-report.md` is NON-IDEMPOTENT across environments: it embeds CR/drain metrics (`perLane` blockers/suggestions, escalation `history`, `lastRun`) read from local untracked `.noldor/cr/` + drain-state. Regenerating it in a git WORKTREE sees a fresh empty `.noldor/` → commits empty metrics → the release regen (main workspace, real metrics) drifts → sdd-report gate aborts. The gate only tolerates the review-skip *count* line (`onlyReviewSkipCountChanged`), not the metrics block. Fix: mask the volatile metrics block in the gate diff like the count line, OR source metrics deterministically, OR doc "regen sdd-report only from the main workspace (release-sweep path), never a worktree." (surfaced v1.0.2 release)
- `npm publish --provenance` on a package npm has never seen REQUIRES an explicit `--access public` — even for UNSCOPED names (EUSAGE: "Can't generate provenance for new or private package"). Our publish-workflow spec/test wrongly asserted `--access public` ABSENT. Make it an asserted invariant + consider a CI dry-run publish on the release PR so it fails before a real `v*` tag, not after. (surfaced v1.0.1 publish)
- npm new-package moderation BLOCKS unscoped names too similar to popular packages: unscoped `noldor` was rejected ("too similar to `color`"), forcing a scope (`@david.zoufaly/noldor`). `noldor doctor` / release-preflight should probe name availability + moderation early (before tagging), and init/docs must not promise an unscoped name without checking. (surfaced v1.0.1 publish)
- CI `NPM_TOKEN` must be able to BYPASS 2FA — a Classic *Publish* token or a plain granular token 403s ("Two-factor authentication or granular access token with bypass 2fa enabled is required"). Need a Classic **Automation** token (or granular-with-2FA-bypass), and a FIRST publish also needs create-package permission (a token scoped to only the not-yet-existing package can't create it). adoption-guide/release docs should state the required token type. (surfaced v1.0.1 publish)
- `pr-flow` post-merge local-main sync fails with `fatal: 'main' is already used by worktree at <main-workspace>` when run FROM a feature worktree (main is checked out in the main workspace). Cosmetic (PR still merges) but noisy + leaves local main unsynced from the worktree side. pr-flow should detect worktree context and skip/redirect the `git checkout main` sync. (surfaced repeatedly, PRs #230-#237)
- Recovery pattern to document: when the tag-triggered publish fails AFTER `pnpm release` already tagged+pushed (workflow bug / token / name), fix on main via fast-track, then `git tag -f v<x> HEAD && git push -f origin v<x>` re-fires `publish.yml` with the fix — no second `pnpm release`, avoids re-hitting graph/garden/sdd gates. Then `rm .noldor/release-state.json` (resume can't finalize once HEAD moved past the bump commit). (surfaced v1.0.1 publish)
- Manually driving a fast-track/sweep in a worktree: EASY to forget writing `.noldor/session.json` first — the commit then fails at the trailer-inject/validate stage with no obvious "missing session" hint. `worktrees create` could scaffold a session-marker stub, or the failure should say "no `.noldor/session.json` — did you skip the gate scaffold?". (surfaced PRs #234, #236)

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
