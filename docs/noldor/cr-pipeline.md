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

`kind=spec` and `kind=plan` route to the same lane implementations, and the kind value lands in the `LaneFindings.kind` field. The prompts differ at `kind=spec`: the reviewer and codex both render the spec-stage blocking definition there (next section), and codex reads the FD's Summary instead of the whole FD.

### Spec-stage blocking

A spec is a document an implementer acts on, so the code-stage definition (`BLOCKING_DEFINITION`) and its "false statement into docs" clause would let almost any inaccuracy in a spec block. At `--kind spec` the `reviewer` and `codex` lanes render `SPEC_BLOCKING_DEFINITION` instead (`src/cr/blocking-definition.ts`, Q-0263). A spec finding blocks only when it names one of three bases, and each basis has a way to settle it that does not require agreeing with the lane:

- `requirement`: something the feature has to do is missing, or two parts of the spec (or the spec and the FD Summary) contradict each other. Add the requirement, move it to Non-goals, or fix one side of the contradiction.
- `feasibility`: the design cannot be built as written against the real code. Change the design, or answer the claim under Open questions (resolved) with the reason it can be built. A claim the lane still upholds is carried to the round cap's arbitration.
- `risk`: building the spec as written would ship a defect, and the spec neither prevents it nor accepts it. Prevent it, or accept it under Risks / trade-offs.

Wording, formatting, cross-references, section structure, detail an implementer can decide, a preference between workable designs, a choice the spec already records, and the FD's scaffold stubs never block a spec. Code enforces the structural half: a spec-kind finding marked blocking with no valid `basis` is filed as a suggestion (`isEffectivelyBlocking` in `src/cr/lanes/subagent.ts`, `toFindings` in `src/cr/review-with-codex.ts`). A blocker a lane files about its own failure, against `<reviewer>` or `<codex>`, is never demoted, so a failed review still reds its round. A prior carried from a sink written before the rule names no basis, so a spec re-round carries it as a suggestion rather than a blocker (`splitCarriedByBasis` in `src/cr/re-round.ts`); a round whose lane failed keeps it a blocker for the next round to judge. The basis rides the sink finding and shows in the re-round prior list and the `cr aggregate` blocker line (`[high][risk] …`).

Settle a spec blocker you reject by recording the ruling in the spec itself, not in chat: the next round's lanes read the spec (`docs/adr/0003-spec-stage-decisions-live-in-the-spec.md`). Codex reads only the FD's Summary at this kind because the FD's Diagram, User Story and Usage sections are stubs filled after the spec.

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

### Re-round contract

A re-round is a dispatch whose lane inherits blockers from its own prior sink. Two lanes
inherit them, `reviewer` and `codex`, and both render one contract from `src/cr/re-round.ts`
(Q-0260):

- The prompt lists every prior blocker as `P1…Pn` and asks the lane to answer each one in a
  `prior` list of `{"n", "resolved", "why"}`. The lane never re-types a prior. Code re-files
  every prior not answered `resolved: true` as the prior finding, unchanged, so its fingerprint
  survives the round — and with it R1, the no-progress stop and any arbitration disposition
  (`docs/adr/0002-code-refiles-standing-cr-blockers.md`). An unanswered, malformed or
  contradictory answer carries the prior. The sink's `notes` record every answer.
- A new finding blocks only as a regression the fix caused, or under the blocking definition.
  Everything else about the fix's own content is a suggestion.
- A lane that fails keeps the priors it was handed, behind its own failure blocker filed against
  `<reviewer>` or `<codex>`. No round ever carries a `<lane>` blocker forward.
- A prior sink that exists but cannot be read, does not parse, or fails `laneFindingsSchema`
  refuses the round with exit 4, before anything is dispatched or recorded. Repair the file, or
  remove it to start that lane's series over.

