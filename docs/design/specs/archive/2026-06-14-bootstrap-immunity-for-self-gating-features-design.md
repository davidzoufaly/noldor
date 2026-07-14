# Bootstrap-Immunity for Self-Gating Features — Design

**Slug:** bootstrap-immunity-for-self-gating-features
**FD:** docs/features/bootstrap-immunity-for-self-gating-features.md
**Date:** 2026-06-14
**Tier:** specs-only
**Deps:** none

## Problem

A feature that *introduces* a new release-time gate cannot satisfy that gate
with its own commits — the enforcement code didn't exist when those commits
were authored. This hit live during `automated-cr-pipeline`:
`src/release/release-cr-gate.ts:checkCrGate` requires `Noldor-Reviewed-Codex`
(tree-match) **or** a non-empty `Noldor-CR-Override-Codex` on every
code-touching commit in `<prev-tag>..HEAD`, but none of the 22 feature-branch
commits carry a codex receipt — `pnpm cr:codex` was added *by those very
commits*. The gate is unsatisfiable by construction.

Today the operator works around it two ways, both manual and both routine
escape hatches:
- hand-add `Noldor-CR-Override-Codex: bootstrap` to each of the 22 commits
  before the next release, or
- run `pnpm release` with `RELEASE_SKIP_CR_GATE=1` (release/index.ts:191) — the
  blanket bypass v0.4.0/v0.5.0 already shipped with.

The blanket bypass skips the gate for the *entire* release range, not just the
gate-introducing commits — it disables the safety net it was meant to bootstrap.

## Goals

- Detect, at `/gate` end-of-flow, that the in-flight feature introduces a gate
  its own commits cannot pass.
- Auto-inject the *exact* override trailer that gate reads, with a recognizable
  `bootstrap` reason, on every commit of the worktree branch — before push,
  while the branch is still private and rewritable.
- Keep the injection idempotent and tree-preserving (so review-receipt
  tree-hashes stay valid).
- Make the injected overrides auditable by `/garden`: a bootstrap override is
  legitimate **only** when some FD in the range declares it introduced that
  gate; orphan bootstrap reasons surface as drift.
- Remove the need for `RELEASE_SKIP_CR_GATE=1` on the gate-introducing cycle.

## Non-goals

- Operationalizing per-commit codex receipts on *normal* (non-gate-introducing)
  features — that is the separate "codex CR unsatisfiable" track noted in the
  roadmap body; this FD only covers the self-gating bootstrap case.
- Removing the `RELEASE_SKIP_CR_GATE` / `RELEASE_SKIP_GATE_COMPLIANCE` env vars.
  They stay as documented escape hatches; retiring them is a tracked follow-up
  `chore` (verify `pnpm release` green without the flag).
- Grandfathering arbitrary historical pre-gate commits via a permanent floor in
  `checkCrGate` (see Open question 4).

## Design

### Unit 1 — `introduces-gate` FD frontmatter field

Extend `FeatureFrontmatterSchema` in `src/features/feature-schema.ts:38` with an
optional `'introduces-gate'` key (the schema is `.strict()`, so the field must
be declared or every gate-introducing FD fails validation):

```ts
'introduces-gate': z.string().min(1).optional(),
```

Value is a **gate-registry key** (Unit 2), e.g. `codex-cr`. Documented in
`docs/noldor/feature-md-schema.md`'s frontmatter table. `/promote` and
`/new-feature` leave it unset by default; it is hand-added to an FD whose work
adds a release-time gate.

### Unit 2 — gate registry (`src/cr/gate-registry.ts`, new)

A single source of truth mapping a gate-registry key to the override trailer
that gate honors, so the injector writes a trailer `checkCrGate` already reads
rather than inventing a new one:

```ts
export const GATE_REGISTRY = {
  'codex-cr':  { overrideTrailer: 'Noldor-CR-Override-Codex', log: 'cr-overrides.log' },
  'claude-cr': { overrideTrailer: 'Noldor-Path-Override',     log: 'overrides.log' },
} as const;

export const BOOTSTRAP_REASON =
  'bootstrap — feature added the gate that would block its own commits';
```

`overrideTrailer` values match exactly what `checkCrGate` reads
(release-cr-gate.ts:54, :61) and what `validateTrailer` logs
(noldor-validate-trailer.ts:94, :104). `log` names the audit ledger
(`.noldor/<log>`) so the injector's breadcrumb lands where the existing
detectors look.

### Unit 3 — injector (`src/cr/bootstrap-immunity.ts`, new)

