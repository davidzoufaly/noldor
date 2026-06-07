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

The audit trail is two-tier. The earlier (rejected) "rely on the trailer alone"
design had a laundering hole: pre-commit cannot read the commit message, so the
operator could set the env var to unlock pre-commit *and* use a non-override
trailer (e.g. `Noldor-Path: fast-track`, which `validate-trailer` accepts at
`noldor-validate-trailer.ts:146` with no logging) — landing the change with **zero
audit record**. The claim that the trailer is "required" is false: only *some*
valid `Noldor-Path` trailer is required, and most paths are not logged.

The fix closes the hole by making the env-var bypass self-auditing:

1. **Local breadcrumb (always written).** When the env var unlocks pre-commit, the
   CLI entrypoint appends a tagged line to `.noldor/overrides.log`:

   ```
   <iso>\t<reason>\t(pre-commit)
   ```

   where `<reason>` is the trimmed env-var value. This is written on *every*
   env-var bypass, regardless of which trailer (if any) the commit carries —
   mirroring the intent of the existing `validate-trailer`
   ([`src/hooks/noldor-validate-trailer.ts`](../../../src/hooks/noldor-validate-trailer.ts):82-90)
   write for the `Noldor-Path-Override` trailer. The line formats are *not*
   identical: the existing commit-msg write is 2-column and untagged
   (`<iso>\t<reason>`); the new pre-commit write is 3-column with a `(pre-commit)`
   tag. A canonical env-var-**and**-trailer commit therefore yields two
   distinguishable lines (one untagged from commit-msg, one `(pre-commit)`-tagged)
   rather than an ambiguous duplicate. `.noldor/overrides.log` has no automated
   parser today (it is a human-readable convenience log), so the differing column
   count and trailing tag are both format-safe.

2. **Authoritative cross-clone audit.** The committed `Noldor-Path-Override:`
   trailer remains the durable audit source read by the `/garden` override detector
   ([`src/garden/detectors/override-audit.ts`](../../../src/garden/detectors/override-audit.ts))
   via `git log`. The operator should pair the env var with the matching trailer:

   ```
   NOLDOR_PATH_OVERRIDE="reason" git commit -m "msg" -m "Noldor-Path-Override: reason"
   ```

**Residual gap (accepted).** An env-var bypass *without* the override trailer is
recorded in the local `.noldor/overrides.log` but is absent from the git-log
cross-clone audit (it is not in commit history). This is strictly better than the
pre-existing `git commit --no-verify` escape, which bypasses every hook and leaves
no record at all. Pairing the env var with the trailer (the documented one-liner)
is required for full cross-clone auditability; the local breadcrumb is the
backstop when an operator omits it.

The env-var value and trailer reason are **not** enforced to match — they are
independent layers, and coupling them adds no safety.

## Unlock signal semantics

`opts.pathOverride?.trim()` non-empty → unlock. `NOLDOR_PATH_OVERRIDE=` (empty) or
unset → no-op (existing behavior). This prevents an accidental empty-string
assignment from silently unlocking the gate.

## Changes

### `src/hooks/noldor-pre-commit.ts`

- Add `overrideReason?: string` to the `PreCommitResult` interface — set when the
  env var honored the bypass so the CLI knows to log it. Keeps `runPreCommit`
  pure (no file I/O inside the function), matching the existing injectable
  structure.
- Add `pathOverride?: string` to the `opts` parameter of `runPreCommit`.
- At the top of `runPreCommit` (before reading the session and before the
  hard-wall block):

  ```ts
  const override = opts.pathOverride?.trim();
  if (override) {
    return { ok: true, overrideReason: override };
  }
  ```

  The single early return releases **both** the allowlist branches and the
  no-session hard wall.
- Extract a small exported helper `logOverride(cwd: string, reason: string): void`
  that appends the breadcrumb line. This is the **prescribed** design (not a
  fallback) — it moves the audit side-effect out of the untestable
  `import.meta.url` entrypoint so it can be unit-tested directly:

  ```ts
  import { appendFileSync } from 'node:fs';
  import { join } from 'node:path';

  export function logOverride(cwd: string, reason: string): void {
    try {
      appendFileSync(
        join(cwd, '.noldor', 'overrides.log'),
        `${new Date().toISOString()}\t${reason}\t(pre-commit)\n`,
      );
    } catch {
      // logging failure must not block the override itself
    }
  }
  ```

  The try/catch mirrors `validate-trailer`'s logging discipline — a failed log
  write never blocks the commit. Note the added `node:fs` (`appendFileSync`) and
  `node:path` (`join`) imports; the file currently imports `spawnSync` only.
- The CLI entrypoint (the `import.meta.url === ...` block) reads
  `process.env.NOLDOR_PATH_OVERRIDE`, passes it as `opts.pathOverride`, and when
  the result carries `overrideReason`, calls
  `logOverride(process.cwd(), r.overrideReason)`.

Lefthook runs hooks as child processes of `git commit` and inherits git's
environment, so `NOLDOR_PATH_OVERRIDE` set on the `git commit` invocation reaches
the hook process. No lefthook config change is needed.

### `src/hooks/__tests__/noldor-pre-commit.test.ts`

Add cases against `runPreCommit` (pure — assert the result, including
`overrideReason`):

1. `pathOverride` non-empty + `micro-chore` session with disallowed staged files →
   `{ ok: true, overrideReason: '<reason>' }` (allowlist released).
2. `pathOverride` non-empty + `release-sweep` session with disallowed staged files →
   `{ ok: true, overrideReason }` (release-sweep allowlist released).
3. `pathOverride` non-empty + no session, post-rollout →
   `{ ok: true, overrideReason }` (hard wall released).
4. `pathOverride` empty / whitespace-only → behaves as if unset (allowlist still
   blocks; no `overrideReason`).
5. `pathOverride` unset → existing behavior unchanged (regression guard).

Plus one test for the breadcrumb against the prescribed `logOverride(cwd, reason)`
helper: call it with a temp `cwd` and assert `.noldor/overrides.log` contains a
`(pre-commit)`-tagged line with the reason. This covers the audit side-effect
without spawning a real `git commit`.

### `docs/noldor/complexity-gating.md`

Under the existing `Noldor-Path-Override` section, document that pre-commit honors
the escape via the `NOLDOR_PATH_OVERRIDE` env var. Include the canonical one-liner.
Phrase the guidance precisely, consistent with the Audit section above: the env var
unlocks pre-commit (and always writes a local `.noldor/overrides.log` breadcrumb);
the `Noldor-Path-Override` trailer **should** be paired with it so the bypass is
captured in the cross-clone git-log audit. Do **not** state that "the trailer is
required" or that "the trailer is the audit record" — the commit-msg layer accepts
any valid `Noldor-Path` (including unlogged `fast-track`), so only pairing the
*override* trailer guarantees cross-clone auditability.

## Out of scope

- **Session Marker Auto-Expire** (sibling roadmap entry) — staleness detection by
  `startedAt` age. This spec only adds the manual escape hatch.
- Auto-clearing `micro-chore` sessions after a successful commit (also tracked under
  the Session Marker Auto-Expire entry).
