# PR Summary Body Enforcement — Commit-Object Redesign — Design

**Slug:** pr-summary-body-enforcement
**FD:** docs/features/pr-summary-body-enforcement.md
**Date:** 2026-08-14
**Tier:** specs-only
**Deps:** none

## Problem

The parked Q-0124 spike correctly identified that a code-carrying commit needs a
structured `Why —` / `How —` / `What —` body, but it enforced that contract at
the wrong boundary. Its blocking `commit-msg` validator reads a provisional
message file plus the repository state visible during one Git invocation. The
commit Git eventually stores is not yet available.

That input mismatch produced 15 real defects over eight code-review rounds. Each
repair handled one more transient state: `git commit -v` editor furniture,
`core.commentChar`, multi-character `core.commentString`, an empty index during
`--amend`, `CHERRY_PICK_HEAD` versus `MERGE_HEAD`, Git-quoted non-ASCII paths,
and the `amend!` subject written by `--fixup=reword`. The fixes were individually
correct, but the growing state classifier remained structurally incomplete.

The durable facts already exist once Git has created the commit:

- the stored message is `git log -1 --format=%B <sha>`;
- the stored path set is `git diff-tree --root -r --no-commit-id --name-only -z <sha>`;
- merge identity is the commit's parent count;
- the pre-push hook receives the ref updates whose outgoing commit objects are
  about to cross the repository boundary.

The spike's other changes do not share this defect. The three path predicates in
[`src/core/allowlist.ts`](../../../src/core/allowlist.ts), the `composeBody` changes
in [`src/core/pr-flow.ts`](../../../src/core/pr-flow.ts), and the widened
`pickSummarySha` selection in
[`src/core/pr-flow-cli.ts`](../../../src/core/pr-flow-cli.ts) operate on stable
branch or diff data and remain part of the design.

## Goals

- Make the blocking decision from immutable commit objects at `pre-push`.
- Validate every distinct commit newly reachable through each updated ref that is
  not already known to be on that remote or grandfathered at activation, so an
  invalid earlier code commit cannot hide behind a valid tip.
- Keep `commit-msg` as fast, explicitly best-effort feedback that never blocks a
  commit and never claims authority over the final object.
- Preserve the spike's reusable path classification, PR Summary composition,
  summary-commit selection, and diff-derived Test Plan behavior.
- Report all invalid outgoing commits in one actionable rejection.
- Add a summary-body-specific activation snapshot so upgrading consumers
  grandfather exactly the commits reachable from their refs at upgrade time.

## Non-goals

- Judging whether the prose is insightful or genuinely plain-language. The
  mechanical gate checks structure; the rule and code review judge quality.
- Generalizing every existing `commit-msg` validator to commit objects. This
  redesign is limited to the summary-body contract exposed by Q-0124.
- Modeling the physical packfile or destination-wide object inventory. Pre-push
  exposes each ref's old and new values, not every server ref, and this design
  performs no network query. The enforceable contract is therefore: commits newly
  reachable through an updated ref, **minus** those reachable from the activation
  snapshot or from any local tracking ref of the remote being pushed to. The
  tracking-ref term is a cost bound rather than an integrity claim (see Risks); a
  commit reachable only through some other, unfetched destination ref may be
  checked again when a new ref introduces it, with the same deterministic result.
- Adding a push-time override. Existing release-automation exemptions and
  rollout compatibility remain; an ordinary invalid code commit must be fixed.
- Rewriting the parked branch's history. Its existing commits already carry
  valid structured bodies, so the redesigned gate can validate and ship itself.

## Design

### Architecture

One pure policy is shared by two adapters with deliberately different authority:

1. The blocking adapter loads final commit objects during `pre-push`. It owns the
   enforcement claim because message, paths, and parents can no longer change
   without producing a different SHA.
2. The advisory adapter reads the provisional `commit-msg` file and current
   index for early feedback. It may miss or over-report invocation-specific
   shapes, so it always exits zero.

[`src/hooks/noldor-pre-push.ts`](../../../src/hooks/noldor-pre-push.ts) remains the
only job that consumes hook stdin. It delegates commit discovery and validation
to a focused module instead of duplicating stdin handling in another Lefthook
job. Direct-to-`origin/main` protection, release-push receipts, and summary-body
validation remain separate decisions even though one entrypoint orchestrates
them.

### Unit 1 — pure summary policy and advisory adapter

Refactor [`src/core/validate-summary-body.ts`](../../../src/core/validate-summary-body.ts)
around a final-object input:

```ts
export interface SummaryCommitInput {
  sha: string;
  message: string;
  files: readonly string[];
  parentCount: number;
  noldorPath?: string;
}

export interface SummaryCommitResult {
  success: boolean;
  subject: string;
  error?: string;
}

export function validateSummaryCommit(input: SummaryCommitInput): SummaryCommitResult;
```

The function is pure and applies this decision order:

1. `parentCount > 1` passes: merge identity comes from the object, not a subject
   or pseudo-ref.
2. `fixup!`, `squash!`, and `amend!` subjects pass because autosquash commits are
   machine-shaped and intended to disappear.
3. A resolved final `Noldor-Path` trailer of `release-automation` or
   `release-sweep` passes.
4. `!touchesCode(files)` passes. A mixed commit with one code path still requires
   the body.
5. The stored body must contain `Why —`, `How —`, and `What —`, each with at
   least 24 non-whitespace characters before the next section.

There is no replay-state input. A cherry-pick or revert that survives into pushed
history is a durable single-parent commit and must explain itself like any other
code commit. A forged `Merge ...` or `Revert "..."` subject buys no exemption.
Likewise, a `Noldor-Path:`-looking line in body prose buys no automation
exemption: the blocking adapter supplies `noldorPath` only when Git's final
trailer block contains exactly one value for that key.

The stored-message path removes `bodyOf(message, commentChar)`, scissors parsing,
comment-marker configuration, and all staged/amend heuristics from the blocking
decision. Git has already removed editor furniture before writing the object.
Trailer stripping and section measurement remain shared pure helpers.

