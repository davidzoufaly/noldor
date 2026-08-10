# Gate Auto-Addresses CR Blockers — Design

**Slug:** specs-cr-gate-multi-reviewer (enhancement: `auto-fix-blockers`)
**FD:** docs/features/specs-cr-gate-multi-reviewer.md
**Date:** 2026-08-07
**Tier:** specs-only
**Entry:** Q-0075 (roadmap, size M, impact high)

## Problem

Both blocker seams in the gate are prompt-only.

- **Artifact-stage.** `/noldor-gate` Step 2.5's continue-dialog offers `address-blockers`, whose prose is
  literally "operator edits the artifact, then loop back to the top of Step 2.5". No CLI backs it.
- **Code-stage.** `cr escalate` prompts `retry-implementation / spawn-deep-review / override-with-trailer /
  abort` ([`src/cr/escalate.ts:64`](../../../src/cr/escalate.ts#L64)).

Neither carries an auto-fix outcome, so not even `proceed-autonomous` plus `autonomous.onFailure` can express
"fix it and re-round". The framework asks the operator to do work it could do itself. In drain
(`autonomous.onFailure: 'abort'`, asserted by
[`assertConfig`](../../../src/autonomous/queue-drain.ts#L88)) the cost is worse than friction: a single
mechanical blocker — a missing spec section, an unanswered open question — aborts the whole iteration and the
supervisor rebuilds from scratch.

A second, smaller defect blocks any re-round loop. Step 2.5 instructs the controller to pass
`--base-sha <priorArtifactSha>` "read from prior `LaneFindings.artifactSha`", but
[`laneFindingsSchema`](../../../src/cr/findings-schema.ts#L29-L47) carries `baseSha` and no `artifactSha`.
The instruction names a field that does not exist.

## Goals

1. A blocker round that is entirely mechanical is fixed and re-reviewed without a prompt.
2. A blocker round containing any design disagreement still reaches the operator.
3. The classification of "mechanical" is made by the reviewer, recorded on disk, and auditable.
4. The loop cannot spin: it stops on a round cap and on no-progress.
5. Both seams use one mechanism.
6. `--base-sha` for a re-round comes from a source that exists.

## Non-goals

- **Applying fixes in Node.** Applying a blocker is an LLM act performed by the gate controller. The CLI
  added here decides and records; it never edits an artifact.
- **A new headless-safe config precondition.** Both `onBlockers` values are safe unattended (see U2), so
  [`assertConfig`](../../../src/autonomous/queue-drain.ts#L88) is left alone.
- **Changing `cr escalate`.** Its contract — "a red already happened, how do we escalate" — and its closed
  exit-code set stay as they are.
- **Adding `artifactSha` to the sink schema.** The instruction is corrected instead (U4, D7).
- **Auto-fixing suggestions.** Only `blockers` are in scope; `suggestions` (Minor) remain advisory.

## Design

### U1 — Reviewer-emitted classification (`Finding.class`)

The reviewer is the classifier, not the controller: whoever applies a fix must not be the one deciding it is
safe to apply unasked.

- [`src/cr/findings-schema.ts`](../../../src/cr/findings-schema.ts#L11-L17) — `findingSchema` gains
  `class: z.enum(['mechanical', 'design']).optional()`. Optional, so every existing sink on disk still parses
  and `aggregate()` is unchanged.
- [`src/cr/lanes/subagent-dispatch.ts`](../../../src/cr/lanes/subagent-dispatch.ts#L72-L86) — `buildPrompt`
  instructs the reviewer to prefix each `Issues` bullet with `[mechanical]` or `[design]`, and defines them:
  *mechanical* = the fix is determined by the finding itself (a missing required section, an unanswered open
  question, a lint-class defect, a stated contract not met); *design* = the fix requires a judgment call the
  reviewer is not making for you (disagreement about an approach, a default, a trade-off).
- **New** `src/cr/finding-class.ts` — one pure fn:

  ```
  splitClassTag('[mechanical] Acceptance criteria section absent')
    -> { class: 'mechanical', message: 'Acceptance criteria section absent' }
  splitClassTag('Acceptance criteria section absent')
    -> { message: 'Acceptance criteria section absent' }
  ```

  Case-insensitive on the tag; an unrecognized bracket prefix is left in the message untouched.
- [`src/cr/lanes/subagent.ts`](../../../src/cr/lanes/subagent.ts#L148-L160) — `mkFinding` runs each bullet
  through `splitClassTag` and spreads the resulting `class` onto the `Finding`.
  `parseSubagentMarkdown`'s exported signature is deliberately **unchanged** (`critical: string[]`) so its
  existing tests keep passing and classification lives in one pure, separately-testable fn.

**An absent tag means `design`.** That is read at the decision site (U4), not written into the sink — the sink
records what the reviewer actually said. Legacy sinks, the `codex` / `manual` / `verifier` lanes, and a
reviewer that ignores the instruction therefore all degrade to today's behaviour rather than to a silent
auto-fix.

### U2 — `autonomous.onBlockers` knob

[`autonomousConfigSchema`](../../../src/core/config.ts#L45-L55) gains
`onBlockers: z.enum(['auto-fix', 'prompt']).default('prompt')`.

`prompt` is the default because a design-disagreement blocker needs operator arbitration and the framework
cannot tell in advance that a round has none.

No new invariant lands in [`src/validate/noldor-config.ts`](../../../src/validate/noldor-config.ts#L15) and
`assertConfig` is untouched: `prompt` makes `autofix plan` decline, after which the existing seam runs exactly
as today (in drain, `onFailure: 'abort'` → abort). Both values are headless-safe.

### U3 — Auto-fix ledger

**New** `src/cr/autofix-ledger.ts`, holding the round state the loop bound needs.

Path: `.noldor/cr/autofix/<slug>-<kind>.json`. Written with the existing
[`writeJsonAtomic`](../../../src/cr/atomic-write.ts).

**The `autofix/` SUBDIRECTORY is load-bearing, not tidiness.**
[`aggregate()`](../../../src/cr/aggregate.ts#L29-L32) collects every
`.noldor/cr/<slug>-<kind>-*.json` regular file as a lane sink, so the originally-specified sibling name
`<slug>-<kind>-autofix.json` matched that glob: `inferLaneFromFilename` returned `null` for it and a bogus
`non-conforming filename` **high** blocker landed in every aggregate for the pair — which would have turned
green `--kind code` runs red and poisoned the very blocker list this feature reads. `aggregate` filters on
`e.isFile()`, so nesting removes the whole collision class; the existing `.noldor/cr/archive/` directory is
skipped the same way. (Caught by the CLI loop test, not by review — the collision is only visible once a real
ledger and a real sink share a directory.)

```
{ slug, kind, sessionStartedAt,
  rounds: [ { round, headSha, fingerprint, applied, deferred, diffStat, stopped? } ] }
```

**The round series is scoped to one gate session.** `sessionStartedAt` is copied from
[`.noldor/session.json`](../../../src/core/session.ts)'s `startedAt`. `readLedger` returns `null` when the
stored value differs from the current session's — a stale series reads as "no prior rounds", so the ledger is
effectively reset at every gate session start. Without this the cap is permanent rather than per-session:
`<slug>-<kind>` repeats across attach sessions and manual re-runs in the main workspace (drains get fresh
worktrees, the main workspace does not), so two auto-fix rounds recorded once would decline every future red
on that pair forever with `round-cap`. Step 4's clean-exit cleanup also `rm -f`s the ledgers for every kind
**and each one's `.bad` quarantine remnant** alongside the escalation-context file (see U6 for the exact
enumeration) — hygiene, not the correctness mechanism, but nothing else ever removes a `.bad` file.

Exports:

- `AUTOFIX_ROUND_CAP = 2` — a constant, not a knob. `docs/vision.md:19` ("opinionated, not configurable");
  one posture knob is enough.
- `fingerprintBlockers(blockers)` — sha1 over the blockers' `severity|file|message` tuples, sorted, so the
  value is order-independent and stable across runs. **`line` is deliberately excluded:** code-stage blockers
  carry one, and an unrelated edit elsewhere in the file shifts it, so an unfixed blocker would fingerprint as
  progress and `no-progress` would never fire — the stop this spec sells as primary.
- `isSameSeries(ledger, sessionStartedAt)` — the single session-match predicate, called by **both**
  `readLedger` and `appendRound`. The spec's own warning below ("reader and writer must key on the same value")
  argues against each side implementing its own comparison, where the two can drift apart silently.
- `readLedger(cwd, slug, kind, sessionStartedAt)` — `null` on absent or when `isSameSeries` is false;
  **throws a distinguishable `LedgerParseError`** on malformed content. A ledger that cannot be parsed means an
  unknown round count, and the caller in U4 must fail toward declining rather than toward another round.
  **Any other fs error (EACCES, EIO, a transient lock) propagates as itself and is NOT a `LedgerParseError`** —
  the distinction is load-bearing, because only a parse failure may trigger the quarantine below. Renaming a
  file away because it could not be *read* would restart the round series on transient infra: a fail-open cap
  reset, the one direction this design refuses.
- `appendRound(cwd, slug, kind, sessionStartedAt, round)` — **the writer owns the session key.** It stamps
  `sessionStartedAt` on the file, and on a mismatch (or an absent file) it *replaces* the series rather than
  appending to it: `{ slug, kind, sessionStartedAt, rounds: [round] }`. Appending blindly to a stale
  prior-session ledger would leave the old `sessionStartedAt` in place, so every subsequent `readLedger` in the
  current session keeps returning `null`, `rounds.length` stays 0, and both `round-cap` and `no-progress` go
  dead for the whole session — the loop bound defeated by the very scoping meant to make it usable. Reader and
  writer must key on the same value or the scoping is decorative — hence the shared `isSameSeries` above.
  On a **malformed** existing file `appendRound` throws rather than replacing it, matching `readLedger`'s
  fail-closed posture: a public export that silently overwrote unparseable state would let a caller who skipped
  the read destroy it. The normal flow never reaches this — `record` reads first — but the contract is explicit
  because `appendRound` is exported.

`appendRound` is a read-modify-write over a shared file: `writeJsonAtomic` makes the write atomic but not the
RMW, so two concurrent invocations against the same `slug`+`kind` can drop a round and undercount the cap.
Concurrent same-slug runs are unsupported, consistent with the sinks (whose `guardLaneOverwrite` likewise
assumes one writer). Parallel drain assigns each child a distinct slug, so the supported concurrency model
does not reach this.

Rejected: deriving rounds from the timestamped sinks under `.noldor/cr/archive/`.
[`guardLaneOverwrite`](../../../src/cr/orchestrate.ts#L210-L222) archives best-effort and logs-and-swallows
failures, so the loop bound would rest on state the framework admits it may lose.

### U4 — `cr autofix plan` (decide)

**New** `src/cr/autofix.ts` — the pure decision, no IO:

```
decide({ blockers, onBlockers, ledger, headSha })
  -> { verdict: 'auto-fix' | 'decline', reason, mechanical, design, baseSha }
```

Rules, in order — the first that matches wins:

| condition | verdict | reason |
| --- | --- | --- |
| `onBlockers !== 'auto-fix'` | `decline` | `knob-off` |
| `ledger.rounds.length >= AUTOFIX_ROUND_CAP` | `decline` | `round-cap` |
| `fingerprintBlockers(blockers)` equals the last round's | `decline` | `no-progress` |
| no blocker with `class === 'mechanical'` | `decline` | `no-mechanical` |
| no usable `baseSha` (see below) | `decline` | `no-base-sha` |
| otherwise | `auto-fix` | — |

`mechanical` = blockers with `class === 'mechanical'`; `design` = every other blocker, absent-tag included
(D2's fail-safe read). A mixed round returns `auto-fix` with a non-empty `design` list — the controller
applies the mechanical subset and then prompts on the remainder without re-rounding (D3), because re-rounding
would buy a review pass guaranteed to re-report the design blocker, and under `onFailure: 'abort'` it aborts
anyway.

`baseSha` is the authoritative value for the eventual re-round, resolved in this order: the last ledger
round's `headSha` when non-empty; else `headSha` (current `HEAD`); else — both unresolvable — no usable value,
so `decide` returns `decline` / `no-base-sha`. The middle fallback matters because `record` degrades a failed
`git rev-parse` to `headSha: ''` (see the error table) rather than refusing to record the round; without it,
round 2 would print an empty `base-sha:` and the gate would invoke `orchestrate --base-sha` with an empty
argument. **`plan` never prints an empty `base-sha:` value.**

This is D7's fix for the `LaneFindings.artifactSha` drift — the instruction is corrected to read this line
instead of a field that never existed, so no sha source can disagree with another.

**New** `src/cr/autofix-cli.ts` — entrypoint. Reads the verb from `process.argv[2]` (the CLI router mutates
argv, so `noldor cr autofix plan` arrives as a positional; same shape as the other `cr` entrypoints). Sources
blockers from [`aggregate(slug, kind)`](../../../src/cr/aggregate.ts#L22) and the knob from `loadConfig`.

stdout, machine-readable and stable:

```
verdict: auto-fix
reason: -
base-sha: a1b2c3d
round: 1/2
mechanical: 2
  M1 docs/design/specs/….md — Acceptance criteria section absent
  M2 docs/design/specs/….md — Open question O3 left unanswered
design: 0
```

Exit codes: `0` = auto-fix, `10` = decline (mirrors `escalate`'s `retry-implementation: 10` convention), `2` =
usage or infra error. **The gate treats `2` as a decline** — never block a gate on this checker's infra. On
exit `2` stdout may be empty and the only guaranteed output is a diagnostic on stderr; the `verdict:` /
`base-sha:` contract binds exits `0` and `10` only, since a malformed ledger makes the prior round's `headSha`
unreadable and no correct `base-sha:` can be printed.

**Residual rule: any non-zero exit other than `10` is treated as `2`.** `plan` cannot collapse to "any
non-zero" the way `record` does (U5) because `10` carries a distinct meaning, so the hole `record` closes by
inversion is closed here by a catch-all instead: an uncaught crash (Node exits `1`) reads as an error, which the
gate already treats as a decline. Both rules are stated over the **shell-observed exit status**, so a signal
kill arrives as `128+N` — non-zero, and not `10`. An implementer wiring these calls through `child_process`
directly must map a `null` exit code with a non-null signal to the same error branch.

### U5 — `cr autofix record`

Same entrypoint, verb `record`. Flags `--slug --kind --applied <n> --deferred <n> [--stopped <reason>]`. Reads
`sessionStartedAt` from `.noldor/session.json` and passes it to `appendRound`, which stamps it and replaces any
stale series (U3).

Appends one round: `round` = `rounds.length + 1` of the *current* session's series; `headSha` = current `HEAD`;
`fingerprint` recomputed from
the sinks (unchanged between `plan` and `record` — nothing re-runs orchestrate in between, so the value
matches what `plan` computed, and no state has to be threaded through the LLM edit); `diffStat` =
`git diff --shortstat <baseSha>..HEAD`.

Recording the fingerprint is what makes `no-progress` detectable on the next round.

Exit codes: `0` = round recorded, `2` = usage error (missing or non-numeric `--applied` / `--deferred`, unknown
`--kind`), a malformed existing ledger, **or any other read/write failure** (EACCES, EIO, a failed atomic
write). There is no `10` — `record` makes no decision.

**The gate stops on any non-zero exit from `record`, not on `2` specifically.** The exhaustive mapping to `2`
above is best-effort diagnostics, not a load-bearing guarantee: a contract that keyed the stop rule on `2`
alone would leave the one path the CLI cannot map — an uncaught crash (Node exits `1`), a signal kill — exactly
as undefined as the mapping exists to prevent. Since `record` has no other non-zero semantics, "any non-zero"
is both simpler and hole-free.

### U6 — Gate seams (prose)

[`.claude/skills/noldor-gate/SKILL.md`](../../../.claude/skills/noldor-gate/SKILL.md) and its twin
`templates/.claude/skills/noldor-gate/SKILL.md` (kept byte-identical per the shared-file check):

- **Step 2.5, `address-blockers`** — before asking the operator to edit, run `cr autofix plan`. On exit 0
  (`next: reround`, all-mechanical): apply the listed mechanical blockers, commit, `cr autofix record`, then
  re-run orchestrate with the printed `base-sha`; loop. On **exit 11** (`next: apply-then-stop`, a design
  blocker rides along): apply + record the mechanical subset, then stop and surface the applied diff plus the
  design blockers verbatim at the dialog. On exit 10, or on any other non-zero (`2` and, per U4's residual
  rule, everything else): today's behaviour.
  *(Amended at code-stage CR: the MIXED round originally shared exit 0 with the all-mechanical round, which
  left the "stop, don't re-round" rule resting on the controller reading the `design:` count out of stdout.
  `decide` now returns a `next` action and the CLI maps it to its own exit code.)*
  **Any non-zero exit from `record` stops the loop** and falls to the existing seam — same posture as `plan`.
  An unrecorded round is invisible to the cap *and* leaves the next fingerprint without a predecessor, so
  continuing would rest the entire loop bound on `record` having silently succeeded.
- **Step 2.5, `--base-sha`** — replace "read from prior `LaneFindings.artifactSha`" (`SKILL.md:142`) with "as
  printed by `cr autofix plan` (`base-sha:` line)". D7.
- **Step 2.5, "Commit the artifact first"** — `SKILL.md:118` asserts the same drift in different words
  ("codex+orchestrator need a stable `artifactSha` to record in `LaneFindings`"), which is equally false
  against the schema. Drop the `LaneFindings` clause: what those lanes actually need is a committed artifact at
  a stable `HEAD`, which the rest of the sentence already says. Both occurrences are rewritten — the fix is
  "every claim that a sink carries `artifactSha`", not one string.
- **Step 4, cr-red** — run `cr autofix plan` before `cr escalate`. Exit 0 → apply, record, re-run the
  code-stage orchestrate (which re-earns the `Noldor-Reviewed-Subagent` receipt —
  [`orchestrate.ts:382`](../../../src/cr/orchestrate.ts#L382) only amends on a green reviewer run). Any
  non-zero exit → `cr escalate` exactly as today.
- **Step 4, "Context cleanup on clean exit"** — the existing `rm -f .noldor/cr/<slug>-escalation-context.md`
  gains the ledgers and their quarantine remnants, **with every kind spelled out**:

  ```
  rm -f .noldor/cr/autofix/<slug>-spec.json  .noldor/cr/autofix/<slug>-spec.json.bad \
        .noldor/cr/autofix/<slug>-plan.json  .noldor/cr/autofix/<slug>-plan.json.bad \
        .noldor/cr/autofix/<slug>-code.json  .noldor/cr/autofix/<slug>-code.json.bad
  ```

  One `<kind>` would be wrong: a `full-*` session runs Step 2.5 at both `spec` and `plan` and Step 4 at `code`,
  so up to three ledgers exist and a `plan`-kind `.bad` would outlive a clean session. All three kinds are
  listed unconditionally rather than derived from the session path — `rm -f` on an absent path is a no-op, so
  enumeration is cheaper than path-dependent logic and cannot get the derivation wrong. **Do not collapse this
  to `.noldor/cr/autofix/<slug>-*`:** the directory is shared in the main workspace, and a slug that is a prefix of
  another (`foo` vs `foo-bar`) would cross-match and delete a sibling feature's ledger.

  `rm -f .noldor/cr/autofix/<slug>-{spec,plan,code}.json{,.bad}` is an acceptable shorthand **in bash/zsh
  only** — brace expansion is deterministic expansion, not pattern matching, so it carries the same
  no-cross-match safety. Under POSIX `sh`/dash the braces stay literal and `rm -f` silently removes nothing,
  so **the enumerated long form above is the portable one** and is what ships. The shorthand is named only so
  an implementer shortening the block reaches for it rather than the forbidden glob.

  U3 claims nothing else ever removes a `.bad` file, so this leg is load-bearing for that claim, not optional
  polish — it is listed here because U6 plus the acceptance list is the implementer's contract.
- [`docs/noldor/drain-mode.md`](../../../docs/noldor/drain-mode.md#L74) — record that autofix runs ahead of
  `cr escalate` in drain, and that with `onBlockers: 'auto-fix'` a mechanical-only red self-heals instead of
  failing the iteration.

### U7 — Registration

- [`src/cli/manifest.ts`](../../../src/cli/manifest.ts#L117-L120) — `cr.subs.autofix` → `cr/autofix-cli.ts`.
- `docs/noldor/script-catalog.md` — cite `src/cr/autofix-cli.ts`, or
  [`validate script-catalog`](../../../src/cli/validate-script-catalog.ts) blocks the commit.

### Data flow

```
orchestrate (exit 1)
  -> aggregate
  -> cr autofix plan ──exit 10/2──> existing seam (Step 2.5 dialog | cr escalate → onFailure)
        │                            (10 also covers `lanes-in-flight`: a lane has no finishedAt yet)
        │ exit 0 or 11
        ├─ controller applies mechanical blockers, commits
        ├─ cr autofix record --applied N --deferred M
        ├─ exit 11 (next: apply-then-stop) ─> surface diff + design blockers, prompt (no re-round)
        └─ exit 0  (next: reround) ─> orchestrate --base-sha <printed> ─> loop (cap 2 / no-progress)
```

### Error handling

| failure | behaviour |
| --- | --- |
| malformed ledger (`LedgerParseError` only) | `plan` **quarantines** the file — `rename` to `autofix/<slug>-<kind>.json.bad`, overwriting any prior quarantine of the same pair — then exits 2, so the gate declines. The current red is still fail-closed (an unknown round count never licenses another round), but the next session reads an absent ledger and starts a fresh series instead of hitting the same wall. Session scoping alone cannot do this: the parse throws *before* `sessionStartedAt` can be compared, and Step 4's clean-exit cleanup never ran precisely because the session that corrupted the file did not exit clean. A failed rename is logged and exit 2 still stands, in which case `rm -f .noldor/cr/autofix/<slug>-<kind>.json` is the fallback the stderr names |
| ledger unreadable for any non-parse reason (EACCES, EIO, transient lock) | exit 2, gate declines, **no rename**. Quarantine is scoped to parse failures precisely so transient infra cannot rename a valid ledger away and restart the round series |
| `record` against a malformed ledger | `appendRound` throws → exit 2, **no quarantine** — `record` never renames, since a writer that discards state it could not read is exactly what the fail-closed posture forbids. In gate flow this is unreachable (`plan` runs first and has already quarantined), so the wall is cleared by the *next `plan`*, not by `record`; a hand-run `record` (see Usage) hits it until then |
| absent ledger, or one whose `sessionStartedAt` differs from the current session | round 1 (fresh series) |
| absent `.noldor/session.json` | `sessionStartedAt: ''`; the series is keyed to "no session" and **rounds accumulate across unrelated no-session runs** until a real session starts and resets it. That direction is fail-closed (over-counting caps early, never late), so it is accepted rather than special-cased. `plan` proceeds |
| prior round's `headSha` empty | fall back to current `HEAD`; if that too is unresolvable → `decline` / `no-base-sha` |
| `aggregate` finds no sinks | `blockers: []` → `decline` / `no-mechanical` |
| `loadConfig` throws | treated as knob unset → `decline` / `knob-off` |
| reviewer emitted no tags | every blocker reads as `design` → `decline` / `no-mechanical` |
| `git rev-parse` / `diff` fails in `record` | `headSha: ''`, `diffStat: '(unavailable)'`; the round is still recorded, so the cap still holds |

### Testing

Unit: `splitClassTag` (tagged both ways, untagged, unknown bracket prefix, case); `fingerprintBlockers`
(order-independence, sensitivity to `severity`/`file`/`message`, insensitivity to `line`); `decide`
(table-driven over all six rules, plus mixed-round `design` non-empty, the absent-tag→design read, and each
`baseSha` fallback rung); `isSameSeries`; `readLedger` (absent → null, session mismatch → null, malformed →
throws `LedgerParseError`, EACCES propagates as itself); `appendRound` (round numbering, series *replacement*
on a session mismatch — the read-write round-trip within one session is the regression test for the bound going
dead — and throw on malformed). CLI: exit-code map for `plan` and for `record`, flag validation for `record`,
the quarantine rename on a parse failure (plus the rename-fails path), **no** rename on a non-parse read error,
and the `rm -f` fallback hint on its stderr.
Integration: a tmp-repo loop that goes red → auto-fix → green; one that trips `no-progress`; one that records
two rounds, starts a new session, and confirms the cap reset.

## Acceptance criteria

1. `findingSchema` accepts `class: 'mechanical' | 'design'` and still parses every sink written before this
   change (no `class` key).
2. `splitClassTag` strips a leading `[mechanical]` / `[design]` tag, case-insensitively, and leaves an
   unrecognized bracket prefix in the message.
3. `buildPrompt` output contains the tagging instruction and both tag definitions.
4. A reviewer bullet tagged `[mechanical]` produces a sink `Finding` with `class: 'mechanical'`; an untagged
   bullet produces a `Finding` with no `class` key.
5. `.noldor/config.json` accepts `autonomous.onBlockers: 'auto-fix' | 'prompt'`; an absent key resolves to
   `prompt`; any other value fails `validate noldor-config`.
6. `assertConfig` accepts both `onBlockers` values and still rejects each of the three existing violations.
7. `decide` returns `decline` with reason `knob-off` / `round-cap` / `no-progress` / `no-mechanical` /
   `no-base-sha` under exactly those conditions, in that precedence order.
8. `decide` on a mixed round returns `auto-fix` with a non-empty `design` list.
9. `decide` classifies a blocker with no `class` key as `design`.
10. `cr autofix plan` exits 0 on `auto-fix`, 10 on `decline`, 2 on usage or infra error. On exits 0 and 10 it
    prints a `verdict:` line and a non-empty `base-sha:` line; exit 2 is exempt from both.
11. Every non-zero `plan` exit other than 10 — including an uncaught crash that exits 1 — is treated as an error
    by the gate, so no exit code at either seam has undefined loop behaviour.
12. `base-sha:` equals current `HEAD` on round 1 and the prior round's `headSha` afterwards; when that stored
    `headSha` is empty it falls back to current `HEAD`, and when neither resolves `plan` declines with
    `no-base-sha` instead of printing an empty value.
13. `cr autofix record` appends a round with an incremented `round` and exits 0; it exits 2 on a missing or
    non-numeric `--applied` / `--deferred`. A second `plan` against unchanged blockers returns `decline` /
    `no-progress`.
14. A third `plan` after two recorded rounds in the SAME session returns `decline` / `round-cap`.
15. `readLedger` returns `null` for a ledger whose `sessionStartedAt` differs from the current session's, so a
    prior session's two rounds do not cap a fresh session.
16. `appendRound` against a ledger from a different session REPLACES the series — the resulting file has the
    current `sessionStartedAt` and exactly one round — so the round the writer just recorded is visible to the
    next `readLedger` in the same session.
17. A malformed ledger makes `plan` exit 2 rather than throwing an unhandled error, renames the file to
    `<file>.bad`, and leaves a subsequent `plan` in a new session reading a fresh series. When the rename
    itself fails, exit 2 still stands and the stderr names the ledger path and the `rm -f` fallback.
18. A ledger that fails to read for a NON-parse reason (EACCES) makes `plan` exit 2 and leaves the file in
    place — no `.bad` rename, so the round series survives transient infra.
19. `appendRound` throws on a malformed existing file rather than replacing it, and never renames.
20. `readLedger` and `appendRound` both reach their session verdict through `isSameSeries` — there is no
    second comparison to drift.
21. `fingerprintBlockers` returns the same value for two blocker sets differing only in `line`.
22. The gate loop stops on ANY non-zero exit from `record` — including a crash that exits 1 — and falls to the
    existing seam rather than re-running orchestrate.
23. `record` maps a usage error, a malformed ledger, and any read/write failure to exit 2 (diagnostics; the stop
    rule in 22 does not depend on it).
24. Step 4's clean-exit cleanup removes the `spec`, `plan`, and `code` ledgers for the slug and each one's
    `.bad` remnant, so no `.bad` file outlives a clean session — and it does so by enumerating kinds, never via
    a `<slug>-*` glob that could cross-match a prefix-sharing sibling slug.
25. The ledger lives under `.noldor/cr/autofix/`, and writing one adds NO blocker to
    `aggregate(slug, kind)` for the same pair.
26. `noldor cr autofix` is routable via the manifest and `validate script-catalog` passes.
27. Gate `SKILL.md` and its `templates/` twin are byte-identical, and neither asserts anywhere — in any wording
    — that a `LaneFindings` sink carries `artifactSha`. Both the `LaneFindings.artifactSha` reference and the
    "stable `artifactSha` to record in `LaneFindings`" clause are gone.

## Risks / trade-offs

- **Reviewer tag compliance.** Agents deviate from prose contracts — the existing parser already tolerates
  markdown decorations for that reason. An untagged round degrades to today's behaviour, so non-compliance
  costs the feature, never correctness. Accepted over a structured-output contract, which would break every
  runner that only emits prose.
- **The controller can "fix" a blocker by deleting the requirement.** Real hazard, only partly mitigated: the
  re-round re-reviews the result, and `record`'s `diffStat` plus the surfaced diff make the edit visible. A
  reviewer that accepts a gutted section is a reviewer-quality problem this spec does not solve.
- **Cap of 2 may be too low.** Q-0073 needed 14 CR rounds to converge. The cap bounds only the *unattended*
  rounds; the operator can still iterate freely after a decline. Raising it is a one-constant change, and
  no-progress detection will usually stop the loop before the cap does.
- **`mechanical` is the reviewer's judgment, and it can be wrong.** A design disagreement mislabelled
  `[mechanical]` gets auto-applied. This is the residual risk the knob's `prompt` default exists to let an
  operator refuse wholesale.
- **Two seams, one mechanism, different fidelity.** Artifact-stage blockers are markdown edits; code-stage
  blockers can span many files. The same `decide` governs both, so a code-stage "mechanical" blocker may be
  materially larger work than an artifact-stage one. Accepted: the alternative is two classifiers.
- **The cap resets per gate session, so it is not a global budget.** A drain that retries an entry, or an
  operator who re-enters the gate, gets two fresh auto-fix rounds. Accepted deliberately: the alternative — a
  permanent per-`slug`+`kind` cap — silently disables auto-fix forever on any pair that once used its two
  rounds, which is worse than a bound an explicit new session can reset. The drain supervisor's own
  `--max-retries` bounds the outer loop.

## User Story

As an operator running the gate, I want mechanical CR blockers — a missing section, an unanswered open
question, a stated contract not met — applied and re-reviewed without stopping to ask me, so that my
attention is spent only on the design disagreements that actually need arbitration, and a drain iteration is
not lost to a defect the framework could have fixed itself.

## Usage

Opt in per repo (default is `prompt` — unchanged behaviour):

```
# .noldor/config.json
"autonomous": { "skipLanePicker": true, "onFailure": "abort",
                "requireHumanPrApproval": false, "onBlockers": "auto-fix" }
```

The gate drives the loop; the two calls are also usable by hand:

```
noldor cr autofix plan --slug <slug> --kind <spec|plan|code>
#   exit 0  -> apply the listed M<n> blockers, then:
noldor cr autofix record --slug <slug> --kind <spec|plan|code> --applied 2 --deferred 0
noldor cr orchestrate --slug <slug> --artifact <path> --kind <kind> --base-sha <printed base-sha>
#   exit 11 -> apply + record the M<n> subset, then STOP (a D<n> design blocker rides along)
#   exit 10 -> decline; run the existing seam (Step 2.5 dialog, or `noldor cr escalate`)
```

Inspect what happened: `.noldor/cr/autofix/<slug>-<kind>.json` holds every round with its fingerprint,
`applied` / `deferred` counts, and `diffStat`.

## Open questions (resolved)

1. *Does this cover one blocker seam or both?* -> **Both, with one shared mechanism.** (D1) The entry names
   both, and they share every primitive — read blockers, classify, apply, re-round with `--base-sha`. Only the
   branch point differs; splitting would duplicate the classifier.
2. *How does the controller classify a blocker as mechanical vs design-disagreement without asking?* -> **It
   does not — the reviewer classifies, via `[mechanical]` / `[design]` bullet tags lifted into an optional
   `Finding.class`; an absent tag reads as `design`.** (D2) Separation of duties: the agent that applies the
   fix must not be the one deciding it may skip asking, or it is grading its own permission slip.
3. *What happens on a mixed round?* -> **Apply the mechanical subset, then prompt on the design remainder
   without re-rounding.** (D3) An immediate re-round buys a review pass guaranteed to re-report the known
   design blocker, and under `onFailure: 'abort'` it aborts anyway.
4. *What bounds the loop?* -> **A constant cap of 2 rounds plus a no-progress fingerprint stop; on either,
   fall through to the existing `onFailure` policy.** (D4) The failure mode that matters is a blocker that
   keeps coming back because the fix did not take — a round counter alone bounds cost, not futility.
5. *Where do the round state and the fix diff live?* -> **`.noldor/cr/autofix/<slug>-<kind>.json`.** (D5;
   moved into the `autofix/` subdirectory during implementation — a sibling name matched `aggregate()`'s sink
   glob and injected a bogus high blocker into every aggregate for the pair)
   Rejected deriving rounds from `.noldor/cr/archive/`: that archiving is best-effort and swallows failures,
   so the bound would rest on state the framework admits it may lose.
6. *Which CLI surface backs this — extend `cr escalate`, or a new command before it?* -> **New
   `cr autofix plan|record`; `escalate` untouched.** (D6) `escalate` means "a red already happened, how do we
   escalate", always writes `escalation-context.md`, and the artifact-stage seam does not call it at all
   today.
7. *The `LaneFindings.artifactSha` drift — fix it here or scope it out?* -> **Fix the instruction, not the
   schema: `autofix plan` prints an authoritative `base-sha:` line and the Step 2.5 prose is rewritten to use
   it.** (D7) Adding the field would make a wrong instruction true and create a second sha source that can
   disagree with the ledger.
8. *Should `onBlockers` join the drain's headless-safe precondition set?* -> **No.** Both values are safe
   unattended: `prompt` simply makes `autofix` decline, after which `onFailure: 'abort'` behaves exactly as
   today. Adding it would break every existing drain config for no safety gain.
9. *What resets the ledger, so the round cap is not permanent?* -> **The gate session: `readLedger` treats a
   ledger whose `sessionStartedAt` differs from the current session's as absent.** (round-1 CR) An
   append-only ledger keyed on `<slug>`+`<kind>` alone would decline every future red on that pair once two
   rounds had ever been recorded — `<slug>`+`<kind>` repeats across attach sessions and manual re-runs in the
   main workspace. Step 4's clean-exit `rm -f` is hygiene on top, not the mechanism.
10. *Does `fingerprintBlockers` include `line`?* -> **No.** (round-1 CR) Code-stage blockers carry a line
    number that an unrelated edit shifts, so including it would make an unfixed blocker look like progress and
    `no-progress` — the stop this spec sells as primary — would never fire.
