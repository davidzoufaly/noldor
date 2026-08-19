# Architecture Decision Record Surface — Design

**Slug:** architecture-decision-record-surface
**FD:** docs/features/architecture-decision-record-surface.md
**Date:** 2026-08-19
**Tier:** specs-only

## Problem

Q-0093 shipped `docs/architecture/` — the shape of the system — and explicitly
carved decision records out of it: its Non-goals calls ADRs "a different
artifact (append-only, dated, superseded-by chains) with a different
lifecycle. Carved to a sibling roadmap entry". That sibling was never minted,
so the shipped spec references an entry that does not exist. This is it.

The demand is concrete. `Package Runtime Representation ADR` (Q-0117,
`docs/backlog.md:191`) asks to record the source-at-runtime distribution
decision as an ADR and currently has nowhere to put it — and Q-0133
(self-contained executable) is `blocked-by: Q-0117`, so the missing surface
sits on a real dependency chain. The 2026-08-12 read-only audit named
source-at-runtime packaging, adoption-safe advisories, sequential queue writes
and graph fallbacks as decisions whose reasoning survives only in
`docs/design/specs/archive/` — artifacts written to design a change, not to
answer "why does this bind us today".

Deletion test: a reviewer can answer "why does this bind us today" without
opening `docs/design/specs/archive/`.

## Goals

- `docs/adr/NNNN-<slug>.md` records with validated frontmatter
  (`status: accepted | superseded`, `date`, `supersedes` / `superseded-by`).
- An append-only discipline the framework actually checks, not prose.
- A supersede chain that never dangles, in either direction.
- `loadDocRoots` key so no caller joins its own path string.
- Adoption-safe: a repo with no ADRs is never blocked by any of it
  (`absent → skipped`, same posture as `docs/architecture/`).
- Noldor dogfoods the surface with its first real record in the same PR.

## Non-goals

- **Deciding Q-0117.** That entry's content — which runtime representation
  ships — is its own M-sized work. This surface is where its output lands,
  not the analysis itself.
- **Backfilling the audit's decision list.** Sequential queue writes, graph
  fallbacks etc. become ADRs as they are next touched, not in a bulk import
  that would ship four unreviewed decision statements at once.
- **Body structure validation.** The template prompts Context / Decision /
  Consequences, but the validator checks frontmatter and chain integrity
  only. Content quality is review-stage work (the same trade Q-0093 made:
  the check sees presence, never truth).
- **A dashboard route.** Same posture as Q-0093 (its route is Q-0134); a
  route for `docs/adr/` is a later entry if wanted.
- **An index page.** A numbered, sorted directory listing is the index.

## Design

### U1 — Record schema (`src/docs/adr-schema.ts`)

Filename contract: `NNNN-<slug>.md` — four digits, zero-padded, then a
kebab-case slug (`/^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/`). Numbers are
unique across the folder; gaps are legal (a record is never renumbered).

Frontmatter contract:

```yaml
---
status: accepted | superseded   # required
date: YYYY-MM-DD                # required — the day the decision was accepted
supersedes: NNNN                # optional — present only on a replacing record
superseded-by: NNNN             # required iff status: superseded
---
```

Exports: `ADR_FILENAME_RE`, `AdrFrontmatter`, `parseAdrFrontmatter(raw)`
(returns a result object, never throws — the same fail-closed boundary
`src/docs/docs-architecture.ts` uses), and `nextAdrNumber(existing)` (max + 1,
zero-padded — shared by U4 so minting has one implementation).

The record body below the frontmatter is free-form; the U4 template prompts
`# <Title>` plus Context / Decision / Consequences sections.

### U2 — Validator (`src/docs/docs-adr.ts`)

```ts
export interface AdrFinding {
  readonly file: string;   // repo-relative path
  readonly rule:
    | 'bad-filename' | 'dup-number' | 'bad-frontmatter' | 'bad-status'
    | 'bad-date' | 'dangling-superseded-by' | 'missing-superseded-by'
    | 'stray-superseded-by' | 'bad-supersedes' | 'unreadable';
  readonly message: string;
}
export interface AdrReport {
  readonly status: 'absent' | 'ok' | 'invalid';
  readonly findings: readonly AdrFinding[];
}
export async function checkAdr(cwd: string): Promise<AdrReport>;
```

