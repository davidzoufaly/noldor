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

#### Next

#### Later

- `noldor commit` wrapper: run the commit and surface the REAL git exit + post-commit status — `$?` after `git commit ... | tail` is `tail`'s exit, so a failed commit looks successful (files silently stay staged); the trap is documented in git-and-commits.md but a wrapper removes the foot-gun. (surfaced PR #216)
- make the fmt pre-commit job auto-fix + `stage_fixed` instead of check-only — oxfmt reflows multi-line `import { ... }` to a single line, so a hand-written multi-line import fails `fmt --check` and blocks the commit. (surfaced PR #216)
- `release --preflight` / first-rung aggregate that reports ALL failing release-prep gates at once (stale `.noldor/session.json` → stale graph → stale garden receipt → stale `docs/sdd-report.md`) and offers auto-remediation — today each abort costs a full re-run to discover the next gate. (surfaced open-source publish, PRs #230-#237)
- assert `--access public` as a publish-workflow invariant (npm `--provenance` on a never-published package REQUIRES it, even unscoped — EUSAGE "Can't generate provenance for new or private package"; our spec/test wrongly asserted it absent) + consider a CI dry-run publish on the release PR so it fails before a real `v*` tag. (surfaced v1.0.1 publish)
- `noldor doctor` / release-preflight should probe npm name availability + moderation early (before tagging) — npm new-package moderation blocks unscoped names too similar to popular packages (unscoped `noldor` rejected: "too similar to `color`", forcing `@david.zoufaly/noldor`); init/docs must not promise an unscoped name without checking. (surfaced v1.0.1 publish)
- pr-flow should detect worktree context and skip/redirect the post-merge `git checkout main` sync — running from a feature worktree fails with `fatal: 'main' is already used by worktree at <main-workspace>`; cosmetic (PR still merges) but noisy + leaves local main unsynced. (surfaced repeatedly, PRs #230-#237)

### Core Product

#### Now

- better unit tests rules on top of https://github.com/gooddata/gdc-mastercard-panther/pull/2542

#### Next

#### Later