Whoever writes the fix works to the rule `cr autofix plan` prints as its `fix-rule:` line: make
the smallest change that resolves the blocker, and prefer deleting a claim to adding one.

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
    {
      "file": "src/x.ts",
      "line": 42,
      "severity": "high",
      "message": "...",
      "suggestion": "...",
      "basis": null
    }
  ],
  "suggestions": [
    { "file": "src/x.ts", "line": 42, "message": "...", "suggestion": "...", "basis": null }
  ],
  "summary": "one-line verdict",
  "prior": [{ "n": 1, "resolved": true, "why": "..." }]
}
```

`basis` is a spec blocker's basis (`requirement`, `feasibility` or `risk`, see "Spec-stage
blocking") and `null` everywhere else; a spec-kind blocker whose basis is `null` is filed as a
suggestion. `prior` answers the prior blockers a re-round lists (see "Re-round contract"); a first round
returns `[]`. Anything else (non-JSON, schema mismatch, non-zero exit) becomes a synthetic
blocker filed against `<codex>` and the script exits 1.

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

The gate-compliance audit (`garden detect --gate-compliance`) has the same
pair, because its `trailerScopeMismatch` and `allowlistDrift` findings also
name commits already squashed onto `main`:

- `release.gateComplianceExemptCommits` — the twin of
  `release.crGateExemptCommits`, same `{ sha, reason }` shape. A matching
  commit is skipped outright rather than reported with a marker: the point
  of the entry is to remove the row.
- `release.gateComplianceSince` — a commit-SHA prefix below which nothing is
  judged. Use it when a rule was adopted *after* the repo's Noldor rollout,
  which is the case `.noldor/rollout-marker` cannot express — `noldor init`
  stamps that marker once and it never moves, so it dates the rollout, not
  the rule. When both are set, the floor wins over the marker.

Reach for either before `RELEASE_SKIP_GATE_COMPLIANCE=1`, which silences the
whole audit including findings that are still fixable.

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

The verdict travels in an answer file, never in the child's printed output (Q-0250). Each
dispatch gets its own path, `.noldor/cr/answers/<slug>-<kind>-<lane>-<dispatchId>.json`, and the
child writes one JSON object there. For a codex-mapped role the codex CLI writes the child's
final message there instead (`--output-last-message`), so its read-only sandbox never needs write
access. Fences, quoted code and prose around the answer therefore cannot break it. A missing file,
invalid JSON or a schema mismatch gets ONE repair round: the seam re-dispatches with the rejected
answer, the reason and the child's output, and asks only for a valid answer. A child that produced
nothing at all gets no repair round, because there is nothing to transcribe. That round is a
transcription, never a second verification: it boots nothing and may not upgrade a hedged report
into `pass`. A verdict it recovers is stamped with a `repair round` note. When the repair fails
too, the round is the "no trustworthy verdict" class above. There is no prose fallback. It stamps
`reason` (`malformed-output`, or `dispatch-failed` when the spawn itself failed) and keeps the
rejected answer and the child's output verbatim in `notes` (bounded at 20k chars). Each lane's
latest raw answer stays at `.noldor/cr/answers/<slug>-<kind>-<lane>.json` for debugging.

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
- **`cr autofix record --deferred` validates against the sink's
  classification, not what you did.** Applying an untagged (`design`-read)
  blocker by hand still records as deferred, or `record` exits 2
  ("N design + 0 unapplied mechanical"). Codex blockers are always untagged,
  so a round mixing reviewer-mechanical with codex findings records as
  `--applied <mechanical> --deferred <codex>` even when every finding was
  fixed. (Q-0145)
- **A fast-track "verified" can be a no-op.** The verify lane returns
  `cannot-verify: no acceptance text (no FD, empty commit prose)` and the
  aggregate still reports `ok=true` — fast-track carries no FD, so the lane
  degrades silently and the reviewer lane is the whole review. (2026-08-20
  XS drain)
- **Resolved (Q-0250): the verify lane could not report on a change whose evidence contained
  fenced code.** Its verdict used to travel as a fenced JSON block, and evidence that quoted a
  ` ```bash ` block closed that fence early. Shipping Q-0239 lost two `pass` verdicts that way
  and ended on `Noldor-Path-Override`. The verdict now travels in an answer file, where a quoted
  fence is just characters inside a JSON string. If a verify round still reds with
  `reason: malformed-output`, read the rejected answer the sink keeps verbatim in `notes` before
  blaming the transport.
- **Resolved (Q-0250): a reviewer that wrote `- (none)` under an empty severity bucket
  red the round with phantom blockers.** Shipping Q-0246, the reviewer approved and its sink
  still carried blockers whose message was the literal `(none)`. The reviewer now answers with
  one JSON object in its answer file. An empty list is `[]`, and placeholder entries such as
  `(none)` or `N/A` are dropped before validation. A finding blocks only when the reviewer marks
  it `blocking`, and never when it is `minor` or marked `maybe:` or `unverified:`. The sink
  `summary` is derived from those flags, so it can no longer read `approve` over a red round.

