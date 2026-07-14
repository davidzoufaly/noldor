# Noldor

Discipline framework for agent-driven software development: a **single mandatory gate** for every code change, doc-anchored features, and an autonomous queue-drain that ships small work unattended. Noldor is pre-1.0 (version lives in `package.json`, printed by `noldor --version`) and self-hosting — it dogfoods its own gate, drain, and release pipeline. It ships as a **private GitHub Packages** npm package, `@davidzoufaly/noldor`, published on tag by CI with the built-in `GITHUB_TOKEN`. Distribution is closed-source by design: the tarball ships readable `src/` (a tsx-on-source runtime), so a public registry is not an option.

New to Noldor, or adding it to an existing repo? The **[adoption guide](docs/noldor/adoption-guide.md)** is the full onboarding path (prerequisites floor, install, the monorepo and CI-auth traps, first-commit gotchas, and the complete config reference). This README is the map; the adoption guide is the territory.

## Prerequisites

Noldor hard-assumes its home stack; the floor is not negotiable pre-1.0: **Node ≥ 20, pnpm ≥ 9, git ≥ 2.30, gh CLI ≥ 2, lefthook ≥ 1**, plus `lint` / `fmt` / `fmt:check` / `test` package scripts. `pnpm noldor doctor` probes every row and fails with a pointer, so a mismatched adopter finds out at minute one. Full table and rationale: the [adoption guide](docs/noldor/adoption-guide.md).

## Install

Noldor is a **private** package on GitHub Packages, so first authenticate npm to that registry. In your project `.npmrc`:

```
@davidzoufaly:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
```

`NPM_TOKEN` is a GitHub token with `read:packages` and access to the noldor repo (fine-grained recommended). Then install as a dev dependency:

```bash
pnpm add -D @davidzoufaly/noldor
```

- **Monorepo / workspace:** add `-w` (`pnpm add -Dw @davidzoufaly/noldor`) — a bare `pnpm add -D` at a workspace root fails with `ERR_PNPM_ADDING_TO_ROOT`.
- **CI / deploy:** any pipeline that runs `npm ci` / `pnpm install` needs the same `.npmrc` plus an `NPM_TOKEN` secret in the job environment, or the install 401s. See the [adoption guide](docs/noldor/adoption-guide.md) for both traps in full.

## Initialize

```bash
pnpm noldor init            # new repo: scaffold docs/noldor, hooks, .noldor/config.json, rollout marker
pnpm noldor init --adopt    # existing repo: reverse-bootstrap current files into the package layout
pnpm noldor doctor          # health check → green
```

`init` drops the `docs/noldor/` rule pages, the lefthook config, the skill bundle, a starter `.noldor/config.json` (only when absent), and `.noldor/rollout-marker` (arms the gate validators — commit it). Once those files are tracked, the pre-edit guard arms and the **next** edit to a tracked file requires a `/noldor-gate` session. Re-pull template updates with `pnpm noldor init --update`; choose agent driver shims with `--agents claude,codex,opencode`.

## Configure

Every consumer ships a `.noldor/config.json` with a `consumer:` block (repo URL, boundaries, path prefixes, and more). Rather than enumerate the fields here — that list drifts against the schema — see the annotated table in the [adoption guide](docs/noldor/adoption-guide.md) and validate your copy with:

```bash
pnpm noldor validate noldor-config
```

Eight optional top-level blocks unlock extra behaviour and every one defaults sanely, so you add them only to override: `crLanes`, `crReview`, `autonomous`, `gate`, `agents`, `release`, `garden`, `clones`. The `crLanes` / `crReview` / `autonomous` blocks drive unsupervised code review and PR-merge — see [`docs/noldor/cr-pipeline.md`](docs/noldor/cr-pipeline.md) for the reference and an annotated example.

## Daily workflow

`/noldor-gate` is the single mandatory entry for any code change. It picks one of six complexity paths (`micro-chore`, `fast-track`, `specs-only-new`, `specs-only-attach`, `full-new`, `full-attach`), scaffolds the matching artifacts (feature doc, spec, plan), and drives the change through code review to an auto-merged PR. Commit hooks enforce that every change rode the gate. Start here: [`lifecycle.md`](docs/noldor/lifecycle.md), [`complexity-gating.md`](docs/noldor/complexity-gating.md), [`workflow.md`](docs/noldor/workflow.md).

## Dashboard

```bash
pnpm noldor dashboard server --port 4321 --docs ./docs
```

Serves the product/framework dashboard (default port 4321): roadmap and backlog, feature phases, WIP age, worktree health, agent-run events, metrics, and the blocked-by graph.

## Autonomous drain

Noldor can ship queued fast-track work with no operator in the loop:

```bash
pnpm noldor autonomous run          # drain a source (--source roadmap|plans)
pnpm noldor autonomous watch --detach  # continuous unattended daemon
pnpm noldor autonomous status       # what is in flight
pnpm noldor autonomous inbox        # open escalations (parked slugs + evidence)
```

Each entry ships via a fresh headless gate run. See [`drain-mode.md`](docs/noldor/drain-mode.md) and [`autonomy.md`](docs/noldor/autonomy.md).

## Upgrading

After pulling a newer framework version, `pnpm noldor doctor` warns on schema skew. Review the migration diffs with `pnpm noldor upgrade --dry-run`, then apply on a clean branch:

```bash
pnpm noldor upgrade
```

Migration-chain and semver policy: [`versioning.md`](docs/noldor/versioning.md).

## CLI reference

`pnpm noldor --help` prints the full command manifest — the list below is the journey-critical subset, **not exhaustive**. Every pnpm script the framework relies on is catalogued in [`script-catalog.md`](docs/noldor/script-catalog.md).

| Group | What it does |
| --- | --- |
| `init` | Scaffold or adopt Noldor into a repo |
| `doctor` | Prerequisite + template-skew health check |
| `dashboard` | Serve the product/framework dashboard |
| `autonomous` | Queue-drain / watch daemon / escalation inbox |
| `upgrade` | Apply version migrations |
| `cr` | Code-review orchestration (spec / plan / code lanes) |
| `pr-flow` | Push → PR → auto-merge |
| `worktrees` | Per-feature isolated worktrees |

## Docs

The framework rule pages live under [`docs/noldor/`](docs/noldor/README.md) — that index is the single source of truth for framework rules, keyed by what you are trying to do.

## Contributing

Framework contributors work against a clone. A consumer repo on the same machine can point at it with a `file:` dependency instead of the registry (assumes `noldor/` is a sibling of the consumer repo, e.g. `~/code/noldor/` next to `~/code/charuy/`):

```json
{
  "devDependencies": {
    "@davidzoufaly/noldor": "file:../noldor"
  }
}
```

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

## License

MIT (see `LICENSE`).