Resolves the folder through `loadDocRoots(cwd).adr` (U6). `status` is
`absent` when the folder does not exist or contains no file matching
`ADR_FILENAME_RE` — a stray `README.md` or notes file does not opt a repo in
(D4: `noldor init` scaffolds nothing here, so no untouched-scaffold special
case is needed; the folder either has records or it does not).

Rules, one finding per file per rule:

- `bad-filename` — a `.md` file in the folder not matching the contract
  (non-`.md` files are ignored).
- `dup-number` — two records share `NNNN`; both are named.
- `bad-frontmatter` / `bad-status` / `bad-date` — parse failure, enum
  violation, or a date that is not a real `YYYY-MM-DD` day.
- `missing-superseded-by` — `status: superseded` without a `superseded-by`.
- `stray-superseded-by` — `superseded-by` present on a record whose `status`
  is `accepted` (the "only if" direction of the contract).
- `dangling-superseded-by` — `superseded-by` names a number with no record,
  regardless of the carrying record's status.
- `bad-supersedes` — `supersedes` names a number with no record, or one whose
  `status` is not `superseded` (D3: both directions validated, so a flip and
  its successor must land together).
- `unreadable` — any filesystem failure becomes a finding, never a throw,
  matching `checkArchitecture`.

Findings sort by file then rule; output is deterministic.

### U3 — Check CLI

`noldor docs adr [--check]`, registered in the `docs` group of
`src/cli/manifest.ts` (`src/cli/manifest.ts:327`) beside `architecture` —
same shape: `--check` is the only mode and the default. Exit 0 on `ok` and on
`absent` (one stdout line naming why the check did not apply), exit 1 on
`invalid` with findings on stderr in U2's order.

### U4 — Authoring CLI

`noldor adr new <slug> [--supersedes NNNN]`, a new top-level `adr` group in
the manifest. Creates `docs/adr/` when missing, mints the next number via
`nextAdrNumber`, and writes `NNNN-<slug>.md` from a code-embedded template
(`status: accepted`, today's date, `# <Title from slug>` + Context / Decision
/ Consequences prompts). It is a generator, not a synced template — it does
NOT join `SCAFFOLD_ONLY_TEMPLATES` (`src/templates/manifest.ts:20`), because
`init` never copies it and `template-sync` must never see it.

`--supersedes NNNN` additionally rewrites the target record's frontmatter:
`status: accepted → superseded`, adds `superseded-by: <new NNNN>`, and stamps
`supersedes: NNNN` on the new record — so D3's one-commit discipline costs
one command. Refuses when the target is already `superseded` or missing.
The frontmatter rewrite touches nothing below the closing `---`, so it stays
inside U5's allowed-mutation set by construction.

### U5 — Append-only pre-push check

A new module `src/hooks/validate-pushed-adrs.ts` (mirroring
`validate-pushed-summaries.ts`), invoked from the pre-push chain in
`src/hooks/noldor-pre-push.ts` with the same `refLines` input the hook
already parses. Per pushed ref: range is `<remote-sha>..<local-sha>`; a zero
remote sha (new branch) falls back to `merge-base(origin/main, local-sha)..local-sha`
(D2 — the summary-body gate's contract, replayable author-side via the gate
preflight `printf` recipe).

For every `docs/adr/*.md` path in the range diff, comparing base blob to tip
blob:

- **New file** → allowed (that is the "append").
- **Deleted file** → blocked. Records are permanent; a wrong decision is
  superseded, never erased.
- **Modified file** → allowed only when the base `status` was `accepted`,
  every change is confined to the frontmatter block, and the frontmatter
  delta is exactly: `status` flipped to `superseded` and a `superseded-by`
  line added. Any body change, any other frontmatter change, or any edit to
  an already-`superseded` record → blocked, naming the file and what moved.

Blocked output explains the remedy: supersede with
`noldor adr new <slug> --supersedes NNNN`. The check is skipped entirely when
the range touches no `docs/adr/` path, so it costs nothing on ordinary
pushes. It runs on every allowed push regardless of remote, mirroring
`validatePushedSummaries` (`src/hooks/noldor-pre-push.ts:96` — only the
main-destination block is origin-gated).

**Repair override.** `NOLDOR_ADR_REPAIR=1` in the pushing environment lets an
otherwise-blocked mutation through — the framework's existing idiom for
audited bypasses (`NOLDOR_RELEASE_PUSH=1`, same hook). Every use appends a
receipt line (`iso`, ref, files) to `.noldor/adr-repairs.log`, and a garden
override-audit detector surfaces unexplained entries the way the bootstrap
and codex override audits do. This is the legal path for the repairs
append-only cannot express: renumbering a post-merge duplicate, retargeting
pointers after such a renumber, and un-wedging a broken chain.

