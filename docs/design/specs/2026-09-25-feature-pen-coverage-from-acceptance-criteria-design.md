# Feature .pen Coverage From Acceptance Criteria — Design

**Slug:** feature-pen-coverage-from-acceptance-criteria
**FD:** docs/features/feature-pen-coverage-from-acceptance-criteria.md
**Date:** 2026-09-25
**Tier:** specs-only
**Deps:** pendev-ui-design-phase
**Entry:** Q-0297 (split from Q-0247)

## Problem

A feature's `.pen` is held to one page-level rule, and it is a count. `/noldor-spec` step 1.5 says "mark exactly one winner `FINAL:<surface>: <name>` per affected surface" (Iterate) and "check that its `FINAL:` pages are exactly one per affected surface" (verdict step (b)). Both are prose the agent executes by hand. The CLI checks less: `surfaceCoverageError` in `src/design/design-approval-cli.ts` asks only that every `FINAL:` page belongs to a `--surface` and every `--surface` owns at least one. `approve()` binds the spec's blob into the record but never reads the spec's text, so nothing ties the pages to what the spec promises.

The hole carries downstream. The `ui-reviewer` lane's prompt (`NOT_NORMATIVE` in `src/cr/lanes/ui-review-dispatch.ts`) says a state the design never authored is not evidence about the code, so a state missing from the design is invisible to code review too.

Shipping charuy's Q-0275, the first design drew only the happy path. At rest, keyboard focus, empty scene, engine error, in-flight and the folded-bar layout were all missing until the operator asked where the interactions were. Criteria 5, 11 and 12 of that spec pin three of them. The fixed design then put all eight states as rows inside one `FINAL:app:` page, which the review lanes read as a single state: they enumerate top-level `FINAL:` pages only (`render-export-dispatch.ts`, step 1).

## Goals

- The set of pages a feature `.pen` must hold is written in the spec and derived from its acceptance criteria: every criterion is either tied to a page or marked as having no screen of its own.
- `design verdict --approve` refuses a UI design whose `FINAL:` pages differ from that set, or whose spec leaves a criterion unaccounted for. It writes no record.
- A read-only check lets step 1.5(b) catch a gap before the operator is shown the pages.
- `design verdict --reconfirm` cannot rebind a changed spec the approved design no longer covers.
- One `FINAL:` page per state becomes the normal shape, several per surface. The "exactly one per surface" prose goes.

## Non-goals

- Judging whether a page actually depicts its criteria. The operator judges that when shown the pages, and the `ui-reviewer` lane compares each page to the code. No model-driven check in this change (open question 7).
- Modes (light / dark) as a coverage dimension for feature designs. Q-0247's `uiCoverage.modes` stays a baseline rule.
- Layout inside a feature `.pen` beyond "pages are top-level frames". Rows, labels and twin order stay a baseline contract (Q-0292).
- Architecture `.pen`s and milestone targets. Their pages are views, not states.
- Re-checking records approved before this change. The pre-commit guard and the `ui-reviewer` lane read them as they do today; only a new approval, including a `--reconfirm`, runs the check.
- `render-compare`'s page selection. It is unchanged, so a surface with several `FINAL:` pages needs `uiBoot.<surface>.page`, as it does today.

## Design

### Structural context

The verdict change lands in community c45: `src/design/design-approval-cli.ts` beside `src/core/blob-id.ts`, owned by `pendev-ui-design-phase`. Its outward edges go to `loadDocRoots()` (c10), `runIfDirect()` in `src/core/cli-entry.ts` (c69), `src/core/design-artifact-names.ts` and `src/design/design-approval.ts` (c25), and `src/design/arch-pen.ts` (c30). `src/design/pen-doc.ts` is a leaf in its own community (c96) that c45, `src/release/ui-design-freshness.ts` (c38) and `src/design/ui-capture-cli.ts` (c36) import. The criteria counter in `src/core/split-suggestion.ts` sits in c52 with `split-check-cli.ts`. `src/utils/markdown-sections.ts` sits in c97, and `docs-architecture.ts` (c108), the design dialogue's `artifact-locate.ts` (c119) and `markdown-section-scan.ts` (c22) already import it. `src/cr/lanes/ui-design-resolve.ts` (c113) is read, not changed.

