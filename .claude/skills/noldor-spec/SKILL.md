---
name: noldor-spec
description: Dialogue an idea into an approved design spec. Use at the gate's spec stage (specs-only-* and full-* paths) or standalone when exploring a feature idea. Question-first loop; writes the spec per `pnpm noldor prep format spec`.
user_invocable: true
---

# /noldor-spec

Turn an idea into a reviewed design document through collaborative dialogue. No implementation action — no code edits, no scaffolding, no skill chaining — before the operator approves the design. "Simple" tasks get the same treatment; the design may be three sentences, but it gets presented and approved.

## Flow

1. **Ground yourself.** Read `docs/vision.md`, the FD at `docs/features/<slug>.md` when one exists, and the real code, docs, and tests the idea touches. Cite actual file paths and symbols in the design — a spec that references no real code is a failure.
1.5. **UI design step (predicate-gated).** Compute the UI verdict: candidate paths = the roadmap entry's `Touches:` values ∪ the FD's `links.code` (glob values expanded per `src/core/ui-predicate.ts` semantics), config = `consumer.uiPaths`/`uiSurfaces`, FD `design:` override absolute both ways. Write the verdict to the session marker (`uiVerdict`, `uiVerdictPaths`), and the pre-filter candidate set to `candidatePaths` — step 1.7 reads that, because `uiVerdictPaths` keeps only what matched `uiPaths`. On `skip`: add one line to the spec ("UI verdict: skip — <reason>") and continue to **step 1.7** — nothing else UI-related. (Never skip past 1.7: a repo with no `uiPaths` configured takes this branch on every session, so routing it to step 2 would make the structural read unreachable in exactly the repos that most need it.) On `required`:
   - **Zero affected surfaces OR any unmapped paths ⇒ do not proceed:** prompt the operator to extend `uiPaths`/`uiSurfaces` (config edit rides the branch) or accept the implicit `app` surface; the step refuses to conclude while the surface set is empty or the verdict's `unmappedPaths` is non-empty — a partially-mapped verdict would leave those paths outside every baseline.
   - **Assert the write target before every pencil write — a wrong `filePath` is a silent write, not an error.** `execute` routes by `filePath` only while that file exists; a path that does not (a typo, a worktree-relative path, a file Node never created because `.pen` is encrypted) falls back to whatever canvas the app currently has open, and the write lands there with no diagnostic. Call `get_app_state` first and confirm the open document is the `.pen` you are about to write; when it is not, open the intended file (`pnpm noldor design pen-bridge`, or `code <file>.pen`) and re-check rather than trusting the argument. Skipping this once cost a baseline four pages (Q-0187): the session held a worktree path, the app held a baseline `.pen` under `docs/design/ui/baseline/`, and the edit landed on that baseline. The `checks shared-files` `.pen` guard rejects that class at commit time, but only after the write — the assertion is what prevents it.
   - **Seed:** create `docs/design/ui/<date>-<dialogue-key>.pen`; for each affected surface, copy its pages from `docs/design/ui/baseline/<surface>.pen` via pencil MCP, naming them `BASE:<surface>: <name>`. Empty/missing baseline ⇒ start blank and say so.
   - **Iterate:** draft 2–3 candidate variants as pages during the clarify dialogue; converge with the operator; mark exactly one winner `FINAL:<surface>: <name>` per affected surface (page-name check happens here, in-session — the CLI cannot read `.pen`).
   - **Record:** name the chosen variant + considered alternatives in the spec's Design section; link the `.pen` path in the spec; set FD `links.design`.
   - **Wake the bridge before you conclude the editor is unavailable.** `.pen` is encrypted and pencil MCP is its only reader; every MCP call fails with `A file needs to be open in the editor` until *some* `.pen` is open in a running VS Code Pencil tab (extension `highagency.pencildev` — the default editor, because `code <file>.pen` is scriptable; the pencil desktop app satisfies MCP too but has to be opened by hand). That is a liveness gate, not a per-file lock: once any file is open, `execute` reaches any `.pen` by `filePath`. Run `pnpm noldor design pen-bridge` — it finds a tracked `.pen` and opens it (exit 1 = the repo tracks none, so the editor must author one; Node cannot write an encrypted `.pen`) — then retry the call.
   - **Editor unavailable:** only after the wake attempt above, stop for an explicit operator waiver — record it in the session marker (`uiWaiver: { reason, at }`) and in spec prose; never write the FD `design:` field. A session waived **before Seed** produces no `.pen` and no `links.design`; a waiver taken any time **after Seed** — the bridge died mid-iteration, or at the verdict — is covered by the verdict bullet below, which keeps the seeded `.pen` rather than orphaning it. A closed editor and an absent editor look identical from Node, so waiving without the wake attempt buys permanent baseline debt for a fixable problem.
   - **Take the operator's verdict — the design is not settled until it is given.** Runs when `uiVerdict` is `required` **and the session carries no `uiWaiver`**; a waived session has no design to ratify and skips straight past this bullet. Nothing outside this conversation distinguishes a design an operator ratified from one nobody saw, so the verdict is taken here and written down here. In order:

     (a) **Open this session's `.pen` by path first** — `pnpm noldor design pen-bridge --pen docs/design/ui/<date>-<dialogue-key>.pen`, or `code <that file>`. Order matters: `get_app_state` reports whatever canvas the app currently has open, so checking pages before opening reads some other document — the read-side twin of the Q-0187 write hazard. A **bare** `pen-bridge` is also wrong here: its candidates come from `git ls-files -- '*.pen'` (the index), and this `.pen` is untracked until gate Step 2.5, so the ranking would hand the editor a different tracked design.

     (b) **Then verify against that file.** Via `get_app_state`, confirm the open document is this session's `.pen` and that it holds exactly one `FINAL:<surface>:` page per affected surface. Zero or several means the iteration is unfinished: return to **Iterate** and come back, which costs no revise round.

     (c) **Show the pages.** Navigate to each winner and each alternative in turn, naming them as they are shown. Listing page names in chat satisfies nothing — it recreates the unwitnessed selection this bullet exists to end.

     (d) **Ask for one atomic verdict** over the whole `FINAL:` set — approve / revise. A multi-surface feature is approved as one design or not at all.

     (e) **On `revise`:** the operator says what to change, and the step returns to **Iterate**; a bare "revise" with no direction is re-asked rather than acted on and consumes no round. A revise verdict writes **no** approval sentence — it is not an approval and must never read as one.

     (f) **On `approve` only, write it:** add to the spec's `## Design`, per affected surface, that the operator approved the named final variant over the named alternatives. **Record** ran earlier and cannot assert an approval that had not happened; it names the choice, this names the ratification.

     (g) After two revise rounds, additionally offer **approve with reservations**, recording the reservation beside the approval — the bound governs what the agent must offer, not what the operator may do, so revising again stays legal. There is no rejection verdict: a design that is not approved is being revised.

     **Waiver after Seed (bridge died mid-iteration, or here at the verdict).** One rule covers both: record `uiWaiver: { reason, at }` in the session marker exactly as the Editor-unavailable bullet does — downstream [`ui-design-resolve.ts`](../../../src/cr/lanes/ui-design-resolve.ts) keys on `session.uiWaiver` to return `not-applicable`, so a waiver that lives only in prose leaves the review lane expecting a ratified design — then **keep the seeded `.pen`** and commit it with the spec, and **ensure `links.design` names it**: keep the pointer Record wrote, or set it here when the bridge died before Record ran. Never unset it. That pointer is how `design archive` finds and repoints the artifact, so clearing it would strand the `.pen` outside the archive flow; the link names a committed-but-unapproved design, and the waiver note in the spec must say so, so a later reader does not mistake an archived `.pen` for a ratified one. The FD `design:` field is still never written — it is the operator's override, not a verdict record.
   The `.pen` commits WITH the spec at gate Step 2.5 (same commit). The approved artifact is never edited afterwards; as-built drift lands in the baseline at gate Step 4. Then continue to step 1.7.
