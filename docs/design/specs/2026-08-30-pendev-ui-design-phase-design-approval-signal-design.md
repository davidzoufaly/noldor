# Enforceable Design-Approval Signal — Design

**Slug:** pendev-ui-design-phase
**FD:** docs/features/pendev-ui-design-phase.md
**Date:** 2026-08-30
**Tier:** specs-only
**Deps:** Q-0186 (design-approval step, shipped PR #399), Q-0190 (capture receipt, shipped PR #401)

## Problem

Q-0186 shipped the operator design verdict as `/noldor-spec` step 1.5 prose: the session's `.pen` is opened by path, its `FINAL:` pages are walked, an atomic approve/revise is taken, and an approval sentence lands in the spec's `## Design`. Its own spec states the reduction outright — the verdict is chat-only, so nothing on disk distinguishes an approved design from an unapproved one, and no gate can read it. The entry's deletion test ("a UI-bearing session **cannot** reach the code stage without a recorded design verdict") was explicitly not delivered.

Q-0186's open question 1 asked where the approval record could live and answered "nowhere", having weighed exactly two locations: `.noldor/session.json` and `.noldor/design/`. Both are gitignored, so neither can carry anything to `main`. That reasoning is sound for those two paths and does not generalise: `.noldor/` also holds **tracked** state, and one instance of it — the UI-capture receipt at `.noldor/ui-capture/<surface>.json`, shipped by Q-0190 three weeks later — is precisely a committed, machine-readable, git-blob-bound receipt written by a step that succeeded. The artifact class Q-0186 concluded did not exist now exists in the same feature.

So the open question is narrower than the entry states. It is not "can an approval be persisted" — it can, with an established pattern. It is whether persisting it buys enough over the chat-only verdict to be worth a new module, a new CLI verb and two refusal branches, given that the realistic cost of a skipped verdict is one wasted implementation pass.

## Goals

- Decide, with the framework's advisory-with-teeth posture as the yardstick, whether an enforceable approval signal is worth its cost — and record the reasoning either way, so this entry is not re-opened a third time.
- If it is worth it: persist the verdict as a record a gate can read, bound to the design it ratified strongly enough that a later edit to that design invalidates it.
- Meet the entry's deletion test as worded — *cannot reach* the code stage, not "is caught once it gets there" — which means at least one refusal must land before implementation begins.
- Extend the refusal points that already exist rather than adding parallel ones. `resolveUiReviewTarget` already refuses a UI-bearing session that owns no design, and `checks shared-files` already refuses two classes of staged `.pen`; each gains one more case rather than a new mechanism.
- Keep the cost proportional: no new artifact kind for `resolveArchivePlan` or garden to learn, no new pre-push job, no new hook, and no re-derivation of the verdict/waiver/ownership logic that already exists in one place.

## Non-goals

- Verifying that the approved design matches what was built. That is the `ui-reviewer` lane's job and Q-0145 already owns it; this signal records *that* an operator approved *which* artifact, not whether the implementation honours it.
- Verifying that the spec's named variant matches the approved page. Q-0186's R4 second half stays open — the operator still approves what the agent renders.
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

That last line is the finding that shapes D3. Placing the record module beside `ui-capture.ts` would mint a new c20→c112 cross-community edge for a single read; placing it in c58, where the dialogue key already lives and where c20 already has edges, adds no bridge. The same reading also settles D4's early point: `src/checks/check-shared-files.ts` is itself in c58, so the guard reads the record from inside its own community.

Neither file the change edits defines a god node — the two in range are `loadDocRoots()` (rank #1, 80 edges, c25) and `loadConsumerConfig()` (rank #2, 40 edges, c69), both reached transitively and neither modified. The edited surface is interior, which is itself the finding: this is an extension along existing seams, not a new coupling.

### D1 — Is it worth building at all?

Recommendation: **yes, in the reduced form below** — but the case is genuinely close and this section states both sides, because the entry's own confidence is `low` and a "no" here is a legitimate outcome that should retire the entry rather than leave it circling.

Against: the framework's posture is advisory-with-teeth, the realistic cost of a skipped verdict is one wasted implementation pass, and Q-0186 already put the question in the right place. Every enforcement mechanism has a bypass cost paid by every honest session forever, in exchange for catching a controller that skipped a step.

For: the cost here is unusually low because none of the machinery is new — the receipt shape, both refusal points, the mode knob and the ownership gate all exist and are all already exercised by this same feature. What is being added is one module, one CLI verb, two `LaneReasonCode` members with one resolver branch, and one `BlockReason` member with one guard branch. And the failure it catches is not "an operator forgot" but "a controller silently skipped a prose step", which is the failure class the framework has repeatedly found prose cannot close on its own — the same reasoning that put `withMandatoryReviewer` in code after the gate's `proceed-without-review` option was removed in prose.

### D2 — The record

One file per dialogue key at `.noldor/design-approval/<dialogue-key>.json`, written by the verdict step, mirroring `src/design/ui-capture.ts`. It is a discriminated union on `outcome`, because a UI-bearing session has two legitimate ways to commit a `.pen` and both need a record:

```
{ "outcome": "approved", "at": "<ISO-8601>", "penBlob": "<git oid>",
  "surfaces": ["<affected surface>", "..."], "reservation": "<text>" }   // reservation optional

{ "outcome": "waived",   "at": "<ISO-8601>", "penBlob": "<git oid>",
  "reason": "<why the verdict could not be taken>" }
```

The `waived` member exists because Q-0186's waiver-after-Seed is a legitimate flow: the bridge dies mid-iteration or at the verdict, and D4 of that spec deliberately keeps the seeded `.pen` and commits it, so `links.design` and the archive repoint pass are not orphaned. Without a record for that case the guard in D4 would refuse a flow the framework endorses.

Writing it, rather than teaching the guard to read `session.uiWaiver`, is what keeps the guard a pure question about the staged set. A pre-commit check should not take transient per-worktree state as input to a commit decision, and `.noldor/session.json` is gitignored — so today nothing on `main` records *why* a committed `.pen` is unapproved except spec prose. A `waived` record puts that beside the design in machine-readable form, which is strictly more than Q-0186 left. The session marker keeps `uiWaiver` unchanged and remains the lane's short-circuit; the two can never disagree in a way that changes an answer, because the session never reaches `main` and the lane tests it first.

`penBlob` is carried by **both** members, so a `waived` record goes stale on a later `.pen` edit exactly as an `approved` one does — a waiver ratifies the artifact that was committed, not any future version of it.

`penBlob` is git's own object id (`git hash-object`), 40 hex under sha1 and 64 under sha256, for exactly the reason `ui-capture.ts` gives for `baselineBlob`: the comparison at verdict time is against the blob git stored, and any working-tree transform (`core.autocrlf`, a `text=auto` attribute, a clean filter, LFS) would make a raw byte hash differ from the stored blob permanently, minting a mismatch no re-approval could clear.

Binding by blob rather than by path buys two things. The approval survives `design archive`'s `git mv` for free, because a move changes the tree entry and not the blob — which is what lets the record live outside `docs/design/ui/` without losing its attachment to the archived artifact. And it invalidates itself: iterate on the `.pen` after approving and the blob changes, so the recorded approval no longer describes the design on disk. That closes the cheap half of Q-0186's R4 in the other direction — not "was the operator shown the real file", which D2 of that spec already closed, but "is the file still the one that was shown".

The directory is tracked. `.gitignore` lists `.noldor/design/` and `.noldor/session.json`; `.noldor/design-approval/` is deliberately neither, exactly as `.noldor/ui-capture/` is neither.

### D3 — Where the module lives

`src/design/design-approval.ts`, beside `archive-resolve.ts` in the c58 neighbourhood that already owns the dialogue key (`src/core/design-artifact-names.ts`) and that both consumers already import from. It exports the union schema, the read, the atomic write and the path helper, in the same shape and order as `ui-capture.ts`, and it keys on the dialogue key rather than a surface because the verdict is atomic over the whole `FINAL:` set (Q-0186 OQ4).

The alternative — extending `ui-capture.ts` — is rejected: that module's whole docstring is about the capture ordering proof, and a second record kind with different semantics inside it would make one file answer two questions. The alternative of a new top-level `src/approval/` is rejected for the opposite reason: one module does not earn a directory.

### D4 — Where it is enforced

Two points, because the entry's deletion test is worded as "cannot **reach** the code stage" and a code-stage lane catches the failure one implementation pass too late. The early point is what meets the test; the late point is what keeps it met after the commit that satisfied it.

**Early — the pre-commit guard.** `src/checks/check-shared-files.ts` already parses `git diff --cached --name-status -z` and already refuses two classes of staged `.pen` through a `BlockReason` union (`pen-baseline`, `pen-archive`), in the pre-commit `validate` group. A third member, `pen-unapproved`, refuses a staged **feature** `.pen` — one under `roots.designUi` that is neither `baseline/` nor `archive/` — when its `change` is `add` and no record for its dialogue key is staged alongside it. This is the gate Step 2.5 commit, so the refusal lands before implementation begins, and it is code in a job that already runs rather than prose a controller can skip. `penSlugFromFilename` (already in that file's own community, via `src/core/design-artifact-names.ts`) yields the key.

Scoping it to `add` is what gives the two points non-overlapping jobs: **a design entering the repo must carry its verdict, and drift after that is the lane's.** It mirrors the existing `pen-archive` rule, which already keys on `entry.change !== 'add'`, and it means a consumer session whose `.pen` landed before this shipped is never hard-blocked by a rule that did not exist when it started — that case degrades to the lane's advisory report instead.

Three placement details the implementation must not get wrong.

The new rule sits **before** the `penAllowed` short-circuit (`if (penAllowed || !isPen(entry.path)) continue;`): `NOLDOR_ALLOW_PEN_WRITE` exists to authorise gate Step 4's baseline write-back, and a baseline override must not waive an approval requirement it has nothing to do with.

`decideViolations` stays **pure over the staged list**. Both existing `.pen` rules test hardcoded prefix constants (`UI_BASELINE_DIR`, `ARCHIVE_DIR`) rather than calling `loadDocRoots`, and the new rule follows that: a `docs/design/ui/` prefix constant from the same module, never a config or filesystem read. The record's presence is likewise decided from the staged paths, not from disk — a record that exists but is unstaged does not satisfy the guard, which is exactly right, since the guard's whole question is what this commit will contain.

And the guard never reads `.noldor/session.json` — which is why D2's record is a union rather than a session lookup.

Gate Step 2.5 prose was reconsidered and rejected again, for a new reason. Q-0186 rejected it for having no legal exit; the exit now exists (`design verdict`, in either mode). It is rejected here because it is prose, and D1's whole argument is that prose cannot close the "controller silently skipped the step" class — adding a paragraph would add a surface without adding a guarantee.

**Late — the lane branch.** In `resolveUiReviewTarget` (`src/cr/lanes/ui-design-resolve.ts`), immediately after the `owned.length` checks resolve a single design. Read the record for the session's dialogue key; terminate `cannot-review` with a new `design-unapproved` reason code when it is absent, and with `design-approval-stale` when it exists but its `penBlob` does not match the blob of `owned[0]` at the review head.

The guard alone would not be enough, which is why both ship. It fires only when a `.pen` is added; a later commit can edit the committed design, and the record would then describe a file that no longer exists in that form. The stale branch is the only thing that catches that, and it needs the review head the lane already resolves.

Every precondition the lane branch needs is already computed above it in the same function: the UI verdict from `sessionUiVerdict`, the waiver short-circuit, the dialogue key from `dialogueKeyFromSession`, and the `branchAdded` ownership gate that proves the `.pen` belongs to this session. That is the whole argument for putting it here rather than in a new check — a `checks design-approval` pre-push job would have to re-derive all five, and would fire on every push instead of once at the code stage where a design finding belongs.

Teeth at the late point come from the existing mode matrix: `makeTerminalWriter` reds a `cannot-review` only under `blocking`, and `loadLaneMode(repo, 'uiReviewMode')` defaults to `advisory`. So the default posture there is "reported, not blocked". The early point has no such knob — `check-shared-files` blocks or it does not — which is deliberate: it is the point that has a one-command remedy in front of it, and a guard that only warned would leave the deletion test unmet again.

### D5 — Where it is written

One CLI verb with two mutually exclusive modes, matching the shape `design capture --vouch-only` already uses (a flag selecting the mode inside a verb, rather than a second verb sharing one atomic write):

```
pnpm noldor design verdict --key <dialogue-key> --approve --surface <s> [--surface <s>...] [--reservation <text>]
pnpm noldor design verdict --key <dialogue-key> --waive --reason <text>
```

It resolves the session's `.pen` the same way the lane does — by dialogue key, matching `penSlugFromFilename`, never by re-deriving today's date — hashes it, and writes the record atomically. The record then commits with the spec and the `.pen` at gate Step 2.5, so it reaches `main` in the same change as the design it describes.

Two call sites in `/noldor-spec` step 1.5, both inside the verdict step:

- `(f) On approve only, write it` — today writes only the approval sentence into `## Design`; it gains the `--approve` form. `(g)`'s approve-with-reservations passes `--reservation`. `(e)`'s revise writes nothing, unchanged.
- The **Waiver after Seed** paragraph — today records `uiWaiver` in the session marker and a note in spec prose; it gains the `--waive` form alongside both, so the committed-but-unapproved `.pen` carries its reason to `main`.

A waiver taken **before** Seed writes nothing here and needs nothing: no `.pen` exists, so the guard has no staged `.pen` to refuse and the lane's waiver short-circuit fires before the new branch.

### D6 — Rejected alternatives

The entry names three; each is rejected for the reason it names, restated against what is now known.

**Sidecar `<stem>.approval.json` beside the `.pen`.** Rejected: `resolveArchivePlan` walks `roots.specs`, `roots.plans` and `roots.designUi` and would need a fourth artifact kind, and garden's design detectors would need the same. Under `.noldor/` the receipt never enters that scan. Blob binding removes the only benefit co-location offered.

**`Noldor-Design-Approved` commit trailer.** Rejected: it re-earns on every amend — the exact failure `Noldor-Reviewed-Subagent` has and that the gate's delta-re-earn bullet exists to work around — and it lives in history rather than in the tree, so it is unreadable in a squash-merged clone. `ui-capture.ts`'s own docstring makes this argument for the ordering proof already.

**FD frontmatter field.** Rejected: the FD never travels into `archive/`, and on an attach path the FD is the *parent*, so one session's approval would be recorded on a document every future session of that feature shares. That is the same defect that makes `design: skip` the wrong tool here, which Q-0186's step 1.5 prose already warns about.

**A new `checks design-approval` pre-push job.** Rejected per D4 — re-derivation, wrong frequency, wrong stage. Noted rather than hidden: because the receipt is on disk and machine-readable, a consumer who wants a push gate can write one against `.noldor/design-approval/` with no further framework work. That is the difference this feature makes, and it is worth stating plainly as the actual deliverable.

### D7 — Surfaces changed

- `src/design/design-approval.ts` — new. Union schema, read, atomic write, path helper.
- `src/design/design-approval-cli.ts` — new. `design verdict --approve | --waive`.
- `src/cli/manifest.ts` + `docs/noldor/script-catalog.md` (and twins) — one row for the new subcommand.
- `src/cr/findings-schema.ts` — two new `LaneReasonCode` members.
- `src/cr/lanes/ui-design-resolve.ts` — one branch after the ownership gate.
- `src/checks/check-shared-files.ts` — a third `BlockReason` (`pen-unapproved`) and its remedy message.
- `.claude/skills/noldor-spec/SKILL.md` + its `templates/` twin — the `--approve` command in verdict step (f) (step (g) adds `--reservation` to it, not a second call), and the `--waive` command in the Waiver-after-Seed paragraph.
- `.gitignore` — no change; the new directory is tracked by omission, and this is asserted by a test rather than assumed.

### D8 — What self-host can and cannot prove

Noldor declares no `consumer.uiPaths`, so the lane branch never fires here — Q-0186's R3, unchanged. The guard is different, and this is the one place where this feature is testable in self-host where Q-0186 was not: `decideViolations` is a pure function over a staged-change list, so `pen-unapproved` is unit-testable with no config, no `.pen` and no editor. That covers the point that meets the deletion test.

Unit tests cover everything below the conversation: record round-trip for both union members, blob mismatch, absent record, the archive-move-preserves-blob property, the guard's add-versus-modify scoping and its independence from `NOLDOR_ALLOW_PEN_WRITE`, and the resolver's two new terminals under both lane modes.

What self-host cannot exercise is the seam from a verdict to a written record, because that seam is a conversation. The end-to-end scenarios — a `required` session that approves, one that edits the `.pen` after approving, and one waived after Seed — run in a consumer that declares `uiPaths`: charuy, the same repo Q-0186's verification scenarios were deferred to.

## Acceptance criteria

1. `design verdict --approve` writes `.noldor/design-approval/<dialogue-key>.json` with `outcome: approved`, `at`, `penBlob` and the affected surfaces; `--waive` writes `outcome: waived` with a `reason`; a revise verdict writes no file. The two modes are mutually exclusive.
2. `penBlob` equals git's object id for the `.pen` on disk, on both members, and the file is written atomically.
3. Approve-with-reservations records the reservation text; a plain approve omits the field.
4. `.noldor/design-approval/` is tracked — a record written there is staged by an ordinary `git add` and is matched by no `.gitignore` rule.
5. Adding a feature `.pen` to the index with no record for its dialogue key staged alongside is refused by `checks shared-files` with reason `pen-unapproved`; staging either member of the union alongside it is accepted, and a staged `modify` of an already-committed feature `.pen` is not refused.
6. The guard does not fire on a staged baseline or archived `.pen` — those keep their existing `pen-baseline` / `pen-archive` reasons and precedence — and `NOLDOR_ALLOW_PEN_WRITE=1` does not waive `pen-unapproved`.
7. A `uiVerdict: required` session with no waiver, owning a `.pen` with no record, resolves `cannot-review` with reason `design-unapproved`.
8. The same session with a record whose `penBlob` does not match the owned `.pen` resolves `cannot-review` with reason `design-approval-stale`, for both `approved` and `waived` records.
9. Both new terminals red under `uiReviewMode: blocking` and stay green under `advisory`, with no change to the existing mode matrix.
10. A session carrying `uiWaiver` resolves `not-applicable` / `waived` before either new lane branch is reached — the waiver short-circuit keeps its current precedence.
11. A `uiVerdict: skip` session, and a repo with no `consumer.uiPaths`, reach no new branch and write no record.
12. Archiving the `.pen` (`design archive`, a `git mv`) leaves a previously written record valid — the blob is unchanged, so the surface resolves to review rather than to `design-approval-stale`.

## Risks / trade-offs

- **R1 — Re-opening a question two specs have now answered.** Q-0186 answered "nowhere" on evidence that was correct for the two paths it weighed. If the operator's judgment is that the chat-only verdict is sufficient, the right outcome is to retire Q-0196 with that reasoning recorded, not to build the smaller thing anyway. D1 states both sides for that reason.
- **R2 — A receipt is evidence of a click, not of judgment.** It proves an approve verdict was taken against a specific blob. It cannot prove the operator looked. Q-0186's D2 already closed the cheap half of that (the pages are re-read from the file and opened in the editor); this closes the "is it still that file" half and leaves the rest open by construction.
- **R3 — One more thing that can go stale.** An operator who iterates on the `.pen` after approving now gets a red where before they got nothing. That is the feature working, but it is also new friction on a surface whose whole point was to be cheap. Mitigated by the default `advisory` mode at the lane and by the remedy being one command.
- **R4 — The guard is a hard block, and the framework has few.** `checks shared-files` refuses a commit outright; there is no advisory mode and no config knob. That is deliberate (D4), but it means a bug in the dialogue-key parse or in the staged-set read would block commits for a flow that is otherwise fine. The add-only scoping is the main mitigation — a session can always commit everything except the `.pen`, take the verdict, and commit again — and `decideViolations` being a pure function makes the failure modes cheap to test exhaustively.
- **R5 — The conversation-to-record seam is unexercised in self-host.** Same as Q-0186 R3, now narrowed: the guard is unit-testable here, but nothing in this repo can produce a verdict, so the first evidence that the skill actually calls `design verdict` lands in a consumer and after this PR.
- **R6 — Two new reason codes on a shared enum.** `laneReasonCodeSchema` is read by every lane's sink parser. Adding members is additive and old sinks still parse, but the enum is now carrying a long tail of `cannot-review` classes and is drifting toward needing per-lane partitioning. Not addressed here; worth an entry if it grows again.

## User Story

As an operator shipping a UI-bearing feature, I want my design approval recorded on disk against the exact `.pen` I approved, so that a session which skipped the verdict — or whose design changed after it — is refused at the code-stage review instead of reaching implementation on an unratified design.

## Usage

- Automatic on UI-bearing sessions. At `/noldor-spec` step 1.5, an `approve` verdict now also runs `pnpm noldor design verdict --key <dialogue-key> --approve --surface <s>...`, writing `.noldor/design-approval/<dialogue-key>.json`. The record commits with the spec and the `.pen` at gate Step 2.5.
- `approve with reservations` adds `--reservation "<text>"`; the reservation is recorded beside the approval in both the spec prose and the record.
- A waiver taken after Seed runs `pnpm noldor design verdict --key <k> --waive --reason "<why>"` alongside the existing `uiWaiver` marker and spec note, so the committed-but-unapproved design carries its reason to `main`. A waiver taken before Seed runs nothing — there is no `.pen`.
- Committing the spec and the `.pen` without either is refused by the pre-commit `shared-files` job (`pen-unapproved`), which names the command to run.
- At code stage the `ui-reviewer` lane additionally refuses a design whose record no longer matches the `.pen` (`design-approval-stale`), and a design with no record at all (`design-unapproved`) for the case where the `.pen` reached the branch without passing the guard. Under the default `autonomous.uiReviewMode: advisory` this reports; set `blocking` to gate on it.
- Remedy for `design-approval-stale`: re-take the verdict on the current design and re-run `design verdict`.
- Nothing to configure. A repo with no `consumer.uiPaths` never reaches any of it.

## Open questions (resolved)

1. *Is an enforceable signal worth its cost at all, or should Q-0196 be retired as answered by Q-0186?* -> **Worth it, in the reduced form specced here** (D1). Rationale: every mechanism it needs already exists in this same feature, so the marginal cost is one module plus one branch — and prose alone has repeatedly failed to close the "controller skipped the step" class.
2. *Where does the record live, given Q-0186 found nowhere?* -> **`.noldor/design-approval/<dialogue-key>.json`, tracked** (D2). Rationale: Q-0186 weighed only the two gitignored `.noldor` paths; `.noldor/ui-capture/` proves a tracked, committed receipt under `.noldor` is an established pattern in this feature.
3. *What binds the approval to the design — path, content hash, or commit?* -> **Git's blob id of the `.pen`** (D2). Rationale: it survives the archive `git mv` for free and self-invalidates when the design is edited; a byte hash would break under autocrlf/clean filters, and a commit would not survive squash-merge.
4. *Which enforcement point — new pre-push check, the existing lane, or gate prose?* -> **Two: a new `pen-unapproved` reason in the existing `checks shared-files` pre-commit guard, plus the `resolveUiReviewTarget` branch** (D4). Rationale: the entry's deletion test says a session cannot *reach* the code stage, and a lane firing at code stage is one implementation pass too late; `check-shared-files` already parses the staged name-status and already refuses two `.pen` classes, so the early point is a third member of an existing union rather than new machinery. Gate Step 2.5 prose is rejected a second time — its Q-0186 objection (no legal exit) is now void, but prose is the very class D1 says cannot close this.
5. *Blocking or advisory by default?* -> **Advisory at the lane, unconditional at the guard** (D4). Rationale: `loadLaneMode` already defaults to advisory and the posture calls for it; the guard has a one-command remedy directly in front of it, and a guard that only warned would leave the deletion test unmet again.
6. *Is a stale record a distinct outcome from an absent one?* -> **Yes, two reason codes** (D4). Rationale: they have different remedies — re-take the verdict versus take one at all — and collapsing them would report "you never approved" to an operator who did.
7. *Does the record carry surfaces, given approval is atomic?* -> **Yes, on the `approved` member** (D2). Rationale: atomicity is about the verdict, not the record; the surface list lets a later reader see which set was ratified without opening an encrypted file.
8. *Should the record be archived alongside the `.pen` at gate Step 4?* -> **No** (D2, D6). Rationale: blob binding makes co-location unnecessary, and moving it would hand `resolveArchivePlan` the fourth artifact kind this design exists to avoid.
9. *How does the guard admit Q-0186's waiver-after-Seed, which legitimately commits an unapproved `.pen`?* -> **The record is a union, and the waiver writes its `waived` member** (D2, D5). Rationale: teaching the guard to read `session.uiWaiver` would make a commit decision depend on transient gitignored per-worktree state and would leave `main` with no machine-readable trace of why a committed design is unapproved; a `waived` record supplies that trace and keeps the guard a pure question about the staged set.
10. *Does a `waived` record carry `penBlob` too?* -> **Yes** (D2). Rationale: a waiver ratifies the artifact that was committed, not any later version of it, so it must go stale on a `.pen` edit exactly as an approval does.
11. *One CLI verb with `--approve`/`--waive`, or two verbs?* -> **One, `design verdict`** (D5). Rationale: it matches `design capture --vouch-only`, where a flag selects the mode inside a verb, and it keeps a single writer for a union record rather than two CLIs sharing one atomic write.
12. *Does the guard fire on every staged feature `.pen`, or only on an add?* -> **Only on an add** (D4). Rationale: it gives the two points non-overlapping jobs — entering the repo versus drifting afterwards — mirrors the existing `pen-archive` rule's own `change !== 'add'` test, and keeps a consumer session whose `.pen` predates this feature from being hard-blocked by a rule that did not exist when it started.
13. *Does `NOLDOR_ALLOW_PEN_WRITE` waive the new rule, as it waives the other two?* -> **No** (D4). Rationale: that override authorises gate Step 4's baseline write-back; letting it waive an approval requirement would couple two unrelated permissions, so the new rule is evaluated before the short-circuit.
