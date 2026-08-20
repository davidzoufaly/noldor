# UI-Design Review Lane — Design

**Slug:** ui-design-review-lane
**FD:** docs/features/ui-design-review-lane.md
**Date:** 2026-08-20
**Tier:** specs-only
**Deps:** pendev-ui-design-phase (Q-0144, shipped PR #342)

## Problem

Q-0144 gave a UI-bearing session a design artifact: a feature `.pen` whose
`FINAL:<surface>` pages are the approved design, committed with the spec at gate
Step 2.5. Nothing then checks the implementation against it. Both existing
enforcement points are blind to design fidelity — `checks ui-design-freshness`
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
- Honest when it cannot do its job: a sink never implies a design comparison that
  did not happen, and says in a machine-readable field which case it was.
- Adoptable without reddening an existing pipeline; enforceable for adopters who
  want it to block.

## Non-goals

- Mechanical render-compare (screenshot diff against a booted app) — Q-0146.
- Reviewing the baseline `.pen`. Gate Step 4 rewrites the baseline *from the
  as-built UI* in the flip commit, which lands before this lane runs, so a
  code-vs-baseline comparison is circular and would always pass.
- Authoring or repairing design artifacts. This lane reads; the design step writes.
- Judging visual quality. The lane checks conformance to what the design pins
  (U5b), not whether the design was good.
- A spec/plan-stage variant. The design artifact is the review *object* here, not
  the review *subject*.

## Design

### U1 — Lane and role registration

`'ui-reviewer'` joins `CANONICAL_LANES` in
[`src/core/lanes.ts`](../../../src/core/lanes.ts); `'ui-reviewer'` joins
`AGENT_ROLES` in
[`src/core/agent-runner/types.ts`](../../../src/core/agent-runner/types.ts). It is
role-routed, following the `reviewer`/`verifier` convention of a lane carrying its
role's name.

Runner resolution is the registry's existing rule, not a new one: `resolveRunner`
returns `agents.roles['ui-reviewer']` when configured and falls back to
`agents.default` (`claude` unless the consumer changed it). A consumer whose
`reviewer` role maps to `codex` can therefore pin `ui-reviewer` back to the
pencil-capable runner without touching `reviewer`. There is **no pre-dispatch
pencil probe**: whether the child can reach an MCP server is invisible from the
parent process, so capability is inferred from the child's own report (U6
`pen-unreadable`) rather than guessed before spawning.

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
first-match loop over `LANE_NAMES` attributes a UI sink to the mandatory
`reviewer` lane: aggregate marks `reviewer` seen and raises a lane-mismatch
finding, while the real reviewer sink is double-counted.

Fix in one place: match candidate names **longest first**, canonical names and
legacy aliases alike, so `ui-reviewer` is tested before `reviewer` and any future
overlapping name is safe by construction.

(`guardLaneOverwrite` is unaffected — it resolves exact filenames through
`sinkCandidatePaths`, never this parser.)

### U3 — Firing predicate (recomputed, never inherited)

The lane decides for itself, from the change under review:

- **predicate base**, resolved independently of the prompt range:
  `input.baseSha ?? resolveDefaultBase(run)`
  ([`src/core/branch-added.ts`](../../../src/core/branch-added.ts)) — the remote's
  default branch, i.e. the whole feature. This split mirrors
  [`src/cr/lanes/subagent.ts`](../../../src/cr/lanes/subagent.ts)'s
  `rulesBaseSha` / `promptBaseSha` and exists for a concrete reason: on the
  `fullReview` path orchestrate **deletes `baseSha`**, so a `${artifactSha}~1`
  fallback would scope the predicate to the tip commit alone and read `skip` for a
  branch whose UI landed earlier — a green sink in the round meant to be widest.
  No revision string is ever built by concatenation onto `artifactSha`, which
  orchestrate leaves `''` when git is unavailable.
- **candidate paths**: `discoverChangedFiles({ cwd, base, head })`. The helper
  throws on an unresolvable ref; U6b maps that to a sink.
- **verdict**: `sessionUiVerdict(fdFrontmatter, candidatePaths, uiConfig)`
  ([`src/core/ui-predicate.ts`](../../../src/core/ui-predicate.ts)) — the same call
  gate Step 4 makes for the baseline write-back, so the FD `design:` override keeps
  working in both directions.

`session.uiVerdict` is deliberately not consulted: it is a spec-time prediction
from `Touches:`/`links.code`, and this lane's question is what actually changed.

Verdict handling:

