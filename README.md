# Noldor

Discipline framework for agent-driven software development. Single gate, doc-anchored changes, consumer-config-driven runtime.

## Status

Pre-extract. Lives at `packages/noldor/` inside the Charuy monorepo. Phase C of the framework-doc-extraction work extracts this directory into its own repo at `github.com/davidzoufaly/noldor`.

## Quick start

After extract, consumers add a `file:` dependency:

```json
{
  "dependencies": {
    "noldor": "file:../noldor"
  }
}
```

Filesystem assumption: `noldor/` is a sibling directory of the consumer repo (e.g. `~/code/noldor/` next to `~/code/charuy/`).

## Configuration

Every consumer ships a `.noldor/config.json` with a `consumer:` block declaring repo URL, lockstep packages, boundaries (dependency-cruiser rules), package prefix, app path prefix, e2e prefix, samples path, deprecated packages, and pnpm stderr prefix. See `src/core/consumer-config.ts` for the schema.

Two **optional** blocks unlock unsupervised code review and PR-merge — the autonomous gate path:

- `crLanes` — which review lanes run per artifact kind (`spec` / `plan` / `code`). Absent → built-in `subagent`-only defaults (`DEFAULT_CR_LANES` in `src/cr/config.ts`); a configured block overrides them.
- `autonomous` — `skipLanePicker` (default `false`), `onFailure` (`prompt` | `spawn-deep-review` | `abort`, default `prompt`), `requireHumanPrApproval` (default `false`). Every field defaults, so the block may be omitted entirely.

Both default sanely; you only add them to override. See [`docs/noldor/cr-pipeline.md`](docs/noldor/cr-pipeline.md) for the full reference and an annotated example.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

## CLI

```bash
pnpm noldor doctor                                       # health check
pnpm noldor dashboard server --port 4321 --docs ./docs   # product / framework dashboard
pnpm noldor invariants run                               # cross-package boundary check
pnpm noldor garden detect                                # SDD drift detection
pnpm noldor validate features                            # feature MD shape validation
```

## License

MIT (see `LICENSE`).