- `resolveIntroducedGate(cwd, slug)` — reads `docs/features/<slug>.md`
  frontmatter via `gray-matter` (same pattern as
  noldor-validate-trailer.ts:169), returns the matching `GATE_REGISTRY` entry or
  `null` when `introduces-gate` is unset/unknown.
- `injectBootstrapOverrides({ cwd, slug, range, runGit })` — when a gate
  resolves, rewrites each commit message in `range` (default
  `origin/main..HEAD`) to carry `<overrideTrailer>: <BOOTSTRAP_REASON>`. Rewrite
  is **message-only**, so commit trees are untouched and any
  `Noldor-Reviewed*: <tree>` receipt amended earlier stays valid. Idempotent —
  a commit that already carries the trailer is skipped (`git interpret-trailers
  --if-exists doNothing` semantics). Returns `{ gate, injected: string[] }`.

Rewrite mechanism: `git filter-branch` over the range with a `--msg-filter`
piping each message through `git interpret-trailers --trailer
"<overrideTrailer>: <reason>"`, run with `FILTER_BRANCH_SQUELCH_WARNING=1`. The
range is a linear private branch descending from `origin/main`; filter-branch
preserves trees and only the message changes. (Alternatives weighed in Open
question 3.)

The injector appends one `<iso>\t<reason>` row per rewritten commit to
`.noldor/<log>` (matching the format `validateTrailer` writes at
noldor-validate-trailer.ts:97/:111) so `/garden`'s ledgers see the bootstrap
overrides without a separate commit-msg pass.

### Unit 4 — CLI surface (`pnpm noldor cr bootstrap`)

Add a `bootstrap` subcommand to the `cr` dispatcher (alongside
`orchestrate`/`aggregate`/`escalate`):

```
pnpm noldor cr bootstrap --slug <slug> [--range origin/main..HEAD] [--autonomous]
```

No-op (exit 0, prints `no introduces-gate — skipped`) when the FD declares no
gate. On success prints the injected SHA count + gate name. `--autonomous`
suppresses any confirmation so the drain runner can call it unattended.

### Unit 5 — gate Step 4 wiring (`.claude/skills/gate/SKILL.md`)

Insert one bullet in Step 4 **after** the code-stage review amends
`Noldor-Reviewed-Subagent` on the tip and **before** `pnpm noldor pr-flow`:

> **Bootstrap-immunity (gate-introducing FDs only).** Run `pnpm noldor cr
> bootstrap --slug <slug>`. If the FD's frontmatter declares `introduces-gate`,
> this rewrites every commit on the worktree branch to carry the matching
> bootstrap override so the release gate the feature introduces can't block its
> own commits. No-op otherwise. Runs after the review amend (tree-preserving) so
> review receipts stay valid; runs before push so the rewrite stays local.

Fast-track / micro-chore paths skip it (no FD).

### Unit 6 — garden legitimacy detector (`src/garden/detectors/bootstrap-override-audit.ts`, new)

New gate-compliance detector wired into `detectGateCompliance`
(garden-detect.ts:582) and `GateComplianceFindings` (garden-detect.ts:567):

- Scan the release range (`releaseRange()`, garden-detect.ts:664) for commits
  whose override trailer reason starts with `bootstrap` (matching
  `BOOTSTRAP_REASON`).
- For each, confirm some FD touched in the range declares `introduces-gate` for
  the gate whose override trailer was used. An override using the bootstrap
  reason **without** a backing gate-introducing FD → `WARN` finding (abuse: a
  non-bootstrap commit laundered through the bootstrap reason).

To keep legitimate bootstrap from reading as override-abuse, exclude
`bootstrap`-reason rows from the frequency/repeated counters in
`src/garden/detectors/codex-cr-override-audit.ts:auditCodexCrOverrides` (those
counters fire at `freqThreshold` 3 — a 22-commit branch would always trip them).
The dedicated detector accounts for them instead.

## Acceptance criteria

- `FeatureFrontmatterSchema` accepts an FD with `introduces-gate: codex-cr` and
  still rejects an unknown frontmatter key (strictness preserved).
- `resolveIntroducedGate` returns the `codex-cr` registry entry for such an FD
  and `null` for an FD without the field.
- `injectBootstrapOverrides` over a 3-commit branch with no codex receipts adds
  `Noldor-CR-Override-Codex: <BOOTSTRAP_REASON>` to all three; a second run is a
  no-op (idempotent); commit trees (`git rev-parse <sha>^{tree}`) are unchanged.
- After injection, `checkCrGate({ from, to })` over that range returns
  `ok: true` (the override branch at release-cr-gate.ts:58 is satisfied).
