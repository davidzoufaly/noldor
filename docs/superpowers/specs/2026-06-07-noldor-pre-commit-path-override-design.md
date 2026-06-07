# Pre-commit Hook Honors `NOLDOR_PATH_OVERRIDE`

- **Date:** 2026-06-07
- **FD:** `noldor` (attach — self-host framework FD)
- **Enhancement slug:** `pre-commit-path-override`
- **Roadmap entry:** Pre-commit Hook Honors `Noldor-Path-Override` (tooling, S, high)

## Problem

`runPreCommit` in [`src/hooks/noldor-pre-commit.ts`](../../../src/hooks/noldor-pre-commit.ts)
reads only `.noldor/session.json`. It never inspects the pending commit message.

The documented `Noldor-Path-Override:` trailer releases the **commit-msg** layer
(`validate-trailer` scope + trailer checks, `enforce-review-receipt`, `release-cr-gate`),
but it never reaches the **pre-commit** layer: git finalizes the commit message
*after* the pre-commit hook runs (on `git commit -m`, `.git/COMMIT_EDITMSG` is not
yet written when pre-commit fires). So a stale `micro-chore` session blocks
legitimate code edits at the pre-commit allowlist check with no escape hatch.

Hit live 2026-05-12: a `fast-track`-intent code edit was stopped because the
session was still `micro-chore` from the prior triage commit, and the override
trailer was invisible to the pre-commit script. Verified 2026-06-07: the hook
still reads only the session marker.

## Mechanism

A `NOLDOR_PATH_OVERRIDE` environment variable, scoped to a single `git commit`
invocation:

```
NOLDOR_PATH_OVERRIDE="reason" git commit -m "msg" -m "Noldor-Path-Override: reason"
```

Stateless by design — no marker file, no cross-invocation bleed. Rejected
alternatives:

- **`.git/COMMIT_EDITMSG` peek** — unreliable. Git's hook ordering means the
  message is not written until after pre-commit runs on `git commit -m`. Best-effort
  at most.
- **`.noldor/override` marker file** — reintroduces the exact failure class being
  fixed: a stale marker left by a crash/abort silently unlocks the *next* commit
  (the same "gate state outlives its intent" problem as the sibling
  Session Marker Auto-Expire entry). Stateful, prone to bleed.

The env var is visible to both the pre-commit and commit-msg hooks because they
run in the same `git commit` process tree.

## Bypass scope

The override releases **both** pre-commit blocks, consistent with the universal
escape-hatch semantics `Noldor-Path-Override` carries everywhere else:

1. **micro-chore / release-sweep allowlist** — staged files outside the allowlist
   (the documented incident).
2. **no-`/gate`-session hard wall** — post-rollout, no session marker present.

A single early return in `runPreCommit`, placed before the session/allowlist
branches and before the hard-wall block, short-circuits both.

## Audit

No new audit logging is added at the pre-commit layer. The operator must set the
matching `Noldor-Path-Override:` trailer regardless — it is required to pass the
commit-msg `validate-trailer` layer. That trailer is the single durable audit
source:

- `validate-trailer` ([`src/hooks/noldor-validate-trailer.ts`](../../../src/hooks/noldor-validate-trailer.ts))
  appends it to `.noldor/overrides.log`.
- It lands in git history, where the `/garden` override detector
  ([`src/garden/detectors/override-audit.ts`](../../../src/garden/detectors/override-audit.ts))
  reads it via `git log`.

The env var's only job is unlocking pre-commit; the audit trail already exists via
the trailer. No double-logging, no dedup concern.

The env var value and trailer reason are **not** enforced to match — they are
independent layers, and coupling them adds no safety.

## Unlock signal semantics

`opts.pathOverride?.trim()` non-empty → unlock. `NOLDOR_PATH_OVERRIDE=` (empty) or
unset → no-op (existing behavior). This prevents an accidental empty-string
assignment from silently unlocking the gate.

## Changes

### `src/hooks/noldor-pre-commit.ts`

- Add `pathOverride?: string` to the `opts` parameter of `runPreCommit`.
- At the top of `runPreCommit` (before reading the session and before the
  hard-wall block):

  ```ts
  if (opts.pathOverride?.trim()) {
    return { ok: true };
  }
  ```

- The CLI entrypoint (the `import.meta.url === ...` block) reads
  `process.env.NOLDOR_PATH_OVERRIDE` and passes it as `opts.pathOverride`. This
  keeps `runPreCommit` pure and testable (no direct `process.env` read inside the
  function), matching the existing injectable structure.

### `src/hooks/__tests__/noldor-pre-commit.test.ts`

Add cases:

1. env var non-empty + `micro-chore` session with disallowed staged files →
   `ok: true` (allowlist released).
2. env var non-empty + no session, post-rollout → `ok: true` (hard wall released).
3. env var empty / whitespace-only → behaves as if unset (allowlist still blocks).
4. env var unset → existing behavior unchanged (regression guard).

### `docs/noldor/complexity-gating.md`

Under the existing `Noldor-Path-Override` section, document that pre-commit honors
the escape via the `NOLDOR_PATH_OVERRIDE` env var. Include the canonical one-liner
and note that both must be set: the env var unlocks pre-commit, the trailer unlocks
the commit-msg layer and provides the audit record.

## Out of scope

- **Session Marker Auto-Expire** (sibling roadmap entry) — staleness detection by
  `startedAt` age. This spec only adds the manual escape hatch.
- Auto-clearing `micro-chore` sessions after a successful commit (also tracked under
  the Session Marker Auto-Expire entry).