More sink/receipt traps:

- **Transient verify-lane `verify dispatch failed: exit -1`.** The verify lane
  occasionally dies on spawn rather than on substance — re-run the lane once
  before treating the aggregate as red.
- **ANY commit after the code-stage CR strips the receipt**, not just an amend —
  `Noldor-Reviewed-Subagent` is `HEAD^{tree}`, so a post-CR nit-fix commit
  leaves the tip unreceipted and pre-push rejects. Remove the code sink
  (`rm .noldor/cr/<slug>-code-*.json`) and re-run
  `cr orchestrate --kind code --base-sha origin/main` to review the new tree
  and mint a fresh receipt on the tip.
- **`cr escalate` `override-with-trailer` stamps nothing.** It prints
  `escalate outcome: override` and exits — the receipt hook exempts only on a
  `Noldor-Path-Override` trailer on the TIP commit
  (`noldor-enforce-review-receipt.ts` reads tip trailers only; an override on
  an earlier commit does nothing). Amend it yourself:
  `git commit --amend --no-edit --trailer "Noldor-Path-Override: <reason>"`.
  A red round at the re-round cap therefore has exactly two exits: one more
  delta round, or that amend. (Q-0132, Q-0145)
- **A refused round leaves its sinks on disk, and `cr aggregate` now says so.**
  `cr orchestrate` returns at the round cap *before* it records the round, so
  nothing rewrites the lane sinks and the previous round's findings sit there
  reading as current — on PR #437 that was three reported blockers of which two
  had already been fixed in a later commit, with nothing in the output to say
  which. The expected-lanes record now stamps the `HEAD` each dispatch ran
  against, and `aggregate` compares that commit's **tree** with `HEAD^{tree}` —
  the same identity the push receipt is bound to, so the receipt amend and
  `cr bootstrap`'s message rewrites do not trip it. A mismatch prints
  `stale <kind> round:` and exits 1 even when every sink is green, and
  `cr autofix plan` declines it as `reason: stale-round` rather than handing you
  `M<n>` fixes for code that may already carry them. Re-run
  `cr orchestrate --kind <kind>` (a changed `HEAD` earns one closing round at
  the cap) or take the `Noldor-Path-Override` amend above. `--unresolved-only`
  mutes it — by the gate's kind-less drain step the tree has moved past every
  spec and plan sink by construction. Records written before this landed carry
  no stamp and read as unknown, never stale. (Q-0211)
- **The arbitration skeleton is still written for a stale round — loudly.** It
  would be tidier to refuse it, and that refusal wedges the session: once
  `hasClosingRound` is spent, `capVerdict` refuses terminally however `HEAD`
  moves, and `decideArbitration` accepts neither a bare override nor a record
  bound to any tree but `HEAD`'s — so with no skeleton for the new tree the push
  has no exit at all. The skeleton is the last way out, so it is written with an
  `arbitrating a stale round` warning and a `CHECK EACH ONE AGAINST THE CODE
  FIRST` line above the disposition instructions. `cr aggregate` is where
  staleness gates; the skeleton is where it is disclosed. (Q-0211)

- **`--lanes reviewer` silently under-runs a configured `crLanes.code`.** The
  gate's Step 4 examples hardcode `--lanes reviewer`, but a repo whose
  `.noldor/config.json` sets `crLanes.code: ['reviewer', 'verifier']` then runs
  only half its own review posture — the verifier lane never dispatches and the
  aggregate still reads green, so nothing marks the gap. Prefer `--autonomous`
  with no `--lanes` (orchestrate reads `crLanes.<kind>`) over the hardcoded
  example, or check the config before passing an explicit lane list. Note this
  is the mirror of the fallback trap above: an ABSENT `crLanes.<kind>` degrades
  to reviewer-only, and an explicit `--lanes` overrides a PRESENT one — both
  land on reviewer-only, neither says so. (2026-08-24, Q-0158)
- **Re-running `cr orchestrate` over an existing sink without `--autonomous`
  dies instantly in any non-TTY runner.** `guardLaneOverwrite` fires an
  interactive prompt, which throws
  `ExitPromptError: User force closed the prompt` under the Claude Code Bash
  tool and every other headless runner — indistinguishable from a real
  dispatch failure. The delta-re-earn recipe shows the command without the
  flag, so it is a trap on the second pass by construction: always add
  `--autonomous` (it defaults the overwrite guard to `archive-and-overwrite`
  and the standalone-in-progress guard to `drop-lane`) when re-running.
  (2026-08-24, Q-0158)
