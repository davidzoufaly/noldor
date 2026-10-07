---
status: accepted
date: 2026-10-07
---

# Opt In Consumer Checks Use A Config Switch

## Context

`noldor dead-code` (`src/checks/dead-code.ts`) shipped as a this-repo-only ratchet over knip's findings. Taking it to consumers ([spec](../design/specs/2026-10-07-dead-code-detection-with-knip-consumers-design.md)) means it must stay quiet in a repo that has not adopted knip, yet bite in one that has. It is the first consumer check that is off by default: `clones` and `indirection` run in every consumer and only fall silent until a baseline exists.

Two ways to say "this repo uses the check" were weighed. A flag at the call site (`dead-code check --if-installed` in the shipped hook) keeps each repo's strictness visible in its own hook file and needs no config, but the hook block is shipped byte-identical and rewritten by `noldor init --update`, so a consumer cannot change the flag there, and the other surfaces that report the check (`sdd-report`, the dashboard) would each have to guess adoption from `node_modules`. A switch in `.noldor/config.json` is one place every surface reads the same answer from.

## Structural context

The decision lands in `src/core/config.ts` (`noldorConfigSchema`, beside `clones:`), which `src/checks/dead-code.ts` (c84), `src/garden/sdd-report.ts` (c10) and `src/dashboard/data.ts` (c5) read. It adds outbound edges from c10 and c5 to c84; no god node is on the path. The consumer half reaches `templates/lefthook/noldor.yml` and a migration under `src/migrations/`.

## Decision

A check that ships to consumers but is off by default is turned on by a `<check>: { enabled: true }` block in `.noldor/config.json`, not by a flag in the shipped hook. The shipped hook always calls the command; the command reads the switch. Off means the command prints one line naming how to turn it on and exits 0 without doing the work. On means the full check with no softened mode. Every surface that reports the check reads the same switch. A `noldor upgrade` migration writes the switch as `false`, so it is visible in each consumer's config, and never turns it on.

## Consequences

Easier:
- A consumer adopts a check by editing one config value; the shipped hook block stays byte-identical across consumers.
- The hook, `sdd-report` and the dashboard cannot disagree about whether a repo uses a check.

Harder:
- A repo's strictness is no longer visible from its hook file alone; one has to read the config.
- Every new opt-in check adds a schema block and a migration.

Ruled out:
- Call-site flags such as `--if-installed` in shipped hook templates as the way to opt a consumer in.
- Inferring adoption from what is installed in `node_modules`.
- An upgrade that turns an opt-in check on by itself.
