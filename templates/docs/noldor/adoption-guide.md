---
noldor-page: adoption-guide
introduced: 0.4.0
---

# Adoption Guide

Noldor is a standalone package. A consuming repo installs it as a dev dependency and is driven entirely through the `noldor` CLI plus a single `.noldor/config.json` — no framework paths are hard-coded to any one project.

## Prerequisites

Noldor is opinionated, not configurable (vision). It hard-assumes its home stack; the floor below is **not negotiable pre-1.0**. `pnpm noldor doctor` probes every row with a floor and fails with a pointer here, so a mismatched adopter finds out at minute one, not mid-gate. Source of truth: `src/core/prerequisites.ts`.

| Prerequisite | Floor | Where assumed | If absent |
| ------------ | ----- | ------------- | --------- |
| Node.js | ≥ 20 | `bin/noldor.mjs` + tsx runtime execute every CLI surface | nothing runs |
| pnpm | ≥ 9 | every scaffolded lefthook job and the gate/release/prep pipelines shell out via `pnpm …` | hooks and pipelines error mid-run |
| git | ≥ 2.30 | worktrees, `interpret-trailers`, porcelain parsing across `src/` | drain/gate/pr-flow fail on git verbs |
| gh CLI | ≥ 2 | pr-flow PR create/merge, release, drain salvage | ship steps fail at PR creation |
| lefthook | ≥ 1 | runs every commit/push hook | gate enforcement silently never fires |
| agent runner | per `agents.versionFloors` | driving agent for gate/drain/CR (`claude` default; `codex`/`opencode` per `agents` config) | drain spawns nothing; probed by the existing runner check |
| package scripts `lint`, `fmt`, `fmt:check`, `test` | — | the scaffolded lefthook config invokes them (`pnpm lint`, `pnpm fmt`, `pnpm --silent fmt:check`); verify lane + release run `pnpm test` (vitest assumed) | pre-commit jobs fail with "missing script" |
| Conventional Commits | — | commit-msg validators (`noldor-scope`, `feature-slug-scope`, trailer schema) and changelog derivation parse `type(scope): subject` | every commit is rejected at commit-msg |

Swappability is out of scope here by design — abstraction decisions (other package managers, other agents, other hook runners) belong to the `portable-gate-entrypoint-for-non-claude-runners` roadmap entry. This matrix only makes the floor visible.

## Bootstrap

1. **Install** the package as a dev dependency from the public npm registry: `pnpm add -D noldor`. (Framework contributors point at a sibling clone instead: `"noldor": "file:../noldor"`.)
2. **Scaffold** the framework files into your repo: `pnpm noldor init`. This drops the `docs/noldor/` rule pages, the lefthook config, the skill bundle, a starter `.noldor/config.json` (only when absent — never overwritten, even by `--update`), and `.noldor/rollout-marker` (arms the gate validators; commit it). Re-run `pnpm noldor init --update` to pull template updates, or `pnpm noldor doctor` to diff your copy against the package templates.
3. **Configure** the scaffolded `.noldor/config.json`: fill the `consumer:` block with your repo's real values (see field table below).
4. **Hooks** install automatically via the package's `postinstall` (`lefthook install`; skipped with a note when lefthook isn't present, e.g. registry installs without devDeps).

