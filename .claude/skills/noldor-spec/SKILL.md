---
name: noldor-spec
description: Dialogue an idea into an approved design spec. Use at the gate's spec stage (specs-only-* and full-* paths) or standalone when exploring a feature idea. Question-first loop; writes the spec per `pnpm noldor prep format spec`.
user_invocable: true
---

# /noldor-spec

Turn an idea into a reviewed design document through collaborative dialogue. No implementation action — no code edits, no scaffolding, no skill chaining — before the operator approves the design. "Simple" tasks get the same treatment; the design may be three sentences, but it gets presented and approved.

## Flow

1. **Ground yourself.** Read `docs/vision.md`, the FD at `docs/features/<slug>.md` when one exists, and the real code, docs, and tests the idea touches. Cite actual file paths and symbols in the design — a spec that references no real code is a failure.
1.5. **UI design step (predicate-gated).** Compute the UI verdict: candidate paths = the roadmap entry's `Touches:` values ∪ the FD's `links.code` (glob values expanded per `src/core/ui-predicate.ts` semantics), config = `consumer.uiPaths`/`uiSurfaces`, FD `design:` override absolute both ways. Write the verdict to the session marker (`uiVerdict`, `uiVerdictPaths`). On `skip`: add one line to the spec ("UI verdict: skip — <reason>") and continue to step 2 — nothing else. On `required`:
   - **Zero affected surfaces OR any unmapped paths ⇒ do not proceed:** prompt the operator to extend `uiPaths`/`uiSurfaces` (config edit rides the branch) or accept the implicit `app` surface; the step refuses to conclude while the surface set is empty or the verdict's `unmappedPaths` is non-empty — a partially-mapped verdict would leave those paths outside every baseline.
   - **Assert the write target before every pencil write — a wrong `filePath` is a silent write, not an error.** `execute` routes by `filePath` only while that file exists; a path that does not (a typo, a worktree-relative path, a file Node never created because `.pen` is encrypted) falls back to whatever canvas the app currently has open, and the write lands there with no diagnostic. Call `get_app_state` first and confirm the open document is the `.pen` you are about to write; when it is not, open the intended file (`pnpm noldor design pen-bridge`, or `code <file>.pen`) and re-check rather than trusting the argument. Skipping this once cost a baseline four pages (Q-0187): the session held a worktree path, the app held a baseline `.pen` under `docs/design/ui/baseline/`, and the edit landed on that baseline. The `checks shared-files` `.pen` guard rejects that class at commit time, but only after the write — the assertion is what prevents it.
   - **Seed:** create `docs/design/ui/<date>-<dialogue-key>.pen`; for each affected surface, copy its pages from `docs/design/ui/baseline/<surface>.pen` via pencil MCP, naming them `BASE:<surface>: <name>`. Empty/missing baseline ⇒ start blank and say so.
   - **Iterate:** draft 2–3 candidate variants as pages during the clarify dialogue; converge with the operator; mark exactly one winner `FINAL:<surface>: <name>` per affected surface (page-name check happens here, in-session — the CLI cannot read `.pen`).
   - **Record:** name the chosen variant + considered alternatives in the spec's Design section; link the `.pen` path in the spec; set FD `links.design`.
   - **Wake the bridge before you conclude the editor is unavailable.** `.pen` is encrypted and pencil MCP is its only reader; every MCP call fails with `A file needs to be open in the editor` until *some* `.pen` is open in a running VS Code Pencil tab (extension `highagency.pencildev` — the default editor, because `code <file>.pen` is scriptable; the pencil desktop app satisfies MCP too but has to be opened by hand). That is a liveness gate, not a per-file lock: once any file is open, `execute` reaches any `.pen` by `filePath`. Run `pnpm noldor design pen-bridge` — it finds a tracked `.pen` and opens it (exit 1 = the repo tracks none, so the editor must author one; Node cannot write an encrypted `.pen`) — then retry the call.
   - **Editor unavailable:** only after the wake attempt above, stop for an explicit operator waiver — record it in the session marker (`uiWaiver: { reason, at }`) and in spec prose; never write the FD `design:` field. A waived session produces no `.pen` and no `links.design`. A closed editor and an absent editor look identical from Node, so waiving without the wake attempt buys permanent baseline debt for a fixable problem.
   The `.pen` commits WITH the spec at gate Step 2.5 (same commit). The approved artifact is never edited afterwards; as-built drift lands in the baseline at gate Step 4.
2. **Scope check.** If the request spans multiple independent subsystems, say so before refining details and help decompose; spec the first sub-project only.
2.5. **Draft-first — write the strawman before you ask anything.** Run `pnpm noldor prep format spec` and write a first-pass skeleton to the real spec path (`docs/design/specs/YYYY-MM-DD-<slug>-design.md`, attach paths `YYYY-MM-DD-<parent>-<enhancement>-design.md`) with **every** contract section present, each one a short honest paragraph that names its own unknowns inline. Use H3 unit headings inside `## Design` — that H2 is fixed by the contract and is where most decisions land, so its H3s are what questions actually address.

   Say plainly that it is a strawman, every time you present it. It is expected to be partly wrong; it exists so the operator reacts to prose instead of ratifying a one-line answer. An operator who reads it as a claim will spend the dialogue correcting it, which is slower than asking nothing.
