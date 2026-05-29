# Noldor Repo Extraction — Design

**Status:** Draft (2026-05-28, rev 2 after subagent review)
**Supersedes:** `2026-05-28-framework-doc-extraction-design.md` (monorepo-split direction)
**Feature:** `framework-doc-extraction` (scope shift: monorepo → separate repo)

## Summary

Extract `packages/noldor/` from the Charuy monorepo into its own private GitHub repository (`davidzoufaly/noldor`). Charuy consumes via `file:../noldor` (sibling on disk, no registry). Git history preserved via `git filter-repo`. Framework docs migrate with the code. Both repos run own dashboard instance.

**Restructured into three phases after review found load-bearing claims unmet by current code:**

- **Phase A — De-Charuy-fication** (the big pre-req). Make `packages/noldor/` source-code consumable by any repo: config-driven `LOCKSTEP_PACKAGES`/`repoUrl`/boundaries, `loadDocRoots()`, fix `vitest.setup` chdir, fix dashboard static-root, parametrise hardcoded `@charuy/` and `apps/web/` references.
- **Phase B — Doc staging + inventory reconcile**. Author `stage-framework-docs.ts`, reconcile Phase 0 inventory (29 FDs, milestone decision), `git mv` framework docs under `packages/noldor/docs/` within Charuy.
- **Phase C — Extract + retarget**. `git filter-repo` extract → push to noldor remote → Charuy retarget to `file:../noldor`, delete `packages/noldor/`.

Each phase lands as its own PR(s). `writing-plans` is invoked on Phase A first.

## Locked decisions

| Decision          | Value                                                        |
| ----------------- | ------------------------------------------------------------ |
| Split scope       | Separate repo (not monorepo folder)                          |
| Repo home         | `github.com/davidzoufaly/noldor`, **private**                |
| Consumption model | `file:../noldor` (sibling on disk, no npm registry)          |
| Doc location      | All framework docs migrate into noldor repo `docs/`          |
| Dashboard         | Two separate dashboards (one per repo)                       |
| Cut-over          | Big bang at Phase C (single coordinated moment)              |
| History           | Preserve via `git filter-repo`                               |
| Charuy workspace  | Drops `packages/*` glob, keeps `apps/*` only                 |
| Build delivery    | `prepare: tsc` on `pnpm install` (no built artifacts in git) |
| Semver            | Independent per repo                                         |
| CI cross-clone    | Charuy CI clones noldor via PAT, ref pinned by env var       |

## § 1 — Final repo topology (post-Phase C)

```
~/code/
├── 3d/                      # Charuy
│   ├── apps/web/            # 3D editor
│   ├── docs/                # product-only
│   ├── package.json         # "noldor": "file:../noldor"
│   ├── pnpm-workspace.yaml  # packages: ['apps/*']
│   └── tsconfig.base.json   # STAYS in Charuy (apps/web extends it)
└── noldor/                  # NEW: github.com/davidzoufaly/noldor (private)
    ├── src/
    ├── scripts/
    ├── templates/
    ├── bin/
    ├── docs/                # framework docs
    ├── package.json         # name: "noldor"
    └── tsconfig.json        # inlined from Charuy base (own copy)
```

## § 2 — Phase A: De-Charuy-fication

**Goal:** make `packages/noldor/src/` consumable by any monorepo. Lands as one or more PRs inside Charuy (still in monorepo form). At end of Phase A, all current Charuy behaviour preserved, all tests green, but framework code reads Charuy-specifics from config instead of hardcoded constants.

**Deliverables:**

### A1 — Runtime config file

Extend existing `.noldor/config.json` (already in repo) to declare consumer-specific values:

```json
{
  "consumer": {
    "name": "charuy",
    "repoUrl": "https://github.com/davidzoufaly/charuy",
    "lockstepPackages": [
      "apps/web/package.json",
      "packages/format/package.json",
      "packages/engine/package.json",
      "packages/viewport/package.json",
      "packages/test-fixtures/package.json",
      "packages/examples/package.json"
    ],
    "boundaries": [{ "path": "packages/engine/src", "allow": ["..."], "deny": ["..."] }],
    "e2ePrefix": "apps/web/e2e/",
    "samplesPath": "apps/web/public/samples",
    "packagePrefix": "@charuy/",
    "pnpmStderrPrefix": "charuy@"
  }
}
```

