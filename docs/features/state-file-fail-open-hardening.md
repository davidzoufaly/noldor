---
area: tooling
category: Tooling
deps: []
entry-id: Q-0040
links:
  code: []
  tests:
    - src/core/__tests__/atomic-write.test.ts
    - src/core/__tests__/rollout-marker.test.ts
    - src/dashboard/__tests__/dashboard-server.test.ts
    - src/dashboard/__tests__/host.test.ts
    - src/hooks/__tests__/noldor-pre-edit-guard.test.ts
  spec: docs/design/specs/2026-07-14-state-file-fail-open-hardening-design.md
name: State-File Fail-Open Hardening
packages:
  - scripts
phase: done
since: 2026-07-13T00:00:00.000Z
noldor-tier: specs-only
---
## Summary

Deep-audit finding (batch `.noldor/research/2026-07-13-184850`): state-file handling consistently fails *open* — corruption or a torn write silently resets toward permissive. Confirmed: crash-path `releaseLock` deletes a drain lock it doesn't own (two concurrent drains possible); corrupt rollout-marker lets every commit pass unchecked; torn `session.json` makes the pre-edit-guard exit 1 instead of 2 (gate silently bypassed); torn `watch-state.json` resets the daily cap + trip rail; torn `drain-park.json` unparks all known-failing entries. Root cause shared: plain `writeFileSync` + parse-error → permissive default, while `atomicWriteFile` and the O_EXCL lock primitive already exist but callers bypass them. Fix: ownership check in `releaseLock`, route state writers through `atomicWriteFile`, make enforcement-file corruption loud and fail toward enforcement, and bind the dashboard to 127.0.0.1 (today 0.0.0.0 no-auth composes with `bypassPermissions` drain agents into a LAN roadmap-inject → RCE chain).

## User Story

As an autonomous drain agent (and the operator supervising it), I want every Noldor state file to fail _closed_ when it is corrupt or half-written, so that a crash or torn write can never silently disable the edit gate, uncap the drain, free a lock the process does not own, or expose the dashboard to the LAN.

## Usage

No new day-to-day commands — enforcement, drain, and edit-gating behave identically on healthy state files. The change is what happens on a corrupt or half-written one: it fails toward safety, loudly.

**UI**

1. The dashboard binds loopback by default: `pnpm noldor dashboard server` serves `http://127.0.0.1:4321`.
2. When `.noldor/drain-park.json` is corrupt, the `/agents` Parked table shows `⚠ parked list unreadable — corrupt .noldor/drain-park.json` instead of a misleading empty list.

**Keyboard shortcut**

- _none_

**Agent/Programmatic API**

- Opt into LAN exposure of the dashboard with `DASHBOARD_HOST=0.0.0.0 pnpm noldor dashboard server` (or `--host 0.0.0.0`); the default `127.0.0.1` keeps the no-auth mutating routes off the network.
- On a corrupt operational state file (`watch-state.json` / `drain-park.json`) the drain aborts its cycle with a loud `… corrupt …` line on stderr — delete the offending `.noldor/*.json` (a _missing_ file is a clean fresh start) and re-run.
- A corrupt `.noldor/session.json` now makes the pre-edit-guard **block** the edit (exit 2) instead of allowing it; a corrupt rollout marker makes the commit/push gates **enforce** rather than drop to soft mode.

## PRs

<!-- @prs-since-last-release: state-file-fail-open-hardening -->

## Changelog

<!-- generated: resources -->

## Resources

- **Tests:**
  - [`src/core/__tests__/atomic-write.test.ts`](../../src/core/__tests__/atomic-write.test.ts)
  - [`src/core/__tests__/rollout-marker.test.ts`](../../src/core/__tests__/rollout-marker.test.ts)
  - [`src/dashboard/__tests__/dashboard-server.test.ts`](../../src/dashboard/__tests__/dashboard-server.test.ts)
  - [`src/dashboard/__tests__/host.test.ts`](../../src/dashboard/__tests__/host.test.ts)
  - [`src/hooks/__tests__/noldor-pre-edit-guard.test.ts`](../../src/hooks/__tests__/noldor-pre-edit-guard.test.ts)

<!-- /generated: resources -->
