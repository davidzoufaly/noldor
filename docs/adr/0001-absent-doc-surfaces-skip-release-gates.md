---
status: accepted
date: 2026-08-19
---

# Absent Doc Surfaces Skip Release Gates

## Context

The framework ships blocking release gates over consumer-owned doc surfaces —
the architecture pages (Q-0093) and the decision records (Q-0135). A gate that
fires on a repo that never adopted the surface would make `noldor init` hand
every fresh consumer a blocked release, and adoption is the framework's
standing prioritization tie-breaker (`docs/vision.md`, "Noldor is a product").
The alternative — gating by default and letting consumers opt out — was
considered when the architecture surface shipped.

## Decision

A doc surface the repo has not opted into maps to `skipped`, never `blocking`,
in every gate that reads it: release preflight rows, garden detectors, and SDD
gaps all key on the surface's own `absent` status. Opt-in is an affirmative
authoring act — editing a scaffolded architecture page, writing the first
decision record — never the mere existence of a folder that `init` or a
curious `mkdir` created. Each blocking row still carries an audited
`RELEASE_SKIP_*` override for the repo that opted in and needs out once.

## Consequences

Easier: `noldor init` is always safe to run — no scaffold can put a consumer
into a blocking state, so adoption has no gate-shaped downside. New doc
surfaces get a ready-made posture to copy instead of re-litigating it.

Harder: a consumer who wants a surface enforced must actually start it; the
framework cannot nudge a repo that never opted in, so absent surfaces are
invisible in garden and the SDD report by design.

Ruled out: gate-by-default with opt-out config, and any check that treats an
empty scaffold as adoption.