None of these files defines a god node, and none sits on a bridge the change would widen. The two new modules are leaves: `src/design/feature-coverage.ts` imported by c45, and `src/core/spec-criteria.ts` imported by c52 and by `feature-coverage.ts`. The graph is fresh; its brainstorm summary was not regenerated, so this reads from the per-path digest only. The entry declares no `Touches:` and the FD has no `links.code` yet, so the paths are the ones grounding found.

UI verdict: skip — noldor configures no `consumer.uiPaths`, and this session changes framework code, not a UI surface.

Architecture verdict: skip — no new directory, package, external or cross-module import (`src/design → src/core` and `src/design → src/utils` already exist), and the FD names no milestone.

### Unit 1 — The coverage table (spec side)

A UI-bearing spec carries a `### Design coverage` H3 inside `## Design`: one table, one row per page the design must hold. Here is charuy's Q-0275, with its 18 criteria, as the table would have held it:

| Page                          | Criteria        | Shows                                      |
| ----------------------------- | --------------- | ------------------------------------------ |
| `FINAL:app: at rest`          | 1, 2            | the readout in the rail, the card closed   |
| `FINAL:app: card open`        | 4, 6, 8, 9      | the card open on hover                     |
| `FINAL:app: keyboard focus`   | 5               | the focus ring, the card open              |
| `FINAL:app: empty scene`      | 11              | zero area, a prompt instead of an error    |
| `FINAL:app: engine error`     | 12              | the readout blank, the message in the card |
| `FINAL:app: 320 px`           | 13              | the card hanging below the readout         |
| `FINAL:app: short room list`  | 14              | the whole card scrolling                   |
| `FINAL:app: volume computing` | 15              | an em dash in the volume row               |
| `FINAL:app: short viewport`   | —               | the readout above the overflow (a decision) |
| not drawn                     | 3, 7, 10, 16–18 | behaviour with no screen of its own        |

Rules, all checkable from the text:

- **Page** is a `FINAL:<surface>: <state>` name in backticks, unique in the table, or the literal `not drawn` on at most one row.
- **One page per row.** Each page row is one top-level frame of the `.pen`, so a surface owns as many `FINAL:` pages as it has rows. States drawn as frames inside one page do not count: the review lanes see only top-level pages.
- **Criteria** lists acceptance-criterion numbers and ranges (`6–10` or `6-10`), or `—` for none. A page row may cite none: a state that comes from a decision rather than a criterion is still drawn.
- **Accounting:** every criterion of `## Acceptance criteria` appears on some row. A criterion may be cited by several pages, but not by a page and by `not drawn` at once.
- **Shows** and any further column are prose for the reader. The check ignores them.

Criteria are numbered by position: the Nth top-level list item of `## Acceptance criteria` is criterion N, the same items split-check's S2 counts. The skill asks a UI-bearing spec to write its criteria as a numbered list, so the numbers the table cites are the numbers a reader sees. The check itself counts positions, so a bulleted list still works.

### Unit 2 — The coverage check (`src/design/feature-coverage.ts`, new)

Pure functions over the spec's text and a list of page names, so the same check runs on the editor's page list and on the file on disk.

- `readCriteria(specMd)` returns the acceptance criteria in order. It finds the section the way S2 does today (the first H2 whose name starts with `Acceptance`, any case) and counts the same top-level `- ` and `N. ` items, but skips fenced lines, using the fence tracking in `src/utils/markdown-sections.ts` (`stepFence`). It lives in `src/core/spec-criteria.ts`: `countSpecCriteria` in `src/core/split-suggestion.ts` moves onto it, so S2 and this check count the same list, and `src/core` must not import `src/design`.
- `readCoverageTable(specMd)` returns the rows, or a finding for each row that breaks Unit 1's grammar.
- `checkFeatureCoverage(specMd, pageNames)` returns findings. Accounting findings: `no-coverage-table`, `no-criteria`, `malformed-row`, `unknown-criterion`, `unaccounted-criterion`, `contradictory-criterion`. Page findings take Q-0247's names and meanings, keyed by page name instead of id: `missing-page` (a declared page no top-level page carries), `duplicate-page` (carried twice), `undeclared-page` (a top-level `FINAL:` page the table does not declare).

The page comparison is written here rather than shared with `checkCoverage` in `src/design/pen-doc.ts`. The two key pages differently: a baseline by the id `<state>-<mode>` its capture emits, a feature design by the name the agent sets. One function serving both keys would carry a switch that only ever takes one branch per caller.

Pages are matched by name, not by id. The agent names a page (`Update(<pageId>, {name})`); ids in a feature `.pen` are generated by the editor.