The existing `pnpm noldor validate summary-body <message-file>` entry becomes the
advisory adapter. It may reuse the spike's provisional-message cleanup and a
NUL-delimited staged-path read to improve feedback, but it prints `advisory:` and
returns zero for missing sections, unreadable files, and Git-plumbing failures.
When the summary-body activation snapshot is absent it prints the same one-line
notice as the blocking adapter (naming the file and the command that creates it)
and then says nothing about the body. The command's docs state that only pre-push
is authoritative.

An `invalid` snapshot read is **exit 0 with a printed reason on the advisory side
only**, and the advisory **still evaluates the body**. Fail-closed applies to the
adapter that owns the enforcement claim; the `commit-msg` adapter always exits
zero, and blocking a commit over a file it has no authority to act on would
resurrect exactly the provisional-state blocking this redesign removes. The
operator learns of the corruption at commit time and is stopped by pre-push, where
it counts.

The asymmetry with `absent` is deliberate. `absent` means the repository never
activated this feature, so advising about a contract it has not opted into is
nagging. `invalid` means it *did* activate and the file is now corrupt — the
contract applies, only its grandfathering boundary is unreadable — and the body
advice itself never depended on snapshot content, which bounds *which* commits
pre-push checks rather than what a valid body looks like.

### Unit 2 — outgoing commit discovery and object loading

Add `src/hooks/validate-pushed-summaries.ts`. It receives the remote name and the
already-buffered pre-push ref lines; it never reads stdin itself. A small injected
Git runner keeps command failures and object shapes testable without mocking
Node's process globals.

For each four-field ref update, candidate discovery combines the old/new values
Git supplied with two sources of negative revisions:

- a zero local SHA is a deletion and contributes no commit;
- the positive revision is always the ref update's `<local-sha>`;
- `^<remote-sha>` is a negative whenever the remote ref already exists **and**
  that object is present locally;
- every activation-snapshot grandfather tip is a negative;
- every `refs/remotes/<remote>/**` tip for the remote being pushed to is a
  negative;
- SHAs are deduplicated across ref updates while preserving discovery order.

All revisions are fed on stdin — `git rev-list --reverse --topo-order --stdin`,
one revision per line — rather than as argv entries. A repository with a few
thousand local and tracking refs would otherwise push the argument list toward
`ARG_MAX`, and that spawn failure is a fail-closed exit 2 whose only operator
recourse would be deleting the snapshot.

These ranges mean “newly reachable through this updated ref,” not “bytes absent
from every destination ref.” The first definition is authoritative from pre-push
stdin; the second would require a network query.

Tracking-ref negatives are a **cost bound, not a security boundary**, and the
spec states that plainly rather than claiming an integrity property it does not
have. Without them, the first push of every new branch subtracts only tips frozen
at activation, so it re-enumerates the entire post-activation mainline — a set
that grows monotonically with repository age, making the most common push in this
workflow the most expensive one. With them, a commit is skipped when it was
reachable from that remote at the last fetch, which is exactly the population that
already crossed the boundary this gate defends.

Forging a tracking ref (`git update-ref refs/remotes/origin/main <sha>`) does
suppress a candidate. That is accepted: it is strictly more effort than
`--no-verify`, which already bypasses every local hook, so the gate's threat model
is an author who forgets, not an author who attacks their own pre-push hook. The
activation snapshot remains immutable precisely because it is the one negative
source a routine `git fetch` cannot move.

Git passes the hook a remote *name* only when the push names one. For
`git push https://… main` the first argument is the raw URL, and
`refs/remotes/<url>/**` matches nothing — silently costing exactly the full
mainline walk the tracking negatives exist to prevent, on the push shape most
likely to come from a fresh clone.

Git already answers this question. A `pre-push` hook receives **two** parameters:
`$1` is the remote name — or the URL when the push named no remote — and `$2` is
always the remote URL. They are equal exactly when the push was anonymous. So the
discriminator is `$1 !== $2`, with no spawn and no heuristic.

This requires plumbing the second parameter, which is not wired today:
[`lefthook/noldor.yml`](../../../lefthook/noldor.yml) passes only `{1}` and
[`src/hooks/noldor-pre-push.ts`](../../../src/hooks/noldor-pre-push.ts) reads
`process.argv[2]`. Unit 4 adds `{2}` to the job (and to its consumer template
twin); the hook reads the URL from `process.argv[3]`.

Resolution then runs:

1. `$1 !== $2` — the argument is a configured remote name. Enumerate
   `refs/remotes/<name>/**` and stop. No config probe on the ordinary push.
2. `$1 === $2` — an anonymous URL push. Run one lookup,
   `git config -z --get-regexp '^remote\..*\.(push)?url$'`, and match the URL
   against the values. On exactly one matching `remote.<name>.` key, enumerate
   that remote's tracking namespace.
3. `$2` absent — a consumer whose Lefthook template predates this change. Fall
   back to enumerating `refs/remotes/<arg>/**` and, only if that is empty, the
   config probe from step 2. This is the weaker heuristic the second parameter
   replaces: it misfires on a configured-but-never-fetched remote
   (`git remote add origin …` then push), where the enumeration is empty for a
   *name*, and the probe then matches a name against URL values and finds
   nothing. The cost is an empty tracking term, which is the cost-only
   degradation below.
4. Otherwise the tracking term is empty and discovery uses snapshot-only
   negatives.

The pattern is anchored at both ends and covers `pushurl`, so a push-URL-only
remote resolves and a stray `remote.x.urlfoo` key does not. The `-z` form is
mandatory for the same reason it is everywhere else in this design: a config
value may contain an embedded newline, and a line-oriented parse could then
associate a URL with the *wrong* `remote.<name>.` key and subtract another
remote's tracking tips — silently skipping validation, the one direction
negatives must never fail.

`git config --get-regexp` **exits 1 when nothing matches**, which is the ordinary
outcome in a repository with no configured remotes. That exit is data, not
failure: it means "no match, empty tracking term". Only an exit greater than 1
is an infrastructure failure. Without this carve-out the fail-closed rule for Git
command failures would turn a routine anonymous push into exit 2 — the exact
opposite of the degradation this paragraph promises.

