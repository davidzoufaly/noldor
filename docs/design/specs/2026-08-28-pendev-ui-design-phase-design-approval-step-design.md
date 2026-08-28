# Design Approval Step Before Implementation — Design

**Slug:** pendev-ui-design-phase-design-approval-step
**FD:** docs/features/pendev-ui-design-phase.md
**Date:** 2026-08-28
**Tier:** specs-only
**Deps:** pendev-ui-design-phase (Q-0144), pencil-bridge wake (Q-0179)

## Problem

The `.pen` lifecycle has no approval seam. [`/noldor-spec`](../../../.claude/skills/noldor-spec/SKILL.md) step 1.5 seeds a feature `.pen`, drafts variants as pages and marks one `FINAL:<surface>:` winner per affected surface — but nothing records that an operator ever agreed to the winner. The spec-stage CR round cannot supply that: `.pen` is encrypted, pencil MCP is its only reader ([pen-bridge.ts](../../../src/design/pen-bridge.ts)), and the `reviewer` / `codex` lanes read the prose diff. The Step 2.5 continue-dialog approves the **spec**, not the design. The `FINAL:` marking is therefore the agent's own assertion, unwitnessed, and implementation proceeds against it.

Today's step 1.5 **Record** bullet does already require the chosen variant and its alternatives to be named in `## Design`. That is not a fix and must not be mistaken for one: it records *what the agent selected*, in language identical to what an unapproved run would produce. Nothing in the artifact distinguishes a design an operator ratified from one nobody ever saw.

One premise in the roadmap entry does not survive contact with the code. The entry says the design artifact "goes straight to `docs/design/ui/archive/` — archived before anyone confirmed the design". It does not: [`design archive`](../../../src/design/archive-cli.ts) runs at gate **Step 4**, at ship time, well after the spec stage and after implementation. There is no premature move to reorder. What is missing is only the confirmation.

## Goals

- A UI-bearing session puts the chosen design in front of the operator — as pages in the editor, not as a list of page names — and takes an explicit verdict before implementation begins.
- The spec's `## Design` prose states that the operator approved the named variant, in terms an unapproved run could not produce.
- Non-UI sessions and waived sessions are untouched — no new prompt, no new failure.
- No new artifact kind, no new CLI, no new gate, and no change to `/noldor-gate`.

## Non-goals

- Any persisted approval record — no sidecar file, no commit trailer, no FD frontmatter field.
- Any machine-checkable enforcement of the verdict (see D3 for what that costs).
- Any edit to `/noldor-gate`, `design archive`, `checks ui-design-freshness`, or the `ui-reviewer` lane.
- Verifying the design's *content*. Node cannot read `.pen`; comparing implemented UI to the design is already `ui-reviewer` (Q-0145) and render-compare (Q-0146).

## Design

### D1 — The verdict is a conversation, and the spec is its trace

There is no approval artifact. The verdict is an explicit operator answer at the design step, and the durable trace is one sentence the spec must carry: `## Design` states, **per affected surface, that the operator approved the named final variant over the named alternatives**. That is a semantic requirement, not a wording one — but it is what separates this from the status quo, where `## Design` records only which variant the agent picked. A run that never asked cannot honestly produce that sentence.

