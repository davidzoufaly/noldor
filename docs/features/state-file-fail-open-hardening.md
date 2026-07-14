---
area: tooling
category: Tooling
deps: []
entry-id: Q-0040
links:
  code: []
  tests: []
name: State-File Fail-Open Hardening
packages:
  - scripts
phase: in-progress
since: 2026-07-13
noldor-tier: specs-only
---

## Summary

Deep-audit finding (batch `.noldor/research/2026-07-13-184850`): state-file handling consistently fails *open* — corruption or a torn write silently resets toward permissive. Confirmed: crash-path `releaseLock` deletes a drain lock it doesn't own (two concurrent drains possible); corrupt rollout-marker lets every commit pass unchecked; torn `session.json` makes the pre-edit-guard exit 1 instead of 2 (gate silently bypassed); torn `watch-state.json` resets the daily cap + trip rail; torn `drain-park.json` unparks all known-failing entries. Root cause shared: plain `writeFileSync` + parse-error → permissive default, while `atomicWriteFile` and the O_EXCL lock primitive already exist but callers bypass them. Fix: ownership check in `releaseLock`, route state writers through `atomicWriteFile`, make enforcement-file corruption loud and fail toward enforcement, and bind the dashboard to 127.0.0.1 (today 0.0.0.0 no-auth composes with `bypassPermissions` drain agents into a LAN roadmap-inject → RCE chain).

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: state-file-fail-open-hardening -->

## Changelog
