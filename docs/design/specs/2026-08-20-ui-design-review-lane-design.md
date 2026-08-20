# UI-Design Review Lane — Design

**Slug:** ui-design-review-lane
**FD:** docs/features/ui-design-review-lane.md
**Date:** 2026-08-20
**Tier:** specs-only
**Deps:** pendev-ui-design-phase (Q-0144, shipped PR #342)

## Problem

Q-0144 gave a UI-bearing session a design artifact: a feature `.pen` whose
`FINAL:<surface>` pages are the approved design, committed with the spec at gate
Step 2.5. Nothing then checks the implementation against it. The two existing
enforcement points are both blind to design fidelity — `checks ui-design-freshness`
([`src/release/ui-design-freshness.ts`](../../../src/release/ui-design-freshness.ts))
compares *commit ancestry* of a baseline against UI paths and never opens a `.pen`;
the code-stage `reviewer` lane reviews the diff against the FD summary and the
cascade rules and is never told a design exists. So a session can approve a design,
implement something materially different, write a baseline from the as-built UI, and
ship green.

`.pen` files are encrypted. Node cannot read them —
[`src/design/ui-sync-cli.ts`](../../../src/design/ui-sync-cli.ts) states the
constraint outright ("pencil MCP is the only reader"), which is why every existing
`.pen` rule is enforced in-session by prose rather than by a validator.

## Goals

- A code-stage CR lane that reviews the implementation against the session's own
  approved design, emitting findings into an ordinary lane sink beside `reviewer`,
  `codex` and `verifier`.
- Fires only on genuinely UI-bearing rounds, decided from the real diff.
- Honest when it cannot do its job: a sink that never implies a design comparison
  that did not happen.
- Adoptable without reddening an existing pipeline; enforceable for adopters who
  want it to block.

## Non-goals

- Mechanical render-compare (screenshot diff against a booted app) — Q-0146.
- Reviewing the baseline `.pen`. Gate Step 4 rewrites the baseline *from the
  as-built UI* in the flip commit, which lands before this lane runs, so a
  code-vs-baseline comparison is circular and would always pass.
- Authoring or repairing design artifacts. This lane reads; the design step writes.
- A spec/plan-stage variant. The design artifact is the review *object* here, not
  the review *subject*.

## Design

### U1 — Lane and role registration

`'ui-reviewer'` joins `CANONICAL_LANES` in
[`src/core/lanes.ts`](../../../src/core/lanes.ts); `'ui-reviewer'` joins
`AGENT_ROLES` in
[`src/core/agent-runner/types.ts`](../../../src/core/agent-runner/types.ts). It is
role-routed, so it follows the `reviewer`/`verifier` convention of a lane carrying
its role's name — and a consumer whose `reviewer` role maps to `codex` can still
pin `agents.roles['ui-reviewer'].runner = 'claude'`, which is where pencil MCP
lives.

Registration consequences that come for free: `laneSchema` accepts it, so
`crLanes.code` may list it and `validate noldor-config` accepts that; the
mandatory-union helpers ignore it (it is neither `reviewer` nor `codex`); and
`writeExpectedLanes` records it before dispatch, so a lane killed mid-run reports
`unresolved` rather than vanishing.

It is **not** added to `DEFAULT_CR_LANES` — opt-in via `crLanes.code`.

### U2 — Sink-filename disambiguation (`inferLaneFromFilename`)

`aggregate` attributes a sink to a lane by filename suffix
([`src/cr/filename.ts`](../../../src/cr/filename.ts):`inferLaneFromFilename`,
called from [`src/cr/aggregate.ts`](../../../src/cr/aggregate.ts)). The sink
`<slug>-code-ui-reviewer.json` ends with `-reviewer.json`, so the existing
first-match loop over `LANE_NAMES` would attribute a UI sink to the mandatory
`reviewer` lane. That is not cosmetic: a red UI round could stand in for the
reviewer's sink, and `guardLaneOverwrite`'s unskippable-lane logic keys off the
same lane identity.

Fix in one place: match candidate lane names **longest first**, so `ui-reviewer`
is tested before `reviewer`. Legacy-alias matching keeps its current shape.

### U3 — Firing predicate (recomputed, never inherited)

The lane decides for itself, from the diff it is about to review:

- candidate paths = `discoverChangedFiles({ cwd, base: baseSha ?? artifactSha~1, head: artifactSha })`
  ([`src/core/branch-added.ts`](../../../src/core/branch-added.ts)) — the same
  helper the `reviewer` lane uses to resolve binding rules;
- verdict = `sessionUiVerdict(fdFrontmatter, candidatePaths, loadUiConfig(repoRoot))`
  ([`src/core/ui-predicate.ts`](../../../src/core/ui-predicate.ts),
  [`src/core/consumer-config.ts`](../../../src/core/consumer-config.ts)) — the same
  call gate Step 4 makes for the baseline write-back, so the FD `design:` override
  keeps working in both directions.

`session.uiVerdict` is deliberately not consulted: it is a spec-time prediction
from `Touches:`/`links.code`, and this lane's question is about what actually
changed. A `skip` verdict writes a one-line green sink (`summary: 'no UI paths in
range'`) rather than nothing, so aggregate sees the expectation met. A verdict
carrying `unmappedPaths` (changed UI paths no declared surface owns) still
reviews — the gap rides the sink as a note, because a config gap is the design
step's problem to fix, not grounds for reddening a code round.

### U4 — Resolving the feature `.pen`

Node resolves a *path*, never content:

1. dialogue key = `dialogueKeyFromSession(readSession(repoRoot))`
   ([`src/design/archive-resolve.ts`](../../../src/design/archive-resolve.ts)) —
   `slug` on `*-new`, `<parent>-<enhancement>` on `*-attach`;
2. candidate dirs = `loadDocRoots(repoRoot).designUi` and its `ARCHIVE_DIR`
   sibling, archive **first**: gate Step 4 archives the `.pen` in the flip commit,
   which precedes the code-stage CR, so the archived path is the common case;
3. match = the entry whose `penSlugFromFilename` equals the key
   ([`src/core/design-artifact-names.ts`](../../../src/core/design-artifact-names.ts)),
   which by construction never matches an undated `baseline/<surface>.pen`.

`kind: 'none'` (fast-track, micro-chore) and no match are both "no design to review
against" and route to U6.

### U5 — Dispatch

One `spawnAgent` call, role `ui-reviewer`, `timeoutMs` from
`resolveDispatchTimeoutMs(cfg)` — same shape as
[`src/cr/lanes/subagent-dispatch.ts`](../../../src/cr/lanes/subagent-dispatch.ts)
and [`src/cr/lanes/verify-dispatch.ts`](../../../src/cr/lanes/verify-dispatch.ts),
with the prompt builder and parser in a `ui-review-dispatch.ts` module and the sink
policy in `ui-review.ts`.

The prompt carries: the resolved `.pen` path, the affected surface names from U3
(so the child knows which `FINAL:<surface>` pages are in scope), the diff range,
and the FD summary. It instructs the child to open the design through pencil MCP
(`get_app_state` for the schema, then `execute({ filePath })`), read the
`FINAL:<surface>` pages, and compare layout structure, component inventory and copy
against the changed files. When the verdict resolves zero surface names — an FD
`design: required` override on a consumer with no `uiSurfaces` block — the prompt
names none and the child reads every `FINAL:` page in the file.

Two scope rules keep the lane from becoming a design critic: report only where the
implementation **contradicts** something the design pins, and treat anything the
design does not pin as out of scope. A design that pins nothing about a detail is
not evidence about that detail.

### U6 — Verdicts and the mode knob

The child emits exactly one fenced ` ```json ` block, last fence wins. The
**schema is this lane's own**, in `ui-review-dispatch.ts` — the verifier's
`verifyVerdictSchema` ([`src/cr/lanes/verify-dispatch.ts`](../../../src/cr/lanes/verify-dispatch.ts))
carries no `findings` field and no `cannot-review` member, so reusing it would
strip every finding and turn every honest cannot-review into "malformed output".
Only the last-fence extraction idiom is shared, not the schema:

```json
{"verdict": "pass" | "fail" | "cannot-review",
 "findings": [{"file": "src/ui/Panel.tsx", "message": "...", "severity": "high"}],
 "reason": "only for cannot-review"}
```

`laneFindingsSchema.verdict`
([`src/cr/findings-schema.ts`](../../../src/cr/findings-schema.ts)) becomes a
union of the existing `verifyVerdictValueSchema` and a new
`uiReviewVerdictValueSchema`, rather than a widened single enum.
`verifyVerdictValueSchema` itself is left untouched, because
`verify-dispatch.ts` imports it as the verifier child's *input* contract: adding
`cannot-review` there would make it parse from a verifier child and fall through
`verify.ts`'s `// verdict === 'fail'` branch as a FAIL. The sink field accepts
both vocabularies; each lane's dispatch parser accepts only its own.

`cannot-review` is the single outcome for every "could not compare" state, each
with a distinct `reason`: no dialogue key, no feature `.pen`, the child reporting
the `.pen` unreadable (pencil absent, non-pencil runner, `execute` error),
dispatch failure or timeout, and malformed output.

`autonomous.uiReviewMode` (`'blocking' | 'advisory'`, default `'advisory'`)
decides loudness:

| verdict | advisory (default) | blocking |
| --- | --- | --- |
| `pass` | `ok: true` | `ok: true` |
| `fail` | findings as `suggestions` (severity `low`), `ok: true` | findings as `blockers`, `ok: false` |
| `cannot-review` | `ok: true`, reason in `notes` | one high blocker, `ok: false` |

This is close to `verifyMode` but not identical: `verify.ts` returns `ok: true`
for an honest `cannot-verify` in *both* modes and reds only on parse/dispatch
failure. Reddening every `cannot-review` under `blocking` is the deliberate
divergence — an adopter who flips the knob is asking for "a UI ship must
actually be design-reviewed", which an honest non-comparison does not satisfy.

Under `blocking`, `ok: false` reds the orchestrate round, which withholds the
`Noldor-Reviewed-Subagent` receipt amend and so blocks the push — the lane needs
no enforcement mechanism of its own.

### U6b — Boundary guards (one sink on every terminating path)

Every input the lane reads can fail, and each failure must still leave a sink —
`aggregate` reads sinks, and the expected-lanes record makes a missing one
`unresolved`. The guards, with the real signatures they guard:

| step | failure | handling |
| --- | --- | --- |
| `loadUiConfig(repoRoot)` | returns `null` (no consumer config) | `not-applicable` sink — the feature is unadopted, not broken |
| `readSession(repoRoot)` | returns `null`, or **throws** on a torn marker | catch; no key ⇒ `cannot-review` (`reason: no-session-key`) |
| `dialogueKeyFromSession` | `kind: 'invalid'` (marker missing `slug`/`parent`) | `cannot-review` (`reason: no-session-key`) |
| `discoverChangedFiles` | throws on an unresolvable ref | catch ⇒ `cannot-review` (`reason: range-unresolvable`) |
| `artifactSha` | `''` when git is unavailable ([`src/cr/orchestrate.ts`](../../../src/cr/orchestrate.ts) defaults it so) | never string-concatenated into a rev; empty ⇒ `range-unresolvable` |
| directory read | `.pen` dir absent / unreadable | treat as no match ⇒ U4's no-`.pen` path |

`loadUiConfig` returning `null` is guarded by every existing caller
([`src/design/ui-sync-cli.ts`](../../../src/design/ui-sync-cli.ts),
[`src/checks/check-ui-design-freshness.ts`](../../../src/checks/check-ui-design-freshness.ts));
`readSession`'s throw is guarded in
[`src/cr/orchestrate.ts`](../../../src/cr/orchestrate.ts) for the codex mandate.
This lane follows both precedents rather than inventing a third posture.

### U7 — Gate wiring

`orchestrate.ts` gains `'ui-reviewer': runUiReview` in its `LANES` record and
extends the existing code-only rejection so `--lanes ui-reviewer --kind spec|plan`
fails with the message `verifier` already gets. Gate Step 4 prose lists it as an
opt-in code lane; no new step. The docs surface is one row in the CR-lane table
plus the config key, with `templates/` twins updated in the same pass.

## Acceptance criteria

1. `ui-reviewer` is accepted in `crLanes.code` by `validate noldor-config`, and
   `--lanes ui-reviewer --kind spec` (or `plan`) exits non-zero with a code-only
   message.
2. `inferLaneFromFilename('x-code-ui-reviewer.json')` returns `ui-reviewer`, and
   `'x-code-reviewer.json'` still returns `reviewer`.
3. A round whose diff matches no `uiPaths` writes a green sink with no dispatch.
4. A round whose diff matches `uiPaths` resolves the feature `.pen` from the
   archive directory when the flip commit has already moved it, and from the live
   directory when it has not.
5. The dispatched prompt names the resolved `.pen` path and every affected surface
   from the recomputed verdict.
6. FD `design: skip` suppresses the lane even when the diff matches `uiPaths`;
   `design: required` fires it even when the diff does not.
7. No dialogue key (fast-track/micro-chore) and no matching `.pen` each produce
   `verdict: cannot-review` with a distinguishing `reason`, and no dispatch.
8. A child reporting the `.pen` unreadable produces `cannot-review`, never findings.
9. Dispatch failure, timeout, and unparseable output each produce `cannot-review`
   with a reason naming which; a `fail` verdict's findings survive parsing into the
   sink (they are not stripped by a schema that lacks the field).
10. Under `advisory`, `fail` and `cannot-review` both write `ok: true` — findings
    land as `suggestions`; under `blocking`, both write `ok: false` with blockers.
11. Every terminating path writes exactly one schema-valid sink at
    `.noldor/cr/<slug>-code-ui-reviewer.json` — including a `null` consumer config,
    an absent or torn session marker, and an unresolvable diff range.
12. A verifier child emitting `cannot-review` still fails the verifier's own parse
    (its input enum is unchanged), so the widened sink field cannot reroute a
    verifier round through the UI vocabulary.
13. A red `ui-reviewer` under `blocking` leaves the tip commit without a
    `Noldor-Reviewed-Subagent` receipt.

## Risks / trade-offs

- **Pencil capability is environmental.** Consumers on codex/opencode reviewers and
  CI runners get `cannot-review`. Advisory default keeps that from being a wall; the
  per-role runner pin is the remedy for anyone who wants the review to actually run.
- **`cannot-review` is a green under advisory.** Deliberate: the sink's `verdict`
  and `reason` carry the truth, and a lane that reds on an absent optional tool
  trains overrides. Adopters who want the guarantee flip one knob.
- **No degraded prose-only review.** A pencil-less run reviews nothing rather than
  reviewing the spec's Design section. Cheaper and honest: a sink can never carry
  design findings that were not derived from the design.
- **Working-tree read, not `git show`.** The lane opens the `.pen` at its on-disk
  path. Correct at Step 4 (the archive move is committed by then) but it would also
  read an uncommitted edit. Accepted for the same reason the design step accepts it:
  pencil MCP opens files, not blobs.
- **Widening `laneFindingsSchema.verdict`** touches a shared schema. Additive and
  union-shaped, with each lane's dispatch parser still accepting only its own
  vocabulary — so every existing sink parses and no lane gains a verdict it cannot
  produce.
- **Prompt-enforced scope.** "Only contradictions of what the design pins" is
  prose, so a chatty model can still moralize about spacing. Advisory default and
  the `severity` field bound the damage.

## User Story

As an agent shipping a UI-bearing feature, I want the code-stage CR to compare what
I built against the design my session approved, so that implementation drift is
caught before merge instead of being silently ratified by a baseline written from
the as-built UI.

## Usage

Opt in per consumer in `.noldor/config.json`:

```json
{
  "crLanes": { "code": ["reviewer", "verifier", "ui-reviewer"] },
  "autonomous": { "uiReviewMode": "advisory" },
  "agents": { "roles": { "ui-reviewer": { "runner": "claude" } } }
}
```

Then the ordinary code-stage round runs it:

```
pnpm noldor cr orchestrate --slug <slug> --artifact <code-paths> --kind code \
  --lanes reviewer,ui-reviewer --base-sha origin/main
pnpm noldor cr aggregate --slug <slug> --kind code
```

Sink: `.noldor/cr/<slug>-code-ui-reviewer.json`. Read `verdict` before reading
`blockers`: `cannot-review` means no comparison happened, and `reason` says why.
Flip `uiReviewMode` to `blocking` once your reviewer runners are pencil-capable.

## Open questions (resolved)

1. *How does the lane get design structure out of an encrypted `.pen`?*
   -> The dispatched child opens it itself via pencil MCP `execute({ filePath })`;
   Node resolves only the path (D1). One artifact, no digest to drift out of sync.
2. *What happens when the child cannot open the `.pen`?*
   -> `cannot-review`, no dispatch of a substitute review (D2). A degraded
   prose-only pass would put design findings in a sink that never saw the design.
3. *Which `.pen` is the review object?*
   -> The feature `.pen`'s `FINAL:<surface>` pages only (D3). The baseline is
   rewritten from the as-built UI before this lane runs, so it cannot judge it.
4. *Spec-time verdict or recomputed?*
   -> Recomputed from the diff under review (D4). The marker holds a prediction;
   the diff is the fact, and UI that emerged during implementation must still be seen.
5. *Blocking or advisory, and what about a UI change with no design at all?*
   -> Advisory default with a `uiReviewMode` knob; no-`.pen` collapses into
   `cannot-review` (D5). Adoption must not red an existing pipeline.
6. *Lane and role naming?*
   -> `ui-reviewer` for both (D6), matching the role-routed convention and letting a
   consumer route this lane to a pencil-capable runner independently of `reviewer`.
7. *Output contract, and where does `cannot-review` live?*
   -> Fenced JSON in the verifier's parse shape; widen the sink `verdict` enum (D7).
   A first-class enum value beats a sentence in `summary` that no reader can trust.