Both mechanical homes are closed anyway: `.noldor/session.json` and `.noldor/design/` are gitignored ([.gitignore:15,23](../../../.gitignore#L15)), so a marker field or a ledger entry would die with the worktree. The alternatives that *would* reach `main` — a `<stem>.approval.json` sidecar, a `Noldor-Design-Approved` commit trailer, an FD frontmatter field — each buy machine-checkability at the price of a new artifact kind for the archive resolver and garden to learn, or a trailer that re-earns on every amend. For a verdict whose whole content is "the operator looked and said yes", that price is not worth paying.

### D2 — Where the seam sits in the flow

Entirely inside `/noldor-spec` step 1.5. Nothing at the gate changes.

That branch currently carries seven bullets — Zero affected surfaces / Assert the write target / Seed / Iterate / Record / Wake the bridge / Editor unavailable — of which **Record is the fifth**. The verdict bullet is appended as the **eighth and last**, after **Editor unavailable**, not inserted after Record: the final two bullets are cross-cutting fallbacks rather than sequential steps, so appending keeps the sequential Seed → Iterate → Record → Approve reading intact and puts the verdict below the waiver bullet that exempts a session from ever reaching it.

The bullet's contract, in order:

1. **Re-read, don't recall.** Confirm via `get_app_state` that exactly one `FINAL:<surface>:` page exists per affected surface, reading the `.pen` rather than session memory.
2. **Show the pages, not their names.** Open the `.pen` in the editor (`pnpm noldor design pen-bridge`) so the operator sees the winner and the alternatives rendered. Listing page names in chat does not satisfy this — it would recreate the unwitnessed-selection problem in new clothing.
3. **Take one atomic verdict** over the whole `FINAL:` set — approve / revise. Approval is not per surface: a multi-surface feature is approved as one design or not at all, which keeps the state space at two values and avoids a partial-approval state the prose would then have to track per surface.
4. **`revise`** reopens the iteration loop and re-presents the entire set when it settles again.
5. **Bounded at two revise rounds**, mirroring `AUTOFIX_ROUND_CAP = 2` and the gate's bounded re-round rule. At the cap the operator may **approve with reservations**, recorded in `## Design` alongside the reservation — an operator loop with no ceiling self-feeds, and every other operator loop in this framework is bounded for that reason.

Gate Step 2.5 was considered as a second surface and rejected. Its detailed spec summary is gated on `specs-only-*` ([`.claude/skills/noldor-gate/SKILL.md:150`](../../../.claude/skills/noldor-gate/SKILL.md)), so `full-*` would get no surface at all; and "withhold `proceed` when the design is unnamed" has no legal exit, since adding a prompt is out of scope and `address-blockers` has no lane finding to fix — leaving `abort` as the only move, against the same skill's own invariant that `proceed` stays available at every point. Dropping it also halves the change surface, which is R2's stated risk.

### D3 — Enforcement: what "cannot reach the code stage" means

No check, no CLI, no `pre-push` job. With the verdict living in conversation, nothing on disk distinguishes an approved design from an unapproved one, so any gate would have to grep the spec's prose — brittle, and it pins wording, which is the failure the spec skill's own acceptance-criteria rule warns against.

This is a real reduction against the roadmap entry, which states its deletion test as an impossibility ("a UI-bearing session **cannot** reach the code stage without a recorded design verdict"). This design does not deliver that. It delivers the question, in the right place, with an approval sentence written into the spec — the same class of guarantee as Step 2.5's "no `proceed-without-review` option", which is prose precisely because the hole it closes is a controller that never invokes the machinery at all. Saying this plainly is part of the deliverable; a spec that implied a gate here would be describing something that is not being built.

### D4 — Session-state precedence

`uiVerdict` and `uiWaiver` are independent fields and **do coexist**: step 1.5 writes the verdict before the `required` branch runs, which is why [`ui-design-resolve.ts`](../../../src/cr/lanes/ui-design-resolve.ts) tests `session.uiWaiver` first. The verdict bullet keys on `uiVerdict === 'required' && !uiWaiver`.

| Session state | `.pen` exists | Approval asked | Trace required in `## Design` |
| --- | --- | --- | --- |
| `uiVerdict: skip` | no | no | no |
| `uiVerdict: required`, no waiver | yes | **yes** | **yes** — approval sentence per surface |
| `uiVerdict: required` + `uiWaiver` | no | no | the existing waiver note only |

A waiver is not a third verdict and not a rejection. It is the pre-existing editor-unavailable escape ([session.ts](../../../src/core/session.ts)): no `.pen` was produced, so there is nothing to approve, and the session's baseline debt is already recorded by the waiver itself.

### D5 — Archival is untouched

`design archive` already runs at gate Step 4 and already moves the feature `.pen` into `docs/design/ui/archive/` alongside the spec, repointing `links.design` ([archive-cli.ts](../../../src/design/archive-cli.ts)). Because the approval sentence lives in the spec body, and the spec archives in the same staged change as the `.pen`, the approval is attached to the archived design for free. No code changes here.

### D6 — Surfaces changed

Prose only, in two files: `.claude/skills/noldor-spec/SKILL.md` (step 1.5, the appended verdict bullet) and its byte-identical `templates/` twin. `checks template-sync` enforces the twin, so the edit lands twice or the push is refused. Editing `.claude/skills` from a worktree requires `NOLDOR_ALLOW_SHARED=1`.

## Acceptance criteria

1. On a `uiVerdict: required` session with no `uiWaiver`, step 1.5 re-reads the `FINAL:<surface>:` pages from the `.pen` via `get_app_state` and opens the file in the editor before asking, and does not conclude until the operator answers approve or revise.
2. The verdict is atomic over the whole `FINAL:` set; `revise` reopens the iteration loop and re-presents every affected surface.
3. After two revise rounds the operator can approve with reservations, and the reservation is written into `## Design`.
4. `## Design` states, per affected surface, that the operator approved the named final variant over the named alternatives.
5. On a `uiVerdict: skip` session, step 1.5 asks nothing new and writes nothing new.
6. A session carrying `uiWaiver` is exempt even though its `uiVerdict` is `required`.
7. `/noldor-gate` is unchanged — no new prompt, no new assertion, no diff to either its live file or its twin.
8. `.claude/skills/noldor-spec/SKILL.md` stays byte-identical to its `templates/` twin (`pnpm noldor checks template-sync` green).
9. No file under `src/` changes, and no new CLI subcommand or check is registered.

## Verification

No automated test can observe a conversational contract, so the evidence is a scripted walkthrough in a consumer repo that declares `uiPaths` (charuy). Each scenario names its observable outcome:

- **required → approve** — pages opened in the editor; `## Design` carries an approval sentence per surface.
- **required → revise → approve** — the whole `FINAL:` set is re-presented, not just the changed surface.
- **required → revise ×2 → approve-with-reservations** — the reservation appears in `## Design`.
- **skip** — no prompt, no `.pen`, `## Design` unchanged in shape.
- **waiver** — no prompt; the existing waiver note is the only trace.
- **multi-surface** — one verdict covers every affected surface; no per-surface partial state appears.

`checks template-sync` green and an empty `git diff` on `.claude/skills/noldor-gate/SKILL.md` cover criteria 7–9 mechanically.

## Risks / trade-offs

- **R1 — Unenforceable by construction.** The roadmap entry's deletion test asks for an impossibility; this ships a question and a prose requirement. A controller that skips the step leaves nothing behind that anything looks for. Accepted deliberately (D1, D3); the honest scope is "the operator is asked", not "the operator cannot be bypassed".
- **R2 — Prose in the framework's busiest design surface.** `/noldor-spec` step 1.5 is already the longest branch in the skill, and every added paragraph competes for controller attention. Mitigated by appending one bullet to one skill after dropping the gate-side edit — half the surface originally drafted.
- **R3 — No exercise in self-host.** Noldor declares no `consumer.uiPaths` and has no `docs/design/ui/`, so every session here resolves to `skip` and the new bullet never fires. First real exercise is a consumer (charuy); the Verification scenarios above have to run there.
- **R4 — The verdict is a look, not a fact.** The cheap half is closed: D2 requires the pages to be re-read from the `.pen` and opened in the editor, so what is shown is what the file holds. The expensive half remains — nothing verifies that the spec's named variant matches the approved page, and the operator is still approving what the agent renders rather than pixels a check compared.

## User Story

As an operator shipping a UI-bearing feature through the gate, I want to see the chosen `.pen` design opened in the editor and be asked to approve it while its variants are still on screen, so that implementation never starts against a design nobody agreed to and the archived spec records that I approved that variant over the alternatives.

## Usage

- Automatic, on UI-bearing sessions only: at `/noldor-spec` step 1.5, once one `FINAL:<surface>:` page is marked per affected surface, the skill re-reads the pages, opens the `.pen` in the editor and asks approve / revise.
- `revise` reopens the variant loop; after two rounds, approve-with-reservations is available and the reservation is recorded.
- The approval, the chosen variant and its alternatives are written into the spec's `## Design` section, which commits with the spec at gate Step 2.5 and archives beside the `.pen` at Step 4.
- Nothing to run, configure or check. A repo with no `consumer.uiPaths` never sees the step.

## Open questions (resolved)

1. *Where does the approval record live, given `.noldor/session.json` and `.noldor/design/` are both gitignored?* -> **nowhere — the verdict is chat-only, and an explicit approval sentence in `## Design` is its trace** (D1). Rationale: every persisted option adds an artifact kind or a trailer to keep consistent, for a verdict whose whole content is an operator's yes.
2. *Does enforcement belong at first-edit, at ship, or nowhere?* -> **nowhere** (D3). Rationale: chat-only approval leaves nothing for a check to read; the remaining options either grep prose or verify that an artifact exists rather than that it was approved.
3. *Which prose surface carries the question?* -> **`/noldor-spec` step 1.5 alone** (D2). Rationale: the gate's spec summary fires only on `specs-only-*`, and withholding `proceed` there has no legal exit; dropping it halves the change surface for a guarantee the same controller would have written anyway.
4. *Is approval atomic or per surface?* -> **atomic** (D2). Rationale: two states instead of a partial-approval space the prose would have to track per surface; the cost is re-presenting every surface after a revise.
5. *Can `uiVerdict: required` and `uiWaiver` coexist, and which wins?* -> **they coexist; the waiver wins** (D4). Rationale: step 1.5 writes the verdict before the branch runs, which is precisely why `ui-design-resolve.ts` tests the waiver first.
6. *Does the archive move need reordering, as the entry asks?* -> **no** (D5). Rationale: `design archive` already runs at Step 4 — the entry's premise was wrong, and the approval attaches to the archived design through the spec for free.
7. *Should a rejection be recorded?* -> **no** (D2). Rationale: a design that is not approved is being revised; a persisted rejection would read to a later reader as a decision rather than a discarded draft.
