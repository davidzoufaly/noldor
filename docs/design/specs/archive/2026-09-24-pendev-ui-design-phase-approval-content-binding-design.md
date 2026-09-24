# Design Approval Binds What Was Approved — Design

**Slug:** pendev-ui-design-phase
**Enhancement:** approval-content-binding
**FD:** docs/features/pendev-ui-design-phase.md
**Date:** 2026-09-24
**Tier:** specs-only
**Deps:** Q-0196 (design-approval signal, shipped PR #406)
**Entry:** Q-0258, retired into `pendev-ui-design-phase`

## Problem

`pnpm noldor design verdict --approve` ([`src/design/design-approval-cli.ts`](../../../src/design/design-approval-cli.ts)) writes `.noldor/design-approval/<pen-stem>.json`, and binds it to one thing: `penBlob`, git's blob id of the `.pen` as it sits on disk. The record can be valid, blob-bound and green while it certifies something nobody approved. Both ways below happened in one session (Q-0275).

1. **It signs the file on disk, while the editor can hold newer content.** The operator approved eight states. The verdict ran right after the last two were drawn, before VS Code had written them out, and recorded the six-state blob. The output (`approved: … @ 7f3cfb9cfbb7`) names no pages, so nothing showed that six is not eight.
2. **It binds the design but not the spec.** Twice a spec CR round changed what the UI *is* — "card withheld below `BESIDE_MIN_WIDTH`" became "card detaches and hangs below the readout"; "totals always pinned" became "the height cap outranks the pinning" — while the `.pen` stayed byte-identical. `penBlob` still matched, so the approval stayed green. The blob binding catches "someone edited the design". The reverse, "the spec moved under an unchanged design", has no detector. The reviewer lane caught it only because it happened to read the spec's claim that every state was drawn.

Nothing checks content because the record's schema comment ([`src/design/design-approval.ts`](../../../src/design/design-approval.ts)) says the `FINAL:` pages sit "inside an encrypted file no check can read". That premise is false: [`docs/noldor/gotchas.md`](../../noldor/gotchas.md) records that a `.pen` is plain UTF-8 JSON, top-level keys `version, children, variables, fileToken`. Node can read the page list.

## Goals

- An approval names the exact page set it covers, and the verdict refuses when the pages the operator saw in the editor are not the pages in the file it signs.
- An approval names the spec revision it was given against. A spec change after the verdict is shown to the operator at spec stage and flagged by the `ui-reviewer` lane at code stage, instead of leaving a green record.
- A harmless spec change can be cleared cheaply: the operator confirms the unchanged design still depicts the new spec, without redrawing or re-walking it.
- Records written before this change keep parsing and keep satisfying `checks shared-files`.

## Non-goals

- Coverage — which states a surface must draw, derived from acceptance criteria, and the "exactly one `FINAL:` page per surface" count. The coverage bullet under roadmap entry Q-0247 owns that.
- Catching an unsaved edit *inside* a page when the page names are unchanged. Page names are the unit compared.
- Deciding in code whether a spec change alters the UI. A person reads the diff.
- Teaching `checks shared-files` about the spec binding. Refusing every spec commit after approval would fire on nearly every CR fix.
- Correcting the "encrypted" claim in the CR lane prompts (`ui-review-dispatch.ts`, `render-export-dispatch.ts`). Only comments in files this change already touches are fixed.

## Design

### Structural context

`design-approval.ts`, `design-approval-cli.ts` and `src/core/blob-id.ts` form one small community (c99). Its two readers sit in other communities and reach it only through `parseApprovalBytes` / `approvalRelPath`: `checks shared-files` (`src/checks/check-shared-files.ts`, c41, from `evaluate()`) and the `ui-reviewer` resolution (`src/cr/lanes/ui-design-resolve.ts`, c50, from `resolveUiReviewTarget()`). None of the touched files is a god node. The change is interior to c99, plus one new use of the existing c50 edge.

### UI verdict

UI verdict: skip — this repo configures no `consumer.uiPaths`, so no path this session changes is a UI path. The change is CLI, lane and skill prose.

### D1 — The page read: what the approval signs

`--approve` gains a required, repeatable `--editor-page <name>`: every top-level page name the agent read from the editor, with the same `Print(Get(document, {depth: 1}).children.map(c => [c.id, c.name]))` read Seed already uses. The CLI reads the `.pen` bytes once, parses them as JSON, and takes `children[].name` in file order as the disk page list. It compares the two as multisets.

- **Equal** → hash those same bytes (`git hash-object --stdin --path <rel>`), so `penBlob` names exactly the content whose pages were compared. Write the record with `pages`, and print the count and every page name signed.
- **Not equal** → write nothing and exit 1. Print which names are in the editor but not on disk, and the reverse, and say to save the `.pen` in VS Code and re-run. No wait loop: the editor exposes no save call over MCP, whether VS Code autosaves depends on the user's settings, and a human save is the fix that always works.

A `.pen` that is not JSON, has no `children` array, or has a page whose name is missing, blank or starts with `--` (argv cannot carry such a name as an `--editor-page` value) is refused with exit 2 (fail closed). Surface check (Open question 5): each `--surface` must own at least one `FINAL:<surface>:` page on disk, and each `FINAL:` page must name a passed surface. That turns `surfaces` from descriptive metadata into a checked claim.

### D2 — Spec binding: what else the record names

`--approve` gains a required `--spec <path>`. It gets the containment `resolveFeaturePen` gives `--pen` — checked on the realpath, symlinks refused — and must sit directly in the specs root (`loadDocRoots(repo).specs`) or directly in its `archive/`. The archive is allowed for the same reason `--pen` accepts an archived design: gate Step 4 archives both before the code-stage lane runs. It must follow the `<date>-<key>-design.md` scheme and carry the same dialogue key as the `.pen` (`specSlugFromFilename` against `penSlugFromFilename`). The record stores `spec: { name, blob }`: the spec's basename, and its blob id hashed the way `penBlob` is — attribute-aware, `git hash-object -w --path <p> -- <p>` — so it equals the blob a commit of that text stores, while `-w` keeps the approval-time text in the object store for a later diff.

The name is what lets every later reader find the spec without a search. `design archive` moves a spec into `archive/` under the same basename and refuses a collision there, so a reader looks at `<specs>/<name>`, then `<specs>/archive/<name>`, and needs no dialogue-key lookup and no ownership gate. The binding is the whole file, not a section digest. No section convention can promise that every UI decision lives inside it, and D3 puts a person in front of the diff, so a harmless edit costs a glance, not a redraw.

### D3 — Where drift is caught

- **Spec stage (first catch).** `design verdict --check --pen <p>` is read-only. It reads the record, finds the spec it names (D2), and compares that file's blob with `spec.blob`. Exit 0 when they match, or when the record is `waived` (nothing was ratified, so nothing can drift). Exit 1 when they differ, printing `git diff <spec.blob> <current>`, or a note saying the approval-time text is not in this clone. Exit 2 when the approval cannot be checked at all: no usable record, a record that names no spec, or a named spec that is gone. Gate Step 2.5 runs it before the continue-dialog on a UI-bearing session (`uiVerdict: required`, no `uiWaiver`). On 1 the operator reads the diff and either confirms the design still depicts the spec (`--reconfirm`), or sends the design back to be revised and approved again. On 2 the verdict is taken again, with `--spec`.
- **`--reconfirm --pen <p>`.** Needs an `approved` record whose `penBlob` still equals the `.pen`'s current blob — a changed design needs a full verdict. It re-hashes the spec the record names and rewrites `spec.blob` and `at`, nothing else. A record that names no spec cannot be reconfirmed: take the verdict again with `--spec`.
- **Code stage (backstop).** `resolveUiReviewTarget` runs its existing `design-approval-stale` check, then reads the spec the record names from the review-head tree — the same tree it already reads the `.pen` and the record from, so no comparison spans two revisions. When that blob differs from `spec.blob`, it terminates `cannot-review` with a new reason, `design-approval-spec-stale`, whose detail names `--reconfirm` as the remedy: red under `blocking`, green with a note under `advisory`. A named spec that is in neither place at the review head terminates the same way, naming the missing file. A record with no `spec` is reviewed as today, plus a note naming the remedy.

### D4 — When the verdict is taken

The verdict steps (a)–(g) of `/noldor-spec` step 1.5 move to the end of the skill: after self-review (step 7), before the link is reported. Then the spec the verdict binds is the spec that gets committed. Seed, Iterate and Record stay where they are. Without the move, every UI session would show drift at its first Step 2.5 round, because steps 3–7 keep editing the spec after an early verdict.

### D5 — Record shape and compatibility

The `approved` member gains `pages?: string[]` and `spec?: { name: string; blob: <git oid> }`. Both are optional, per the `state-file-schema-additive` rule, and each reader owns the `undefined` branch with a message naming the remedy. `spec` is one object rather than two loose fields, so a record can never carry a name without a blob or the reverse. `spec.name` must be a bare basename that `specSlugFromFilename` accepts — no `/`, no `..` — checked by the schema itself, so a hand-edited record cannot point any reader outside the specs root. `waived` is unchanged: nothing was ratified, so there is no page set or spec to bind. The schema stays `.strict()`, so a record with the new keys is unusable to an older framework (`pen-unapproved`). That downgrade hazard is accepted, because a repo runs one framework version at a time.

### D6 — Surfaces changed

- `src/design/design-approval.ts` — the two schema fields; the "encrypted" comment corrected.
- `src/design/design-approval-cli.ts` — `--editor-page`, `--spec`, the page read and compare, `--check`, `--reconfirm`, the new output lines.
- `src/core/blob-id.ts` — hashing from bytes (`--stdin`) and a write option.
- `src/cr/lanes/ui-design-resolve.ts` and `src/cr/findings-schema.ts` — the spec lookup at the review head and the `design-approval-spec-stale` reason.
- Tests: `src/design/__tests__/design-approval.test.ts`, `src/cr/__tests__/lanes/ui-review.test.ts`.
- Skill prose, both copies of each (kept identical by `checks template-sync`): `.claude/skills/noldor-spec/SKILL.md` (D4 and the new arguments) and `.claude/skills/noldor-gate/SKILL.md` (the Step 2.5 check).
- `docs/noldor/script-catalog.md` and its `templates/` twin — the `design:verdict` entry.
- `docs/features/pendev-ui-design-phase.md` — `links.code` gains the two design-approval files; Usage is refreshed at gate Step 4.

## Acceptance criteria

1. `design verdict --approve` with no `--editor-page` exits 2 and writes nothing.
2. `--approve` whose `--editor-page` set differs from the on-disk page names exits non-zero, writes no record, and prints the names missing on each side.
3. `--approve` whose page set matches writes a record whose `pages` equals the on-disk page names in file order and whose `penBlob` is the blob id of the bytes those names were read from; stdout lists every signed page.
4. A `.pen` that is not JSON, lacks a `children` array, or holds a page whose name is missing, blank or flag-shaped makes `--approve` exit 2 with nothing written.
5. `--approve` refuses (exit 2) when a `--surface` owns no `FINAL:<surface>:` page on disk, or when a `FINAL:` page names a surface that was not passed.
6. `--approve` without `--spec`, with a spec that is a symlink or not directly in the specs root or its `archive/`, or with a spec whose dialogue key differs from the `.pen`'s, exits 2. On success `spec.name` is the spec's basename, `spec.blob` is its blob id, and `git cat-file -e <spec.blob>` succeeds afterwards.
7. `design verdict --check` finds the named spec whether it is live or archived. It exits 0 when that file's blob equals `spec.blob` or the record is `waived`; exits 1 when the blob differs, printing the diff, or a note when the approval-time blob is not in the object store; and exits 2 when there is no usable record, the record names no spec, or the named spec is missing.
8. `--reconfirm` on an `approved` record whose `penBlob` matches the `.pen` rewrites only `spec.blob` and `at`. When the `.pen` changed since the record, the record is `waived`, or it names no spec, it exits non-zero and writes nothing.
9. The `ui-reviewer` lane, given a record whose `spec.blob` differs from the blob of the spec it names at the review head, terminates `cannot-review` with reason `design-approval-spec-stale` — red under `blocking`, green with a note under `advisory`. Given a record with no `spec`, it reviews as before and adds a note naming the remedy.
10. A record written before this change (no `pages`, no `spec`) still parses, and still satisfies `checks shared-files` for its `.pen`. A record whose `spec.name` contains `/` or `..` does not parse.
11. Both copies of the `noldor-spec` skill take the verdict after self-review and pass `--editor-page` for every top-level page and `--spec`; both copies of the gate skill run `design verdict --check` on UI-bearing sessions at Step 2.5, routing a drift to confirm-or-revise and an approval that cannot be checked to a fresh verdict.
12. Deletion test: approving with unsaved editor content, and changing the spec after approval, each end in a refusal or a non-green signal instead of a green record.

## Risks / trade-offs

- **The CLI now depends on the `.pen` file format.** Reading `children[].name` ties the verdict to pen.dev's JSON layout (seen stable across 2.13, 2.14 and 2.17). A future layout change makes `--approve` refuse, fail closed, until the parser follows. The read is kept minimal to keep that coupling small.
- **The page comparison is blind inside a page.** An unsaved edit that keeps every page name the same passes. Accepted: the failure on record added whole states, and page names are what both sides can list cheaply.
- **Spec edits after approval are normal at spec stage.** Most CR fix rounds on a UI session will show drift at `--check`, costing the operator one question per round. That question is the missing check itself, and it arrives with the diff.
- **The approval-time spec blob is unreachable until a commit holds it.** A fresh clone lacks it, so `--check` reports the drift without a diff and says why. Locally, `git gc` keeps unreachable blobs for two weeks by default (`gc.pruneExpire`), longer than a session.
- **`.strict()` downgrade hazard** — see D5.
- **Skill edits from a worktree.** `checks shared-files` refuses `.claude/skills/**` staged in a `.worktrees/` checkout; the sanctioned escape is `NOLDOR_ALLOW_SHARED=1` on that commit, with the `templates/` twins in the same commit.
- **Trust is unchanged.** The CLI still cannot prove the operator said yes; `--reconfirm` is exactly as trust-based as `--approve`.

## User Story

As an operator ratifying a UI design, I want the approval record to name the pages I was shown and the spec revision I approved them against, so that an unsaved editor or a later spec change cannot leave a green approval certifying something I never approved.

## Usage

At the end of `/noldor-spec`, once the operator approves:

```bash
pnpm noldor design verdict --pen docs/design/ui/<date>-<key>.pen --approve \
  --surface app --spec docs/design/specs/<date>-<key>-design.md \
  --editor-page "BASE:app: rest" --editor-page "FINAL:app: rest" --editor-page "FINAL:app: empty"
```

It prints every page it signed, or refuses and names the pages the file on disk is missing — save the `.pen` in VS Code and re-run.

At gate Step 2.5 on a UI-bearing session, before the continue-dialog:

```bash
pnpm noldor design verdict --check --pen docs/design/ui/<date>-<key>.pen
```

Exit 1 prints the spec diff since approval. If the design still depicts the spec:

```bash
pnpm noldor design verdict --reconfirm --pen docs/design/ui/<date>-<key>.pen
```

Otherwise revise the design and take the verdict again. Exit 2 means the approval cannot be checked at all — take the verdict again, with `--spec`.

## Open questions (resolved)

1. *When the editor's pages and the file's pages differ, should the verdict wait for the editor to save?* -> No: refuse at once and say to save. The editor has no save call over MCP and autosave depends on user settings, so a wait could time out anyway; a human save always works (D1).
2. *Where should a spec change after approval be caught?* -> At spec stage, by `design verdict --check` at gate Step 2.5 with the operator reading the diff, plus a code-stage backstop in the `ui-reviewer` lane. Code stage alone finds it after the implementation has already followed the new spec (D3).
3. *When is the verdict taken?* -> After self-review, as the spec skill's last step, so the bound spec is the committed one (D4).
4. *Bind the whole spec, or a digest of the sections that describe the UI?* -> The whole file. No section convention can guarantee coverage, and a person reads the diff, so a harmless edit costs a glance (D2).
5. *Now that the file is readable, should `--surface` be checked against the `FINAL:` pages?* -> Yes, both directions, with no per-surface count — the count belongs to the coverage work (D1).
6. *What happens to records written before this change?* -> They parse; `--check` exits 2 and the lane adds a note, each naming the remedy: take the verdict again (D3, D5).