### Unit 3 — The verdict (`src/design/design-approval-cli.ts`)

- `--approve` on a UI `.pen` bound to a spec runs `checkFeatureCoverage` on the spec it binds and the pages it read from disk, after the editor-versus-disk comparison. Any finding refuses: every finding is printed, nothing is written. An architecture `.pen`, a milestone target and `--waive` skip the check.
- `--reconfirm` runs the same check on the changed spec and the approved pages (the `.pen` blob is already proven unchanged). A finding refuses and says the design needs a full verdict.
- A new read-only verb, `--coverage`, takes `--spec` and the editor's `--editor-page` list and runs the same check. It reads no `.pen` bytes, so it works before the editor saves, and it writes nothing. `--pen` still names the design, so the spec's dialogue key is matched as `--approve` matches it, and an architecture `.pen` or a milestone target is refused as a usage error. Step 1.5(b) runs it before the pages are shown.
- `--check` is unchanged. It reports drift; `--reconfirm` is where drift meets the check.

Exit codes: `--coverage` exits 0 when the design is covered, 1 listing every gap, and 2 on a usage error or an unreadable spec, the same 0 / 1 / 2 as `--check`. A coverage refusal at `--approve` or `--reconfirm` exits 2, like their other refusals. Exit 1 at `--approve` already means "the editor has not saved" and the skill branches on it, so it keeps that one meaning.

### Unit 4 — Skill and docs

- `/noldor-spec` step 1.5: derive the coverage table from the acceptance criteria before drawing. Iterate draws the winning variant once per declared page, each a top-level `FINAL:` page. Step (b) runs `design verdict --coverage` in place of the hand count. Step (f)'s command is unchanged. Template twin in `templates/.claude/skills/noldor-spec/SKILL.md`.
- The spec format contract (`src/prep/formats.ts`) names the table for UI-bearing specs.
- `docs/noldor/script-catalog.md` (`design verdict`), the Usage line of `docs/features/pendev-ui-design-phase.md` that says "marks one winner", and the comment on `validateBaselineFile` in `src/design/ui-sync-cli.ts` ("one FINAL per surface").
- No review-lane prompt changes. The spec reviewer's prompt (`buildPrompt` in `src/cr/lanes/subagent-dispatch.ts`) is organised by review dimension and carries no rule about any one section (open question 8).

### Error handling

Every refusal names what it refuses, and nothing is written on any refusal. An unreadable spec is a refusal (exit 2), never a pass. A table the parser cannot read is a finding naming the row, not a crash. A spec with no `## Acceptance criteria`, or none parsed, is `no-criteria`. The check never throws.

### Testing

- `feature-coverage.ts`: fixture specs for each finding, and a charuy Q-0275-shaped spec (18 criteria, the table above) that passes against its page list and fails when one page is dropped. Ranges with an en dash and a hyphen. A table reformatted by oxfmt (padded cells).
- CLI, in the existing temp-repo harness: `--approve` refuses and writes no record on each finding class, and approves a covered design with several `FINAL:` pages on one surface. `--reconfirm` refuses a spec that gained an unaccounted criterion. `--coverage` exit codes, and no file written. Architecture, milestone and `--waive` behave as before.
- split-check: every existing S2 test passes on the shared reader.

## Acceptance criteria

1. `design verdict --approve` on a UI `.pen` whose spec has no `### Design coverage` table exits 2, writes no record, and says the table is missing.
2. `--approve` refuses the same way, naming the criterion, when a criterion of the spec appears on no row of the table.
3. `--approve` refuses the same way, naming the page, when a declared page is not a top-level page of the `.pen`, is carried by two top-level pages, or when the `.pen` has a top-level `FINAL:` page the table does not declare.
4. `--approve` refuses the same way when a row cites a criterion the spec does not have, cites a criterion that is also on the `not drawn` row, or breaks the table grammar.
5. With every criterion accounted for and the `.pen`'s top-level `FINAL:` pages exactly the declared pages, `--approve` writes the record as it does today, including when one surface owns several `FINAL:` pages.
6. `--reconfirm` exits 2 and leaves the record unchanged when the changed spec is no longer covered by the approved pages, and reconfirms as today when it still is.
7. `design verdict --coverage` exits 0 on a covered design and 1 listing every gap otherwise, reads the page names from `--editor-page`, and writes nothing.
8. An architecture `.pen`, a milestone target and `--waive` behave exactly as today.
9. Records approved before this change keep passing the pre-commit guard and the `ui-reviewer` lane's resolution unchanged.
10. split-check's S2 counts the same criteria the coverage check numbers.
11. `/noldor-spec` step 1.5 and the spec format contract name the coverage table and the `--coverage` check, and no longer state the one-page-per-surface rule; template twins match.

