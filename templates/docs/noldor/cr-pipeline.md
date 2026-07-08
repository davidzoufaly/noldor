---
noldor-page: cr-pipeline
introduced: 0.4.0
---

# CR Pipeline

Code review runs in two contexts: per-stage during `/gate` (Step 2.5
across spec/plan/code) and as a release-gate audit at `pnpm release`.
The per-stage flow is multi-reviewer (four lanes, parallel writes,
schema-validated sinks); the release gate still demands a tree-matched
trailer for each commit. `pnpm release` blocks the cut unless every
code-touching commit in the release range has a Claude review trailer
and the configured codex/standalone trailers (or an explicit override).

## When to run

| Situation                                | Command                                  |
| ---------------------------------------- | ---------------------------------------- |
| Finished a feature, before push          | `pnpm noldor cr codex` (gate lane)       |
| Want a sanity check on uncommitted work  | `pnpm noldor cr codex --working`         |
| Want a sanity check on a specific commit | `pnpm noldor cr codex <sha>`             |
| Want a sanity check on a range           | `pnpm noldor cr codex <from>..<to>`      |
| Re-running after fixing a blocker        | `pnpm noldor cr codex --rerun`           |
| Previewing CR without amending           | `pnpm noldor cr codex --dry-run`         |
| Scoping CR to a few files                | `pnpm noldor cr codex --paths a.ts,b.ts` |

Only the gate lane (`pnpm noldor cr codex` and `pnpm noldor cr codex --rerun`) writes
the `Noldor-Reviewed-Codex` trailer. All other invocations are
feedback-only.

## Multi-reviewer Step 2.5

Step 2.5 of `/gate` runs four lanes in parallel: `manual` (operator
verdict + finding loop), `codex` (`pnpm noldor cr codex` wrapper), `subagent`
(Task-tool dispatch with markdown→JSON parser), and `standalone`
(iTerm2-spawned headless Claude). Each lane writes its findings to
`.noldor/cr/<slug>-<kind>-<lane>.json` where `kind` is `spec | plan |
code` and `lane` is the lane name. Sinks are atomic — every writer
calls `writeJsonAtomic` from `src/cr/atomic-write.ts` (temp file +
`fs.rename`) so concurrent lanes never tear a partial JSON. Schemas
live in `src/cr/findings-schema.ts`; `laneFindingsSchema` validates
every sink on aggregate, and corrupt or mismatched files are surfaced
as synthetic blockers via `src/cr/aggregate.ts`. The aggregate step
collects all four sinks for the active kind and gates progress on a
clean union of blockers.

### Artifact kind semantics

The orchestrator's `--kind` flag accepts `spec`, `plan`, or `code` (see `src/cr/findings-schema.ts:artifactKindSchema`). Path-to-kind mapping at `/gate` Step 2.5:

| Path                | Step 2.5 invocations                    |
| ------------------- | --------------------------------------- |
| `specs-only-new`    | 1× `--kind spec`                        |
| `specs-only-attach` | 1× `--kind spec`                        |
| `full-new`          | 1× `--kind spec`, then 1× `--kind plan` |
| `full-attach`       | 1× `--kind spec`, then 1× `--kind plan` |

`kind=spec` and `kind=plan` route to the same lane implementations today; the kind value lands in the `LaneFindings.kind` field for audit trail only. Lane prompts may diverge in the future (e.g. `--kind spec` could pull in different review heuristics).

## Step 4 collapse

Step 4 (code review) used to be a subagent + codex retry loop driven
by `/gate`. It is now a single subagent lane by default — the code
stage runs the same multi-reviewer machinery as spec/plan, just with
`crLanes.code: ['subagent']` baked in. Codex remains opt-in: set
`crLanes.code: ['subagent', 'codex']` in `.noldor/config.json` to add
the codex lane back. Manual and standalone are also opt-in via the
same array. The collapse removed the per-stage retry-loop logic from
the gate skill — retry is now uniform across stages via the escalation
dispatcher (see below).

## Config-driven defaults

`.noldor/config.json` (loaded by `src/cr/config.ts`) holds the
lane overrides and autonomous-mode toggles. **Both blocks are optional**
— omit them entirely and sane built-in defaults apply:

```jsonc
{
  "consumer": { /* required — see adoption-guide.md */ },

  // OPTIONAL. Absent → built-in DEFAULT_CR_LANES: every kind reviews with ["subagent"].
  "crLanes": {
    "spec": ["manual", "subagent"],
    "plan": ["manual", "subagent"],
    "code": ["subagent"]              // add "codex" for a second opinion: ["subagent", "codex"]
                                      // (codex needs the codex CLI authenticated — it is NOT
                                      //  part of the autonomous-safe built-in default)
  },

  // OPTIONAL. Every field defaults (the whole block may be omitted).
  "autonomous": {
    "skipLanePicker": false,          // default false — true skips the lane multi-select
    "onFailure": "prompt",            // default "prompt" | "spawn-deep-review" | "abort"
    "requireHumanPrApproval": false,  // default false — true keeps the PR-approval prompt
    "watch": {}                       // optional watch-daemon rails — see docs/noldor/autonomy.md
  }
}
```

Continuous mode (watch daemon, salvage, escalation inbox, rails): see [`autonomy.md`](autonomy.md).

Built-in defaults live in `DEFAULT_CR_LANES` (`src/cr/config.ts`):
`{ spec: ['subagent'], plan: ['subagent'], code: ['subagent'] }`. `subagent`
is the only lane that runs fully unattended (in-process; no external CLI auth
like codex, no human stdin like manual, no GUI terminal like standalone), so it
is the autonomous-safe default.

Precedence at orchestrate time (`resolveLanes` in `src/cr/orchestrate.ts`):

1. CLI `--lanes <list>` wins.
2. Otherwise, when `--autonomous` is passed **or** `autonomous.skipLanePicker: true`:
   the configured `crLanes.<kind>` if present, else `DEFAULT_CR_LANES[kind]`.
   A missing `crLanes` block is no longer a hard error — it falls back to the default.
3. Otherwise (interactive, no flag): the gate skill prompts via the lane multi-select.

The schema is
validated by `pnpm noldor validate noldor-config` (Zod loader in
`src/cr/config.ts`); validation also runs at the top of
`src/cr/orchestrate.ts` so a malformed config fails fast.

## Delta re-review

The orchestrator records the commit SHA at which findings were last
aggregated (`baseSha`) in the sink. On re-run, `src/cr/
orchestrate.ts` diffs `baseSha..headSha`; an empty diff means no code
moved, so all configured lanes get a synthetic OK record (lane =
`delta-short-circuit`) without spawning reviewers. This is the
fast-path for "review still green after a no-op rebase" cases. The
`--full-review` flag bypasses the short-circuit unconditionally and
forces every lane to re-run from scratch. The delta logic only fires
when every previous lane was green; any prior blocker forces a fresh
run.

## Escalation

When aggregate surfaces a blocker, control passes to
`src/cr/escalate.ts` (CLI: `pnpm noldor cr escalate`). In autonomous
mode the dispatcher honors `autonomous.onFailure`: `prompt` (fall
through to interactive), `spawn-deep-review` (auto-dispatch the
standalone deep-review lane), or `abort` (exit non-zero, leave plan
MD untouched). Interactive mode prompts the operator with four
choices: `retry-implementation`, `spawn-deep-review`,
`override-with-trailer`, `abort`. Findings to feed back into the next
implementation pass are written to
`.noldor/cr/<slug>-escalation-context.md` — on retry the gate skill
appends that file's contents under the `## Findings to address`
heading in the plan MD, then deletes the side-channel file on a
clean exit so stale context never leaks into a future loop. Exit
codes from `pnpm noldor cr escalate` encode the chosen outcome (see
`src/cr/escalate-cli.ts`).

## JSON contract

Codex must return:

```json
{
  "blockers": [
    { "file": "src/x.ts", "line": 42, "severity": "high", "message": "...", "suggestion": "..." }
  ],
  "suggestions": [{ "file": "src/x.ts", "line": 42, "message": "...", "suggestion": "..." }],
  "summary": "one-line verdict"
}
```

Anything else (non-JSON, schema mismatch, non-zero exit) becomes a
synthetic blocker and the script exits 1.

## Override

When codex genuinely cannot run (binary unavailable, transient outage),
add a trailer to the commit message:

```
Noldor-CR-Override-Codex: <human-readable reason>
```

Empty reasons are rejected by `noldor-validate-trailer.ts`. Each
override is appended to `.noldor/cr-overrides.log` (separate from
the path-override log). `/garden` audits frequency, short reasons, and
copy-paste repeats.

## Release gate

`pnpm release` runs `checkCrGate({ from: <prev-tag>, to: HEAD })` after
`pnpm noldor validate features`. Main is squash-merge only, so PR-branch
trailers land embedded in the squash commit body — the gate scans the
whole message for `Noldor-*` lines, not just the final trailer block.
It classifies each commit:

- `Noldor-Path: release-automation` or `release-sweep` → skip.
- All paths within the micro-chore allowlist → skip.
- Otherwise → require review evidence: any of `Noldor-Reviewed`,
  `Noldor-Reviewed-Subagent`, `Noldor-Reviewed-Codex` (receipt), or a
  non-empty `Noldor-Path-Override` / `Noldor-CR-Override-Codex`. Tree
  freshness is NOT re-checked here — the pre-push hook enforces it on
  the branch tip, and a squash commit's tree legitimately differs.

Failures abort the release with a per-commit diagnostic. Skipping via
`RELEASE_SKIP_CR_GATE=1` appends a `(release)`-tagged line to
`.noldor/overrides.log`.

A known-bad historical commit is acknowledged per-SHA instead of
skipping the whole gate: add a `release.crGateExemptCommits` entry
(`sha` prefix, min 7 hex chars, plus a required `reason`) to
`.noldor/config.json`. `checkCrGate` skips matching commits, reports
them under `exempted`, and the release log echoes each one
(`→ CR gate: exempted <sha> — <reason>`); the committed config diff is
the audit trail. Expected self-host override noise is declared the same
way under `garden.overrideAudit.expected` (matched by `shaPrefix`
and/or `reasonIncludes`, with a required `note`); matched overrides
stop counting toward the override-audit WARN threshold but stay listed
in `/garden` output and the SDD report with an `(expected)` marker.

## Verify lane

The `verify` lane (code artifacts only) is the behavioral third signal beside
tests and CR: it boots the real artifact and judges observed behavior against
the FD's acceptance text (`## Summary` + `## Usage`; commit prose for FD-less
fast-tracks).

Two layers:

- **Smoke floor** (deterministic): `noldor doctor` + boot every
  `consumer.verifyCommands` surface + HTTP-200/exit-0 probe. Runs first, also
  standalone via `pnpm noldor verify smoke [--json]`. A smoke failure blocks
  in **both** verify modes — stop-the-line semantics: a broken surface halts
  autonomous merging whether or not this FD broke it.
- **Verifier agent** (judgment): spawned via the agent-runner registry
  (`role: verifier`), exercises the specific new behavior through the real
  interface (never by reading source), and emits
  `{ verdict: pass | fail | cannot-verify, evidence: [{command, observed}], mismatches: [] }`
  as the sink's verdict payload (`.noldor/cr/<slug>-code-verify.json`).

Policy: `autonomous.verifyMode: "blocking" | "advisory"` (default `advisory`)
governs only the agent verdict — `fail` maps mismatches to blockers (blocking)
or suggestions with an `ADVISORY FAIL:` summary (advisory). `cannot-verify`
never blocks. Spawn failure, timeout, or malformed verifier output is one
"no trustworthy verdict" class: fail-closed blocker in blocking mode,
`cannot-verify` note in advisory.

Opt in via `crLanes.code: ["subagent", "verify"]`; drain and watch inherit it
from config.

## Deferred (post-MVP)

- Brainstorm-loop per finding.
- PR-based granularity (waiting on Noldor PR adoption).
- Auto-pruning old sidecars.
- Codex CR running inside CI.

## Review gotchas

- **Never comma-join `--artifact` for `--kind code`.** `cr orchestrate --kind code
  --artifact <x>` runs the empty-delta short-circuit (`isEmptyDiffDefault`,
  `src/cr/orchestrate.ts`) with the artifact string as a **single git pathspec**.
  A comma-joined file list matches nothing → `git diff --quiet` exit 0 →
  "synthetic OK (empty delta)" → every lane skipped with a fake approve →
  merging ships unreviewed code. Pass ONE pathspec (`.` for whole-diff review).
  Treat any "synthetic OK (empty delta)" on a branch you KNOW changed as a bug
  signal, not a pass.
- **`phase: done` does NOT mean code-stage CR ran.** An in-progress FD whose
  implementation is "done" and phase flipped can still have never run code-stage
  CR (empty `.noldor/cr/`, no `Noldor-Reviewed-Subagent` trailer) — seen on
  resume across several features. Verify CR actually ran before `pr-flow`; don't
  trust the phase.
- **Exclude the `verify` lane for features with no HTTP/runtime surface.** Use
  `cr orchestrate --lanes subagent`. `noldor doctor` exits 1 on a
  lefthook-not-on-PATH check (a false positive — lefthook works via
  `pnpm exec`), which reds the verify-lane smoke floor and, under
  `onFailure: abort`, halts the drain.
- **`cr orchestrate --autonomous` with a missing `crLanes.<kind>` does NOT
  hard-error.** Despite the gate skill's claim, it silently falls back to the
  subagent lane. Set `crLanes.<kind>` explicitly if you want a specific lane set.

Sink-file mechanics (stale sink after amend, archive-to-subdir, headless
overwrite crash) live in [`gotchas.md`](gotchas.md#cr-sinks).