- **Budget a whole extra dispatch to re-earn the receipt after a cap-round
  fix.** The re-round cap governs *arbitration* rounds; the
  `Noldor-Reviewed-Subagent` receipt is separately bound to `HEAD^{tree}`, so
  the commit that fixes the final round's blocker strips it. Q-0158 needed a
  4th dispatch that found nothing, purely to mint a receipt on the new tip.
  This is not a cap violation — the cap and the receipt count different things
  — but it is invisible when planning the round budget. (2026-08-24, Q-0158)
  Since Q-0170 the cap accounts for it rather than leaving it to arithmetic: a
  green round does not count, and past the cap a commit that changes `HEAD`
  earns one closing round. That dispatch is the receipt re-earn.

Two traps in how a round's result is read:

- **Rounds that keep finding real defects are not evidence of converging
  quality.** Q-0124's code CR ran 3→3→2→2→1→1→3 blockers over 8 rounds, and
  from round 2 on nearly every finding was about the *previous round's fix*
  rather than the original design. Each was genuine and verified, which is why
  the loop felt productive; what it signalled was a design forcing case-by-case
  repairs. After ~3 rounds on one artifact, ask whether the findings are
  independent or each one repairs the last — if the latter, stop and question
  the design instead of running another round. Q-0145 repeated the pattern
  (rounds 3–4 flagged only the prior rounds' fixes — an `errMessage` helper
  added in round 3 was itself flagged in round 4); at the re-round cap,
  budget for closing with a `Noldor-Path-Override` recording the arbitration
  rather than expecting convergence.
- **A green `verifier` lane is not a second opinion on correctness.** It
  returned `pass` with 0 blockers on all 8 rounds of Q-0124 while `reviewer`
  found 15 real defects, including a forgeable `Merge branch 'fake'` bypass.
  Acceptance-style verification confirms the happy path does what the feature
  claims; it does not probe adversarial or edge-state cases. Shipping on a green
  verify alone would have shipped every one of those defects.
