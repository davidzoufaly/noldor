---
noldor-page: cr-pipeline
introduced: 0.4.0
---

# CR Pipeline

Code review runs in two contexts: per-stage during `/noldor-gate` (Step 2.5
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

Step 2.5 of `/noldor-gate` runs four lanes in parallel: `manual` (operator
verdict + finding loop), `codex` (`pnpm noldor cr codex` wrapper), `reviewer`
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

The orchestrator's `--kind` flag accepts `spec`, `plan`, or `code` (see `src/cr/findings-schema.ts:artifactKindSchema`). Path-to-kind mapping at `/noldor-gate` Step 2.5:

| Path                | Step 2.5 invocations                    |
| ------------------- | --------------------------------------- |
| `specs-only-new`    | 1× `--kind spec`                        |
| `specs-only-attach` | 1× `--kind spec`                        |
| `full-new`          | 1× `--kind spec`, then 1× `--kind plan` |
| `full-attach`       | 1× `--kind spec`, then 1× `--kind plan` |

`kind=spec` and `kind=plan` route to the same lane implementations today; the kind value lands in the `LaneFindings.kind` field for audit trail only. Lane prompts may diverge in the future (e.g. `--kind spec` could pull in different review heuristics).

## Step 4 collapse

Step 4 (code review) used to be a reviewer + codex retry loop driven
by `/noldor-gate`. It is now a single reviewer lane by default — the code
stage runs the same multi-reviewer machinery as spec/plan, just with
`crLanes.code: ['reviewer']` baked in. Codex remains opt-in: set
`crLanes.code: ['reviewer', 'codex']` in `.noldor/config.json` to add
the codex lane back. Manual and standalone are also opt-in via the
same array. The collapse removed the per-stage retry-loop logic from
the gate skill — retry is now uniform across stages via the escalation
dispatcher (see below).

**Codex mandate on bigger entries (M/L/XL):** on sessions whose path is
spec-bearing (`specs-only-*`, `full-*` — the routing policy's projection of
entry size M/L/XL per `sizeToPath()`), orchestrate unions the `codex` lane
into every `--kind spec` and `--kind code` round (`withMandatoryCodex` in
`src/core/lanes.ts`), so a big change never ships reviewed by exactly one
model family. XS/S paths (`fast-track`, `micro-chore`) and sessionless runs
are exempt, so drains never block on a broken codex CLI; a
present-but-unreadable marker fails closed (mandate assumed on). The union is
idempotent — a configured `crLanes` block that already lists codex is
unchanged — and the overwrite guard withholds `keep-and-skip` for the
mandated lane, mirroring the reviewer mandate on spec/plan.

## Config-driven defaults

`.noldor/config.json` (loaded by `src/cr/config.ts`) holds the
lane overrides and autonomous-mode toggles. **Both blocks are optional**
— omit them entirely and sane built-in defaults apply:

```jsonc
{
  "consumer": { /* required — see adoption-guide.md */ },

  // OPTIONAL. Absent → built-in DEFAULT_CR_LANES: every kind reviews with ["reviewer"].
  "crLanes": {
    "spec": ["manual", "reviewer"],   // "reviewer" is MANDATORY on spec + plan —
    "plan": ["manual", "reviewer"],   // omitting it fails `validate noldor-config`
    "code": ["reviewer"]              // add "codex" for a second opinion: ["reviewer", "codex"]
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
`{ spec: ['reviewer'], plan: ['reviewer'], code: ['reviewer'] }`. `reviewer`
is the only lane that runs fully unattended (in-process; no external CLI auth
like codex, no human stdin like manual, no GUI terminal like standalone), so it
is the autonomous-safe default.

Precedence at orchestrate time (`resolveLanes` in `src/cr/orchestrate.ts`):

1. CLI `--lanes <list>` wins.
2. Otherwise, when `--autonomous` is passed **or** `autonomous.skipLanePicker: true`:
   the configured `crLanes.<kind>` if present, else `DEFAULT_CR_LANES[kind]`.
   A missing `crLanes` block is no longer a hard error — it falls back to the default.
3. Otherwise (interactive, no flag): the gate skill prompts via the lane multi-select.

Whichever branch wins, the resolved set for `spec` and `plan` passes through
`withMandatoryReviewer` (`src/core/lanes.ts`): **`reviewer` is always-on for
those two kinds**, so no spec or plan can reach implementation unreviewed. A
lane pick or a `crLanes.spec` / `crLanes.plan` block that omits `reviewer` gets
it appended (order otherwise preserved, no duplicate), and orchestrate prints
`lane 'reviewer' is mandatory for <kind> artifacts — added to the requested lanes`
when it had to add it. The gate skill's Step 2.5 lane multi-select correspondingly
offers **no `proceed-without-review`** option at these kinds. The overwrite guard
(below) withholds its `keep-and-skip` choice for that lane too — otherwise a stale
or red prior sink could stand in for the review, since the exit code only inspects
lanes that actually ran. `code` is exempt from the union — its reviewer pass is
enforced downstream by the `Noldor-Reviewed-Subagent` receipt the pre-push hook
validates.

`pnpm noldor validate noldor-config` refuses a `crLanes.spec` / `crLanes.plan`
set without `reviewer` rather than letting the config advertise a review posture
the runtime silently overrides. Omitting the key is always fine — absence
inherits the reviewer-only `DEFAULT_CR_LANES`.

The schema is
validated by `pnpm noldor validate noldor-config` (Zod loader in
`src/cr/config.ts`); validation also runs at the top of
`src/cr/orchestrate.ts` so a malformed config fails fast.

## Delta re-review

The orchestrator records the commit SHA at which findings were last
aggregated (`baseSha`) in the sink. On re-run, `src/cr/
orchestrate.ts` diffs `baseSha..headSha`; an empty diff means no code
moved, so a lane gets a synthetic OK record (lane =
`delta-short-circuit`) without spawning reviewers. This is the
fast-path for "review still green after a no-op rebase" cases. The
`--full-review` flag bypasses the short-circuit unconditionally and
forces every lane to re-run from scratch.

The short-circuit is per-lane, gated on that lane's own prior sink existing
**and recording no blockers** — for every lane and every artifact kind.
"No changes since prior run" presupposes a prior run that went green, so a
first pass, or a re-run over unaddressed blockers, still gets a real review
rather than a synthetic pass nobody earned. A lane that survives the gate is
dispatched with `fullReview` (no `baseSha`), because the artifact diff is
known-empty at that point and a delta prompt would put nothing in front of
the reviewer.

Lanes in one round can therefore split: a green `reviewer` short-circuits
while a red `manual` re-runs. That matters most on `code`, where a synthetic
OK also drives the `Noldor-Reviewed-Subagent` receipt amend — until this gate
covered every lane, a red round cleared itself on the next no-op re-run
(`blockers: []`, exit 0), which is the one failure mode a review gate must
not have.

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
the path-override log). `/noldor-garden` audits frequency, short reasons, and
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
in `/noldor-garden` output and the SDD report with an `(expected)` marker.

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

Opt in via `crLanes.code: ["reviewer", "verifier"]`; drain and watch inherit it
from config. The noldor repo itself runs `verifyMode: "blocking"` (flipped
after the advisory bake-in period); the schema default stays `advisory` so new
consumers adopt the lane observation-first.

`pnpm noldor pr-flow` lifts the sink's verdict + evidence array into a
`## Verify Evidence` PR-body section (command/observed pairs — spec item D3),
so reviewers see behavioral proof on the PR itself. Missing or off-shape sink
⇒ the section is omitted; the PR still opens.

## UI-design review lane

The `ui-reviewer` lane (code artifacts only) asks whether the implemented UI
matches the design the session approved — the gap the freshness check cannot
see, since that compares commit ancestry and never opens a `.pen`.

How it runs:

- **Firing** is recomputed in-lane from the real change: candidate paths are the
  diff from the remote default branch to the round's head, intersected with
  `consumer.uiPaths`/`uiSurfaces` (`sessionUiVerdict`). The round's `--base-sha`
  is deliberately ignored — every delta shape narrows it, and a fragment of the
  branch describes neither the as-built UI nor which commit added the design.
- **Design resolution** is a path, never content: the session's dialogue key
  selects a dated `.pen` under `docs/design/ui/` (archive first — gate Step 4
  archives it in the flip commit), gated on the branch-added set so a foreign
  feature's design can never be picked up. Two matches decline as
  `ambiguous-design` rather than guessing.
- **Dispatch** spawns `role: ui-reviewer` against a private scratch COPY of the
  design. The child reads it through pencil MCP — `.pen` is encrypted, so pencil
  is the only reader — and compares the `FINAL:<surface>` pages against the diff.
  The lane hashes the repo's `.pen` across the dispatch; a change under the
  reviewer is `pen-modified` and reds in **both** modes.
- **Verdicts** land in `.noldor/cr/<slug>-code-ui-reviewer.json` as
  `pass | fail | cannot-review | not-applicable` plus a machine-readable
  `reason`. `not-applicable` = nothing to review (no UI in range, `design: skip`,
  operator waiver, unadopted config). `cannot-review` = there was, and the
  comparison could not be performed (no design artifact, pencil unavailable,
  malformed output). A fast-track session that changed UI paths gets
  `cannot-review`, never `not-applicable` — that would be a bypass.

Policy: `autonomous.uiReviewMode: "blocking" | "advisory"` (default `advisory`)
governs review outcomes only. Advisory maps findings to `low` suggestions and
greens `cannot-review`; blocking maps findings to blockers and reds
`cannot-review` too, since an un-performed design review does not satisfy "a UI
ship must actually be design-reviewed". Artifact integrity (`pen-modified`) is
outside the knob.

What it does NOT judge: pixel geometry, spacing, color, type, motion and
interactivity are unpinned until the design stage defines a marking convention;
mechanical render-compare (screenshot diff against a booted app) is the sibling
`render-compare` lane below. Every finding must name both sides it compared —
the design page and element, and the code file.

Opt in via `crLanes.code: ["reviewer", "ui-reviewer"]`, and route the role to a
pencil-capable runner when `reviewer` is mapped elsewhere:
`agents.roles: { "ui-reviewer": { "runner": "claude" } }`. The lane is excluded
from the delta short-circuit, so it re-runs on every code round rather than
inheriting a synthetic OK from an unchanged `--artifact` path.

## Render-compare lane

The `render-compare` lane (code artifacts only) is the mechanical half the
structural lane deliberately leaves out: it boots the consumer's app from a
declared recipe, captures what each affected surface's real route renders, and
**pixel-diffs** it against a raster of the surface's selected `FINAL:` design
page. The verdict is computed by a diff algorithm — the one dispatched agent is
the design EXPORTER (`role: render-compare`), which opens a scratch copy of the
`.pen` through pencil MCP and exports pages to PNG; its words never decide a
verdict, its output files do (each expected PNG must exist and decode, or the
surface is `export-failed`).

How it runs:

- **Firing and design resolution** are identical to `ui-reviewer` (same
  `resolveUiReviewTarget` — same predicate, waiver, ownership gate, and terminal
  vocabulary), so both lanes agree about whether a round is UI-bearing.
- **Recipes** live in `consumer.uiBoot`, keyed by surface name:
  `verifyCommand` (references a `kind: "server"` entry in
  `consumer.verifyCommands` — boot/health are not respecified), `route` (leading
  `/`, narrow charset — shell metacharacters are unrepresentable), optional
  `page` (selects among several `FINAL:<surface>: <name>` pages), a
  `screenshotCommand` template carrying exactly the placeholders `{url}` `{out}`
  `{width}` `{height}` (every value substitutes as a single-quoted shell token),
  `maxDiffRatio` (default `0.25`, in `[0, 1]`), and `captureTimeoutMs` (default
  `60000`, integer in `[1, 120000]`). `validate noldor-config` rejects a recipe
  for an undeclared surface, a non-server `verifyCommand`, template placeholder
  drift, and any surface-name set whose artifact-name sanitization collides.
- **Boot** groups surfaces by `verifyCommand`; each group boots once on a fresh
  port (pre-boot occupancy check, own process group, SIGKILL on every exit
  path). When `verifier` shares the round, render-compare starts only after it
  resolves — the two lanes boot the same servers. A failed boot marks only its
  group's surfaces `boot-failed`; the round continues.
- **Per surface**: a route probe (final status must be 2xx — a 404/500 route is
  `route-unreachable`, never a confident pixel verdict against an error page),
  then the capture command under its timeout, then the diff: `pixelmatch` +
  `pngjs` with pinned constants (`threshold: 0.2`, `includeAA: false`),
  `diffRatio > maxDiffRatio` fails (ratios exactly at the threshold pass),
  severity `high` past `2×` the threshold, else `med`. A size-mismatched pair is
  `dimension-mismatch` naming both sizes (pin your screenshot tool's device
  scale factor to 1). Design raster, screenshot, and diff image persist under
  `.noldor/cr/render-compare/<slug>/` (inside the gitignored `.noldor/cr/`),
  rebuilt atomically per round.
- **Verdicts** land in `.noldor/cr/<slug>-code-render-compare.json`. Every
  affected surface gets its own outcome — a recipe-less affected surface is a
  full `no-boot-recipe` outcome, so such a round can never aggregate to `pass` —
  and the single verdict is the worst by `fail` > `cannot-review` > `pass`, the
  headline `reason` from the highest-precedence failure (ties by surface name).
  The repo `.pen`'s sha256 across the round is the sole `pen-modified` trigger,
  and it overrides everything: `verdict: fail`, one high blocker, `ok: false`
  in **both** modes.

Policy: `autonomous.renderCompareMode: "blocking" | "advisory"` (default
`advisory`) — deliberately separate from `uiReviewMode`, since confidence in
structural review and in a booted-app pixel pipeline diverge. Advisory maps
fail findings to `low` suggestions and greens `cannot-review`; blocking reds
both.

Known limits (accepted, not bugs): two rendering engines never match
pixel-perfectly, so the default threshold is a coarse drift detector — literal
copy and element inventory stay the structural lane's job; a blank render
diffed against a mostly-blank design page passes here (the structural lane's
inventory review is the guard); live data behind a route inflates ratios (the
per-surface `maxDiffRatio` override is the interim remedy). The export path
requires a running VS Code window with the Pencil extension and an open `.pen`
(the exporter child recovers a down bridge with `code <scratch>.pen`), so in
headless CI the lane degrades to `cannot-review` (`export-failed`) — honestly,
and advisory by default.

Opt in per consumer:

```json
{
  "consumer": {
    "uiSurfaces": { "dashboard": ["src/dashboard/**"] },
    "verifyCommands": {
      "dashboard": { "command": "pnpm dev --port {port}", "kind": "server", "healthPath": "/" }
    },
    "uiBoot": {
      "dashboard": {
        "verifyCommand": "dashboard",
        "route": "/",
        "page": "overview",
        "screenshotCommand": "pnpm exec playwright screenshot --viewport-size={width},{height} {url} {out}",
        "maxDiffRatio": 0.25
      }
    }
  },
  "crLanes": { "code": ["reviewer", "render-compare"] },
  "autonomous": { "renderCompareMode": "advisory" }
}
```

The lane is opt-in (never in the defaults), code-only, and excluded from the
delta short-circuit for the same reason `ui-reviewer` is. On a `fail`, open the
persisted diff image before arguing with the ratio.

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
  "synthetic OK (empty delta)" → the lane skipped with a fake approve →
  merging ships unreviewed code. Pass ONE pathspec (`.` for whole-diff review).
  Treat any "synthetic OK (empty delta)" on a branch you KNOW changed as a bug
  signal, not a pass. The prior-run gate above narrows the blast radius — a lane
  with no sink, or a red one, re-runs instead of synthesizing — but a lane whose
  earlier round went green still short-circuits on the bogus empty diff.
- **`phase: done` does NOT mean code-stage CR ran.** An in-progress FD whose
  implementation is "done" and phase flipped can still have never run code-stage
  CR (empty `.noldor/cr/`, no `Noldor-Reviewed-Subagent` trailer) — seen on
  resume across several features. Verify CR actually ran before `pr-flow`; don't
  trust the phase.
- **Exclude the `verify` lane for features with no HTTP/runtime surface.** Use
  `cr orchestrate --lanes reviewer`. `noldor doctor` exits 1 on a
  lefthook-not-on-PATH check (a false positive — lefthook works via
  `pnpm exec`), which reds the verify-lane smoke floor and, under
  `onFailure: abort`, halts the drain.
- **`cr orchestrate --autonomous` with a missing `crLanes.<kind>` does NOT
  hard-error.** Despite the gate skill's claim, it silently falls back to the
  reviewer lane. Set `crLanes.<kind>` explicitly if you want a specific lane set.

Two more sink/receipt traps:

- **Transient verify-lane `verify dispatch failed: exit -1`.** The verify lane
  occasionally dies on spawn rather than on substance — re-run the lane once
  before treating the aggregate as red.
- **ANY commit after the code-stage CR strips the receipt**, not just an amend —
  `Noldor-Reviewed-Subagent` is `HEAD^{tree}`, so a post-CR nit-fix commit
  leaves the tip unreceipted and pre-push rejects. Remove the code sink
  (`rm .noldor/cr/<slug>-code-*.json`) and re-run
  `cr orchestrate --kind code --base-sha origin/main` to review the new tree
  and mint a fresh receipt on the tip.

Two traps in how a round's result is read:

- **Rounds that keep finding real defects are not evidence of converging
  quality.** Q-0124's code CR ran 3→3→2→2→1→1→3 blockers over 8 rounds, and
  from round 2 on nearly every finding was about the *previous round's fix*
  rather than the original design. Each was genuine and verified, which is why
  the loop felt productive; what it signalled was a design forcing case-by-case
  repairs. After ~3 rounds on one artifact, ask whether the findings are
  independent or each one repairs the last — if the latter, stop and question
  the design instead of running another round.
- **A green `verifier` lane is not a second opinion on correctness.** It
  returned `pass` with 0 blockers on all 8 rounds of Q-0124 while `reviewer`
  found 15 real defects, including a forgeable `Merge branch 'fake'` bypass.
  Acceptance-style verification confirms the happy path does what the feature
  claims; it does not probe adversarial or edge-state cases. Shipping on a green
  verify alone would have shipped every one of those defects.

Sink-file mechanics (stale sink after amend, archive-to-subdir, headless
overwrite crash) live in [`gotchas.md`](gotchas.md#cr-sinks).
