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
lane defaults and autonomous-mode toggles:

```json
{
  "crLanes": {
    "spec": ["manual", "subagent"],
    "plan": ["manual", "subagent"],
    "code": ["subagent"]
  },
  "autonomous": {
    "skipLanePicker": false,
    "onFailure": "prompt",
    "requireHumanPrApproval": true
  }
}
```

Precedence at orchestrate time: CLI `--lanes <list>` wins, otherwise
config defaults apply when `autonomous.skipLanePicker: true`,
otherwise the interactive picker prompts the operator. The schema is
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
`pnpm noldor validate features`. The gate classifies each commit:

- `Noldor-Path: release-automation` → skip.
- All paths within the micro-chore allowlist → skip.
- Otherwise → require both `Noldor-Reviewed: <tree>` (or
  `Noldor-Path-Override`) and `Noldor-Reviewed-Codex: <tree>`
  (or `Noldor-CR-Override-Codex`). Trailer values must equal
  `git rev-parse <sha>^{tree}`.

Failures abort the release with a per-commit diagnostic naming the
missing side(s).

## Deferred (post-MVP)

- Brainstorm-loop per finding.
- PR-based granularity (waiting on Noldor PR adoption).
- Auto-pruning old sidecars.
- Codex CR running inside CI.