| verdict | affected surfaces | lane does |
| --- | --- | --- |
| `skip` | — | `not-applicable` sink, no dispatch |
| `required` | ≥1 named surface (incl. the implicit `app` when no `uiSurfaces` block exists) | review those surfaces' `FINAL:` pages |
| `required` | 0 — only reachable via an FD `design: required` override whose diff matches no `uiPaths` | review every `FINAL:` page in the file |
| `required` | ≥1 surface **plus** `unmappedPaths` | review the matched surfaces; list the unmapped paths in `notes` |

The last row is the config-gap case, and it is a note rather than a finding: an
under-covering `uiSurfaces` map is the design step's problem to fix, not grounds
for reddening a code round. The zero-surface row is override-only — with no
`uiSurfaces` block and ≥1 matching path the predicate returns the implicit `app`,
never an empty set.

### U4 — Resolving the feature `.pen`

Node resolves a *path*, never content:

1. **Waiver first.** `session.uiWaiver` present ⇒ `not-applicable` (reason
   `waived`), no dispatch. Gate Step 4 skips the baseline write-back for a waived
   session precisely because no feature `.pen` exists; reddening one under
   `blocking` would punish a decision the operator already made.
2. **Dialogue key** = `dialogueKeyFromSession(readSession(repoRoot))`
   ([`src/design/archive-resolve.ts`](../../../src/design/archive-resolve.ts)) —
   `slug` on `*-new`, `<parent>-<enhancement>` on `*-attach`.
3. **Candidates** from `loadDocRoots(repoRoot).designUi` and its `ARCHIVE_DIR`
   sibling, whose basename parses to that key via `penSlugFromFilename`
   ([`src/core/design-artifact-names.ts`](../../../src/core/design-artifact-names.ts)) —
   which by construction never matches an undated `baseline/<surface>.pen`.
4. **Ownership gate**: keep only candidates in `discoverAddedFiles({ base })` — the
   same merge-base gate `resolveArchivePlan` documents as load-bearing. Filename
   matching alone is not sufficient: `<parent>-<enhancement>` is not injective and
   the parsers ignore the date prefix, so an ungated match can resolve a *foreign*
   feature's live `.pen` and produce confident findings against the wrong design.
5. **Resolution**: exactly one survivor ⇒ review it. Zero ⇒ `cannot-review`
   (`no-feature-pen`). More than one (an archived copy plus a re-run's live file,
   two dated files sharing a key) ⇒ `cannot-review` (`ambiguous-design`) naming the
   candidates. Guessing is worse than declining: the wrong design yields findings
   that read as authoritative.

`kind: 'none'` (fast-track, micro-chore) and `kind: 'invalid'` route to U6b.

### U5 — Dispatch

One `spawnAgent` call, role `ui-reviewer`, `timeoutMs` taken from
`LaneInput.dispatchTimeoutMs` (orchestrate already resolved it; both sibling lanes
consume it from there). Prompt builder and parser live in `ui-review-dispatch.ts`,
sink policy in `ui-review.ts` — the two-module split both sibling lanes use.

**Read-only by construction.** pencil `execute` is the editor's *write* API, so the
lane never points the child at the repo's own file: it copies the resolved `.pen`
to a scratch path outside the repo (`os.tmpdir()`) and passes that. A mutation then
cannot dirty the tree the receipt amend is about to stamp. As a backstop the lane
asserts `git diff --quiet -- <penPath>` after the dispatch and, if the assertion
fails, emits a high blocker in both modes — a modified design artifact invalidates
the review that produced it. The scratch copy is removed on every exit path.

**Exact prompt inputs** (the child extracts; the lane does not):

- the scratch `.pen` path, and the surface names in scope from U3;
- the diff range `base..head` and the repo root — the child reads the diff itself
  with git, the same way the `reviewer` lane's child does; the lane does not inline
  a diff;
- the FD summary, inline (`readFdSummary`), as context for intent.

The child is instructed to open the design through pencil MCP (`get_app_state` for
the schema, then `execute({ filePath })`), read the in-scope `FINAL:` pages, and
compare against the changed files.

### U5b — What counts as a finding

"The design pins it" is otherwise a judgment call per reviewer, so the prompt
defines it. **Normative** — a contradiction here is a finding:

- the `FINAL:` page's element hierarchy and the order of its named children;
- the inventory of named components/elements (present in design, absent in code, or
  vice-versa);
- literal text of labels, headings, button copy, and empty/error/loading messages,
  compared after whitespace trimming;
- which elements are interactive, where the design marks that;
- the set of states/variants the design authored as separate `FINAL:` pages.