Schema validated via zod (matches existing `.noldor/config.json` parsing pattern). Defaults provided where reasonable; required fields surface clear errors.

### A2 — Code touched

Replace hardcoded constants in:

- `packages/noldor/src/release/index.ts:25-32` — `LOCKSTEP_PACKAGES`
- `packages/noldor/src/release/release-packages.ts:22-30` — duplicate `LOCKSTEP_PACKAGES`
- `packages/noldor/src/release/release-dry-run.ts:15` — `repoUrl`
- `packages/noldor/src/release/index.ts:269` — hardcoded `/tmp/charuy-release-notes-*` path → use `consumer.name`
- `packages/noldor/src/dashboard/views.ts:25` — `GITHUB_REPO` default
- `packages/noldor/src/invariants/boundaries.ts:9-38` — boundary rules
- `packages/noldor/src/garden/sdd-report.ts:473,490` — `E2E_PREFIX`
- `packages/noldor/src/garden/sdd-report.ts:552-567` — `@charuy/` prefix matcher
- `packages/noldor/src/garden/graph-fd-lookup.ts:140-143` — samples whitelist
- `packages/noldor/src/garden/garden-detect.ts:588` — pnpm stderr prefix
- `packages/noldor/src/features/fill-links-code-gaps.ts:59` — `apps/web/` startsWith
- `packages/noldor/src/features/validate-features.ts:120-122` — `@charuy/`/`apps/` strip rules

All read from `loadConsumerConfig()` (new utility next to existing config readers).

### A3 — `loadDocRoots()`

New utility `packages/noldor/src/core/doc-roots.ts`:

```ts
export interface DocRoots {
  features: string;
  roadmap: string;
  backlog: string;
  vision: string;
  ideas: string;
  milestones: string;
  plans: string;
  specs: string;
}

export function loadDocRoots(cwd = process.cwd()): DocRoots;
```

Default: returns `${cwd}/docs/{features,roadmap.md,...}` paths (matches current behaviour).

Threaded through every consumer that currently hardcodes `process.cwd()/docs/...`:

- `packages/noldor/src/dashboard/data.ts:64-71`
- `packages/noldor/src/garden/sdd-report.ts:1086-1091`
- `packages/noldor/src/garden/garden-detect.ts:65,92,198`
- `packages/noldor/src/core/next-priority.ts:172,204,224`
- `packages/noldor/src/garden/plan-resolution.ts:40`
- `packages/noldor/src/core/allowlist.ts:22-24`
- `packages/noldor/src/core/rename-plan-only-tier.ts:48-62`

### A4 — Bug fixes (separate commits inside Phase A)

- `packages/noldor/vitest.setup.ts` — `process.chdir(resolve(here, '../../'))` lands above package; change to `resolve(here, '..')` so tests work both in monorepo and standalone.
- `packages/noldor/src/dashboard/server.ts:265` — `STATIC_ROOT` resolved against `process.cwd()` but actual asset lives at `packages/noldor/src/dashboard/static/dist/`. Switch to `fileURLToPath(new URL('./static/dist', import.meta.url))` so it's package-relative.
- `packages/noldor/src/dashboard/server.ts` — add `--docs <path>` CLI flag accepted by `dashboard server` command (currently only `--port`). Threads through to `loadDocRoots(docsPath)`. Without this, two-dashboard claim from § 5 doesn't hold.

### A5 — Tests

Each touched module gets a unit test confirming it reads from config, not hardcoded constants. Snapshot of `.noldor/config.json` schema parse.

### Phase A verification

- `pnpm verify` green (lint, fmt, typecheck, test, build:samples, doctor)
- `pnpm dashboard` boots, lists Charuy docs unchanged
- `pnpm release --dry-run` produces same output as before Phase A
- `apps/web` dev server unchanged
- Diff audit: `rg "charuy" packages/noldor/src/` returns zero hits (config keys excepted)