3. **Clarify — every question beneath the draft it concerns.** Ask questions ONE per message, multiple-choice preferred. Stop when purpose, constraints, and success criteria are clear. Don't re-ask what the roadmap entry or FD body already answers — confirm it instead.

   The operator must never answer blind. Run this loop for every question:
   - **Seed once, before question 1** (dialogue slug = the feature slug on `*-new`, `<parent>-<enhancement>` on `*-attach` — the same key that names the spec file). One `--support` per anchor you found while grounding; `--entry` only when the roadmap entry slug differs from the dialogue slug (attach paths):
     `pnpm noldor design log --slug <dialogue-slug> --entry <roadmap-slug> --support "src/foo.ts:12 — already does X"`
   - **Before every question**, name the heading the question is about and render the state for it, pasting stdout verbatim inside a fenced code block immediately above the question — so the question is the last thing read:
     `pnpm noldor design context --slug <dialogue-slug> --section "<H2 or H3 name>"`
   - **After every answer**, record it with its reasoning before asking the next thing:
     `pnpm noldor design log --slug <dialogue-slug> --resolve O2 --decide "chose X" --because "<why X beats the alternatives>" --instead-of "<what was rejected and why not>" --section "<heading>" --open "new thread this raised"`
   - **Then update the drafted section on disk** to reflect the answer, so the next question renders against prose that already carries it.

   The block is a digest, not a dump: the heading under discussion renders its current draft in full plus the decisions bound to it with their reasoning, and everything else collapses to one line with a `(+why)` / `(+2 more)` marker naming what was withheld. `--full` expands the lot; `--spec <path>` names the artifact when the slug does not resolve to one file; `--kind plan` switches contracts. A `⚠` line flags any tag or confirmation that no longer matches a heading. Flag names are exact — `--support`, not `--existing-support`; `--because` takes exactly one `--decide`. Never hand-edit the ledger at `.noldor/design/<slug>.md`: the writer fails closed on a file it cannot parse.
4. **Approaches.** Present 2-3 approaches with trade-offs. Lead with your recommendation and why.
5. **Section-by-section confirmation.** Walk the contract sections in order. For each one, bring its prose up to **one to two paragraphs** that say how the thing will actually work — the product and technical choices, named, while they are still cheap to change — then give the operator a clickable markdown link to the spec file and ask whether that section is right. A one-line section gives the operator nothing to judge; that is the failure this step exists to prevent.

   On the operator's yes: `pnpm noldor design log --slug <dialogue-slug> --confirm-section "<heading>"`. That records the heading with a digest of the body they approved, so the checklist marks it `✓` and re-marks it `✎` if the prose changes afterwards — which survives a context compaction, unlike a yes in chat. Re-run `--confirm-section` after an edit to re-confirm, `--unconfirm-section` to withdraw. Nothing is gated on it: a section can be confirmed in one line when it genuinely is one line, and the operator can always say "skip the rest, write it".

   Cover architecture, units (one purpose each, clear interfaces, independently testable), data flow, error handling, testing. YAGNI ruthlessly.
6. **Finish the spec.** The file already exists from step 2.5; bring it fully in line with the `pnpm noldor prep format spec` contract and make sure every confirmed section still reads the way the operator approved it.
7. **Self-review, fix inline:** placeholder scan (TBD/TODO/vague requirements), internal contradictions, scope (single implementation plan's worth?), ambiguity (a requirement readable two ways → pick one, state it).
8. **Report the artifact path as a clickable markdown link and stop.** Re-link the spec in every later prompt or summary that references it. The gate owns what happens next (Step 2.5: lint → commit → CR lanes → continue dialog). Do not chain into planning or implementation.

## Rules

- One question per message — never a wall of questions.
- Every question declares the heading it is about, and renders that heading's current draft above itself. A question with no `--section` is a question the operator answers blind.
- Record the reasoning with the decision, not just the answer. `--decide` without `--because` produces exactly the un-auditable one-liner this loop exists to replace.
- Acceptance criteria pin behavior, not phrasing — state observable outcomes (exit code, file written, signal emitted), never exact wording of messages or prose structure, which turns every reword into a drift finding.
- Budget ~12 acceptance criteria. More usually means the spec bundles concerns or pins details; collapse per-detail criteria into behavior-level ones or split the scope (the gate's `split-check --spec` flags >20).
- Never write review-history meta-narrative into the artifact — no "as flagged in round N", no reviewer-dialogue recaps, no self-references to the spec's own revision process. Pure liability surface that later rounds re-flag.
- In existing code, follow existing patterns; include targeted improvements only where existing problems affect the work.
- Open questions section: answer your own questions with a recommendation and a one-line rationale; the operator ratifies rather than originates.
- The operator's explicit instructions always override this skill.
