---
name: noldor-spec
description: Dialogue an idea into an approved design spec. Use at the gate's spec stage (specs-only-* and full-* paths) or standalone when exploring a feature idea. Question-first loop; writes the spec per `pnpm noldor prep format spec`.
user_invocable: true
---

# /noldor-spec

Turn an idea into a reviewed design document through collaborative dialogue. No implementation action — no code edits, no scaffolding, no skill chaining — before the operator approves the design. "Simple" tasks get the same treatment; the design may be three sentences, but it gets presented and approved.

## How this skill loads

This file is a router. It holds what every spec session runs; the design procedures live in files beside it, in the skill's base directory (the path printed when the skill loaded). A fork carries one line of the form **Read now:** [`<file>`](<file>). That line is part of its step: read the named file in full at that point, before acting on the branch, and read it again if the context was compacted since. Never act on a fork from memory — its rules live only in that file.

| Session | Reads on every run | Reads only when |
| --- | --- | --- |
| any spec session | `SKILL.md` | `ui-design.md` and `pen-canvas.md` when the UI verdict is `required`; `arch-design.md` and `pen-canvas.md` when the architecture verdict is `required` |

A session whose UI and architecture verdicts both come back `skip` reads this file alone.

## Flow

1. **Ground yourself.** Read `docs/vision.md`, the FD at `docs/features/<slug>.md` when one exists, and the real code, docs, and tests the idea touches. Cite actual file paths and symbols in the design — a spec that references no real code is a failure.
1.5. **UI design step (predicate-gated).** Compute the UI verdict over **this session's own surface**, not the parent feature's. Candidate paths:

   - `*-attach`: the source roadmap block's `Touches:` values, and the parent FD's `links.code` **only when the block declares none**. Unioning the parent's `links.code` in makes an enhancement inherit `required` from files it never opens — that link list describes the feature, not this session. Q-0189 caught `agent-camera-control` matching six paths (`App.tsx`, `ViewportArea.tsx`, three `packages/viewport/src/*` files, `useMeshData.ts`), none of which adding two agent verbs had to touch; the verdict came out right, but by accident.
   - `*-new`: the entry's `Touches:` ∪ the FD's `links.code` — there is no parent FD, so the two rules coincide.

   Glob values expand per `src/core/ui-predicate.ts` semantics; config = `consumer.uiPaths`/`uiSurfaces`; FD `design:` override absolute both ways. Write the verdict to the session marker (`uiVerdict`, `uiVerdictPaths`), and — **unnarrowed on every path** — the union set (the entry's `Touches:` ∪ the FD's `links.code`) to `candidatePaths`. The two inputs differ on attach deliberately: the verdict asks what *this session* changes, while step 1.7's structural read wants the feature's whole neighbourhood. Step 1.7 reads `candidatePaths` and not `uiVerdictPaths`, because that key keeps only what matched `uiPaths`.

   On `skip`: add one line to the spec ("UI verdict: skip — <reason>") and continue to **step 1.6** — nothing else UI-related. A `skip` earned by the attach narrowing is a *prediction*, and the code-stage `ui-reviewer` lane recomputes the verdict from the real `origin/main..HEAD` diff, so an implementation that ends up editing a `uiPaths` file the block's `Touches:` never named lands on `cannot-review / no-design-artifact` with nothing recorded. When that happens, do not re-open the design stage: take it at gate Step 4 the same way the no-visual-delta bullet in `ui-design.md` does — a spec line plus `uiWaiver` when the surface is visually unchanged, or an actual `.pen` when it moved. (Never skip past 1.7: a repo with no `uiPaths` configured takes this branch on every session, so routing it to step 2 would make the structural read unreachable in exactly the repos that most need it.) On `required`: **Read now:** [`ui-design.md`](ui-design.md) — surface mapping, seeding, the coverage table and iteration — then continue to step 1.6.