## § 3 — Phase B: Doc staging + inventory reconcile

**Goal:** classify and physically `git mv` framework docs into `packages/noldor/docs/` within Charuy. Land as one PR.

### B1 — Inventory reconcile

Re-run `pnpm noldor:classify`. Reconcile against earlier Phase 0 snapshot (`.noldor/classification/`):

- **Confirmed counts (re-verify):** 29 framework FDs (not 28 — subagent caught), 49 roadmap entries, 3 backlog entries, 3 plans, 4 specs.
- **Milestones decision:** classifier currently emits 0 milestone rows. `docs/milestones/public-release.md` is product (dream-house web app). **Decision:** no milestone files migrate; `public-release.md` stays in Charuy. Spec milestones section dropped.
- **CHANGELOG/release-notes decision:** `CHANGELOG.md` + `docs/release-notes.md` are produced by `pnpm release` per-repo, so each repo gets its own fresh history. Charuy keeps current files unchanged; noldor starts with empty `CHANGELOG.md` + `docs/release-notes.md` (or auto-generated by first `noldor release` run).
- **docs/noldor/ decision:** `templates/docs/noldor/*.md` syncs into `docs/noldor/` via `noldor init`. After extract, that stays — every consumer (Charuy included) keeps a synced `docs/noldor/` copy from the noldor templates. No special handling needed.

### B2 — `stage-framework-docs.ts` (new script)

`packages/noldor/scripts/migration/stage-framework-docs.ts`:

- Reads `.noldor/classification/framework.txt`.
- For each row, `git mv <source> packages/noldor/docs/<dest>`.
- Mappings:
  - `feature` rows: `docs/features/<slug>.md` → `packages/noldor/docs/features/<slug>.md`
  - `roadmap` rows: edit-in-place. Read `docs/roadmap.md`, partition entries, write framework entries to `packages/noldor/docs/roadmap.md`, leave product entries in `docs/roadmap.md`.
  - `backlog` rows: same partition pattern.
  - `plan` rows: `docs/superpowers/plans/<file>` → `packages/noldor/docs/superpowers/plans/<file>`
  - `spec` rows: `docs/superpowers/specs/<file>` → `packages/noldor/docs/superpowers/specs/<file>`
- Produces dry-run summary first; requires `--apply` flag to mutate.
- Unit tests cover roadmap/backlog partition with synthetic fixtures.

### B3 — vision.md / ideas.md

- `docs/vision.md` contains both product + framework concerns. Manually split: framework-only excerpt → `packages/noldor/docs/vision.md`. Product-only content stays in Charuy `docs/vision.md`. (Not script-automated; one-off content surgery.)
- `docs/ideas.md` is gitignored locally. `packages/noldor/docs/ideas.md` starts empty (also gitignored).

### B4 — `pnpm noldor:classify` script location

After Phase C, `packages/noldor/scripts/migration/` disappears from Charuy. Pre-empt by:

- Keep `pnpm noldor:classify` in Charuy root `package.json` during Phase B (still useful for reconcile).
- After Phase C, Charuy `package.json` drops the script. Re-classification needs the noldor repo.
- Note in Phase C deliverables: remove the script line from Charuy `package.json`.

### Phase B verification

- `pnpm verify` green (with `loadDocRoots()` now finding `packages/noldor/docs/...`)
- Both dashboards boot: `pnpm dashboard --docs ./docs` (product, port 5173) + `pnpm dashboard --docs ./packages/noldor/docs` (framework, port 5174)
- Framework dashboard lists 29 FDs, 49 roadmap, 3 backlog, 3 plans, 4 specs
- Cross-tree links audit: 0 hits via `noldor doctor`

## § 4 — Phase C: Extract + retarget

**Goal:** physical separation. Lands as one Charuy PR + new noldor repo creation.

### C1 — Pre-extract preparation (committed in Charuy first)