1.7. **Structural-read step (path-gated).** Skip entirely unless the session marker's `path` is `specs-only-*` or `full-*` — `fast-track` and `micro-chore` never run it, so the XS drain is untaxed. Runs here, before the strawman, so the reading informs `## Design` rather than decorating it afterwards.

   Persist the pre-filter candidate set step 1.5 already derived (`links.code` ∪ the entry's `Touches:`) to the session marker as `candidatePaths`, then read it back here. Do **not** use `uiVerdictPaths`: that key holds only the subset that matched `consumer.uiPaths`, so in a repo where `uiPaths` is unset it is empty for every session and this step would resolve nothing.

   Run `pnpm noldor design graph-context` with one `--path` per candidate and branch on the verdict it prints:

   - **`skipped`** (exit 0) — the repo tracks no graph. Write the unit as `noldor:cut no graph tracked — <what would change the answer>`; graphify is optional and a bare prose line would be flagged by the very detector this feature adds.
   - **`stale`** (exit non-zero) — run `/graphify --ast-only`, then `pnpm toon`, then retry **exactly once**. The working-tree freshness leg is what that regeneration satisfies. If the retry is still not `fresh` (graphify absent, regen failed, whatever), write the unit from whatever is available plus a `noldor:cut` naming the staleness.
   - **`fresh`** (exit 0) — read `graph.brainstorm-summary.toon` when the report says it is usable, then write `### Structural context` from the per-path digest: the communities the change lands in, any god node it defines (with its degree rank), and the cross-community edges it sits on.

   **This step never stops a session.** Advisory-with-teeth applies here as much as to the detector: at worst it records an honest skip and the dialogue continues. Two things make the unit worth writing rather than performing — name only what the digest actually shows, and say plainly when a file is interior (no god node, no bridge), which is itself a finding.

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