**Not normative** unless the design annotates it explicitly: pixel geometry,
spacing and color values, font choices, animation. A state or breakpoint the design
never authored is unpinned — its absence from the design is not evidence about the
code, and the lane must not infer a missing variant.

**Evidence requirement.** Every finding names both sides: the design page plus the
element or label, and the code file (with symbol or line where known). A finding
that cannot name both is not actionable and must not be emitted.

### U6 — Verdicts, sink mapping, and the mode knob

The child emits exactly one fenced ` ```json ` block, last fence wins. The
**schema is this lane's own**, in `ui-review-dispatch.ts` — the verifier's
`verifyVerdictSchema` ([`src/cr/lanes/verify-dispatch.ts`](../../../src/cr/lanes/verify-dispatch.ts))
carries no `findings` field and no `cannot-review` member, so reusing it would
strip every finding and turn every honest cannot-review into "malformed output".
Only the last-fence extraction idiom is shared, not the schema.

A **discriminated union**, so a syntactically valid but semantically inconsistent
payload is rejected rather than half-honored (rejection is handled as
`malformed-output`):

- `pass` — `findings` empty, no `reason`;
- `fail` — `findings` non-empty, each carrying the U5b evidence, no `reason`;
- `cannot-review` — `findings` empty, `reason` required and non-empty.

`laneFindingsSchema.verdict`
([`src/cr/findings-schema.ts`](../../../src/cr/findings-schema.ts)) becomes a union
of the existing `verifyVerdictValueSchema` and a new `uiReviewVerdictValueSchema`
(`pass | fail | cannot-review | not-applicable`), rather than one widened enum.
`verifyVerdictValueSchema` is left untouched, because `verify-dispatch.ts` imports
it as the verifier child's *input* contract: adding members there would let a
verifier child emit `cannot-review` and fall through `verify.ts`'s
`// verdict === 'fail'` branch as a FAIL. The sink field accepts both vocabularies;
each lane's dispatch parser accepts only its own, and each lane is the only writer
of its own sink, so no other lane can emit a UI verdict.