- Confirm `packages/noldor/package.json` `name: "noldor"`, `version: "0.0.0"` (placeholder).
- Bump `packages/noldor/package.json` version to `0.1.0` (first independent release).
- Add `packages/noldor/tsconfig.json` standalone version: copy effective compiler options from `tsconfig.base.json`, drop `extends`. `tsconfig.base.json` stays in Charuy.
- Add `packages/noldor/.gitignore`, `LICENSE` (MIT to start; see Out of scope on license review), `README.md`.
- Add `packages/noldor/.npmrc` mirroring Charuy (`auto-install-peers=true`, `strict-peer-dependencies=false`).
- Add `packages/noldor/turbo.json` minimal config (or skip turbo in noldor — single package).
- Change `"build": "tsc"` (already exists) → add `"prepare": "tsc"` to `packages/noldor/package.json`. Same compiler, runs on `pnpm install` for consumers.
- Cross-import audit: `rg "from ['\"](apps|packages)/" packages/noldor/src/ packages/noldor/scripts/` returns zero hits.
- Workspace-dep audit: `packages/noldor/package.json` has no `workspace:*` deps on other Charuy packages. Confirm (currently true per inspection — only outward deps).

### C2 — Extraction script `scripts/extract-noldor.sh` (run locally, not committed)

```bash
# 1. Mirror Charuy to scratch dir
cd /tmp && git clone --no-local /Users/davidzoufaly/code/3d noldor-extract
cd noldor-extract

# 2. Filter to packages/noldor/ only, strip prefix
git filter-repo \
  --path packages/noldor/ \
  --path-rename packages/noldor/:

# 3. Push to new noldor remote
git remote add origin git@github.com:davidzoufaly/noldor.git
git push -u origin main

# 4. Tag first independent release
git tag v0.1.0
git push --tags

# 5. Clone result next to Charuy
cd ~/code && git clone git@github.com:davidzoufaly/noldor.git
```

### C3 — Noldor repo verify (in `/tmp/noldor-extract`, then `~/code/noldor`)

- `pnpm install` succeeds standalone
- `pnpm test` green (vitest setup fixed in Phase A)
- `pnpm typecheck` green
- `pnpm noldor doctor` self-check green
- `pnpm noldor dashboard server --docs ./docs --port 5174` boots, lists framework FDs (dashboard `--docs` flag added in Phase A)

### C4 — Charuy retarget PR

- Edit Charuy `package.json`: `"noldor": "file:../noldor"` (replaces `workspace:*`).
- Edit `pnpm-workspace.yaml`: remove `packages/*`, keep `apps/*`.
- Remove `noldor:classify` script line from Charuy `package.json` (script disappears with `packages/noldor/`).
- `git rm -r packages/noldor/`.
- `pnpm install --force` — lockfile diff inspected; rebuild from scratch if noisy.
- `pnpm verify` green (all `pnpm noldor <cmd>` resolves via `node_modules/.bin/`).
- `apps/web` dev server boots.
- README setup section updated: requires `~/code/noldor/` checked out as sibling.

### C5 — CI

Noldor repo `.github/workflows/ci.yml`:

- Triggers: push/PR to main
- Jobs: lint (oxlint), fmt:check (oxfmt), typecheck (`tsc`), test (vitest), `noldor doctor`
- Node 20, pnpm via corepack

Charuy repo CI adds sibling-checkout. **Important:** `actions/checkout@v4` defaults reject `path` outside workspace. Use `path: ./noldor-sibling` then `mv` it to `../noldor` before `pnpm install`:

```yaml
- name: Checkout noldor
  uses: actions/checkout@v4
  with:
    repository: davidzoufaly/noldor
    path: ./noldor-sibling
    ref: ${{ env.NOLDOR_REF }}
    token: ${{ secrets.NOLDOR_REPO_PAT }}

- name: Move noldor to sibling location
  run: mv ./noldor-sibling ../noldor
```

`NOLDOR_REF` defaults to `main` for Charuy main branch, pinned to tag on Charuy release builds.

Secrets: `NOLDOR_REPO_PAT` (fine-grained PAT, read-only access to `davidzoufaly/noldor`) provisioned before Phase C.

### C6 — Release tracks

| Repo   | Versioning      | Release                       |
| ------ | --------------- | ----------------------------- |
| noldor | own semver/tags | `pnpm release` in noldor repo |
| Charuy | own semver/tags | `pnpm release` in Charuy      |