That fallback is a **cost-only degradation and never a correctness change**: fewer
negatives can only enlarge the candidate set. It is called out here because a
silent enlargement looks like a hang rather than a policy decision.

When an existing remote ref's `<remote-sha>` is not present locally — the routine
non-fast-forward case, where the remote moved and this clone has not fetched — the
negative is simply dropped and discovery proceeds from the grandfather and
tracking tips alone. That is strictly *more* validation, never a bypass, and it
leaves Git's own `Updates were rejected` message as the diagnostic the operator
sees instead of pre-empting it with a Noldor infrastructure failure.

For each distinct SHA, the loader resolves every fact in **two** commands:

```text
git log -1 --format=%P%x00%B%x00%(trailers:key=Noldor-Path,valueonly) <sha>
git diff-tree --root -r --no-commit-id --name-only -z <sha>
```

Parents, message, and the final `Noldor-Path` trailer all come from the commit
header, so one `git log` yields all three: split the output on NUL into
`%P` (space-separated parent OIDs, whose count is `parentCount`), `%B` (the raw
stored message), and the trailer values. A commit message cannot contain a NUL
byte, so the delimiter is unambiguous. Splitting these into three spawns would buy
one early exit on merge commits — a cheap header read — at the price of two extra
processes on every non-merge commit, which is the common case and the dominant
push latency.

The `-z` path protocol is mandatory so non-ASCII, whitespace, quotes, and newlines
remain data rather than Git-formatted prose. Commands use argument arrays, never a
shell. The trailer-format output is accepted only when it contains exactly one
non-empty trimmed value; zero, duplicate, or conflicting values supply no
automation exemption and remain subject to the ordinary body contract (the
existing trailer validator can report their schema problem).

`diff-tree` is skipped entirely for a commit already exempted by parent count,
autosquash subject, or automation trailer, so a merge still costs one command.

The negative tips come from a dedicated tracked snapshot,
`.noldor/summary-body-rollout.json`, rather than the older repository-wide
`.noldor/rollout-marker`. The latter predates this feature and cannot describe
which commits were already present when this validator activated.

Add `src/core/summary-body-rollout.ts` with a versioned, fail-closed schema:

```ts
export interface SummaryBodyRolloutSnapshot {
  version: 1;
  grandfatherTips: string[];
}

export type SummaryBodyRolloutRead =
  | { kind: 'absent' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'ok'; snapshot: SummaryBodyRolloutSnapshot };

export function readSummaryBodyRolloutSnapshot(cwd?: string): SummaryBodyRolloutRead;
export function ensureSummaryBodyRolloutSnapshot(cwd?: string): EnsureMarkerStatus;
```

The read result is a discriminated union rather than
`SummaryBodyRolloutSnapshot | null`, because the two failure outcomes must not
collapse: `absent` means advisory-only compatibility and exit 0, while `invalid`
means fail closed with exit 2. A nullable return would make them the same value
and put the "a corrupt snapshot blocks rather than disables" acceptance criterion
out of reach. This is the same null-collapse
[`src/core/rollout-marker.ts`](../../../src/core/rollout-marker.ts) escaped by adding
`rolloutMarkerExists` beside `readRolloutMarker`, so an empty marker could no
longer masquerade as no marker; the union states the distinction in the type
instead of in a second function. `invalid.reason` carries the operator-facing
detail (unsupported version, malformed JSON, empty or duplicate tip set,
syntactically invalid SHA) into the exit-2 diagnostic.

`ensureSummaryBodyRolloutSnapshot` records the deduplicated object IDs at the tips
of `HEAD`, `refs/heads/**`, `refs/remotes/**`, and `refs/tags/**` at activation.
Each ref is peeled to a commit; annotated tags contribute their target commit and
refs that do not resolve to commits contribute nothing. The file is written with
`atomicWriteFileSync` from [`src/core/atomic-write.ts`](../../../src/core/atomic-write.ts),
as `ensureRolloutMarker` already does — and the stakes are higher here, because a
torn or zero-byte write is now an `invalid` read that hard-blocks every push at
exit 2 rather than a soft-mode fallback. The snapshot stores tips,
not every reachable commit: passing each as a negative revision makes Git exclude
their complete ancestor closure. A commit on any old side branch is grandfathered
only when it was reachable from a recorded tip at activation. A commit added to
that branch later is not an ancestor of the old tip and therefore remains in the
candidate set—even if the branch subsequently merges the upgraded mainline. New
orphan/root history is likewise not reachable from a recorded tip and enforces
normally.

Fresh `noldor init` and `init --update` create the snapshot beside the existing
general marker; `noldor upgrade` creates it before applying/updating the installed
framework so all current unpublished refs are grandfathered. The file is reported
as an upgrade/init artifact and must be committed with the framework update. Add
it to `MICRO_CHORE_GLOBS`; it already falls outside `CODE_GLOBS`.

Upgrade handles the snapshot independently of the semver migration chain: both
an empty chain and a non-empty chain report/create it, `--dry-run` reports without
writing, and an apply that would create it observes the same clean-tree preflight
as other upgrade writes. This avoids inventing a version-gap migration solely to
arm a runtime gate. In the self-hosting worktree, the implementation snapshots
the approved-spec refs before the first code commit, so the new implementation
objects are not grandfathered.

An absent snapshot means advisory-only compatibility, but never a *silent* one.
Deleting one tracked JSON file — or cloning a repo that never committed it — would
otherwise turn the entire gate off with no output at all, which is the push-time
override this design lists as a non-goal, reachable by `rm`. So both adapters
print one line to stderr naming the missing file and the command that creates it
(`.noldor/summary-body-rollout.json` — run `pnpm noldor init --update`) before
allowing the push or staying quiet about the body. The notice does not change the
exit code on either side.

Malformed JSON, unsupported version, an empty/duplicate tip set, or a
syntactically invalid SHA fails closed as an infrastructure error; corrupt data
can never broaden the grandfathered set. A syntactically valid tip that is unavailable or no longer resolves to a
commit in the current clone is omitted from the negative revisions with one
warning. Omission can only narrow grandfathering and cause extra validation; it
cannot hide a candidate. Once created, init/upgrade never rewrites the
snapshot—moving the tips forward would silently grandfather post-activation
commits.

