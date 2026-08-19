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
   - **Seed:** create `docs/design/ui/<date>-<dialogue-key>.pen`; for each affected surface, copy its pages from `docs/design/ui/baseline/<surface>.pen` via pencil MCP, naming them `BASE:<surface>: <name>`. Empty/missing baseline ⇒ start blank and say so.
   - **Iterate:** draft 2–3 candidate variants as pages during the clarify dialogue; converge with the operator; mark exactly one winner `FINAL:<surface>: <name>` per affected surface (page-name check happens here, in-session — the CLI cannot read `.pen`).
   - **Record:** name the chosen variant + considered alternatives in the spec's Design section; link the `.pen` path in the spec; set FD `links.design`.
   - **Editor unavailable:** stop for an explicit operator waiver — record it in the session marker (`uiWaiver: { reason, at }`) and in spec prose; never write the FD `design:` field. A waived session produces no `.pen` and no `links.design`.
   The `.pen` commits WITH the spec at gate Step 2.5 (same commit). The approved artifact is never edited afterwards; as-built drift lands in the baseline at gate Step 4.
2. **Scope check.** If the request spans multiple independent subsystems, say so before refining details and help decompose; spec the first sub-project only.
3. **Clarify — with the design state rendered inline every time.** Ask questions ONE per message, multiple-choice preferred. Stop when purpose, constraints, and success criteria are clear. Don't re-ask what the roadmap entry or FD body already answers — confirm it instead.

   The operator must never answer blind. Run this loop for every question:
   - **Seed once, before question 1** (dialogue slug = the feature slug on `*-new`, `<parent>-<enhancement>` on `*-attach` — the same key that names the spec file). One `--support` per anchor you found while grounding; `--entry` only when the roadmap entry slug differs from the dialogue slug (attach paths):
     `pnpm noldor design log --slug <dialogue-slug> --entry <roadmap-slug> --support "src/foo.ts:12 — already does X"`
   - **Before every question**, render the state and paste stdout verbatim, inside a fenced code block, immediately above the question — so the question is the last thing read:
     `pnpm noldor design context --slug <dialogue-slug>`
   - **After every answer**, record it before asking the next thing (repeatable flags; one call can resolve a thread and record the decision it became):
     `pnpm noldor design log --slug <dialogue-slug> --resolve O2 --decide "chose X because Y" --open "new thread this raised"`

   Flag names are exact — `--support`, not `--existing-support`. The block renders Scope, Decided, Open, Existing support, uncapped. Never hand-edit the ledger at `.noldor/design/<slug>.md`: the writer fails closed on a file it cannot parse.
4. **Approaches.** Present 2-3 approaches with trade-offs. Lead with your recommendation and why.
5. **Design in sections.** Write each section into the spec file on disk as it stabilizes (don't hold the draft only in chat) and give the operator a clickable markdown link to the file with every section check-in; after each section ask whether it looks right before continuing. Cover architecture, units (one purpose each, clear interfaces, independently testable), data flow, error handling, testing. YAGNI ruthlessly.
6. **Write the spec.** Run `pnpm noldor prep format spec` and structure the document exactly per the printed contract. Save to `docs/design/specs/YYYY-MM-DD-<slug>-design.md` (attach paths: `YYYY-MM-DD-<parent>-<enhancement>-design.md`).
7. **Self-review, fix inline:** placeholder scan (TBD/TODO/vague requirements), internal contradictions, scope (single implementation plan's worth?), ambiguity (a requirement readable two ways → pick one, state it).
8. **Report the artifact path as a clickable markdown link and stop.** Re-link the spec in every later prompt or summary that references it. The gate owns what happens next (Step 2.5: lint → commit → CR lanes → continue dialog). Do not chain into planning or implementation.

## Rules

- One question per message — never a wall of questions.
- Acceptance criteria pin behavior, not phrasing — state observable outcomes (exit code, file written, signal emitted), never exact wording of messages or prose structure, which turns every reword into a drift finding.
- Budget ~12 acceptance criteria. More usually means the spec bundles concerns or pins details; collapse per-detail criteria into behavior-level ones or split the scope (the gate's `split-check --spec` flags >20).
- Never write review-history meta-narrative into the artifact — no "as flagged in round N", no reviewer-dialogue recaps, no self-references to the spec's own revision process. Pure liability surface that later rounds re-flag.
- In existing code, follow existing patterns; include targeted improvements only where existing problems affect the work.
- Open questions section: answer your own questions with a recommendation and a one-line rationale; the operator ratifies rather than originates.
- The operator's explicit instructions always override this skill.
