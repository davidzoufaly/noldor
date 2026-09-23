---
status: accepted
date: 2026-09-22
---

# Shipped CI templates route through a PR

## Context

Noldor shipped no `.github/` templates until `self-refreshing-compact-knowledge-graph` (Q-0260), which adds a workflow that regenerates the committed knowledge graph after a merge and lands the result on the default branch. Deciding how that bot commit reaches `main` forced a general question, because the answer binds every CI file noldor ships from here on.

The framework already answers it for humans. `src/hooks/noldor-pre-push.ts` blocks `refs/heads/main` outright, with the message "All paths land on main via PR." No hook honours a `CI` or `GITHUB_ACTIONS` escape, and `postinstall` runs `lefthook install`, so any CI job that installs dependencies has those hooks live. A workflow that pushed directly would therefore have to carry `--no-verify` or `LEFTHOOK=0` — inside a file noldor hands to every consumer.

The reference implementation pushes directly (`gdc-mastercard-panther/.github/workflows/update-knowledge-graphs.yaml`), which is unremarkable in a repo that has no such gate. Noldor does, and it is the gate's author.

## Structural context

The decision binds `templates/.github/**` — a directory that did not exist before — against `src/hooks/noldor-pre-push.ts`. `src/templates/manifest.ts` (community 32) is the distribution seam: `templateFiles()` is a recursive directory walk, so the constraint applies to any file later added under that path without further wiring.

noldor:cut the committed graph predates `templates/.github/`, so no edge to it can be read from the graph yet; a later reading would change this only by naming the communities the workflow's own scripts land in.

## Decision

A CI workflow that noldor ships as a template reaches the default branch by opening a pull request. It never pushes to the default branch, and it never disables or bypasses the git hooks — no `--no-verify`, no `LEFTHOOK=0`, and no skipping `lefthook install` to avoid arming them.

A wholly machine-generated commit that consequently cannot carry a `Noldor-FD:` trailer or a review receipt uses the existing `Noldor-Path-Override:` trailer, naming its reason. That is the established mechanism rather than a new one: `src/prep/prep-promote.ts` already ships this shape for machine-written commits approved at a different stage, and `src/garden/detectors/override-audit.ts` counts every use into the SDD report.

## Consequences

Easier: the framework's stated posture holds without an exception clause, so a consumer reading a shipped workflow learns the gate rather than learns to route around it. Bot commits stay auditable — the override trailer puts them in the same report as every other override, instead of arriving as unattributed pushes.

Harder: a workflow needs repository support for merging its own PR. Where auto-merge is unavailable — charuy is a live instance — the PR waits for an operator, so the graph refresh is delayed rather than automatic. Falling back to a direct push is not available, by this decision and by the pre-push guard independently.

Ruled out: shipping any CI template that bypasses the hooks, including the reference implementation's direct-push shape. Also ruled out is the narrower dodge of skipping dependency install so the hooks are never armed — it reaches the same unreviewed commit by omission rather than by flag.

Open: override volume. One override per qualifying merge could drown the audit signal it lands in. The PR-title filter (`feat|fix|refactor`) limits the rate, and an empty regeneration produces no commit at all, but neither bounds it by design.
