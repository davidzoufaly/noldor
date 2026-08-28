# Design Approval Step Before Implementation — Design

**Slug:** pendev-ui-design-phase-design-approval-step
**FD:** docs/features/pendev-ui-design-phase.md
**Date:** 2026-08-28
**Tier:** specs-only
**Deps:** pendev-ui-design-phase (Q-0144), pencil-bridge wake (Q-0179)

## Problem

The `.pen` lifecycle has no approval seam. [`/noldor-spec`](../../../.claude/skills/noldor-spec/SKILL.md) step 1.5 seeds a feature `.pen`, drafts variants as pages and marks one `FINAL:<surface>:` winner per affected surface — but nothing records that an operator ever agreed to the winner. The spec-stage CR round cannot supply that: `.pen` is encrypted, pencil MCP is its only reader ([pen-bridge.ts](../../../src/design/pen-bridge.ts)), and the `reviewer` / `codex` lanes read the prose diff. The Step 2.5 continue-dialog approves the **spec**, not the design. The `FINAL:` marking is therefore the agent's own assertion, unwitnessed, and implementation proceeds against it.

One premise in the roadmap entry does not survive contact with the code. The entry says the design artifact "goes straight to `docs/design/ui/archive/` — archived before anyone confirmed the design". It does not: [`design archive`](../../../src/design/archive-cli.ts) runs at gate **Step 4**, at ship time, well after the spec stage and after implementation. There is no premature move to reorder. What is missing is only the confirmation.

## Goals

- A UI-bearing session puts the chosen design in front of the operator and takes an explicit verdict before implementation begins.
- The durable trace of that verdict is the spec's own `## Design` prose, which is already committed and already archived beside the `.pen`.
- Non-UI sessions and waived sessions are untouched — no new prompt, no new failure.
- No new artifact kind, no new CLI, no new gate.

## Non-goals

- Any persisted approval record — no sidecar file, no commit trailer, no FD frontmatter field.
- Any machine-checkable enforcement of the verdict (see D3 for what that costs).
- Any change to `design archive`, `checks ui-design-freshness`, or the `ui-reviewer` lane.
- Verifying the design's *content*. Node cannot read `.pen`; comparing implemented UI to the design is already `ui-reviewer` (Q-0145) and render-compare (Q-0146).

## Design

### D1 — The verdict is a conversation, and the spec is its trace

There is no approval artifact. The verdict is an explicit operator answer at the design step, and the only thing that outlives the session is the sentence the spec already owes: `/noldor-spec` step 1.5's **Record** bullet requires the chosen variant and the considered alternatives to be named in `## Design`. That prose is committed with the spec at gate Step 2.5 and archived beside the `.pen` at Step 4, so the trail exists without inventing a second record.

