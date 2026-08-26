# Ideas

Raw entry point for human-generated ideas. `/triage` promotes bullets into `docs/roadmap.md` (flat priority-ordered list) or `docs/backlog.md` (parking lot).

- 3 verticals: tooling, business, core product
- roadmap: flat priority-ordered list (file order = priority); every entry is a `### <Entry Name>` heading at one fixed level — never a `### <Category>` container (`validate:triage` errors on `empty-group-heading`)

## Notes

## Priority

## Not groomed

## Lessons

Raw capture point for operator/agent lessons + gotchas. `/noldor-absorb` classifies each unfiled bullet (`drop | gotcha | actionable | feedback`), files it into framework docs, and stamps `[absorbed YYYY-MM-DD → <dest>]`. Stamped bullets may be pruned — git history is the audit trail.

- `toolchain-floor` reads root tsconfigs only (`TSCONFIG_CANDIDATES` = `tsconfig.base.json`, `tsconfig.json`), so a nested config below the lib floor passes unseen. Found live: `src/dashboard/static/tsconfig.json` sat at `lib: ["ES2023", "DOM"]` while `platform-over-dependency` and `deterministic-cleanup` both bind `**/*.ts` — which includes `drag.ts` and `agents.ts` — and mandate `Set.prototype.union` and `Symbol.dispose`, each a TS2550 under that lib. The `lib-inherited` guard cannot help: it stays quiet because the *root* config declares a `lib`, and it is decided repo-wide by design. So two enforced rules mandated code a real config in this repo rejects, and nothing reported it. Options: walk every tsconfig the workspace scan already finds (the manifest walk is right there), or assert that a nested config either declares no `lib` — inheriting the base — or meets the floor itself. Worth noting `lib` REPLACES rather than merges on `extends`, so putting the floor in a base config protects only children that omit `lib` entirely. (found 2026-08-26, CR on the tsconfig-shared-base refactor)

## Verticals

### Core Product

#### Now

#### Next

#### Later

## Triaged