- A `Noldor-Reviewed-Subagent: <tree>` trailer amended before injection still
  tree-matches after injection.
- `pnpm noldor cr bootstrap --slug <slug>` exits 0 with a "skipped" message when
  the FD declares no `introduces-gate`.
- The bootstrap detector flags a commit carrying a `bootstrap`-reason override
  when no in-range FD declares `introduces-gate`; passes it when one does.
- `auditCodexCrOverrides` does not raise `frequency`/`repeated` findings for
  rows whose reason starts with `bootstrap`.
- e2e: a feature branch that adds a gate + an FD with `introduces-gate`, run
  through `cr bootstrap`, lets `pnpm release` pass `checkCrGate` **without**
  `RELEASE_SKIP_CR_GATE=1`.

## Risks / trade-offs

- **History rewrite on the feature branch.** `filter-branch` rewrites SHAs;
  safe here because the branch is private pre-push and `pr-flow` already
  force-pushes with `--force-with-lease`. Risk if invoked on `main` — the CLI
  must refuse a range that includes `main`'s tip or run only inside a worktree
  branch.
- **Tree-hash coupling.** Correctness depends on filter-branch preserving trees;
  message-only `--msg-filter` does. A future switch to a rebase-based rewrite
  must keep this invariant (Open question 3).
- **Reason-string as a contract.** The detector matches on the `bootstrap`
  reason prefix; a typo in `BOOTSTRAP_REASON` would silently de-audit. Mitigated
  by sourcing the constant from one module (Unit 2) used by both injector and
  detector.
- **Abuse surface.** The bootstrap reason satisfies the gate for *any* commit it
  is stamped on. The legitimacy detector (Unit 6) is the backstop — its WARN is
  advisory, not blocking, so a determined operator can still ship abuse; that
  matches the framework's "floor, not ceiling" posture.

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

## Open questions (resolved)

1. *Detect gate-introduction via FD frontmatter or graph annotation?*
   -> **FD frontmatter `introduces-gate`.** (D1) The FD frontmatter is the
   strict-Zod single source of truth and is validated in CI; the graph is
   derived and lossy, with no validation path.

2. *New generic `Noldor-<gate>-Override` trailer, or reuse the existing
   per-gate override trailers?*
   -> **Reuse via the registry** (`Noldor-CR-Override-Codex`,
   `Noldor-Path-Override`). (D2) `checkCrGate` only reads those exact keys
   (release-cr-gate.ts:54/:61); a new generic trailer wouldn't satisfy the gate
   without also editing `checkCrGate` and every audit detector.

3. *Branch-rewrite mechanism: `filter-branch`, `rebase --exec`, or a tip-only
   manifest trailer?*
   -> **`filter-branch --msg-filter` over `origin/main..HEAD`** with
   `FILTER_BRANCH_SQUELCH_WARNING=1`. (D3) It is message-only (preserves trees,
   keeps review receipts valid), handles the linear private branch in one pass,
   and avoids interactive rebase (blocked in this environment). A tip-only
   manifest was rejected: the body and the audit detectors require a per-commit
   trail.

4. *How to handle historical pre-gate commits (the 18 pre-v0.1.0 codex-less
   commits)?*
   -> **Keep `RELEASE_SKIP_CR_GATE=1` as the documented one-cycle escape hatch
   plus a one-time backfill**, not a permanent floor in `checkCrGate`. (D4) A
   permanent floor adds standing complexity and a silent skip window to the
   gate; a one-time `cr bootstrap --range <tag>..HEAD` backfill on a maintenance
   branch is auditable and self-retiring. Tracked by the follow-up `chore` to
   verify `pnpm release` is green without the flag.

5. *Inject before or after the Step 4 review-trailer amend?*
   -> **After the amend, before push.** (D5) filter-branch preserves trees, so
   the `Noldor-Reviewed*: <tree>` receipt amended first stays valid; injecting
   first risks the amend reordering or clobbering the trailer block.

6. *Only `*-new` paths, or also `*-attach` enhancements?*
   -> **Any path whose session FD (or attach parent) declares
   `introduces-gate`.** (D6) A gate can be introduced by an enhancement to an
   existing FD, not only a brand-new feature.

7. *Bootstrap overrides will trip the existing override-frequency WARN — keep or
   suppress?*
   -> **Suppress in `auditCodexCrOverrides`; account via the dedicated
   legitimacy detector.** (D7) A legitimate 22-commit bootstrap would always
   exceed `freqThreshold` 3 and read as abuse; the dedicated detector audits
   legitimacy (backing FD present) instead of raw frequency.