Boundary honesty: this guards the push seam. A hand edit committed directly
to `main` (release pushes, override merges) is out of its reach — that class
is what U7/U8 catch later.

### U6 — Doc root

`DocRoots` (`src/core/doc-roots.ts:51`) gains
`adr: join(cwd, 'docs', 'adr')`. No transition alias — the folder never had
a legacy name.

### U7 — Garden detector + SDD gap

`src/garden/detectors/adr.ts` wraps `checkAdr` and emits one `Gap` per
finding (`category: 'adr'`, `itemId: <file>#<rule>`, message = the finding's
message), nothing on `absent`. The findings join the blocking class
deliberately — an invalid record already blocks the release row (U8), so
garden reporting it as blocking is consistent, not a new cliff; there is no
advisory class here (the Q-0093 advisory split existed for module-staleness
nags, which have no ADR equivalent). Wired wherever
`detectArchitectureFindings` is wired (`collectGaps` → `docs/sdd-report.md`,
`garden detect`, dashboard).

### U8 — Release probe

A new `'adr'` member of `PreflightRowId` (`src/release/preflight-types.ts:14`),
appended to `ALL_ROW_IDS` and `PROBES` (`src/release/preflight-probes.ts`).
`absent → skipped` with the reason in `detail`; `invalid → blocking` with
`fix: noldor docs adr --check`; `ok → ok`. `RELEASE_SKIP_ADR=1` routes
through the existing `overrideSkip` helper, checked first, audited like every
other override. The pinned count assertion in
`src/release/__tests__/preflight-probes.test.ts` moves 14 → 15 in the same
change.

### U9 — Dogfood record

