---
name: noldor-plan
description: Decompose an approved spec into a bite-size TDD implementation plan. Use at the gate's plan stage (full-* paths) or standalone for any multi-step work with a written spec. Writes the plan per `pnpm noldor prep format plan`.
user_invocable: true
---

# /noldor-plan

Write an implementation plan for an engineer with zero context for this codebase and questionable taste: every file to touch, complete code, exact commands, expected output. Assume a skilled developer who knows almost nothing about this toolset or problem domain. DRY. YAGNI. TDD. Frequent commits.

## Flow

1. **Read the spec** (latest `docs/design/specs/*-<slug>-design.md`) and every file it names. If the spec spans multiple independent subsystems, flag it — one plan per subsystem, each producing working testable software on its own.

1.8. **Draft-first — skeleton before questions.** Before asking anything, run `pnpm noldor prep format plan` and write a skeleton to `docs/design/plans/YYYY-MM-DD-<slug>.md`: the header block, a `## File Structure` list, and one `## Task N: <name>` heading per task you can already name from the spec, each carrying a sentence or two on what it does and what is still unknown. Present it as a strawman.

   Without this the `--section` loop below has nothing to render — a plan question would arrive above an empty heading, which is the same blind-answer problem the spec dialogue's draft-first step exists to remove. The skeleton is also what makes plan headings addressable, since `--section` matches the artifact's own H2/H3 names.

   **Any question you pose while planning carries the design state inline**, same loop and same ledger as the spec dialogue (decisions taken at spec time stay visible here — that continuity is the point):
   - before every question, name the plan heading it concerns: `pnpm noldor design context --slug <dialogue-slug> --kind plan --section "<H2 or H3 name>"`, pasted verbatim inside a fenced code block immediately above the question. Plan headings are the ones the contract produces — `File Structure`, `Task N: <name>` — so a question about one task renders that task's current draft and the decisions bound to it, and everything else collapses to one line;
   - after every answer, record its reasoning too: `pnpm noldor design log --slug <dialogue-slug> --decide "…" --because "<why>" --instead-of "<what was rejected>" --section "<heading>"` (plus `--resolve <id>` / `--open "…"` as applicable). `--because` and `--instead-of` take exactly one `--decide`;
   - then update the affected plan section on disk, so the next question renders against a draft that already carries the answer rather than the original strawman — the same beat the spec dialogue runs, and without it draft-first decays to draft-once;
   - on a task block the operator has signed off: `pnpm noldor design log --slug <dialogue-slug> --kind plan --confirm-section "<heading>"`, which records a digest of the approved body so the checklist re-flags it if the plan changes underneath. **`--kind plan` is not optional here** — `design log` defaults to `spec`, so without it the digest is taken from the *spec* and the sign-off either never sticks (the plan heading reads `✎` forever) or hard-errors on a heading the spec does not carry. On a split plan `--spec` is safe: naming any one part resolves that part's whole generation, so the cohort stays complete. Use it to pick a *generation* when the slug matches more than one.

   `--full` expands every collapsed value. A `-part<N>` split plan resolves to all its parts at once with their headings unioned in part order. `--spec` on a plan names a *generation*, not a file: point it at any one part and the whole cohort comes back vetted, which is how you disambiguate when the locator refuses a slug matching two generations. Dialogue slug = the feature slug on `*-new` paths, `<parent>-<enhancement>` on `*-attach` — the key that names the spec file. Never hand-edit `.noldor/design/<slug>.md`.
2. **File structure first.** Refine the skeleton's file map before the tasks: which files are created/modified and each one's single responsibility — this locks decomposition. Follow the codebase's existing patterns; prefer small focused files.
3. **Format contract.** Run `pnpm noldor prep format plan` and structure the document exactly per the printed contract, header blockquote included verbatim.
4. **Tasks.** Each task: a **Files:** block (Create:/Modify:/Test: exact paths), then checkbox steps. One step = one 2-5 minute action. TDD order: write the failing test → run to verify FAIL (exact command + expected output) → implement → run to verify PASS → commit. Prescribe the commit as `git commit -F <message-file>`, where the file holds a conventional-commit subject, a blank line, a free-form body explaining the change, then ONE trailing paragraph carrying `Noldor-FD: <slug>` and any other trailer. In the FIRST code-bearing task's commit only, the body must carry `Why —` / `How —` / `What —` sections (em dash, not `Why:` — a colon reads as a git trailer and gets absorbed; each section needs 24+ non-whitespace characters). Do **not** prescribe `-m "<subject>" -m "Noldor-FD: <slug>"`: a second `-m` opens a new paragraph so `git interpret-trailers --parse` sees only the last one and strands `Noldor-FD`. Commit bodies are free-form at push time, but the FIRST substantive commit's body becomes the PR Summary and `pr-flow` (`validatePrSummary`) refuses delivery unless it carries the three sections — so prescribe them in the first code-bearing task's commit. An executor following the plan verbatim must produce a branch that delivers.
5. **Self-review against the spec, fix inline:** every spec requirement maps to a task (add tasks for gaps); zero placeholders; types, signatures, and names consistent across tasks.
6. **Save + split check.** Save to `docs/design/plans/YYYY-MM-DD-<slug>.md`, then run `pnpm noldor noldor split-check --plan <path>` and capture stdout + exit code. Exit 0 → continue. Exit 1 = infra error → note it and continue; never block on checker infra. Exit 2 → report the P1 signal verbatim, then **diagnose before restructuring** — a P1 trip has two different causes and only one of them is a plan problem:

   - **(i) The scope is oversized.** The plan is long because the work is. Restructuring the document just spreads too much work across more files. The remedy is a *scope split*, which belongs upstream: carve the excess back to `docs/roadmap.md` as sibling entries via the gate's Step 2.5 `split-back` (`address-blockers` → `split-back`), narrow the plan to the first slice, and continue.
   - **(ii) The scope is right; the plan is verbose.** Restructure into `docs/design/plans/YYYY-MM-DD-<slug>-part<N>.md` parts — each part independently shippable software (same bar as step 1's one-plan-per-subsystem rule) — delete the monolith file, and re-run the split check on each part before continuing.

   **Ask (i) first.** A thousand-row plan is more often too much work than too many words. `-part<N>` is a *document* split — it moves no scope out of the FD — which is why it stays local instead of producing queue siblings like every scope split does. See [complexity-gating.md → Which phase owns the split](../../../docs/noldor/complexity-gating.md#which-phase-owns-the-split).
7. **Report** the saved path(s) and stop. The gate owns sequencing (Step 2.5 `--kind plan`: lint → commit → CR lanes).

## Plan failures — never write these

- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation" / "handle edge cases"
- "Write tests for the above" without the actual test code
- "Similar to Task N" — repeat the code; tasks are read out of order
- A code step without the complete code
- References to types, functions, or methods no task defines

## Rules

- Exact file paths always; exact commands with expected output in every run step.
- The operator's explicit instructions always override this skill.
