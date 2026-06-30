---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/cr/gate-registry.ts
    - src/cr/bootstrap-immunity.ts
    - src/cr/bootstrap-cli.ts
    - src/features/feature-schema.ts
    - src/cli/manifest.ts
    - src/garden/detectors/bootstrap-override-audit.ts
    - src/garden/detectors/codex-cr-override-audit.ts
    - src/garden/garden-detect.ts
  docs:
    - docs/noldor/feature-md-schema.md
  tests:
    - src/cr/__tests__/gate-registry.test.ts
    - src/cr/__tests__/bootstrap-immunity.test.ts
    - src/garden/detectors/__tests__/bootstrap-override-audit.test.ts
  spec: >-
    docs/superpowers/specs/2026-06-14-bootstrap-immunity-for-self-gating-features-design.md
name: Bootstrap-Immunity for Self-Gating Features
packages:
  - scripts
phase: done
noldor-tier: specs-only
---
## Summary

When a feature adds a new release-time gate, the feature's own implementation commits cannot satisfy that gate (the enforcement code didn't exist when they were authored). Hit live during automated-cr-pipeline: the new `release-cr-gate.ts` requires `Noldor-Reviewed-Codex` on every code-touching commit in the release range, but none of the 22 feature-branch commits have it because `pnpm cr:codex` was added by those very commits. Operator currently must hand-add `Noldor-CR-Override-Codex: bootstrap` to each commit before next release, or extend the gate to skip pre-feature SHAs. Framework-level fix: when a gate-introducing FD is detected (graph annotation? FD frontmatter `introduces-gate: <name>`?), `/gate` end-of-flow auto-injects matching `Noldor-<gate>-Override: bootstrap — feature added the gate that would block its own commits` on every commit on the worktree branch. Audited by `/garden`'s override detectors so it can't be silently abused on non-bootstrap work.

- v0.4.0 release shipped with `RELEASE_SKIP_CR_GATE=1` bypass for the same reason — 34 commits in `v0.3.0..v0.4.0` predate the CR pipeline. Retire the env-var bypass next cycle once bootstrap-immunity lands so v0.5.0 doesn't ship the escape hatch as routine. Track via a `chore` to verify `pnpm release` succeeds without the flag.
- Codex CR gate unsatisfiable — 18 commits since v0.1.0 lack codex receipts; release needs `RELEASE_SKIP_CR_GATE=1` until codex CR is operationalized or pre-v0.1.0 commits are grandfathered.

## User Story

As an agent (or operator) shipping a feature that introduces a new release-time
gate, I want `/gate` end-of-flow to auto-stamp the matching bootstrap override
on the feature's own commits, so that the gate the feature adds doesn't block
its own merge or force a blanket `RELEASE_SKIP_CR_GATE=1` bypass at release.

## Usage

**Declare the gate on the FD** — add to `docs/features/<slug>.md` frontmatter:

```yaml
introduces-gate: codex-cr   # registry key from src/cr/gate-registry.ts
```

**Gate flow (automatic)** — at `/gate` Step 4, after code-stage review and
before PR flow, the gate runs:

```
pnpm noldor cr bootstrap --slug <slug>
```

No-op for FDs without `introduces-gate`. For a gate-introducing FD it rewrites
every commit on the worktree branch to carry the matching bootstrap override and
prints the injected count.

**Manual / ad-hoc:**

```
pnpm noldor cr bootstrap --slug <slug> --range origin/main..HEAD
pnpm noldor cr bootstrap --slug <slug> --autonomous   # no prompts (drain)
```

**Audit:** `pnpm garden:detect --gate-compliance` surfaces any `bootstrap`-reason
override that lacks a backing `introduces-gate` FD as a WARN.

**Agent API / keyboard surface:** _none — operates through git, the `noldor cr`
CLI, and lefthook; no `window.*` surface._

## PRs

<!-- @prs-since-last-release: bootstrap-immunity-for-self-gating-features -->

## Changelog
