# Noldor Framework Vision

## North Star

Noldor is the discipline framework for agent-driven software development.
Every change flows through a single gate, every artifact is doc-tracked,
and every commit carries enough context for an autonomous agent or human
reviewer to understand the why. The goal: a development substrate where
agents can ship production-quality changes unsupervised — and where humans
can audit the trail without losing context.

Specs explain intent. Plans break intent into bite-sized tasks. Gates
enforce that no code change escapes review. Detectors keep the doc
framework in sync with the code. Release machinery is one-button. The
framework is the floor; the operator's judgment is the ceiling.

## Posture

Noldor is opinionated, not configurable. The defaults are the framework.
Single-source-of-truth feature MDs (`docs/features/<slug>.md`) anchor every
change. The gate skill is the only entry point. Phase markers move in
lockstep with PRs. The dashboard surfaces drift the moment it appears,
not at release time.

Consumer-specific values live in `.noldor/config.json`'s `consumer:`
block — lockstep packages, repo URL, package prefix, app path prefix,
boundary rules. The framework runtime reads them through
`loadConsumerConfig()`; no Charuy literal survives in framework code.

## Noldor is a product

Noldor is intended for adoption by other projects, not a personal substrate.
When ranking framework work, weight **adoption blockers** — distribution,
upgrade/migration, consumer-contract testing, real external-adoption runs —
above internal-only polish. This is the standing prioritization tie-breaker.

The framework must also be **self-owned**: every load-bearing fact lives in this
repo, not in any single assistant's private memory. Operational knowledge that
would otherwise be memory-bound belongs in [`noldor/gotchas.md`](noldor/gotchas.md)
and the runbooks beside it.

## Editing this file

Vision is the strategic frame: paragraph-level intent, no schedules, no
version commitments. Specific features and intermediate work live in
`packages/noldor/docs/roadmap.md` (triaged) and `packages/noldor/docs/backlog.md`
(parked).