1.6. **Architecture design step (baseline-gated).** Skip entirely unless the session marker's `path` is `specs-only-*` or `full-*` **and** `docs/design/architecture/baseline.pen` exists — a repo that never drew a baseline pays nothing. Otherwise the step runs step 1.5's lifecycle on the architecture canvas.

   - **Verdict — asked, never inferred.** Recommend `required` or `skip` and ask once, naming the signals behind the recommendation: a new directory under a scan root in the entry's `Touches:` or in the design, a new package or runnable unit, a new external the system talks to, a new cross-module import the design introduces, or the FD's `milestone:` having a target at `docs/design/architecture/milestones/<milestone>.pen` — then show `pnpm noldor design arch-progress --milestone <milestone>` so the design moves the baseline toward it. Write the answer to the session marker as `archVerdict`. On `required`, **Read now:** [`arch-design.md`](arch-design.md) — seeding, iteration and the record — then continue to step 1.7. On `skip`, add one line to the spec ("Architecture verdict: skip — <reason>") and continue to step 1.7. The ship-time check is the backstop: gate Step 4 runs `pnpm noldor checks arch-baseline` on every path, so a module-level change this verdict missed still surfaces before the PR.

1.7. **Structural-read step (path-gated).** Skip entirely unless the session marker's `path` is `specs-only-*` or `full-*` — `fast-track` and `micro-chore` never run it, so the XS drain is untaxed. Runs here, before the strawman, so the reading informs `## Design` rather than decorating it afterwards.

   Persist the pre-filter candidate set step 1.5 already derived (`links.code` ∪ the entry's `Touches:`) to the session marker as `candidatePaths`, then read it back here. Do **not** use `uiVerdictPaths`: that key holds only the subset that matched `consumer.uiPaths`, so in a repo where `uiPaths` is unset it is empty for every session and this step would resolve nothing.

   Run `pnpm noldor design graph-context` with one `--path` per candidate and branch on the verdict it prints:

   - **`skipped`** (exit 0) — the repo tracks no graph. Write the unit as `noldor:cut no graph tracked — <what would change the answer>`; graphify is optional and a bare prose line would be flagged by the very detector this feature adds.
   - **`stale`** (exit non-zero) — run `pnpm noldor graphify build`, then retry **exactly once**. The working-tree freshness leg is what that regeneration satisfies. If the retry is still not `fresh` (no usable Python, build failed, whatever), write the unit from whatever is available plus a `noldor:cut` naming the staleness.
   - **`fresh`** (exit 0) — read `graph.brainstorm-summary.toon` when the report says it is usable, then write `### Structural context` from the per-path digest: the communities the change lands in, any god node it defines (with its degree rank), and the cross-community edges it sits on.

   **Put the graph back after a regeneration.** The `stale` branch rewrites tracked files — `graphify-out/graph.json`, `GRAPH_REPORT.md` and both `.toon` files. That regeneration exists only to feed this read; left in place it becomes an unrelated diff that any later `git add -A` carries into the PR, and CI rebuilds the graph after the merge anyway. So before regenerating, confirm `git status --porcelain -- graphify-out/` prints nothing; once the unit is written (whatever the retry's verdict), run `git restore --source=HEAD --staged --worktree -- graphify-out/ && git clean -fdq -- graphify-out/`. The clean leaves gitignored caches alone. If `graphify-out/` was already dirty before the regeneration, those edits are not this step's to discard: skip the restore and say so in chat. Done right, `git status graphify-out/` is clean when the step ends.

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
5. **Section-by-section confirmation.** Walk the contract sections in order. For each one, bring its prose up to **one to two paragraphs** that say how the thing will actually work — the product and technical choices, named, while they are still cheap to change — then give the operator the spec link **exactly as the auto-open hook supplied it** (see the link rule under step 8) and ask whether that section is right. A one-line section gives the operator nothing to judge; that is the failure this step exists to prevent.

   On the operator's yes: `pnpm noldor design log --slug <dialogue-slug> --confirm-section "<heading>"`. That records the heading with a digest of the body they approved, so the checklist marks it `✓` and re-marks it `✎` if the prose changes afterwards — which survives a context compaction, unlike a yes in chat. Re-run `--confirm-section` after an edit to re-confirm, `--unconfirm-section` to withdraw. Nothing is gated on it: a section can be confirmed in one line when it genuinely is one line, and the operator can always say "skip the rest, write it".

   Cover architecture, units (one purpose each, clear interfaces, independently testable), data flow, error handling, testing. YAGNI ruthlessly.
6. **Finish the spec.** The file already exists from step 2.5; bring it fully in line with the `pnpm noldor prep format spec` contract and make sure every confirmed section still reads the way the operator approved it.
6.5. **Decision records — ask before the spec is reviewed, not after it is archived.** Read back the finished spec and list every decision that **closed a named alternative for a reason that outlives this feature** — a boundary, a data model, an enforcement posture, a dependency declined. Step 4's approaches comparison is the usual source, but `## Design` H3 units and the open-questions answers carry them too. A choice with no rejected alternative, or one the code will state plainly, is not on the list.

   Present the list (usually zero to two entries; more than two means the spec bundles concerns) with a one-line "what this rules out" for each, and ask the operator which deserve a record — `pnpm noldor docs adr --check`'s contract and the append-only push gate are described in [`docs/noldor/doc-conventions.md`](../../../docs/noldor/doc-conventions.md). For each confirmed entry run `pnpm noldor adr new <slug>`, fill `Context` / `Decision` / `Consequences` from the spec's own prose, link the record from the spec section it came from, and commit it as its own `docs(adr): <title>` commit on the branch.

   **Zero is the common and correct answer** — most specs decide nothing that outlives them, and a record per feature would make the folder unreadable, which is worse than an empty one. Ask anyway, every time: the spec is archived at gate Step 4 and rewritten by the next enhancement, so this is the last moment the reasoning exists anywhere durable. Never write a record for a decision the operator did not confirm — the surface is append-only, so a wrong record can only be superseded, never withdrawn.

7. **Self-review, fix inline:** placeholder scan (TBD/TODO/vague requirements), internal contradictions, scope (single implementation plan's worth?), ambiguity (a requirement readable two ways → pick one, state it).
7.5. **Take the design verdict (UI-bearing sessions).** When `uiVerdict` is `required` and no `uiWaiver` is recorded, **Read now:** [`pen-canvas.md`](pen-canvas.md) — and run its ratification steps (a)–(g) now, against the finished spec, or its **Waiver after Seed** paragraph when the editor cannot be reached. The record binds this spec's text, so finish editing first: a spec edit after the verdict surfaces as drift at gate Step 2.5 (`design verdict --check`) and costs the operator a `--reconfirm`. When `archVerdict` is `required` and no `archWaiver` is recorded, take the architecture verdict the same way, as `arch-design.md` describes — one verdict per `.pen`; a session with both a UI and an architecture design asks for two, never one merged approval.
8. **Report the artifact link and stop.** Re-link the spec in every later prompt or summary that references it. The gate owns what happens next (Step 2.5: lint → commit → CR lanes → continue dialog). Do not chain into planning or implementation.

   **Paste the supplied link; never build one.** Writing the spec fires the `PostToolUse` auto-open hook, which returns a ready-made markdown link in its `additionalContext` (and opens a tab too, when the repo sets `design.autoOpen: true` — off by default, because a launch can raise a different editor window and interrupt the operator). Use that string verbatim. Do **not** derive a path and do **not** run `pnpm noldor design open` yourself.

   The reason is not style. A markdown link resolves against the **editor's workspace folder**, while a repo-relative path is relative to the **session's checkout** — and every `specs-only-*` / `full-*` session runs inside `.worktrees/<slug>/`. Those two roots coincide on `main` and diverge in a worktree, which is why a hand-built link works sometimes and silently does nothing the rest of the time. The hook computes the difference; you cannot see it from here.

   If no `additionalContext` arrived (the hook is not wired, or `code` is absent), run `pnpm noldor design open <path>` once and report its `link:` line. When even that reports the wrong root — a multi-root workspace, or a session whose cwd is not the folder the editor opened — the operator's escape hatch is `NOLDOR_WORKSPACE_ROOT`.

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