`aggregate` is unaffected by the widening: it decides on `blockers` and lane `ok`,
never on `verdict`, which is diagnostic. Readers that *do* branch on `verdict`
(operators, the gate's summary) get the reason codes below.

**Reason codes** — stable, one per failure class: `waived`, `no-session-key`,
`no-feature-pen`, `ambiguous-design`, `pen-unreadable` (pencil absent, runner not
pencil-capable, `execute` error), `dispatch-failed`, `timeout`,
`malformed-output`, `range-unresolvable`, `fd-unreadable`, `pen-modified`.

**Sink mapping.** `autonomous.uiReviewMode` (`'blocking' | 'advisory'`, default
`'advisory'`) decides loudness; `verdict` and `reason` are written identically in
both modes, so only `ok` and the findings' placement change:

| verdict | advisory (default) | blocking |
| --- | --- | --- |
| `not-applicable` | `ok: true`, reason in `notes`, no findings | same |
| `pass` | `ok: true` | `ok: true` |
| `fail` | findings → `suggestions`, severity forced to `low`, `ok: true` | findings → `blockers`, child severities preserved, `ok: false` |
| `cannot-review` | `ok: true`, reason in `notes` | one high blocker naming the reason, `ok: false` |

Severity is preserved only where it is actionable: an advisory round's findings are
suggestions by definition, so they normalize to `low`; a blocking round keeps what
the child assigned.

This is close to `verifyMode` but not identical: `verify.ts` returns `ok: true` for
an honest `cannot-verify` in *both* modes and reds only on parse/dispatch failure.
Reddening every `cannot-review` under `blocking` is the deliberate divergence — an
adopter who flips the knob is asking for "a UI ship must actually be
design-reviewed", which an honest non-comparison does not satisfy.

Under `blocking`, `ok: false` reds the orchestrate round, which withholds the
`Noldor-Reviewed-Subagent` receipt amend and so blocks the push — the lane needs no
enforcement mechanism of its own.

### U6b — Boundary guards (one sink on every terminating path)

Every input the lane reads can fail, and each failure must still leave a sink —
`aggregate` reads sinks, and the expected-lanes record makes a missing one
`unresolved`. The guards, against the real signatures:

| step | failure | handling |
| --- | --- | --- |
| `loadUiConfig(repoRoot)` | returns `null` (no consumer config) | `not-applicable` — unadopted, not broken |
| `readSession(repoRoot)` | returns `null`, or **throws** on a torn marker | catch ⇒ `cannot-review` (`no-session-key`) |
| `dialogueKeyFromSession` | `kind: 'none'` or `kind: 'invalid'` | `not-applicable` for `none` (fast-track carries no design); `cannot-review` (`no-session-key`) for `invalid` |
| `discoverChangedFiles` / `discoverAddedFiles` | throw on an unresolvable ref or missing merge base | catch ⇒ `cannot-review` (`range-unresolvable`) |
| `artifactSha` | `''` when git is unavailable | never concatenated into a rev; empty ⇒ `range-unresolvable` |
| FD read | absent (fast-track) or malformed | absent ⇒ empty summary, review continues (the `reviewer` lane already treats a missing FD as legitimate); malformed ⇒ `cannot-review` (`fd-unreadable`) |
| `.pen` dir read | absent / unreadable | treat as no match ⇒ U4's zero-survivor path |
| sink write | fails (EACCES, full disk) | rethrow. Nothing can record a failure to record; orchestrate's `allSettled` reds the round and the expected-lanes record reports `unresolved`. AC12's "exactly one sink" is qualified on this one case |

`loadUiConfig`'s `null` is guarded by every existing caller
([`src/design/ui-sync-cli.ts`](../../../src/design/ui-sync-cli.ts),
[`src/checks/check-ui-design-freshness.ts`](../../../src/checks/check-ui-design-freshness.ts));
`readSession`'s throw is guarded in
[`src/cr/orchestrate.ts`](../../../src/cr/orchestrate.ts) for the codex mandate.
This lane follows both precedents rather than inventing a third posture.

### U7 — Gate wiring

`orchestrate.ts` gains `'ui-reviewer': runUiReview` in its `LANES` record and
extends the existing code-only rejection so `--lanes ui-reviewer --kind spec|plan`
fails with the message `verifier` already gets. `autonomous.uiReviewMode` joins the
autonomous config schema, so an invalid value is rejected by
`validate noldor-config` rather than silently defaulting. Gate Step 4 prose lists
the lane as an opt-in code lane; no new step. The docs surface is one row in the
CR-lane table plus the config key, with `templates/` twins updated in the same pass.

The lane runs one extra `discoverChangedFiles` over a range the `reviewer` lane
also resolves in the same round. Accepted: one git subprocess against a shared
mutable cache is the wrong trade, and the two callers want different bases (the
reviewer's rules base is the prompt range; this predicate's is the whole feature).

## Acceptance criteria

1. `ui-reviewer` is accepted in `crLanes.code` by `validate noldor-config`;
   `--lanes ui-reviewer --kind spec` (or `plan`) exits non-zero with a code-only
   message; an invalid `uiReviewMode` value is rejected and its default is
   `advisory`.
2. `inferLaneFromFilename` returns `ui-reviewer` for `x-code-ui-reviewer.json`,
   `reviewer` for `x-code-reviewer.json`, and the correct lane for every legacy
   alias, with matching order independent of enum declaration order.
3. A round whose diff matches no `uiPaths` writes a `not-applicable` sink and
   dispatches nothing; FD `design: skip` does the same even when paths match, and
   `design: required` dispatches even when they do not.
4. On the `fullReview` path (orchestrate having deleted `baseSha`) the predicate
   still sees the whole feature: a branch whose UI landed in an earlier commit
   dispatches rather than writing a green sink.
5. `.pen` resolution prefers nothing by accident: exactly one branch-added
   candidate is reviewed, zero yields `no-feature-pen`, two or more yields
   `ambiguous-design` naming the candidates, and a foreign feature's live `.pen`
   is never selected.
6. `session.uiWaiver` yields `not-applicable` (`waived`) with no dispatch.
7. The prompt names the scratch `.pen` path (never the repo path), the in-scope
   surface names, the diff range and the repo root; zero in-scope surfaces means
   every `FINAL:` page, and unmapped paths ride `notes` rather than findings.
8. The lane leaves the repo's `.pen` byte-identical: a child mutation is caught by
   the post-dispatch assertion and emitted as a high blocker in both modes, and the
   scratch copy is removed on every exit path.
9. The child schema rejects `pass`-with-findings, `fail`-without-findings, and
   `cannot-review`-without-reason, each handled as `malformed-output`; a `fail`
   verdict's findings survive parsing into the sink.
10. Every failure class writes its documented reason code, and dispatch failure,
    timeout and unparseable output are distinguishable from each other.
11. Mode matrix holds: under `advisory`, `fail` and `cannot-review` write
    `ok: true` with findings as `low` suggestions; under `blocking`, both write
    `ok: false` with child severities preserved on `fail`.
12. Every terminating path writes exactly one schema-valid sink at
    `.noldor/cr/<slug>-code-ui-reviewer.json` — including `null` consumer config, an
    absent or torn session marker, and an unresolvable range — except a failure of
    the sink write itself, which reds the round via `unresolved`.
13. A verifier child emitting `cannot-review` still fails the verifier's own parse,
    so the widened sink field cannot reroute a verifier round through the UI
    vocabulary; `aggregate`'s exit code is unchanged by any `verdict` value.
14. A red `ui-reviewer` under `blocking` leaves the tip commit without a
    `Noldor-Reviewed-Subagent` receipt; a `pass`, a `not-applicable`, and an
    advisory `fail` all leave the receipt earned.

## Risks / trade-offs

- **Pencil capability is environmental.** Consumers on codex/opencode reviewers and
  CI runners get `cannot-review`. Advisory default keeps that from being a wall; the
  per-role runner pin is the remedy. No pre-dispatch probe exists because the
  parent cannot see the child's MCP surface.
- **`cannot-review` is a green under advisory.** Deliberate: `verdict` and `reason`
  carry the truth, and a lane that reds on an absent optional tool trains overrides.
- **No degraded prose-only review.** A pencil-less run reviews nothing rather than
  reviewing the spec's Design section — a sink can never carry design findings that
  were not derived from the design.
- **Scratch copy costs fidelity for safety.** The child reviews a copy, so a `.pen`
  that only opens correctly in place would fail as `pen-unreadable`. Accepted: the
  alternative is handing the editor's write API a tracked file mid-review.
- **Working-tree read, not `git show`.** The lane copies the `.pen` from its on-disk
  path, so an uncommitted edit is what gets reviewed. Correct at Step 4 (the archive
  move is committed by then), and pencil opens files, not blobs.
- **U5b is prompt-enforced.** A normative/non-normative list bounds a chatty model
  far better than "material difference" did, but it is still prose. Advisory default
  and the evidence requirement bound the damage.
- **Union-shaped sink verdict** touches a shared schema. Additive, with each lane's
  dispatch parser accepting only its own vocabulary, so every existing sink parses
  and no lane gains a verdict it cannot produce.

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

Sink: `.noldor/cr/<slug>-code-ui-reviewer.json`. Read `verdict` before `blockers`:
`not-applicable` means the round had no UI to review, `cannot-review` means no
comparison happened and `reason` says which class. Flip `uiReviewMode` to
`blocking` once your reviewer runners are pencil-capable.

## Open questions (resolved)

1. *How does the lane get design structure out of an encrypted `.pen`?*
   -> The dispatched child opens it via pencil MCP `execute({ filePath })`, against
   a scratch copy; Node resolves only the path (D1). One artifact, no digest to drift.
2. *What happens when the child cannot open the `.pen`?*
   -> `cannot-review`, no substitute review (D2). A degraded prose-only pass would
   put design findings in a sink that never saw the design.
3. *Which `.pen` is the review object?*
   -> The feature `.pen`'s in-scope `FINAL:` pages only (D3). The baseline is
   rewritten from the as-built UI before this lane runs, so it cannot judge it.
4. *Spec-time verdict or recomputed?*
   -> Recomputed from the change under review, against the whole feature rather than
   the prompt range (D4). The marker holds a prediction; the diff is the fact.
5. *Blocking or advisory, and a UI change with no design at all?*
   -> Advisory default with a `uiReviewMode` knob; no-`.pen` is `cannot-review`,
   waived and non-UI are `not-applicable` (D5). Adoption must not red a pipeline.
6. *Lane and role naming?*
   -> `ui-reviewer` for both (D6), matching the role-routed convention and letting a
   consumer route this lane to a pencil-capable runner independently of `reviewer`.
7. *Output contract, and where does `cannot-review` live?*
   -> A lane-owned discriminated union; the sink `verdict` field becomes a union of
   both vocabularies (D7). Widening the verifier's own enum would reroute verifier
   rounds; a first-class value beats a sentence in `summary`.
8. *What stops the reviewer from editing the design it reviews?*
   -> Scratch copy plus a post-dispatch `git diff --quiet` assertion (D8). pencil
   `execute` is a write API and prose is not a permission boundary.
9. *Which `.pen` properties are normative?*
   -> Hierarchy, inventory, copy, interactivity and authored states; geometry,
   spacing, color, type and motion only where annotated (D9). Without this the
   review is a taste argument.