When no commit-ref tip exists (fresh empty repository), ensure returns
`skipped-no-git`, writes no snapshot, and tells the operator to rerun init after
the first commit. This mirrors the existing general rollout-marker bootstrap and
keeps an empty on-disk snapshot reserved for corruption rather than giving it two
meanings.

The result aggregates every invalid commit as `{ sha, subject, error }`; it does
not stop after the first failure.

### Unit 3 — pre-push orchestration

Extend [`src/hooks/noldor-pre-push.ts`](../../../src/hooks/noldor-pre-push.ts) after
its single bounded stdin read:

1. Parse the ref lines once.
2. Run the existing direct-`origin/main` decision first. A forbidden destination
   fails immediately without unnecessary object walks.
3. Run outgoing summary validation for every allowed push, including non-origin
   remotes. A release override allows the destination but does not disable body
   validation; release commits pass through their `Noldor-Path` exemption.
4. On violations, print one rejection containing every short SHA, subject, and
   missing/thin section result, then exit 1.
5. Record the existing release-push receipt only after validation succeeds.

### Unit 4 — non-blocking commit-msg wiring

Keep the existing `summary-body` job in
[`lefthook/noldor.yml`](../../../lefthook/noldor.yml) and its consumer template, but
rename it `summary-body-advisory` and document its exit-zero contract. It stays
after trailer validation so trailer diagnostics remain the first actionable
message. No new pre-push job is added.

The existing `noldor-pre-push` job gains Git's second hook parameter — `run: pnpm
noldor hooks pre-push {1} {2}` — in both this file and its consumer template twin,
so the hook can tell a remote name from a remote URL without a spawn (Unit 2). The
hook treats `process.argv[3]` as optional: a consumer running a template that
predates this change still works, on the documented fallback.

Update [`src/cli/manifest.ts`](../../../src/cli/manifest.ts) and the script catalog
description from “validate” to “advise” without changing the stable command name.

Revise `.noldor/rules/pr-summary-why-how-what.md` so it names pre-push as the
mechanical floor, and update `docs/noldor/git-and-commits.md`,
`docs/noldor/pr-flow.md`, `docs/noldor/script-catalog.md`, and their consumer
template twins. Refresh `docs/features/pr-summary-body-enforcement.md` so its
Summary, User Story, and Usage describe the commit-object contract rather than
the parked commit-msg design.

### Unit 5 — retained spike behavior

Retain, with their existing tests:

- `isBookkeepingOnly`, `isRetirementOnly`, and `touchesCode` in
  [`src/core/allowlist.ts`](../../../src/core/allowlist.ts);
- `pickSummarySha` skipping the complete bookkeeping set only when
  `files.length > 0` in
  [`src/core/pr-flow-cli.ts`](../../../src/core/pr-flow-cli.ts);
- the retirement template that quotes the subject's reason instead of inventing
  one, FD-summary plus commit-body composition, and diff-derived Test Plan in
  [`src/core/pr-flow.ts`](../../../src/core/pr-flow.ts).

The redesign changes only which boundary can block on the body contract. It does
not reopen the already-settled PR-composition behavior.

### Data flow

The authoritative path is:

```text
git push
  -> Lefthook buffers pre-push stdin for noldor-pre-push
  -> noldor-pre-push parses destination ref updates
  -> activation snapshot + this remote's tracking tips supply negative revisions
  -> validate-pushed-summaries enumerates non-grandfathered SHAs per updated ref
  -> one git log yields parents, stored message and the Noldor-Path trailer
  -> parent count classifies merges; stored message classifies automation/autosquash
  -> diff-tree -z supplies exact committed paths for what is left
  -> validateSummaryCommit checks code-bearing single-parent commits
  -> all violations are rendered together
  -> exit 0 permits transfer; exit 1/2 prevents it
```

Ref-line parsing is strict. Each non-empty line must contain exactly local ref,
local SHA, remote ref, and remote SHA. An all-zero SHA is recognized with
`/^0+$/`, not a hard-coded 40-character constant, so the parser does not assume
SHA-1 repositories. Ref deletions stop after this parse; branch and tag updates
flow through the same `rev-list` discovery.

The Git runner has distinct text and NUL-delimited result paths. The combined
header command decodes UTF-8 text and splits it on NUL into parents, message, and
trailer value. The `diff-tree -z` result stays a `Buffer` until it is split on byte
`0x00`; it is never line-split or trimmed. This keeps a valid repository path
containing whitespace, quotes, or a newline from changing classification before it
reaches `touchesCode`.

Per SHA, work is ordered from cheapest to most specific:

1. Stop the whole check when the summary-body snapshot read is `absent`, after
   printing the notice. An `invalid` read exits 2. Otherwise use its grandfather
   tips plus this remote's tracking tips as negatives while enumerating
   candidates; no per-object date or ancestry heuristic remains.
2. Read the commit header once. Skip an object with more than one parent, an
   autosquash subject, or exactly one recognized release-automation
   `Noldor-Path` value — all three decisions come from that single command.
3. Read the NUL-delimited files and apply `touchesCode`. Objects exempted in
   step 2 never reach this command.
4. Measure the three body sections.

Root commits have zero parents and are validated normally when they carry code.
For merge commits, path differences against individual parents are irrelevant to
this contract because parent count already supplies the explicit exemption.

The advisory path deliberately stops short of this claim:

```text
git commit
  -> commit-msg receives provisional message file
  -> advisory reads provisional prose + best-effort staged paths
  -> advisory prints a warning when the likely code commit lacks sections
  -> advisory always exits 0
  -> Git writes the commit object
