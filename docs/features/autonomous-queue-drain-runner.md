---
area: tooling
category: Tooling
deps:
  - autonomous-plan-to-pr-merge
links:
  code: []
  tests: []
  spec: docs/superpowers/specs/2026-06-10-autonomous-queue-drain-runner-design.md
name: Autonomous Queue-Drain Runner
packages:
  - scripts
phase: in-progress
noldor-tier: full
---

## Summary

An external supervisor that drains the roadmap's fast-track (XS/S) queue autonomously — spawning a fresh `claude --print "/gate"` per entry, one auto-merged PR at a time, with retry-then-skip, a concurrency lock, and a per-iteration timeout. Each feature runs in a clean context, so always-clear is preserved without a human between features.

## User Story

As an operator with a backlog of small (XS/S) roadmap entries, I want one command that ships them autonomously — one auto-merged PR at a time, each in a fresh always-cleared `claude --print` context — so that I can drain the fast-track queue without sitting between every feature to `/clear` and re-run `/gate`.

## Usage

**CLI**

1. Ensure `.noldor/config.json` sets `autonomous: { "onFailure": "abort", "skipLanePicker": true, "requireHumanPrApproval": false }` — the drain refuses to start otherwise (headless-safe precondition).
2. From the main workspace on a clean, synced `main`, run `pnpm noldor autonomous queue-drain`.
3. Preview without spawning or merging anything: `--dry-run`. Tune with `--max-features N` (default 20), `--max-retries N` (default 2), `--iteration-timeout MS` (default 30 min). Add `--json` for a machine-readable summary.
4. The runner ships each fast-track (XS/S) roadmap entry as its own auto-merged PR, skipping M/L/XL and `Touches:`/multi-scope entries, until the queue is drained, all-remaining are skipped, or `--max-features` is hit.
5. Stop cleanly between iterations with SIGINT (Ctrl-C) or `touch .noldor/drain-stop` (exit 130).

**Agent API**

- None. The runner is the agent driver — it spawns `NOLDOR_DRAIN=1 claude --print "/gate"` per entry; there is no in-editor API surface.

**Exit codes**

- `0` completed (drained / all-skipped / `--max-features` reached) · `1` aborted on error (config/lock/parse/`gh`/git-sync) · `130` stopped via kill switch.

## PRs

<!-- @prs-since-last-release: autonomous-queue-drain-runner -->

## Changelog
