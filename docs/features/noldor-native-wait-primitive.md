---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/core/wait.ts
    - src/core/wait-cli.ts
  tests:
    - src/core/__tests__/wait.test.ts
    - src/core/__tests__/wait.cli.test.ts
name: Noldor-Native Wait Primitive
packages:
  - scripts
phase: done
noldor-tier: specs-only
---

## Summary

Runner-agnostic alternative to the harness `Monitor` tool, consumer side only: `noldor wait <state-file> --until <terminal-cond> [--emit <jsonpath>]` that polls until a job reaches a terminal state and surfaces progress. Do NOT invent a new progress format — reuse the existing producer-side state files (`.noldor/drain-state.json` heartbeat, `.noldor/cr/<slug>-<kind>-<lane>.json` sinks). The "write one side / read other" channel already exists; the gap is a portable wait/poll the controller calls instead of the host harness's Monitor (which can be blocked + isn't cross-runner). Parked: background-task completion notifications already cover most waiting.

## User Story

As an autonomous controller (or any headless agent) on any runner, I want to block on a producer's state file until it reaches a terminal state — with fast-fail and a bounded timeout — so that I can sequence work without depending on the host harness's `Monitor` tool, which can be blocked and is not portable across runners.

## Usage

```bash
# Wait for a drain cycle to go idle (10-min default timeout), quiet:
noldor wait .noldor/drain-state.json --until 'phase==idle' --quiet

# Wait for a CR lane sink to finish; fail fast if it landed blockers:
noldor wait .noldor/cr/my-feature-spec-subagent.json \
  --until 'finishedAt?' --fail-if 'blockers.0?' --emit summary
# stdout: the lane's `summary` string on terminal
# exit:   0 finished-clean · 1 finished-with-blockers · 2 timeout
```

`noldor wait <state-file> --until <cond> [--fail-if <cond>] [--emit <dotpath>] [--interval-ms 2000] [--timeout-ms 600000] [--quiet]`

- **Predicate grammar** (generic over any JSON): `<dotpath> == <value>`, `<dotpath> != <value>`, or `<dotpath>?` (exists = resolves to non-null). Dotpaths are `.`-separated, index arrays numerically (`blockers.0`), and admit kebab-case keys (`retries.my-feature`). `eq`/`neq` never match an absent path (no false terminal).
- **Exit codes:** `0` `--until` matched · `1` `--fail-if` matched (evaluated first, wins ties) · `2` timeout (`--timeout-ms 0` = wait forever) · `3` usage/parse error.
- **Output:** progress → stderr (silenced by `--quiet`); `--emit` prints one value → stdout (scalar raw, object/array as JSON; absent/null prints nothing).

## PRs

<!-- @prs-since-last-release: noldor-native-wait-primitive -->

## Changelog

<!-- generated: resources -->

## Resources

- **Code:**
  - [`src/core/wait.ts`](../../src/core/wait.ts)
  - [`src/core/wait-cli.ts`](../../src/core/wait-cli.ts)
- **Tests:**
  - [`src/core/__tests__/wait.test.ts`](../../src/core/__tests__/wait.test.ts)
  - [`src/core/__tests__/wait.cli.test.ts`](../../src/core/__tests__/wait.cli.test.ts)

<!-- /generated: resources -->
