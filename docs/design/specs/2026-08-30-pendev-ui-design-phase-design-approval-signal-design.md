# Enforceable Design-Approval Signal — Design

**Slug:** pendev-ui-design-phase
**FD:** docs/features/pendev-ui-design-phase.md
**Date:** 2026-08-30
**Tier:** specs-only
**Deps:** Q-0186 (design-approval step, shipped PR #399), Q-0190 (capture receipt, shipped PR #401)

## Problem

Q-0186 shipped the operator design verdict as `/noldor-spec` step 1.5 prose: the session's `.pen` is opened by path, its `FINAL:` pages are walked, an atomic approve/revise is taken, and an approval sentence lands in the spec's `## Design`. Its own spec states the reduction outright — the verdict is chat-only, so nothing on disk distinguishes an approved design from an unapproved one, and the entry's deletion test ("a UI-bearing session **cannot** reach the code stage without a recorded design verdict") was explicitly not delivered.

Q-0186's OQ1 answered "the record lives nowhere", having weighed exactly two locations — `.noldor/session.json` and `.noldor/design/`, both gitignored. Sound for those paths, but it does not generalise: `.noldor/` also holds **tracked** state, and the UI-capture receipt at `.noldor/ui-capture/<surface>.json` (Q-0190, three weeks later) is precisely a committed, machine-readable, git-blob-bound receipt written by a step that succeeded. The artifact class Q-0186 concluded did not exist now exists in the same feature.

So the open question is narrower than the entry states: not "can an approval be persisted" — it can, with an established pattern — but whether it buys enough over the chat-only verdict to be worth a new module, a CLI verb and two refusal branches, given that the realistic cost of a skipped verdict is one wasted implementation pass.

## Goals

- Decide, against the advisory-with-teeth posture, whether an enforceable approval signal is worth its cost — recording the reasoning either way, so the entry is not re-opened a third time.
- If it is worth it: persist the verdict as a record a gate can read, bound to the design it ratified strongly enough that a later edit to that design invalidates it.
- Meet the entry's deletion test as worded — *cannot reach* the code stage, not "is caught once it gets there" — which means at least one refusal must land before implementation begins. Stated exactly, the invariant is: **no commit adds a feature `.pen` unless the same tree holds a valid record — approved, or explicitly waived — naming that exact blob.** Designs already committed before this ships are outside it and are reported by the lane, not refused.
- Extend the refusal points that already exist — `resolveUiReviewTarget` and `checks shared-files` each gain one more case, not a new mechanism — with no new artifact kind for `resolveArchivePlan` or garden, no new pre-push job or hook, and no re-derivation of the verdict/waiver/ownership logic.

## Non-goals

- Verifying that the approved design matches what was built (Q-0145's `ui-reviewer` lane owns that) or that the spec's named variant matches the approved page (Q-0186 R4's second half stays open). This signal records *that* an operator ratified *which* artifact, nothing more.
- Changing the verdict conversation itself: the approve/revise dialogue, its atomicity, the two-round reservation offer and the waiver semantics all ship as-is from Q-0186.
- Recording rejections. Q-0186 OQ7 settled this: a design that is not approved is being revised, and a persisted rejection reads to a later reader as a decision rather than a discarded draft.
- Making this fire in the noldor repo. Self-host declares no `consumer.uiPaths`, so every session here resolves `skip`.

## Design

### Structural context

Read from `pnpm noldor design graph-context` over the parent FD's `links.code` after an `--ast-only` regeneration (3054 nodes, 8150 edges, 169 communities).

The change lands across three communities that already touch each other, plus one it does not:

- **c20** — `src/cr/lanes/ui-design-resolve.ts` alongside `src/design/archive-cli.ts`, `src/core/branch-added.ts` and `src/cr/read-fd-summary.ts`. Community owned by `acceptance-verify-lane` (4 files), `rules-cascade-v1` (1), `specs-cr-gate-multi-reviewer` (1). This is where the refusal branch goes.
- **c58** — `src/design/archive-resolve.ts` alongside `src/core/design-artifact-names.ts` and `src/checks/check-shared-files.ts`. The dialogue-key/naming/`.pen`-guard neighbourhood. c20 already imports from c58 (`archive-resolve.ts [c58] via imports_from`, `resolveArchivePlan() [c58] via calls`).
- **c57** — `src/core/session.ts`, which c20 already reads (`session.ts [c57] via imports_from`, `readSession() [c57] via imports`).
- **c112** — `src/design/ui-capture.ts`, the receipt writer this design copies. c20 does **not** currently reach c112; c112's own edges run to `slug.ts [c41]`, `atomicWriteFileSync() [c40]`, `ui-design-freshness.ts [c84]`.

That last line shapes D3: a record module beside `ui-capture.ts` would mint a new c20→c112 bridge for a single read, while c58 — where the dialogue key lives, where `check-shared-files.ts` sits, and where c20 already has edges — adds none. Neither edited file defines a god node (`loadDocRoots()` rank #1 and `loadConsumerConfig()` rank #2 are reached transitively, not modified); the edited surface is interior, which is itself the finding: an extension along existing seams, not a new coupling.

### D1 — Is it worth building at all?

Recommendation: **yes, in the reduced form below** — but the case is close, the entry's own confidence is `low`, and a "no" retiring the entry is a legitimate outcome, so both sides are stated.

Against: the posture is advisory-with-teeth, a skipped verdict realistically costs one implementation pass, Q-0186 already put the question in the right place — and every enforcement mechanism charges every honest session forever to catch a controller that skipped a step.

For: the cost is unusually low because none of the machinery is new — the receipt shape, both refusal points, the mode knob and the ownership gate all exist and are already exercised by this same feature; D7 is the whole surface. And the failure it catches is not "an operator forgot" but "a controller silently skipped a prose step" — the class the framework has repeatedly found prose cannot close, the same reasoning that put `withMandatoryReviewer` in code after the gate's `proceed-without-review` option was removed in prose.

### D2 — The record

**Identity: one record per design artifact, keyed by the `.pen` stem** — the basename without extension, at `.noldor/design-approval/<pen-stem>.json`. The bare dialogue key would not be injective: two sessions on the same parent and enhancement produce two dated `.pen` files sharing one key, and a later verdict would silently overwrite the only tree-visible record of an earlier, already-archived design. The stem is unique per *simultaneously live* artifact (`resolveArchivePlan` refuses a basename collision into `archive/`), and every consumer already holds it: the CLI is given the `.pen` path, the guard has the staged path, the lane has `owned[0]`. One collision remains reachable — a same-day redo of the same parent and enhancement, whose new `.pen` reproduces an archived stem; its verdict then overwrites the archived design's record. Accepted: the archived `.pen` is immutable (`pen-archive`), no live review reads its record, and the loss is historical bookkeeping, not enforcement. The alternative — keying by blob — would orphan every record on the first legitimate re-verdict.

**Shape.** A discriminated union on `outcome`, because a UI-bearing session has two legitimate ways to commit a `.pen` and both need a record:

```
{ "outcome": "approved", "at": "<ISO-8601>", "penBlob": "<git oid>",
  "surfaces": ["<affected surface>", "..."], "reservation": "<text>" }   // reservation optional

{ "outcome": "waived",   "at": "<ISO-8601>", "penBlob": "<git oid>",
  "reason": "<why the verdict could not be taken>" }
```

The schema is `.strict()`, like `uiCaptureReceiptSchema`: an unknown field means writer and reader disagree about what the record means.

`surfaces` is **descriptive metadata, not a verified claim.** The authoritative set is the `FINAL:` pages inside an encrypted file only pencil MCP can read, so the schema requires non-empty and deduplicated and nothing more; no acceptance criterion asserts the list matches anything.

The `waived` member exists because Q-0186's waiver-after-Seed legitimately commits an unratified `.pen` (that spec's D4 keeps the seeded file so `links.design` and the archive repoint pass are not orphaned); without a record for that case the guard in D4 would refuse a flow the framework endorses. The invariant this feature enforces is therefore **"approved, or explicitly waived on the record"** — never "approved" alone, and the Goals and User Story say it that way.

A record — rather than teaching the guard to read `session.uiWaiver` — keeps the guard a question about content git can see: the marker is transient, per-worktree and gitignored, so today nothing on `main` says *why* a committed `.pen` is unratified. `uiWaiver` stays unchanged as the lane's short-circuit; D4's table covers the run where only the record survives.

`penBlob` is carried by **both** members — a waiver ratifies the artifact that was committed, not any future version of it — so a `waived` record goes stale on an edit exactly as an `approved` one does.

**Which revision `penBlob` names, and who computes it.** Always git's own object id — never a hash over raw bytes, for the reason `ui-capture.ts` gives for `baselineBlob`: a working-tree transform (`core.autocrlf`, `text=auto`, a clean filter, LFS) would make a byte hash differ from the stored blob permanently. Each consumer names its revision, and all three are git-computed so the transforms cancel:

| Who | Revision compared | How it is obtained |
| --- | --- | --- |
| `design verdict` (write) | the working-tree `.pen` — the content that will enter the index | the lifted `blobIdOfWorktreeFile` helper (`git hash-object --path <p> -- <p>`) |
| `checks shared-files` (guard) | the **index** entry for the staged `.pen` | the destination oid in `git diff --cached --raw -z --no-abbrev` |
| `ui-reviewer` (lane) | the **review-head tree** entry, for both the `.pen` and the record | `git rev-parse <head>:<path>` for the oid, `git cat-file blob <head>:<record>` for the bytes |

The write and the guard agree because `git add` stores exactly the object `hash-object --path` computes; the lane reads both artifacts from one tree, so it never compares across revisions.

Binding by blob rather than by path buys two things: the approval survives `design archive`'s `git mv` for free (a move changes the tree entry, not the blob), which is what lets the record live outside `docs/design/ui/`; and it self-invalidates — edit the `.pen` after the verdict and the recorded blob no longer describes the design on disk. That answers Q-0186's R4 in the other direction: not "was the operator shown the real file", which that spec closed, but "is the file still the one that was shown".

The directory is tracked: `.gitignore` lists `.noldor/design/` and `.noldor/session.json`, and `.noldor/design-approval/` is deliberately neither, exactly as `.noldor/ui-capture/` is neither.

### D3 — Where the module lives

`src/design/design-approval.ts`, beside `archive-resolve.ts` in the c58 neighbourhood that already owns the artifact-naming vocabulary (`src/core/design-artifact-names.ts`) and that both consumers already import from. It owns the record: the union schema, the record-specific bytes-to-record parse built on the core policy below, an atomic write, and the path helper — the same four exports `ui-capture.ts` has, in the same order.

**The shared helpers lift to `src/core/` rather than being written twice.** `blobIdOfWorktreeFile` (`src/design/ui-capture.ts:79`) already runs `git hash-object --path <p> -- <p>` with exactly D2's rationale, and `parseReceiptBytes` already fixes a lenient-read policy (unusable bytes → `null`) for a `.noldor` receipt. Both lift into `src/core/`, and each consumer takes only what its revision needs: the CLI is the sole user of the worktree hash; the guard and the lane read oids from `--raw` and `rev-parse` respectively and use the parse policy on record bytes. `ui-capture.ts` becomes an importer — also what the clone ratchet expects, since a second implementation would trip it.

**The path helper routes through the repo's containment choke point.** `receiptPath` (`src/design/ui-capture.ts:57`) runs its surface through `parseSlug` + `slugPath` for exactly this reason, and the record helper does the same with the pen stem. The stem is derived from a caller-supplied `--pen` path, so without the guard `--pen ../../../../etc/x.pen` would write outside `.noldor/design-approval/`. This is the Q-0097 branded-`Slug` discipline and it is not optional on a path built from an argument.

**Error policy.** Absent and unreadable-or-malformed records are distinct at the boundary and collapse to the same refusal downstream — "no usable record", never a pass, since fail-open would make the feature decorative. The parse returns `null` for unusable bytes rather than throwing, matching `parseReceiptBytes`. A write to a stem whose record exists **overwrites**: re-taking the verdict on a revised design is the normal remedy, and refuse-if-exists would make the stale case unrecoverable. `design verdict` exits non-zero having written nothing on: both or neither mode flag, a flag from the other mode (`--reason` with `--approve`, `--surface` with `--waive`), a `--pen` that fails containment, does not exist, or whose stem yields no key, or a git hash failure. Containment for `--pen`: the path must **realpath-resolve** inside `<repo>/docs/design/ui/` and outside `baseline/` — symlinks, traversal and absolute paths all resolve before the test. `archive/` is deliberately inside it: gate Step 4 archives the `.pen` in the flip commit *before* the code-stage lane runs, so a re-verdict on an archived design is a legitimate call, not an error.

The alternative — extending `ui-capture.ts` — is rejected: that module's whole docstring is about the capture ordering proof, and a second record kind with different semantics inside it would make one file answer two questions. The alternative of a new top-level `src/approval/` is rejected for the opposite reason: one module does not earn a directory.

### D4 — Where it is enforced

Two points, because the entry's deletion test is worded as "cannot **reach** the code stage" and a code-stage lane catches the failure one implementation pass too late. The early point meets the test; the late point keeps it met after the commit that satisfied it.

**Early — the pre-commit guard.** `src/checks/check-shared-files.ts` already refuses two classes of staged `.pen` through a `BlockReason` union (`pen-baseline`, `pen-archive`), in the pre-commit `validate` group. Two members join it: `pen-unapproved` refuses a staged feature `.pen` for which the commit's tree holds **no usable record** — absent, unreadable, or failing the strict schema — and `pen-approval-mismatch` refuses one whose record parses but whose `penBlob` names a different object than the `.pen` being staged. Separate reasons because the remedies differ: take a verdict at all, versus re-take it on the design as it now stands.

Presence of a record path in the staged set is deliberately **not** the test: that would admit a malformed record, one staged for deletion, and — the case that matters — approve-then-edit-then-commit-both, exactly the failure the blob binding exists to catch. The guard compares objects, not filenames.

**How, without becoming impure.** The staged read moves from `git diff --cached --name-status -z` to `git diff --cached --raw -z --no-abbrev`, whose records carry the destination object id — `--no-abbrev` because the raw format abbreviates by default (probed: `ce01362` where `hash-object` returns the full 40 hex), and an abbreviated oid can never equal the stored `penBlob`, so every correct approval would refuse. A destination oid of all zeros (a delete, or an unmerged entry) is not a content id and never satisfies a comparison. `StagedChange` gains a `blob` field, and `parseNameStatus` becomes `parseRawDiff`, keeping its rename/copy expansion (`R` → `delete(old) + add(new)`, `C` → `add(new)`, so a renamed or copied `.pen` is an add and is caught). `evaluate` (the pure decision over the staged list) additionally receives `records: (recordRelPath: string) => string | null` — the record bytes **the resulting tree will hold** — and does its own strict parse and oid comparison. The impure caller builds that lookup with delete-aware precedence: a staged **delete** of the record path resolves to `null` outright — never a fall-through to `HEAD`, where the doomed copy still exists and would fail open; a staged add or modify supplies the staged blob's bytes; only a path absent from the staged set entirely reads `git cat-file blob HEAD:<record path>`. That `HEAD` leg is what leaves no state without a legal exit: `git add` on an unchanged tracked file stages nothing, so a record committed before its `.pen` (split commits, a reordering rebase, a re-added pen) could never satisfy a staged-set-only test. The requirement is presence *in the resulting tree*, not *in this commit's diff*.

**Scope.** The guard is independent of `consumer.uiPaths` — a rule about `.pen` files entering the repository, not about whether a session is UI-bearing — and, like the two existing rules, tests hardcoded prefix constants rather than calling `loadDocRoots`; only the lane half is config-gated. It fires only on an `add`: the two points get non-overlapping jobs (**a design entering the repo must carry its verdict; drift after that is the lane's**), it mirrors `pen-archive`'s own `change !== 'add'` test, and a `.pen` predating this feature is never hard-blocked by a rule that did not exist when it started. The guarantee is the Goals' invariant — exact within its scope; outside it, the lane reports.

Two placement details the implementation must not get wrong. The new rules sit **before** the `penAllowed` short-circuit: `NOLDOR_ALLOW_PEN_WRITE` authorises gate Step 4's baseline write-back, and a baseline override must not waive an approval requirement it has nothing to do with. And the guard never reads `.noldor/session.json` — which is why D2's record is a union rather than a session lookup.

**An unparseable filename refuses rather than passes.** `penSlugFromFilename` returns `null` for a basename outside its dated pattern (`docs/design/ui/foo.pen` yields no stem). Treating that as "no rule applies" would make an undated filename the bypass, so such a `.pen` is refused under `pen-unapproved`, with remedy text naming the `<date>-<key>.pen` shape (`penFileName` builds it): a file the naming scheme cannot identify is one no record can name.

Gate Step 2.5 prose was reconsidered and rejected again, for a new reason: its Q-0186 objection (no legal exit) is now void, but prose is the very class D1 says cannot close this — a paragraph would add surface without adding a guarantee.

**Late — the lane branch.** In `resolveUiReviewTarget` (`src/cr/lanes/ui-design-resolve.ts`), immediately after the `owned.length` checks resolve a single design. It reads the record for `owned[0]`'s stem from the review-head tree:

| Record at the review head | Lane outcome |
| --- | --- |
| absent, unreadable, or failing the strict schema | `cannot-review` / `design-unapproved` |
| `penBlob` differs from the tree's `.pen` blob (either member) | `cannot-review` / `design-approval-stale` |
| `outcome: approved`, `penBlob` matches | proceed to review |
| `outcome: waived`, `penBlob` matches | `not-applicable` / `waived` |

The last row is where session and tree could diverge: `session.uiWaiver` short-circuits earlier in the same function, so the record is only consulted for a waived design when the marker is gone but the tree is not — a re-review from a fresh checkout. A matching `waived` record as approval would be a silent bypass; as `design-unapproved` it would red a session that did what the framework told it to. `not-applicable` / `waived` is the answer the marker would have given, so the sources cannot disagree — which is why D2's invariant says "approved, or explicitly waived". A `waived` record whose blob does not match still goes `design-approval-stale`.

The guard alone would not be enough: it fires only on an add, and a later commit can edit the committed design, leaving the record describing a file that no longer exists in that form. The stale branch catches that, and it needs the review head the lane already resolves — along with the verdict, the waiver precedence, the dialogue key and the `branchAdded` ownership gate, all computed above it in the same function. That is the argument against a new `checks design-approval` pre-push job: re-derivation of all five, at the wrong frequency.

Teeth at the late point come from the existing mode matrix: `makeTerminalWriter` reds a `cannot-review` only under `blocking`, and `loadLaneMode(repo, 'uiReviewMode')` defaults to `advisory`. The early point has no such knob — deliberate: it has a one-command remedy in front of it, and a guard that only warned would leave the deletion test unmet again.

### D5 — Where it is written

One CLI verb with two mutually exclusive modes, matching the shape `design capture --vouch-only` already uses (a flag selecting the mode inside a verb, rather than a second verb sharing one atomic write):

```
pnpm noldor design verdict --pen <path to the session's .pen> --approve --surface <s> [--surface <s>...] [--reservation <text>]
pnpm noldor design verdict --pen <path to the session's .pen> --waive --reason <text>
```

It takes the `.pen` **path**, not a key: the file is what it must hash anyway, and deriving the stem from the path it just read removes the caller error where a hand-typed key names a different artifact than the one being ratified. The caller resolves that path by dialogue key against `docs/design/ui/`, matching `penSlugFromFilename` — never by re-deriving today's date, which a session resumed after midnight gets wrong (Q-0186's own trap). The CLI hashes the working-tree file and writes the record atomically.

**Write ordering.** The approval sentence in `## Design` and the record are two writes; **the record is authoritative** — it is the only one a gate reads — and it is written **last**. That makes the failure modes unequal in the right direction: a sentence with no record is refused loudly at the next commit with a one-command remedy, while a record with no sentence would be a silent claim of ratification. A non-zero `design verdict` exit is a failed verdict step — the skill surfaces it and does not proceed as approved (or waived) until a re-run exits 0; re-running is idempotent because a write overwrites (D3).

The record commits with the spec and the `.pen` at gate Step 2.5, reaching `main` in the same change as the design it describes.

Two call sites in `/noldor-spec` step 1.5, both inside the verdict step: `(f) On approve only, write it` gains the `--approve` form, run after the approval sentence lands (`(g)` adds `--reservation`; `(e)`'s revise writes nothing); the **Waiver after Seed** paragraph gains the `--waive` form alongside the marker and the prose note, so the committed-but-unratified `.pen` carries its reason to `main`. A waiver **before** Seed writes nothing and needs nothing: no `.pen` exists, so the guard has nothing to refuse and the lane's short-circuit fires first.

### D6 — Rejected alternatives

The entry names three; each is rejected for the reason it names, restated against what is now known.

**Sidecar `<stem>.approval.json` beside the `.pen`.** Rejected: `resolveArchivePlan` and garden's detectors would each need a fourth artifact kind, while under `.noldor/` the record never enters that scan — and blob binding removes the only benefit co-location offered.

**`Noldor-Design-Approved` commit trailer.** Rejected: it re-earns on every amend — the failure the gate's delta-re-earn bullet exists to work around — and it lives in history, unreadable in a squash-merged clone (`ui-capture.ts`'s docstring makes this argument already).

**FD frontmatter field.** Rejected: the FD never archives, and on an attach path it is the *parent* — one session's approval recorded on a document every future session shares, the same defect that makes `design: skip` the wrong tool here.

**A new `checks design-approval` pre-push job.** Rejected per D4 — re-derivation, wrong frequency, wrong stage. Noted rather than hidden: because the receipt is on disk and machine-readable, a consumer who wants a push gate can write one against `.noldor/design-approval/` with no further framework work. That is the difference this feature makes, and it is worth stating plainly as the actual deliverable.

### D7 — Surfaces changed

- `src/design/design-approval.ts` — new. Union schema, read, atomic write, path helper.
- `src/design/design-approval-cli.ts` — new. `design verdict --approve | --waive`.
- `src/core/blob-id.ts` — new. `blobIdOfWorktreeFile` lifted out of `src/design/ui-capture.ts`, plus the lenient-read policy (`unusable bytes → null`) lifted from `parseReceiptBytes`; record-specific parsing stays in the design-approval module (D3). `src/design/ui-capture.ts` becomes an importer rather than the owner.
- `src/cr/findings-schema.ts` — two new `LaneReasonCode` members (`design-unapproved`, `design-approval-stale`).
- `src/cr/lanes/ui-design-resolve.ts` — the record branch after the ownership gate, per D4's table.
- `src/checks/check-shared-files.ts` — `parseNameStatus` → `parseRawDiff` over `--raw -z --no-abbrev`, a `blob` field on `StagedChange`, the delete-aware `records` lookup parameter on `evaluate`, two new `BlockReason` members (`pen-unapproved`, `pen-approval-mismatch`) and their remedy messages.
- Skill prose, both copies, kept byte-identical by `checks template-sync`: `.claude/skills/noldor-spec/SKILL.md` and `templates/.claude/skills/noldor-spec/SKILL.md` — the `--approve` command in verdict step (f) (step (g) adds `--reservation` to it, not a second call), and the `--waive` command in the Waiver-after-Seed paragraph.
- Command registration, both copies: `src/cli/manifest.ts` and `docs/noldor/script-catalog.md`, plus `templates/docs/noldor/script-catalog.md` — one row for `design verdict`. `docs/noldor/script-catalog.md` is hand-maintained and gated by `pnpm noldor validate script-catalog`, which joins on both the manifest row and the leaf `<group> <sub>` name (Q-0147), so the row must name `design verdict` exactly.
- `.gitignore` — no change; `.noldor/design-approval/` is tracked by omission, and a test asserts that rather than assuming it.

### D8 — What self-host can and cannot prove

Noldor declares no `consumer.uiPaths`, so the lane branch never fires here — Q-0186's R3, unchanged. The guard is different, and this is the one place where this feature is testable in self-host where Q-0186 was not: `evaluate` remains a pure function over data — a staged-change list plus a `records` lookup — so every one of its refusals is unit-testable with no config, no `.pen`, no git and no editor. That covers the point that meets the deletion test, which is precisely the half Q-0186 could not test at all.

Unit tests cover everything below the conversation. On the guard: absent, malformed, schema-invalid, blob-mismatched and matching records; both union members; `add` versus `modify`; rename and copy resolving to the destination `add`; the record found in `HEAD` rather than the staged set; an unkeyable filename; independence from `NOLDOR_ALLOW_PEN_WRITE`; and baseline/archive paths keeping their existing reasons. On the module: round-trip for both members, strict-schema rejection of an unknown field, overwrite-on-existing, and `--pen` path containment. On the lane: each row of D4's table, under both lane modes. Plus the archive-move-preserves-blob property, which is what lets the record live outside `docs/design/ui/`.

What no test here can reach is the seam from a verdict to a written record, because that seam is a conversation. The end-to-end scenarios — a `required` session that approves, one that edits the `.pen` after approving, and one waived after Seed — run in a consumer that declares `uiPaths`: charuy, the same repo Q-0186's verification scenarios were deferred to.

## Acceptance criteria

1. `design verdict --pen <p> --approve` writes `.noldor/design-approval/<stem of p>.json` with `outcome: approved`, `at`, `penBlob` and a non-empty deduplicated `surfaces`; `--waive` writes `outcome: waived` with a `reason`. A revise verdict writes no file. Both modes, neither mode, or a flag belonging to the other mode exits non-zero having written nothing.
2. `penBlob` equals git's object id for the `.pen` — the same value `git add` stores — on both members; the write is atomic and overwrites an existing record for the same stem.
3. Two `.pen` files sharing a dialogue key but differing in date get two distinct records, and writing one does not disturb the other.
4. Approve-with-reservations records the reservation text; a plain approve omits the field. An unknown field makes a record unusable (`.strict()`).
5. `.noldor/design-approval/` is tracked — a record written there is staged by an ordinary `git add` and is matched by no `.gitignore` rule.
6. Adding a feature `.pen` whose stem has **no usable record in the resulting tree** — absent, unreadable, or schema-invalid — is refused by `checks shared-files` with reason `pen-unapproved`. A record satisfies the guard whether it is staged in the same commit or already present in `HEAD`.
7. Adding a feature `.pen` whose record parses but whose `penBlob` names a different object is refused with reason `pen-approval-mismatch` — including the approve-then-edit-then-commit-both sequence, which must not pass.
8. A staged `modify` of an already-committed feature `.pen` is not refused by the guard; a rename or copy into the feature directory is, because its destination resolves to an `add`.
9. The guard does not fire on a staged baseline or archived `.pen` — those keep their existing `pen-baseline` / `pen-archive` reasons and precedence — `NOLDOR_ALLOW_PEN_WRITE=1` waives neither new reason, and a staged feature `.pen` whose basename yields no stem is refused under `pen-unapproved`.
10. `evaluate` reaches every verdict above from its arguments alone — a staged-change list and a record lookup — with no filesystem, config or git access of its own.
11. The record path helper refuses a `--pen` whose derived stem would escape `.noldor/design-approval/`, via the same `parseSlug` + `slugPath` containment `receiptPath` uses.
12. At the review head, the lane maps the record onto D4's table: no usable record → `cannot-review` / `design-unapproved`; `penBlob` mismatch on either member → `cannot-review` / `design-approval-stale`; matching `approved` → review proceeds; matching `waived` → `not-applicable` / `waived`.
13. Both new lane terminals red under `uiReviewMode: blocking` and stay green under `advisory`, with no change to the existing mode matrix.
14. A session carrying `uiWaiver` resolves `not-applicable` / `waived` before the record is read — the short-circuit keeps its current precedence — and a `uiVerdict: skip` session reaches no new lane branch and writes no record.
15. A repo with no `consumer.uiPaths` reaches no new *lane* branch; the guard still applies to any feature `.pen` it stages, because the guard is config-independent by design.
16. Archiving the `.pen` (`design archive`, a `git mv`) leaves a previously written record valid — the blob is unchanged, so the design resolves to review rather than to `design-approval-stale`.

## Risks / trade-offs

- **R1 — A record is evidence of a click, not of judgment.** It proves a verdict was taken against a specific blob, not that the operator looked. Q-0186's D2 closed "was the operator shown the real file"; this closes "is it still that file" and leaves the rest open by construction.
- **R2 — One more thing that can go stale.** Iterating on the `.pen` after approving now yields a red where before there was nothing. That is the feature working, but it is new friction on a surface meant to be cheap; mitigated by the lane's default `advisory` mode and a one-command remedy.
- **R3 — The guard is a hard block, and the framework has few.** No advisory mode, no config knob — deliberate (D4), but a bug in the stem parse or the raw-diff read would block commits for a fine flow. Mitigations: add-only scoping makes it reachable only on the commit introducing a design; the `HEAD` fallback removes the no-exit states; `evaluate` stays pure, so every refusal is exhaustively unit-testable without git.
- **R4 — Sixteen acceptance criteria is above the usual budget.** Six enumerate guard outcomes a single "refuses an unratified design" criterion would hide; each is a state a fail-open bug could land in silently, so the specificity is the point.
- **R5 — The conversation-to-record seam is unexercised in self-host.** Q-0186 R3 narrowed: the guard is fully unit-testable here, but nothing in this repo can produce a verdict, so the first evidence the skill actually calls `design verdict` lands in a consumer, after this PR.
- **R6 — New members on two shared unions.** Both additions are additive and old sinks still parse, but `laneReasonCodeSchema` is carrying a long tail of `cannot-review` classes and drifts toward per-lane partitioning. Worth an entry if it grows again.
- **R7 — `parseNameStatus` becomes `parseRawDiff`, and it is exported.** A real API change — name, signature, output shape, plus a required parameter on `evaluate` — to a file the pre-commit chain depends on. Both symbols are consumed only by `check-shared-files.ts` and its test today, so the blast radius is one file; a partial migration would break commits repo-wide rather than failing a test.

## User Story

As an operator shipping a UI-bearing feature, I want my verdict — an approval, or an explicit waiver when the editor was unreachable — recorded on disk against the exact `.pen` it names, so that a commit adding a design nobody ratified is refused before implementation begins rather than reported after it.

## Usage

- Automatic on UI-bearing sessions: at `/noldor-spec` step 1.5 an `approve` verdict writes its sentence into `## Design`, then runs `pnpm noldor design verdict --pen docs/design/ui/<date>-<key>.pen --approve --surface <s>...`; the record at `.noldor/design-approval/<date>-<key>.json` commits with the spec and the `.pen` at gate Step 2.5.
- `approve with reservations` adds `--reservation "<text>"`; the reservation is recorded beside the approval in both the spec prose and the record.
- A waiver taken after Seed runs the same verb with `--waive --reason "<why>"`, alongside the existing `uiWaiver` marker and spec note, so the committed-but-unratified design carries its reason to `main`. A waiver taken before Seed runs nothing — there is no `.pen`.
- Committing a `.pen` with no valid record is refused by the pre-commit `shared-files` job: `pen-unapproved` when no usable record is in the tree, `pen-approval-mismatch` when the record names a different version of the design. Both remedies name the command to run.
- At code stage the `ui-reviewer` lane re-checks the record at the review head, catching a design edited after its verdict (`design-approval-stale`) and one that reached the branch without a record (`design-unapproved`). Under the default `autonomous.uiReviewMode: advisory` this reports; set `blocking` to gate on it.
- Remedy for either stale outcome is the same: re-take the verdict on the design as it now stands and re-run `design verdict`, which overwrites the record.
- Nothing to configure. The lane half never fires in a repo with no `consumer.uiPaths`; the guard applies to any feature `.pen` that repo commits.

## Open questions (resolved)

1. *Is an enforceable signal worth its cost, or is Q-0196 answered by Q-0186?* -> **Worth it, in the reduced form here** (D1). Every mechanism it needs already exists in this feature, so the marginal cost is one module plus two branches — and prose alone has repeatedly failed to close the "controller skipped the step" class.
2. *Where does the record live, and what keys it?* -> **`.noldor/design-approval/<pen-stem>.json`, tracked** (D2). Q-0186 weighed only the two gitignored `.noldor` paths, while `.noldor/ui-capture/` proves a tracked receipt there is an established pattern. The stem rather than the dialogue key because the key is not injective: two dated `.pen` files sharing one would collide, and a later verdict would overwrite the only record of an already-archived design.
3. *What binds the record to the design?* -> **Git's blob id, with the compared revision named per consumer** (D2). It survives the archive `git mv`, self-invalidates on an edit, and — unlike a byte hash — cannot break under autocrlf or a clean filter; no comparison ever spans two revisions.
4. *Which enforcement point?* -> **Two, both extending existing code** (D4): a pre-commit refusal in `checks shared-files` — the entry's test says a session cannot *reach* the code stage, and a lane firing there is one pass too late — and the `resolveUiReviewTarget` branch. Gate Step 2.5 prose is rejected again: its Q-0186 objection is void, but prose is the class D1 says cannot close this.
5. *Path-presence test, or validated binding?* -> **Valid and matching** (D4). Presence would admit a malformed record, one staged for deletion, and approve-then-edit-then-commit-both — the case the binding exists to catch. `--raw -z --no-abbrev` hands `evaluate` the full object id as data, so it stays pure; a staged delete of the record resolves to absent, never to the `HEAD` copy.
6. *Must the record be staged in the same commit?* -> **No — the resulting tree decides** (D4). A staged-set-only test has no legal exit for split commits or a reordering rebase; a staged delete resolves to absent with no `HEAD` fallback.
7. *Does the guard fire on every staged feature `.pen`, and can an override waive it?* -> **Only on an add, and no** (D4). Add-only gives the two points non-overlapping jobs and keeps a pre-existing `.pen` from being hard-blocked; `NOLDOR_ALLOW_PEN_WRITE` authorises an unrelated permission (the Step 4 baseline write-back).
8. *Blocking or advisory?* -> **Advisory at the lane, unconditional at the guard** (D4). The lane keeps `loadLaneMode`'s default; the guard has a one-command remedy in front of it, and one that only warned would leave the deletion test unmet.
9. *How does the guard admit Q-0186's waiver-after-Seed?* -> **The union's `waived` member, which the waiver writes; a matching one resolves `not-applicable` / `waived` at the lane** (D2, D4). Reading `session.uiWaiver` instead would rest a commit decision on transient gitignored state and leave `main` with no trace of why a design is unratified; the record gives the same answer the marker would, so they cannot disagree. The enforced invariant is therefore "approved, or explicitly waived".
10. *Are `surfaces` verified, and is stale distinct from absent?* -> **No, and yes** (D2, D4). The authoritative set lives in `FINAL:` pages no check can read, so the list is descriptive metadata; absent and stale get separate reasons at both points because their remedies differ.
11. *One CLI verb or two, and does it take a key or a path?* -> **One `design verdict`, taking `--pen <path>`** (D5). A flag selecting the mode matches `design capture --vouch-only` and keeps one writer for a union record. The path is what it must hash anyway, and deriving the stem from it removes the error where a hand-typed key names a different artifact than the one being ratified.
12. *Which of the sentence and the record is authoritative if one write fails?* -> **The record, written last** (D5). That ordering makes the survivable failure the loud one: a missing record is refused at the next commit, a missing sentence would be a silent ratification claim.
13. *Should the record be archived alongside the `.pen` at gate Step 4?* -> **No** (D2, D6). Blob binding makes co-location unnecessary, and moving it would hand `resolveArchivePlan` the fourth artifact kind this design exists to avoid.