Workflow: release noldor → bump Charuy `NOLDOR_REF` to new tag → release Charuy. `release-sweep` skill is cwd-based, works per-repo.

No npm publish. Tags exist for ref-pinning + readability.

## § 5 — Risks + mitigations

| Risk                                               | Mitigation                                                                                                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase A scope creep (parametrising every constant) | Strict checklist (§ 2 A2) — only files cited. New uncovered hardcoding fixed in follow-up PR.                                                                                    |
| `loadConsumerConfig` schema churn                  | zod schema with semver-style major bump on breaking changes; consumer config file under `.noldor/` is part of consumer repo.                                                     |
| Lockfile churn on retarget                         | `pnpm install --force` then commit; if diff is huge, `rm pnpm-lock.yaml && pnpm install` for clean regen.                                                                        |
| Sibling-path assumption breaks for other devs      | README setup + `noldor doctor` checks `../noldor` exists with clear error message.                                                                                               |
| CI `path: ../noldor` rejection                     | Use `./noldor-sibling` + `mv` workaround documented in § 4 C5.                                                                                                                   |
| Filter-repo loses cross-package import             | Pre-extract audit in § 4 C1 catches; zero tolerance.                                                                                                                             |
| Rollback after noldor pushed + tagged              | Acknowledged not clean. If revert needed, `gh repo archive davidzoufaly/noldor` to freeze; future re-extract starts fresh from filter-repo. Document in retarget PR description. |
| `pnpm noldor:classify` disappears from Charuy      | After Phase C, Charuy users run classifier via `cd ../noldor && pnpm noldor classify`. Doc this in noldor README.                                                                |
| Two-repo dev loop friction                         | `tsc --watch` in noldor + occasional `pnpm install --force` in Charuy. Documented in noldor README.                                                                              |
| `prepare: tsc` slow on every Charuy install        | Cache `noldor/dist/` in CI via actions/cache keyed on noldor commit sha.                                                                                                         |
| Charuy CI cannot access private noldor repo        | `NOLDOR_REPO_PAT` provisioned before Phase C.                                                                                                                                    |
| Future re-classification drift                     | Noldor repo owns the classifier; Charuy `.noldor/classification/` snapshot becomes archival. Drop or keep with timestamp.                                                        |

## § 6 — Out of scope

- npm publish (file: dep covers current needs)
- Public open-source release of noldor (private for now)
- Multi-consumer support (only Charuy consumes noldor today; consumer config schema makes future consumers possible but not designed for)
- CI matrix expansion (single Node 20 sufficient)
- Cross-repo issue tracker linking
- LICENSE choice deep review (MIT placeholder; revisit before publishing)
- Dependabot / renovate setup in noldor repo
- Branch protection rules for noldor `main`
- Issue/PR templates in noldor repo
- `CODEOWNERS` in noldor repo
- Husky/lefthook in noldor repo (Charuy keeps its own)
- Cross-repo PR-flow integration (CR pipeline depends on single-repo hooks today)
- `CONTRIBUTING.md` creation in either repo (doesn't currently exist in Charuy)
- `pre-rename.yaml` cleanup at Charuy root (separate concern; document but don't touch)
- `.vscode/settings.json` migration (stays in Charuy)
- `turbo.json` simplification post-workspace-shrink (Charuy has single workspace member after extract; consider dropping turbo, separate decision)
- Retroactive `release-notes.md` split (each repo starts fresh)

## § 7 — Linked artifacts

- Locked monorepo-split spec (now superseded): `docs/superpowers/specs/2026-05-28-framework-doc-extraction-design.md`
- Phase 0 plan (still valid, classifier output reusable): `docs/superpowers/plans/2026-05-28-framework-doc-extraction-phase-0.md`
- Feature MD: `docs/features/framework-doc-extraction.md` (needs scope-shift update post-approval)
- Memory: `[[project-framework-doc-extraction]]`
- Subagent review: findings captured inline above (B1, B2, B3, B4, B5, B6 blockers + S1-S7 significant + M1-M10 minor)
