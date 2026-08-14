---
area: tooling
category: Tooling
deps:
  - specs-cr-gate-multi-reviewer
entry-id: Q-0112
links:
  code: []
  tests:
    - src/core/agent-runner/__tests__/bounded-capture.test.ts
    - src/cr/__tests__/codex-failure.test.ts
    - src/cr/__tests__/lanes/codex.test.ts
name: Review-Run Lifecycle Module
packages:
  - scripts
phase: in-progress
since: 2026-08-12T00:00:00.000Z
noldor-tier: specs-only
---
## Summary

The codex CR lane owns neither the process it starts nor the capability probe it
trusts. It shells out through `pnpm`, so `execFile`'s timeout signals only the
direct child and the codex grandchild survives to burn quota unattended; it
guesses `--base-sha` support by grepping intercepted `--help` output, so the
probe can never return true and artifact review is silently always full-scope;
and the streams it accumulates are bounded only where they reach the sink. Give
the lane one process owner responsible for timeout, signal and process-group
cleanup plus capped diagnostics, and replace the capability guess with something
that can actually answer.

Scope narrowed on 2026-08-14 from the original 2026-08-12 audit block. Two of
that block's four premises shipped in the interim and are explicitly **out of
scope**: aggregate rediscovering sinks by filename (fixed by the expected-lanes
record, `src/cr/expected-lanes.ts`, Q-0100 / PR #309) and the lossy code/spec/plan
dispatch ternary (fixed by the `--code` mode, Q-0099 / PR #308). Whether the
expected-lanes record should widen into a full pre-dispatch run manifest is a
question for the spec, not a settled premise.

The three live concerns:

- `codexSupportsBaseSha()` can never return true, so codex artifact review is
  always full-scope. It runs `pnpm --silent noldor cr codex --help` and greps for
  `--base-sha`, but the dispatcher intercepts `--help` first (`src/cli/help.ts`
  prints a one-line usage plus the manifest desc and returns), so the detailed
  usage string in `src/cr/codex.ts` — which does list `--base-sha` — is
  unreachable and `runCli`'s `inv.help` branch is dead code. Measured: the probe
  exits 0 in 307 ms with zero matches, every run logs the unsupported-fallback
  line, and `baseSha` never lands in a sink. This is the live mechanism behind
  Q-0089's symptom (a); that spec's account of a bad sha throwing in `git diff`
  is true but describes a different path. The fix touches the shared CLI help
  surface (Q-0115, still in backlog) or replaces the grep with a version check.
- The codex CR lane orphans codex when the outer `execFile` cap fires. The lane
  shells out through `pnpm`, and `execFile`'s timeout signals only its direct
  child, so the codex grandchild survives, runs to self-completion and burns
  ChatGPT quota — unattended, in drain mode. Codex-specific: `reviewer` and
  `verifier` dispatch through `spawnAgent` (`subagent-dispatch.ts`,
  `verify-dispatch.ts`), which already spawns detached and group-kills. Three CR
  rounds on Q-0089 established that an inner cap inside `spawnCodex` drags in a
  kill path, detached spawning, a Ctrl-C signal reaper and two out-of-process
  fixture harnesses; routing this lane through `spawnAgent` like the other two is
  the likelier shape than a second kill implementation.
- `spawnCodex` accumulates stdout and stderr unbounded in memory. Fine for
  codex's measured 326 KB, but a runaway child could grow the node heap without
  limit, and the bounding that exists (`formatStderrTail`, 4000 chars) applies
  only to what reaches the sink. No measured case yet — the outer `execFile`
  stopped bounding it once the inner spawn took ownership of the streams — so cap
  it when the lifecycle owner lands.

**Deletion test:** `codexSupportsBaseSha`, nested pnpm timeout ownership and the
duplicated process-kill implementations all go; the codex lane adapter keeps only
prompt and result semantics.

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: review-run-lifecycle-module -->

## Changelog