Both mechanical homes are closed anyway: `.noldor/session.json` and `.noldor/design/` are gitignored ([.gitignore:15,23](../../../.gitignore#L15)), so a marker field or a ledger entry would die with the worktree. The alternatives that *would* reach `main` — a `<stem>.approval.json` sidecar, a `Noldor-Design-Approved` commit trailer, an FD frontmatter field — each buy machine-checkability at the price of a new artifact kind for the archive resolver and garden to learn, or a trailer that re-earns on every amend. For a verdict whose whole content is "the operator looked and said yes", that price is not worth paying.

### D2 — Where the seam sits in the flow

`/noldor-spec` step 1.5's `required` branch currently carries seven bullets — Zero affected surfaces / Assert the write target / Seed / Iterate / Record / Wake the bridge / Editor unavailable — of which **Record is the fifth**. The verdict bullet is appended as the **eighth and last**, after **Editor unavailable**, not inserted after Record: the final two bullets are cross-cutting fallbacks rather than sequential steps, so appending keeps the sequential Seed → Iterate → Record → Approve reading intact and puts the verdict below the waiver bullet that exempts a session from ever reaching it.

The bullet reads: once exactly one `FINAL:<surface>:` page exists per affected surface, re-read the pages from the file via `get_app_state` rather than from session memory, confirm exactly one `FINAL:<surface>:` per affected surface, then present the winner and the alternatives and take an explicit verdict — approve / revise. `revise` returns to the iteration loop and re-presents; there is no third state, because a design that is neither approved nor being revised is just an unanswered question. The question sits here rather than later for one reason: this is the only point in the flow where the variants are actually on screen.

Gate Step 2.5 gains **no new prompt**. Its existing detailed-spec-summary bullet — the one that already renders Scope / Files touched / Acceptance criteria / Deferred risks before the continue-dialog on `specs-only-*` — grows one line: on a session whose `uiVerdict` is `required` **and which carries no `uiWaiver`**, the summary must name the approved design.

The waiver term in that predicate is load-bearing, not defensive. Step 1.5 writes `uiVerdict` *before* the `required` branch runs, so a waived session carries **both** `uiVerdict: required` and `uiWaiver` — which is exactly why [`ui-design-resolve.ts`](../../../src/cr/lanes/ui-design-resolve.ts) tests `session.uiWaiver` first. Keying on the verdict alone would leave every waived UI session facing a summary that can never name a design. Step 2.5 is already the most prompt-dense seam in the gate; an assertion inside prose the controller already prints costs nothing and still gives the gate something to refuse on.

The waiver path is unchanged and is not a third verdict: a session that waived the design step under `uiWaiver` ([session.ts](../../../src/core/session.ts)) has no `.pen` to approve, so there is nothing to ask about.

### D3 — Enforcement: what "cannot reach the code stage" means

No check, no CLI, no `pre-push` job. With the verdict living in conversation, nothing on disk distinguishes an approved design from an unapproved one, so any gate would have to grep the spec's prose for a `FINAL:` line — brittle, and it pins wording, which is the failure the spec skill's own acceptance-criteria rule warns against.

This is a real reduction against the roadmap entry, which states its deletion test as an impossibility ("a UI-bearing session **cannot** reach the code stage without a recorded design verdict"). This design does not deliver that. It delivers the question, in the right place, with the answer written into the spec — the same class of guarantee as Step 2.5's "no `proceed-without-review` option", which is prose precisely because the hole it closes is a controller that never invokes the machinery at all. Saying this plainly is part of the deliverable; a spec that implied a gate here would be describing something that is not being built.

### D4 — Archival is untouched

`design archive` already runs at gate Step 4 and already moves the feature `.pen` into `docs/design/ui/archive/` alongside the spec, repointing `links.design` ([archive-cli.ts](../../../src/design/archive-cli.ts)). Because the approval is recorded in the spec body, and the spec archives in the same staged change as the `.pen`, the approval is attached to the archived design for free. No code changes here.

### D5 — Surfaces changed

Prose only, in four files: `.claude/skills/noldor-spec/SKILL.md` (step 1.5, the new verdict bullet), `.claude/skills/noldor-gate/SKILL.md` (Step 2.5, one line in the detailed spec summary), and the byte-identical `templates/` twin of each. The twins are currently identical to their live counterparts and `checks template-sync` enforces that, so every edit lands twice or the push is refused. Editing `.claude/skills` from a worktree requires `NOLDOR_ALLOW_SHARED=1`.

## Acceptance criteria

1. On a `uiVerdict: required` session with no `uiWaiver`, `/noldor-spec` step 1.5 re-reads the `FINAL:<surface>:` pages from the `.pen` via `get_app_state` before presenting them, and does not conclude until the operator has answered approve or revise.
2. `revise` returns to the variant-iteration loop and the question is re-asked; it does not advance the spec.
3. The approved variant and the alternatives considered are named in the spec's `## Design` section before the spec is committed.
4. On a `uiVerdict: skip` session, step 1.5 asks nothing new and writes nothing new.
5. On a session carrying `uiWaiver`, step 1.5 asks nothing new — there is no `.pen` to approve.
6. Gate Step 2.5's detailed spec summary names the approved design on a session whose `uiVerdict` is `required` and which carries no `uiWaiver`.
6a. A session carrying `uiWaiver` is exempt from criterion 6 even though its `uiVerdict` is `required`.
7. Gate Step 2.5 fires no additional `AskUserQuestion` on any path.
8. `.claude/skills/noldor-spec/SKILL.md` and `.claude/skills/noldor-gate/SKILL.md` remain byte-identical to their `templates/` twins (`pnpm noldor checks template-sync` green).
9. No file under `src/` changes, and no new CLI subcommand or check is registered.

## Risks / trade-offs

- **R1 — Unenforceable by construction.** The roadmap entry's deletion test asks for an impossibility; this ships a question and a prose requirement. A controller that skips the step leaves nothing behind that anything looks for. Accepted deliberately (D1, D3); the honest scope is "the operator is asked", not "the operator cannot be bypassed".
- **R2 — Prose in the two hottest skills.** `/noldor-spec` and `/noldor-gate` are the framework's highest-traffic instruction surfaces, and every added paragraph competes for controller attention with everything already there. Mitigated by adding one bullet and one line rather than a section, and by putting no new prompt on Step 2.5.
- **R3 — No exercise in self-host.** Noldor declares no `consumer.uiPaths` and has no `docs/design/ui/`, so every session here resolves to `skip` and the new bullet never fires. First real exercise is a consumer (charuy). Same exposure Q-0144 already carries; there is no unit test to write for a prose change.
- **R4 — The verdict is a look, not a fact.** The cheap half is closed: D2 requires the pages to be re-read from the `.pen` via `get_app_state` before presentation, so what is shown is what the file holds rather than what session memory recalls. The expensive half remains — nothing verifies that the spec's named variant matches the approved page, and the operator is still approving what the agent describes rather than pixels it rendered.

## User Story

As an operator shipping a UI-bearing feature through the gate, I want to be asked to approve the chosen `.pen` design while its variants are still on screen, so that implementation never starts against a design nobody agreed to and the archived spec records which variant was chosen over which alternatives.

## Usage

- Automatic, on UI-bearing sessions only: at `/noldor-spec` step 1.5, once one `FINAL:<surface>:` page is marked per affected surface, the skill presents the winner plus the alternatives and asks approve / revise.
- `revise` reopens the variant loop; the question returns when the design settles again.
- The approved variant and its alternatives are written into the spec's `## Design` section, which commits with the spec at gate Step 2.5 and archives beside the `.pen` at Step 4.
- Nothing to run, configure or check. A repo with no `consumer.uiPaths` never sees the step.

## Open questions (resolved)

1. *Where does the approval record live, given `.noldor/session.json` and `.noldor/design/` are both gitignored?* -> **nowhere — the verdict is chat-only, and the spec's `## Design` prose is its trace** (D1). Rationale: every persisted option adds an artifact kind or a trailer to keep consistent, for a verdict whose whole content is an operator's yes.
2. *Does enforcement belong at first-edit, at ship, or nowhere?* -> **nowhere** (D3). Rationale: chat-only approval leaves nothing for a check to read; the remaining options either grep prose or verify that an artifact exists rather than that it was approved.
3. *Which prose surface carries the question?* -> **`/noldor-spec` step 1.5, plus a no-new-prompt assertion at gate Step 2.5** (D2). Rationale: ask where the variants are on screen; give the gate something to refuse on without adding a prompt to its busiest seam.
4. *Does the archive move need reordering, as the entry asks?* -> **no** (D4). Rationale: `design archive` already runs at Step 4, after the spec stage — the entry's premise was wrong, and the approval attaches to the archived design through the spec for free.
5. *Should a rejection be recorded?* -> **no** (D2). Rationale: the verdict is binary here — a design that is not approved is being revised, and a persisted rejection would read to a later reader as a decision rather than a discarded draft.
6. *Does `full-*` approve at spec stage or plan stage?* -> **spec stage, same bullet** (D2). Rationale: the plan decomposes a design already chosen, so a plan-stage question would gate nothing.