- **When round N+1 finds a defect in round N's fix, prefer the candidate that
  DELETES a rule over the one that adds a case.** Q-0214 (PR #453) ran 4 red
  spec rounds and 4 red code rounds; each found a real silent-loss defect in
  the previous round's fix, always the same class — a copied declaration
  silently dropped from the clone report. Every fix that *added* a distinction
  (terminate the import match at `;`, then an ASI boundary, then the import
  grammar; require a `return`, then disqualify `interface`/`type`/`enum`/
  `class`) was falsified next round; the three that held each *removed* one
  (drop the container list, drop the `(` bail, drop the `;` bail). Before
  picking a fix, say plainly which direction the predicate fails in.
- **A blocking gate that refuses working code is worse than the gap it closes —
  that asymmetry is the stop condition, not the round cap.** Q-0126's
  `src/invariants/` text scanner over a semantic pattern took three red code
  rounds and 14 findings and never converged: keying on an equality operator
  missed string-method spellings, a proximity window exempted a guard pasted
  from the check's own violation message, and the per-line replacement refused
  `isEntrypoint(import.meta.url, argv1)` — the helper's own documented API,
  the very thing the check existed to steer toward — plus ordinary one-line
  `/** … */` doc comments. The last two rounds failed in the **false-positive**
  direction; that is where to stop, whatever the cap says. The escape was not a
  fourth heuristic but removing the unit and filing it as its own entry with
  the three falsified designs attached, which turned six oscillation signals
  into zero. `src/invariants/` has no AST route since TS7 dropped the
  in-process compiler API, so "this invariant needs an AST" is a recognised
  reason to *not build it now* rather than to write another heuristic.

## Round budget

`cr orchestrate` appends one entry per resolved dispatch to
`.noldor/cr/autofix/<slug>-<kind>.json` and refuses to dispatch once the budget
is spent, exiting **3** with the round history and the way out. `cr autofix
record` no longer appends — it annotates the round it reviewed, matched by head
— so the seam and the operator draw from one budget rather than two counts that
could not see each other.

Only **red** rounds count, against `AUTOFIX_ROUND_CAP + 1` (three: the initial
pass plus two re-rounds). A green dispatch arbitrates nothing and is free,
however many run, which is what keeps receipt re-earns from spending budget.

A dispatched round always counts; what varies is its verdict, and that comes
from the findings **filed**, not from the aggregate's `ok` — which is also false
when an expected lane merely failed to resolve. Three rules follow, each closing
a hole the others open:

- A crashed lane files nothing, so a clean reviewer beside a crashed codex is
  **green**. Reading `ok` there would spend budget on a review that did not
  happen and, on a closing round, mark the pair terminal over a spawn failure.
  Findings are attributed to the lanes that ran THIS round: sinks are archived
  rather than deleted, so a lane crashing on a later round leaves its previous
  sink on disk and would otherwise decide the round by a review that did not
  happen.
- A round in which **no lane wrote a sink** is red, not green. Nothing was
  reviewed, and green means "reviewed, found nothing" — a no-verdict green would
  disarm the cap through the green-last-round exemption and allow unlimited
  same-head retries. It also keeps a chronically crashing lane from leaving the
  counter at zero forever.
- An **integrity** blocker says the verdict cannot be trusted, so it reds the
  round but never marks it terminal. One corrupt sink must not wedge the pair
  behind the override permanently.

Only a red round whose findings were actually filed, and which carries no
integrity blocker, can be the terminal closing round. A round in which every
lane crashed is still recorded red — leaving it uncounted would let repeated
crashes disarm the cap completely.

The refusal engages only while the last round was **red**. After a green one
the pair is re-minting rather than arbitrating, so a same-head retry is allowed
— otherwise a failed receipt mint could not be re-run.

Past the cap the refusal lifts when `HEAD` differs from the last recorded
round's, because the operator committed a fix. Heads compare by prefix, the
same way the ledger resolves a round's identity. That earns one closing round. A
**red** closing round is terminal: it is marked, and every dispatch after it is
refused, leaving the arbitration override as the only exit. A **green** one
mints the receipt and is not marked, so the pair stays open to further green
re-mints — the receipt is `HEAD^{tree}`-bound and any later commit strips it,
so locking there would forbid exactly the re-mint this design keeps free.

Everything about the count fails **open**: an unreadable or malformed ledger
leaves the cap inert for that round, and a failed append under-counts. A missed
cap costs one dispatch; a false cap costs the ship. A series with no session
marker never records the closing-round sentinel, since one sessionless run
would otherwise lock out every future sessionless dispatch for the pair.

### Taking the arbitration exit

The refusal writes a skeleton to `.noldor/cr/arbitration/<slug>-<kind>.json` and
prints the blocker ids it holds. Answer each one, then read off the digest:

```
pnpm noldor cr arbitration dispose --slug <slug> --kind <kind> \
  --blocker <id> --disposition <accepted|rejected|deferred> --note "<why>"
pnpm noldor cr arbitration digest --slug <slug> --kind <kind>
```

`dispose` replaces any prior answer for that blocker rather than appending one —
the schema forbids two dispositions for one id, so changing your mind by hand
produces a record that no longer parses. `digest` prints the digest plus the
`git commit --amend --trailer …` line to run, and exits **1** when a push naming
that digest would still be refused: a blocker left undisposed, a record with no
arbitrable blockers (every finding was an integrity blocker, which
`buildSkeleton` drops and no operator can dispose of), or a `boundTree` that
`HEAD` has moved past. Each reason prints as a `not ready:` line.

**A spec or plan digest is never a verified close, and `digest` exits 1 to say
so.** `noldor-enforce-arbitration.ts` builds its record path with a hardcoded
`'code'`, so it is the only record the trailer is ever checked against: naming a
spec digest is *refused* where a code record for the same slug exists (the guard
compares the named digest against that one) and merely *unchecked* where none
does, since the guard then fails open with its warning. The same hardcoded
`'code'` governs the guard's ledger fallback, so a filled spec or plan record
feeds nothing at push time either: it is a readable account of how that round was
settled, and the close itself happens at `--kind code`.

Both commands existed only as functions before Q-0228, which made the one exit
past a capped round also the one surface that asked for a hand-edited,
schema-validated JSON file — against a disposition vocabulary nothing printed.

Sink-file mechanics (stale sink after amend, archive-to-subdir, headless
overwrite crash) live in [`gotchas.md`](gotchas.md#cr-sinks).
