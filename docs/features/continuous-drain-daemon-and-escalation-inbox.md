---
area: tooling
category: Agents
deps:
  - agent-events-log-and-agents-dashboard-page
  - acceptance-verify-lane
links:
  code:
    - src/autonomous/
    - src/core/consumer-config.ts
    - src/dashboard/
    - src/cli/manifest.ts
    - docs/noldor/cr-pipeline.md
    - docs/noldor/autonomy.md
    - script-catalog.md
  tests: []
  spec: docs/superpowers/specs/2026-06-12-continuous-drain-daemon-and-escalation-inbox-design.md
name: Continuous Drain Daemon and Escalation Inbox
packages:
  - scripts
phase: in-progress
noldor-tier: full
---

## Summary

Every autonomous stage is one-shot and operator-fired: someone types `noldor autonomous run`, watches (or returns later), handles failures by reading logs, salvages stale bases by hand from a memory recipe. The vision sentence — agents ship unsupervised — currently means "unsupervised per invocation". Make autonomy *continuous*: a long-running (or cron-fired) mode that keeps draining the queue, repairs its own known failure modes, and escalates the rest to a structured inbox instead of dying or blocking.

**What to do:**

- `noldor autonomous watch` mode: wraps the existing drain loop (`src/autonomous/drain-loop.ts`) in a scheduler — `--interval <min>` polling or long-lived daemon; each cycle: refresh main, re-read queue, run a bounded drain (`--max-features` per cycle), sleep. Reuses `drain.lock` semantics; a second watcher refuses to start.
- Auto-salvage: codify the stale-base recipe as code, not operator lore — detect on pickup: existing `fast/<slug>` branch whose base is behind main, or a closed-unmerged PR for the slug → rebuild worktree from fresh main, **re-apply** the change (not cherry-pick), retire stale branch + remote; emit `salvaged` event. The 2026-06-10/11 drain runs proved the recipe manually (PR #49→#55 case); this entry mechanizes it.
- Escalation inbox: when an item exhausts retries, hits a verify/CR blocking fail with `onFailure` not resolvable headlessly, or trips an unknown git state → write `.noldor/escalations.jsonl` (`{ ts, slug, reason, evidence, state-snapshot, suggested-action }`), mark the item parked (skip-list with reason), **continue with the next item** — park-and-continue replaces today's abort-or-prompt at the loop level. Dashboard inbox page (or `/agents` tab): open escalations with one-glance reason + evidence, operator resolves → unpark (`noldor autonomous unpark <slug>`).
- Notification: pluggable notify hook on escalation + cycle summary (shipped/parked counts) — shell command in consumer config (`autonomous.notifyCommand`), so Slack/push/mail is the consumer's one-liner, not framework scope.
- Safety rails, all consumer-config with conservative defaults: `maxFeaturesPerDay`, `maxConsecutiveFailures` (trip → pause whole watcher + escalate), wall-clock cap per item, `pause` switch (file-based `.noldor/drain.pause` honored mid-cycle), budget cap hook if token accounting exists by then. A paused or tripped watcher is loud — notify + dashboard banner, never silent.
- Run placement: local daemon first (operator's machine, simplest trust model); CI-cron variant documented as a follow-up once contract-CI exists (needs secrets + checkout strategy decisions).

**What it enables:** the vision claim made literal — queue drains continuously, operator's job collapses to feeding triage and clearing an inbox; combined with verify-lane + telemetry, "unsupervised" becomes defensible: continuously shipped, independently verified, measurably tracked.

**Open questions:** daemon vs cron-fired (lean: same code, `--once` flag makes cron trivial); interaction with release cadence (auto-release-candidate after N ships? — explicitly out of scope v1, release stays operator-fired); multi-repo watchers later (one per consumer, no coordination v1); how `watch` coexists with an operator working in the same repo (lock + pause conventions probably suffice — document).

**Acceptance sketch:** seed queue with 3 entries incl. one engineered stale-base and one destined-to-fail → `noldor autonomous watch --interval 5 --max-features 1`: two ship across cycles (one via auto-salvage, `salvaged` event present), one lands in escalations with evidence and the watcher keeps running; `drain.pause` halts next cycle; notify hook fired on the escalation.

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: continuous-drain-daemon-and-escalation-inbox -->

## Changelog