After pulling a newer framework version, run `pnpm noldor doctor` — a
`framework skew` warning means the consumer's tree is anchored to an older
schema version. Run `pnpm noldor upgrade --dry-run` to review the migration
diffs, then `pnpm noldor upgrade` on a clean branch to apply them. See
[versioning.md](versioning.md#version-aware-upgrade).

> **First commit & gotchas.** The scaffolded lefthook jobs shell out to your `lint` / `fmt` / `fmt:check` / `test` scripts and to `lefthook` itself — add any you lack (`pnpm add -D lefthook`; add the four package scripts if missing) so the first commit's hooks don't fail with "missing script". The bootstrap commit stages `docs/noldor/**`, but the `noldor-scope` hook allowlists the `init` scaffold set, so it lands clean (no `(noldor)` scope required). Once those files are tracked, the pre-edit guard arms: the **next** edit to a tracked file needs a `/gate` session. Adopting the lint floor (`oxlint --deny-warnings`) on a repo that already has warnings will block that first commit — fix them, or stage an oxlint ignore ramp before adopting.

## `.noldor/config.json` → `consumer:` block

| Field               | Meaning                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| `name`              | Consumer project name (used in logs and release output).                   |
| `repoUrl`           | Repository URL (used for changelog/PR links).                              |
| `lockstepPackages`  | Paths to the `package.json` file(s) version-bumped together each release (each is read and rewritten in place). A single-package repo lists `["package.json"]`. |
| `scanPaths`         | Source roots the SDD detectors + graph-freshness scan (e.g. `["src"]`).    |
| `boundaries`        | dependency-cruiser forbidden-rule shapes for the invariants check.         |
| `deprecatedPackages`| Packages flagged on import.                                                |
| `e2ePrefix`         | Path prefix for e2e tests.                                                 |
| `samplesPath`       | Path to sample/fixture assets, if any.                                     |
| `packagePrefix`     | npm scope for workspace packages (e.g. `@acme/`).                          |
| `appPathPrefix`     | Path prefix for the app, for FD `links.code` resolution.                   |
| `categories`        | Release-notes categories (functional-domain axis, NOT commit types). Default `["Core","Tooling","Other"]`. Grows via `/triage` + `/promote`. |
| `areaCategories`    | Maps an FD `area` slug → a category. Unmapped areas fall back to `Other`.   |
| `scopeAliases`      | Maps a short commit-scope token → the FD slug(s) it may front, so the trailer-scope-mismatch detector accepts informal scopes (e.g. `{"cr": ["noldor"]}` lets `feat(cr):` carry `Noldor-FD: noldor`). Matched on the scope's last `:`-segment. Optional, defaults `{}`. |
| `verifyCommands`    | Named run surfaces for the verify lane's smoke floor: `{ "<name>": { "command": "… --port {port}", "kind": "server" \| "cli", "healthPath": "/", "readyTimeoutMs": 30000 } }`. `server` surfaces boot, get probed for HTTP 200, then killed; `cli` surfaces must exit 0. `{port}` is substituted with the per-tree port. Optional, defaults `{}` — smoke trivially green. Pair with `autonomous.verifyMode` (`"advisory"` default \| `"blocking"`), which governs only the verify agent's judgment; the smoke floor blocks in both modes. |

**Single-package example:**

```json
{ "consumer": { "name": "acme", "repoUrl": "https://github.com/acme/acme",
  "lockstepPackages": ["package.json"], "scanPaths": ["src"], "appPathPrefix": "src",
  "packagePrefix": "@acme/", "e2ePrefix": "e2e/", "samplesPath": "samples", "boundaries": [], "deprecatedPackages": [],
  "categories": ["Core", "Tooling", "Other"], "areaCategories": { "core": "Core", "tooling": "Tooling" } } }
```

A monorepo lists one `package.json` path per package in `lockstepPackages` (e.g. `["packages/app/package.json", "packages/lib/package.json"]`) and broader `scanPaths` (e.g. `["packages", "apps"]`).

## Optional: autonomous CR config

Beyond the required `consumer:` block, `.noldor/config.json` accepts two **optional** blocks that drive the unsupervised gate path (`proceed-autonomous`):

- `crLanes` — review lanes per artifact kind (`spec` / `plan` / `code`). Omit it and orchestrate uses the built-in `DEFAULT_CR_LANES` (`subagent`-only per kind). Set it to opt in heavier review, e.g. `"code": ["subagent", "codex"]`.
- `autonomous` — `skipLanePicker` (default `false`), `onFailure` (`prompt` | `spawn-deep-review` | `abort`, default `prompt`), `requireHumanPrApproval` (default `false`). Every field defaults, so the block may be omitted entirely.

```json
{ "consumer": { "...": "..." },
  "crLanes": { "spec": ["manual", "subagent"], "plan": ["manual", "subagent"], "code": ["subagent"] },
  "autonomous": { "skipLanePicker": false, "onFailure": "prompt", "requireHumanPrApproval": false } }
```

Neither block is required — a config with only `consumer:` runs autonomous CR on the `subagent`-only defaults. Full reference: [`cr-pipeline.md`](cr-pipeline.md).

## Invocation

The framework is invoked as `pnpm noldor <group> <subcommand>` (e.g. `pnpm noldor garden detect`, `pnpm noldor validate features`, `pnpm noldor release run`). A consumer MAY add flat `package.json` aliases (`"release": "noldor release run"`) for convenience, but the framework only guarantees the `noldor` CLI itself.

For the page-by-page overview, see:

- [`README.md`](README.md) — route table to every framework page.
- [`script-catalog.md`](script-catalog.md) — every framework command, grouped by concern.
- [`skill-catalog.md`](skill-catalog.md) — every user-invocable Claude Code skill.
- [`lifecycle.md`](lifecycle.md) — pipeline diagram + complexity tiers.