`docs/adr/0001-absent-doc-surfaces-skip-release-gates.md`, written in this
PR: the decision — already made once in Q-0093 and reused here (D4/D5) —
that a doc surface a repo has not opted into maps to `skipped`, never
`blocking`, in every gate. It is a real, load-bearing decision with a
stated alternative (gate-by-default) and consequences (`init` can never
brick a consumer's release), so it exercises the validator on real content
and turns the repo's own release row `ok` on first run. For that reason the
FD does **not** declare `introduces-gate`: the new pre-push rules see only
new files in this PR (allowed by construction), and the release row is green
via this record — no window exists where the feature's gates block the
feature's own shipping (the same argument Q-0093 U9 made).

## Acceptance criteria

1. `noldor adr new first-decision` in a repo with no `docs/adr/` creates the
   folder and `0001-first-decision.md` with `status: accepted`, today's
   date, and the template body; a second `new` mints `0002-…`.
2. `noldor adr new <slug> --supersedes 0001` flips `0001` to
   `status: superseded`, adds `superseded-by` pointing at the new number,
   stamps `supersedes: 0001` on the new record, and the folder then passes
   `noldor docs adr --check`; the flag refuses a missing or
   already-superseded target.
3. `noldor docs adr --check` exits 0 on a valid folder and on an absent one
   (with a line naming why), and the bare invocation behaves identically.
4. It exits 1 naming file and rule for: a non-conforming filename, a
   duplicate number, unparseable frontmatter, a status outside the enum, an
   invalid date, `superseded` without `superseded-by`, a `superseded-by` on an
   `accepted` record or naming no existing record, and a `supersedes` whose target is missing or
   not `superseded`.
5. A folder containing only non-record files (e.g. `README.md`) reads as
   `absent`; filesystem failures yield `unreadable` findings, never a throw.
6. A push whose range modifies an accepted record's body, edits a
   superseded record, or deletes any record is blocked with the file named;
   a push adding a new record, or applying exactly the
   status-flip-plus-`superseded-by` mutation, passes.
7. The pre-push check derives its range from the hook's ref lines; a
   new-branch push (zero remote sha) checks against the merge-base with
   `origin/main`; pushes touching no `docs/adr/` path skip the check; with
   `NOLDOR_ADR_REPAIR=1` a blocked mutation passes and a receipt line lands
   in `.noldor/adr-repairs.log`.
8. Release preflight reports an `adr` row: `skipped` when absent, `blocking`
   with a `fix` when invalid, `ok` when valid; `RELEASE_SKIP_ADR=1` forces
   `skipped` and tags the override; the row-count assertion passes at 15.
9. `garden detect` and `docs/sdd-report.md` carry `adr` gap lines while the
   folder is invalid and nothing when it is absent.
10. `loadDocRoots(cwd).adr` resolves `docs/adr`, and every new unit resolves
    the folder through it.
11. This repo ships `docs/adr/0001-absent-doc-surfaces-skip-release-gates.md`
    and every check above is green on the repo itself.

## Risks / trade-offs

- **The push seam is the only append-only enforcement point.** A hand edit
  committed to `main` outside a PR (release push, override merge) bypasses
  U5, and U7/U8 only catch it if it also breaks frontmatter or the chain —
  a silently reworded body on `main` is invisible. Accepted: the same class
  of edit bypasses every pre-push gate in the repo, and PR flow is the
  enforced path (`noldor-pre-push.ts` blocks direct main pushes).
- **Two records can mint the same number in parallel branches.** Two drain
  children each running `adr new` mint the same `NNNN` with different slugs;
  no git conflict fires. The `dup-number` rule catches it post-merge (garden,
  SDD report, release row) rather than at push. The remedy is renumbering the
  younger record via a `NOLDOR_ADR_REPAIR=1` push — renumbering is a
  delete-plus-add, which the plain check rightly blocks, so the audited
  override is the designed repair path, not a workaround. One repair push
  also carries any pointer retargets the renumber forces.
- **Blocking release row on a docs artifact.** Same trade Q-0093 accepted,
  same two escape hatches: never opting in, and `RELEASE_SKIP_ADR=1`.
- **The supersede flip must land with its successor.** D3's fail-closed
  validation means a lone `status: superseded` flip reds the folder until
  the replacing record exists. `adr new --supersedes` makes the pair one
  command; hand authors get a red check with a message naming the fix.
- **Frontmatter-delta parsing in U5 is textual.** The allowed-mutation check
  compares parsed frontmatter plus raw body bytes; a reformat that moves the
  closing `---` or reorders keys reads as a violation. Deliberate: strictness
  errs toward blocking, and the remedy line names the legal path.
- **No content quality check.** A one-line Decision with empty Context
  passes. Review stages own quality, as with every doc surface here.

## User Story

As a maintainer or review agent, I want the repository's binding decisions
recorded as append-only, dated, supersede-chained records, so that I can
answer "why does this bind us today" without excavating archived design
specs.

## Usage

```bash
# first record (creates docs/adr/)
noldor adr new package-runtime-representation

# replace a decision — flips 0003 to superseded, links both directions
noldor adr new package-runtime-representation-v2 --supersedes 0003

# validate (exit 0 ok/absent, 1 invalid)
noldor docs adr --check

noldor garden detect          # same findings, alongside the other detectors
pnpm release                  # adr row: ok / skipped / blocking
RELEASE_SKIP_ADR=1 pnpm release   # audited override
```

Append-only is enforced at push: editing an accepted record's body, editing
a superseded record, or deleting a record fails the pre-push hook; the only
legal in-place mutation is the supersede flip.

## Open questions (resolved)

1. *How is append-only enforced — git diff, frontmatter-only validation, or
   advisory?*
   → **Git-diff check in the pre-push chain.** The entry demands "a
   discipline the framework can check"; prose discipline and advisory nags
   both fail that test (D1).
2. *Which range does the pre-push check diff?*
   → **The push range from the hook's ref lines**, merge-base fallback on a
   zero remote sha — the summary-body gate's proven contract, replayable
   author-side via the gate preflight recipe (D2).
3. *Is the supersede chain validated in both directions?*
   → **Yes.** `superseded` requires an existing `superseded-by` target;
   `supersedes` requires a target that is actually `superseded`. Fail-closed
   like `blocked-by` refs — a dangling chain defeats the surface's purpose
   (D3).
4. *What does `noldor init` scaffold?*
   → **Nothing.** Opt-in is a folder with ≥1 real record; `adr new` births
   it. No scaffold means no untouched-scaffold special case and no way for
   `init` to put a consumer near a blocking state (D4).
5. *Release row?*
   → **Blocking, absent → skipped, `RELEASE_SKIP_ADR=1` override.** It is
   the only gate that sees invalid records landed outside the push seam
   (D5).
6. *CLI surface?*
   → **`docs adr --check` + `adr new [--supersedes]`.** Minting and the
   supersede pair are the two error-prone hand operations; a third
   `supersede` command adds surface the first demand (Q-0117) does not need
   (D6).