```

The next push re-evaluates the resulting object from scratch. No advisory verdict
or state is cached or forwarded to pre-push.

### Failure behavior and diagnostics

Three outcome classes remain visibly distinct:

- **Policy rejection (exit 1):** one or more newly reachable, post-activation,
  single-parent code commits lack valid sections. The diagnostic begins
  `pre-push: outgoing commits do not explain themselves`, then lists every
  offending short SHA and subject with its missing or under-24-character
  sections. It then names the negative sources discovery actually used — the
  activation tip count, and the resolved remote with its tracking tip count or
  the fact that the tracking term was empty — so the operator can see what was
  subtracted from the candidate set. It ends with the exact three-line template
  and says that the stored commits must be reworded before pushing.
- **Infrastructure failure (exit 2, blocking adapter only):** malformed ref input,
  `rev-list` failure, an `invalid` activation snapshot read (the advisory adapter
  prints the same reason and still exits 0), an unreadable candidate commit object, or
  an unparseable parent row. The message names the failing ref/SHA, the sanitized
  Git argument list, and — for a snapshot problem — the `invalid.reason`. It also
  names the negative sources **when the failure occurred after discovery
  resolved them**; a malformed ref line or an `invalid` snapshot aborts before
  any remote or tip count exists, and the diagnostic simply omits what it does not
  have rather than inventing zeroes. An
  existing ref's locally-unavailable remote-old SHA is deliberately **not** in this
  class: that negative is dropped and validation widens instead, so a routine
  non-fast-forward push still fails with Git's own `Updates were rejected`
  message rather than a Noldor infrastructure error that pre-empts it. The hook
  performs no fetch and no other network action itself.
- **Advisory finding (exit 0):** the provisional message probably lacks sections,
  or its files/state cannot be read. The message begins
  `summary-body advisory:` and explicitly says pre-push will check the stored
  object. It never rejects the commit.
- **Disabled notice (exit 0, both adapters):** the activation snapshot is absent.
  One line names `.noldor/summary-body-rollout.json` and `pnpm noldor init
  --update`, so an advisory-only repository says so instead of looking green.

The blocking path fails closed on infrastructure errors. Failing open would turn
the sole authoritative check into another silent bypass; a failed push has not
changed the remote and can be retried safely. The advisory path fails open
because its input is intentionally non-authoritative.

Diagnostics aggregate policy violations but stop on infrastructure failure: a
partial scan cannot truthfully say whether the remaining objects pass. Duplicate
SHAs from multiple ref updates appear once. Subjects are rendered on one line;
control characters are escaped so a crafted stored subject cannot forge another
diagnostic entry.

### Testing

Tests follow `docs/noldor/testing-principles.md`: pure policy cases stay small,
while claims about Git object shape run against scratch repositories and real Git
commands.

Extend `src/core/__tests__/validate-summary-body.test.ts` with the final-object
matrix:

- all three sections pass; each missing section and each 23/24-character boundary
  reports precisely;
- order remains a prose convention rather than a mechanical requirement;
- trailer lines do not pad the final section, and the colon form keeps its
  `interpret-trailers` hint;
- `touchesCode` false passes, while one code path among prose requires a body;
- root and single-parent code commits enforce; two-parent commits pass;
- a single-parent commit with a forged `Merge ...` or `Revert "..."` subject
  fails;
- `fixup!`, `squash!`, `amend!`, `release-automation`, and `release-sweep` pass;
- release exemptions require exactly one recognized value from the final trailer
  block; a matching body line or duplicate/conflicting values do not exempt;
- cherry-picked and reverted single-parent objects enforce without any pseudo-ref
  input.

Add `src/hooks/__tests__/validate-pushed-summaries.test.ts` for range and loader
behavior:

- strict four-field parsing, SHA-1/SHA-256 all-zero deletion detection, and
  malformed-line rejection;
- existing-ref and new-ref revision construction, each supplying every grandfather
  tip and every tracking tip for the pushed remote as negatives, all delivered on
  stdin rather than argv (a thousand-ref fixture stays under `ARG_MAX`);
- tracking tips for a *different* remote are not subtracted;
- `$1 !== $2` resolves a named remote with no config lookup at all, including for
  a configured remote that has never been fetched (empty tracking namespace);
- `$1 === $2` resolves an anonymous URL push through `remote.*.url` and through
  `remote.*.pushurl` to that remote's tracking namespace;
- an absent `$2` falls back to enumerate-then-probe and still pushes;
- `git config --get-regexp` exiting 1 (no configured remotes) yields an empty
  tracking term and a successful push, not exit 2, while an exit above 1 is an
  infrastructure failure;
- a config value containing an embedded newline cannot associate a URL with the
  wrong `remote.<name>.` key, because the probe is parsed NUL-delimited;
- an unconfigured URL yields an empty tracking term, a larger candidate set, and
  no infrastructure failure;
- diagnostics report the negative sources once discovery has resolved them, and
  omit them on failures that abort before that point;
- an existing ref whose remote-old SHA is absent locally drops that one negative
  and still enumerates candidates, without an infrastructure failure;
- stable SHA deduplication across two ref updates;
- a commit already reachable through another, unfetched destination ref is still
  checked when a new updated ref introduces it;
- a real root commit, ordinary commit, merge commit, cherry-pick, revert, and
  force-push range;
- stored message loaded without `commit -v` comments/scissors/diff;
- `--amend` validated from the amended object's full diff rather than the index;
- non-ASCII, space-containing, quoted, and newline-containing paths survive the
  NUL protocol and classify correctly;
- every commit reachable from an activation tip skips, including old side-branch
  history merged later;
- a commit added to that side branch after activation remains a candidate even
  after the upgraded mainline is merged, closing the ancestry-only bypass;
- orphan/root history not reachable from a grandfather tip validates normally;
- an absent snapshot reads `absent`, stays advisory-only, and prints the notice
  naming the file and the init command, while malformed JSON, an unsupported
  version, an empty/duplicate tip set, or an invalid SHA reads `invalid` and
  produces an infrastructure failure carrying that reason;
- parents, message, and the `Noldor-Path` trailer are parsed from one NUL-split
  header read, and a merge/autosquash/automation object issues no `diff-tree`;
- a stored message containing NUL-adjacent content and multi-line trailers splits
  correctly into its three header fields;
- a valid but locally unavailable/garbage-collected grandfather tip is omitted
  with a warning and its formerly grandfathered commits are conservatively
  validated when encountered;
- two invalid objects aggregate, while a loader failure returns infrastructure
  failure without a partial pass verdict.

Extend `src/hooks/__tests__/noldor-pre-push.test.ts` with orchestration cases:

- direct `origin/main` rejection performs no summary object walk;
- feature and non-origin pushes validate all outgoing objects;
- a valid tip does not hide an invalid earlier commit;
- release override still scans, while correctly trailered automation passes;
- policy failure exits 1, infrastructure failure exits 2, success exits 0;
- release-push receipt writes only after summary validation succeeds;
- the real stdin timeout/error behavior remains unchanged.

Add `src/core/__tests__/summary-body-rollout.test.ts` and extend the init/upgrade
suites:

- snapshot creation records/deduplicates commit tips from detached/current HEAD,
  local branches, remote-tracking refs, and commit-pointing tags; annotated tags
  are peeled and non-commit refs contribute no tip;
- fresh init and `init --update` create the summary-body snapshot without
  replacing an existing one;
- upgrade creates/reports the snapshot in both non-empty and empty migration-chain
  paths, while `--dry-run` reports without writing;
- a consumer with multiple unpublished pre-upgrade branches can push every
  snapshotted history, while the first later commit on any branch enforces;
- a snapshot copied to another clone omits machine-local unavailable tips without
  blocking the push or widening grandfathering;
- a fresh empty repository returns `skipped-no-git`, writes no snapshot, and the
  init output tells the operator to rerun after the first commit;
- ensure is idempotent and never advances existing tips;
- the read returns `absent` / `invalid` / `ok` as distinct variants, so a caller
  cannot conflate a missing snapshot with a corrupt one;
- the write goes through `atomicWriteFileSync`, so an interrupted creation leaves
  either no file or a complete one — never the zero-byte file that would now
  hard-block every push.

Keep a narrow advisory suite in
`src/core/__tests__/validate-summary-body.test.ts`: likely invalid code produces a
warning, valid structure stays quiet, and every missing-file/Git-failure/finding
path exits zero — including an `invalid` snapshot read, which prints its reason,
**still advises on the body**, and exits zero on this adapter while the blocking
adapter exits 2 on the same file. An `absent` read prints the notice and, unlike
`invalid`, says nothing about the body. Existing `allowlist`, `pr-flow`, and `pr-flow-cli` suites remain
green and continue pinning the retained spike behavior.

One end-to-end scratch test installs the hook configuration against a bare remote:
an invalid earlier code commit plus a valid tip is rejected before the remote ref
moves; after rewording the invalid object, the same push succeeds. This is the
acceptance-level proof that the validator reads objects selected by pre-push ref
updates rather than the current index or `COMMIT_EDITMSG`.

## Acceptance criteria

- [ ] `commit-msg` never rejects because of the summary body; an invalid likely
  code commit prints an advisory and still creates the commit.
- [ ] Pushing one code commit without valid `Why —`, `How —`, and `What —`
  sections fails before the remote ref changes and names that SHA, subject, and
  every missing/thin section.
- [ ] A valid tip does not hide an invalid earlier outgoing commit.
- [ ] Two invalid outgoing commits are both reported once, even when reachable
  from multiple pushed refs.
- [ ] New-ref discovery subtracts the activation tips **and** this remote's
  tracking tips, so pushing a new branch enumerates only what that remote has not
  been observed to hold — not the whole post-activation mainline. A commit
  reachable only through some other unfetched destination ref is still checked.
- [ ] All positive and negative revisions reach `rev-list` on stdin, so a
  repository with thousands of refs cannot fail the push through `ARG_MAX`.
- [ ] An existing ref whose remote-old SHA is missing locally drops that negative
  and validates more, rather than failing the push with exit 2; Git's own
  non-fast-forward message stays the one the operator sees.
- [ ] Parents, stored message, and the `Noldor-Path` trailer come from one
  `git log` per candidate, and an exempt object never runs `diff-tree`.
- [ ] Stored message validation is unaffected by `git commit -v`,
  `core.commentChar`, or `core.commentString`.
- [ ] Stored path validation is unaffected by an empty amend index or Git path
  quoting; deletions and non-ASCII paths classify from `diff-tree -z`.
- [ ] Merge commits pass only when the object has more than one parent. A forged
  `Merge ...` subject on a single-parent code commit fails.
- [ ] Cherry-pick and revert state is not inspected. Their durable single-parent
  code commits require structured bodies; autosquash objects remain exempt.
- [ ] Release automation is exempt only through exactly one recognized
  `Noldor-Path` value in Git's final trailer block; a body line cannot forge it.
- [ ] Bookkeeping and prose-only objects remain exempt through `touchesCode`,
  while a mixed commit with one code path enforces.
- [ ] No summary-body snapshot means advisory-only compatibility, announced on
  both adapters by one stderr line naming the file and the command that creates
  it — never a silent disable. Init/update and upgrade snapshot all current
  commit-ref tips; exactly their reachable history is grandfathered.
- [ ] The snapshot read distinguishes absent from invalid in its return type, and
  the snapshot file is written atomically.
- [ ] An `invalid` snapshot exits 2 on the blocking adapter and 0 on the advisory
  adapter, which prints the reason, still advises on the body — unlike an
  `absent` read, which stays quiet about it — and still lets the commit through.
- [ ] The pre-push job passes Git's remote URL as a second parameter, and the
  hook uses `$1 !== $2` to tell a remote name from a URL without a config probe.
  A consumer template that predates this still resolves, via the documented
  enumerate-then-probe fallback.
- [ ] A push whose remote argument is a URL resolves back to the configured remote
  for its tracking negatives, and an unconfigured URL degrades to snapshot-only
  negatives — more validation, never less, and never an infrastructure failure.
- [ ] Diagnostics emitted **after** discovery resolves its negatives name them:
  the activation tip count and the resolved remote with its tracking tip count,
  or that the tracking term was empty. Failures that abort earlier — a malformed
  ref line, an `invalid` snapshot — omit the line rather than reporting zeroes.
- [ ] `git config --get-regexp` exiting 1 is read as "no match, empty tracking
  term"; only an exit above 1 is an infrastructure failure, so an anonymous push
  in a repository with no configured remote still pushes.
- [ ] A commit added after activation on an old side branch remains enforceable
  after any later merge, and root/orphan commits not reachable from a snapshot
  tip enforce normally.
- [ ] A present malformed/corrupt summary-body snapshot blocks with infrastructure
  exit 2 instead of disabling or broadening enforcement.
- [ ] A valid grandfather SHA unavailable in the current clone is omitted with a
  warning; the push continues with less grandfathering, never more.
- [ ] Fresh init without a Git `HEAD` writes no snapshot, reports
  `skipped-no-git`, and remains advisory-only until init is rerun.
- [ ] Malformed ref input or unreadable Git objects fail the push with exit 2 and
  an actionable diagnostic; the hook never fetches or mutates repository state.
- [ ] Direct `origin/main` protection, review-receipt enforcement, release-push
  receipts, template sync, and clone checks retain their existing behavior.
- [ ] The retained retirement Summary, FD/body composition, `pickSummarySha`, and
  diff-derived Test Plan tests remain green.
- [ ] `pnpm typecheck`, the targeted Vitest suites, `pnpm test`,
  `pnpm noldor checks template-sync`, `pnpm noldor validate script-catalog`, and
  `pnpm noldor rules validate` pass.

## Risks / trade-offs

- **Blocking feedback moves later.** An ignored or missed advisory can create an
  invalid unpublished commit, and validating every outgoing object means a later
  correction commit cannot cover it. The operator must reword/recreate the
  unpublished object before push. This is the deliberate cost of validating the
  right input; diagnostics identify every affected SHA in one run. No automatic
  history rewrite is added.
- **Tracking-ref negatives trade a forgeable input for a bounded cost.** Without
  them, the candidate set for a brand-new branch is everything added since
  activation, so the cheapest-looking push in this workflow grows more expensive
  every month the repository lives — unbounded in repo age, not merely a small
  per-push repeat. Accepting `refs/remotes/<remote>/**` as negatives bounds that
  to what this clone has not yet seen on the remote, at the price of an input a
  local `git update-ref` can forge. The gate is a local hook that `--no-verify`
  already disables in one flag, so this buys an attacker nothing they lacked; the
  immutable activation snapshot stays the one negative source a routine fetch
  cannot move. Pre-push still cannot see the destination's full ref inventory, so
  a commit reachable only through some *other* unfetched remote ref is re-checked
  deterministically, deduplicated within the push.

  The unconditional stderr notice is reserved for the absent snapshot and is
  deliberately *not* extended to tracking subtraction, because the two failures
  are not the same size: an absent snapshot means the gate checks nothing at all,
  while a forged tracking tip removes specific commits from a gate that still
  validates everything else. Printing a line on every ordinary push would train
  operators to ignore it. Instead, the exit-1 and exit-2 diagnostics — the output
  an operator is already reading — name the negative sources they used: the
  activation tip count, and the resolved remote plus its tracking tip count (or
  the fact that the tracking term was empty). Counting how many candidates the
  tracking tips actually suppressed is not reported, since that would need a
  second `rev-list` on every push to compute a number nobody acts on.
- **Activation adds one tracked snapshot.** Consumers must commit
  `.noldor/summary-body-rollout.json` with their init/upgrade changes. If they do
  not, another clone remains advisory-only, matching the established rollout
  model. Init/upgrade output names the file and required commit step.
- **The snapshot grows with local ref count.** One SHA per activation-time commit
  ref keeps the file compact in ordinary repos and precisely captures side
  histories. Repositories with many stale refs may record redundant ancestry,
  but creation deduplicates identical tips and runtime SHA results; no live ref
  is consulted after activation.
- **Snapshots can name machine-local commits.** Another clone may not possess an
  unpublished activation-time tip, and deleted refs may eventually be garbage
  collected. Such tips are safely omitted at read time: this can produce extra
  validation of old history, but never an exemption. The warning names the SHA
  so the operator can fetch it when preserving that grandfather boundary matters.
- **Per-object Git calls add push latency.** Two spawns per candidate — one
  header read, one `diff-tree` for whatever is not already exempt — is the floor
  this design accepts; a packed or batched parser (`git cat-file --batch`) is the
  obvious later optimization and must preserve identical inputs and be measured
  first. Deduplication, snapshot and tracking negatives, and exempting merges and
  automation before `diff-tree` bound the common branches.
- **Merge commits are exempt even when conflict resolution changes code.** Parent
  count is immutable and closes the entire transient-state class, but does not
  distinguish a trivial merge from a substantive resolution. Review receipt and
  code review remain the backstop. This is narrower and more auditable than a
  subject or pseudo-ref heuristic.
- **Structural prose is still gameable.** Twenty-four characters are a floor,
  not evidence of a good explanation. The `pr-summary-why-how-what` rule and CR
  continue to own the quality bar.
- **The command name still says `validate`.** Keeping
  `pnpm noldor validate summary-body` avoids a breaking CLI rename, while its
  description/output make the advisory contract explicit.

## User Story

As an agent pushing a reviewed branch, I want Noldor to validate the immutable
messages, files, and parent structure of every outgoing commit, so that a PR
cannot ship an unexplained code change because `commit-msg` misread provisional
Git state.

## Usage

Write each code-carrying commit with the same structured body:

```text
fix(clones): union untracked files into the diff-scoped verdict

Why — a new file has no git post-image, so the clone gate silently skipped the
new content and could report a false clean result.
How — resolveChangedRanges unions untracked paths into the range map as complete
file spans before clone coverage is evaluated.
What — src/clones/ranges.ts and its regression test now make a pasted new file
participate in diff-scoped clone detection.

Noldor-Path: fast-track
```

At commit time, `summary-body-advisory` prints early feedback but does not reject
or certify the commit. The standalone form has the same advisory contract:

```bash
git add -A
pnpm noldor validate summary-body .git/COMMIT_EDITMSG
```

At push time, no extra command is needed. Lefthook invokes
`pnpm noldor hooks pre-push <remote>`, feeds it Git's ref updates, and validates
every distinct outgoing object. A rejection names all objects that need
rewording. Because the remote has not moved, repair only the unpublished history
and retry the normal push; do not use `--no-verify`.

Bookkeeping/prose-only commits need no body. Merge commits are recognized by
their parent count. Durable cherry-pick and revert commits are ordinary
single-parent history and need the body when they carry code.

## Open questions (resolved)

1. *Which boundary owns the blocking decision?*
   -> **`pre-push` over stored commit objects.** This supersedes the parked
   spec's commit-msg decision because only the object contains the message,
   files, and parents Git will actually transfer (D15).

2. *Which commit objects are checked?*
   -> **Every distinct object newly reachable through an updated ref that is
   neither grandfathered at activation nor already reachable from that remote's
   tracking refs.** Checking only the tip or `pickSummarySha` would weaken the
   existing every-commit contract and let invalid intermediate commits ship
   (D11; negatives refined in CR rounds 2–3).

3. *Should `commit-msg` disappear?*
   -> **No; retain it as exit-zero advice.** It preserves cheap feedback without
   letting provisional state block work or claim correctness (D12).

4. *Should summary validation be another pre-push job?*
   -> **No; delegate from the existing stdin-owning entrypoint.** One bounded
   stdin read avoids duplicated/ref-consumption-sensitive hook wiring while the
   focused loader remains independently testable (D12–D13).

5. *How are new remote refs bounded?*
   -> **By the activation-time grandfather tips *and* the pushed remote's
   tracking tips, as negative revisions on stdin.** Snapshot tips alone left the
   first push of every new branch re-walking the whole post-activation mainline,
   growing without bound as the repository ages. Tracking tips bound it to what
   this clone has not observed on that remote; they are documented as a cost
   bound, not an integrity property, since `--no-verify` is a cheaper bypass than
   forging one (CR round 2, D1).

6. *What replaces merge/cherry-pick/revert transient state?*
   -> **Parent count only identifies merges; durable single-parent commits
   enforce.** Cherry-picks and reverts that remain in history should explain
   themselves, while autosquash subjects remain exempt because those objects are
   intended to disappear (D12).

7. *Should Git-plumbing errors allow the push?*
   -> **No; exit 2 without mutating state.** Pre-push is the authoritative and
   safely retryable boundary, so failing open would recreate a silent bypass
   (D14).

8. *Which parked-spike work survives?*
   -> **Keep path predicates, PR composition, summary selection, docs intent, and
   their tests; replace provisional enforcement.** Those units already consume
   stable branch/diff inputs and do not share the architectural defect (D13).

9. *Can the existing `.noldor/rollout-marker` grandfather pre-upgrade history?*
   -> **No; add `.noldor/summary-body-rollout.json`.** The existing marker may
   predate this validator by months, and one new marker cannot date commits on
   side branches. The snapshot records all activation-time commit-ref tips, so
   exactly their ancestor closure is grandfathered and later side-branch commits
   still enforce (spec-review fixes).

10. *What if another clone cannot resolve a snapshotted machine-local tip?*
    -> **Omit that negative tip with a warning.** Missing a grandfather input can
    only cause more commits to be validated; treating it as fatal would make the
    tracked snapshot non-portable, while treating it as an exemption would fail
    open (spec-review fix).

11. *How does the snapshot reader report absent versus corrupt?*
    -> **A discriminated `absent | invalid | ok` result, not a nullable
    snapshot.** Both failures collapsing to `null` would make "a corrupt snapshot
    blocks at exit 2" unreachable — the same null-collapse `rolloutMarkerExists`
    was added to escape in `rollout-marker.ts`. Encoding it in the type keeps the
    two exits from depending on a second lookup (CR round 2, M1).

12. *May an absent snapshot disable the gate silently?*
    -> **No; both adapters print one line naming the file and the init command.**
    A silent disable reachable by deleting one tracked file is the push-time
    override this spec calls a non-goal. The notice changes no exit code (CR
    round 2, D2).

13. *Is a locally-missing remote-old SHA an infrastructure failure?*
    -> **No; drop that negative and validate more.** A remote that moved before
    this clone fetched is routine, and failing closed there would replace Git's
    own `Updates were rejected` diagnostic with a Noldor one while adding no
    safety — widening the candidate set is strictly conservative (CR round 2,
    D3).

14. *Does an `invalid` snapshot block a commit as well as a push?*
    -> **No; advisory prints the reason, still advises on the body, and exits 0.**
    Fail-closed belongs to the adapter holding the enforcement claim. Blocking
    `commit-msg` on a file it has no authority over would reintroduce the
    provisional-state blocking this redesign exists to remove. It still advises
    because, unlike `absent`, the repository *has* opted in — only the
    grandfathering boundary is unreadable, and body advice never depended on it
    (CR rounds 3–4).

15. *What if the push names a URL instead of a remote?*
    -> **Use Git's own second hook parameter: `$1 !== $2` means the argument is a
    name.** Git passes the raw URL as `$1` for `git push https://… main`, so a
    naive glob would silently restore the unbounded walk. An earlier revision
    inferred the answer from an empty `refs/remotes/<arg>/**` enumeration, but
    that misreads a configured-but-never-fetched remote as a URL; `$2` is the
    fact rather than an inference, and costs nothing. The config probe then runs
    only on a genuinely anonymous push, and its no-match exit of 1 is data, not
    failure. A consumer whose Lefthook template does not yet pass `{2}` keeps the
    old enumerate-then-probe path — cost-only, never narrowing the candidate set
    (CR rounds 3–5).

16. *Should tracking subtraction get the same unconditional notice as an absent
    snapshot?*
    -> **No; it is reported inside the exit-1/exit-2 diagnostics instead.** An
    absent snapshot means nothing is checked; a forged tracking tip removes some
    commits from a gate that still checks the rest. A line on every ordinary push
    would be trained away, and counting suppressed candidates would cost a second
    `rev-list` per push (CR round 3).

17. *How many Git spawns per candidate?*
    -> **Two: one header read, one `diff-tree` for objects still in play.**
    `%P`, `%B`, and the `Noldor-Path` trailer are all header fields, so splitting
    them into three commands paid two extra spawns on every non-merge commit —
    the common case — to save one cheap read on merges (CR round 2, D4).