## Risks / trade-offs

- **Every UI-bearing session pays for a table.** That is the point: the table is where the criteria are walked. A session in flight across the upgrade that already drew one page per surface has to split it and add the table before `--approve` passes.
- **The machine forces the question, not the answer.** Whether a criterion has a screen of its own is still the agent's call. The operator sees the `not drawn` row when confirming the section, and a spec reviewer reading the criteria can flag a visible one placed there.
- **Table grammar.** A table is easy to write badly. The parser trims cells, accepts both dash forms and names the row it cannot read.
- **Several `FINAL:` pages per surface.** A consumer that runs `render-compare` must set `uiBoot.<surface>.page` to the state its route renders. No known consumer runs that lane today; charuy's `crLanes.code` is `reviewer` only.
- **Skill edits from a worktree.** `checks shared-files` refuses `.claude/skills/**` from a feature worktree; the skill edit rides this branch with `NOLDOR_ALLOW_SHARED=1`, as earlier skill changes did.
- **A nested `FINAL:` page reads as missing.** The check sees top-level pages only, so a page drawn inside a row frame is reported as `missing-page`. The message says a nested page does not count; the baseline contract in `docs/noldor/ui-baseline.md` states the same rule for baselines.

## User Story

As an operator approving a feature's UI design, I want the design checked against a list of pages derived from the spec's acceptance criteria, so that a design that draws only the happy path cannot be approved while the states the criteria promise are missing.

## Usage

- Writing a UI-bearing spec: add `### Design coverage` under `## Design`. One row per `FINAL:<surface>: <state>` page with the criteria it shows, and one `not drawn` row for criteria with no screen of their own. Every criterion must appear.
- Before showing the pages (step 1.5(b)): `pnpm noldor design verdict --pen <pen> --coverage --spec <spec> --editor-page "<name>" …`. Exit 0 means the pages are exactly the table; otherwise it lists each missing, doubled or undeclared page and each unaccounted criterion.
- Approving (step 1.5(f)): `design verdict --approve` as today. It now refuses a design that the coverage check fails, and writes nothing.
- After a spec change: `design verdict --reconfirm` refuses when the design no longer covers the spec. Revise the design and take the verdict again.

## Open questions (resolved)

1. _Where does the coverage set live?_ → In the spec, as a `### Design coverage` table under `## Design` (D1). The operator confirms it with the rest of the design, the spec reviewer reads it, and the verdict CLI already resolves the spec.
2. _What makes the set derived rather than hand-written?_ → Every criterion must appear in the table, on a page row or on `not drawn`, and the CLI refuses otherwise (D2). That forces the walk over every criterion, which is the step Q-0275 skipped.
3. _One `FINAL:` page per surface, or one per state?_ → One top-level `FINAL:` page per declared row, several per surface allowed (D3). The `ui-reviewer` already reads each `FINAL:` page as one authored state, and the review lanes see only top-level pages, so states drawn as rows inside one page are invisible to them.
4. _Match pages by name or by id?_ → By name (D4). The agent sets names; ids in a feature `.pen` come from the editor.
5. _Where is the check enforced?_ → At `--approve` and `--reconfirm`, which refuse, plus a read-only `--coverage` for step 1.5(b) (D5). The guard and the lane read records as today: a record written after this change can only exist if the check passed.
6. _Are modes a coverage dimension?_ → No (D6). A criterion that pins a mode gets its own row.
7. _Should a model check what each page depicts, using the render export?_ → Not in this change (D7). It needs the editor bridge, so it cannot run headless, its answer changes between runs, and the operator already judges the pages at the verdict.
8. _Should the spec reviewer's prompt get a rule about the table?_ → No (D8). The prompt is organised by review dimension with no rule for any one section, and the table explains itself: a reviewer who reads a visible criterion on the `not drawn` row can already file it under the `requirement` basis.
9. _Does `--reconfirm` check records approved before this change?_ → Yes (D9). Any approval written after this change certifies coverage; the cost is a one-time table for a session in flight across the upgrade.
