# Stable Entry IDs for Roadmap + Backlog — Design

**Slug:** stable-entry-ids-for-roadmap-backlog
**FD:** docs/features/stable-entry-ids-for-roadmap-backlog.md
**Date:** 2026-07-03
**Tier:** specs-only

## Problem

Every roadmap and backlog entry is addressed by a kebab-slug derived from its heading at parse time (`createSlugTracker` in `src/utils/parse-blocks.ts:60` — `slugify(name)` plus `-2`/`-3` collision suffixes). The slug is never persisted; it is recomputed on every parse. That makes it rename-fragile:

- Renaming a heading silently changes the slug, breaking every `deps:` reference (read by `scoreEntry` / `resolveIsShipped` in `src/triage/score.ts:41,71`), every `parent:` bullet, every commit-trailer scope, every dashboard block URL (`src/dashboard/api/blocks.ts` addresses entries by slug), and `noldor roadmap remove-block <slug>` (`src/triage/remove-block-cli.ts:27`).
- Collision suffixes (`-2`, `-3`) are source-order-dependent: inserting an entry above a colliding pair re-numbers the survivor.
- Moving an entry between roadmap ↔ backlog (first-class per `docs/noldor/triage.md` "Cross-file moves … are first-class and bidirectional") keeps the slug only if the heading is untouched, and loses any heading-evolution traceability either way.

Nothing in the system survives a rename. The queue needs one identifier that is minted once and never rewritten.

## Goals

- Every roadmap and backlog entry carries a stable short ID (`- id: Q-0042` bullet field) minted at first triage and never rewritten — including across heading renames and roadmap ↔ backlog moves.
- Counter persisted in `.noldor/id-counter.json`; minting is a CLI (`pnpm noldor triage mint-id`) so `/triage` and `/new-feature` shell out instead of guessing.
- Parser (`parse-blocks.ts`), validator (`validate-triage.ts`), and scorer (`score.ts`) understand IDs: `deps:` may reference an ID or a slug interchangeably.
- One-sweep backfill CLI stamps IDs onto all current entries (~25 roadmap + ~7 backlog as of 2026-07-02) and is idempotent, so consumer repos can run it at adoption time.
- Slug stays the human-readable alias — headings remain renameable without breakage.
- Preambles of `docs/roadmap.md` / `docs/backlog.md` and the framework pages `docs/noldor/triage.md` / `docs/noldor/feature-md-schema.md` document the contract.

## Non-goals

- **No consumer-wide reference migration.** Commit trailers, dashboard URLs, garden detectors, and `/gate` keep resolving slugs today; this entry ships the substrate (ID field + resolver) they adopt incrementally. `first-class-blocked-by` (dep of this entry) is the first planned consumer.
- **No rewrite of existing FDs.** Historical `docs/features/*.md` stay ID-less; only entries promoted after this ships carry the ID forward.
- **No dashboard UI for IDs** (display/edit) — the parser exposes `id` on `BacklogEntry`, so the dashboard can render it later for free.
- **No renumbering, ever.** Gaps in the sequence (rejected triage rows, dropped entries) are permanent and harmless.

## Design

### Unit 1 — ID format + counter + mint CLI (`src/triage/entry-id.ts`, new)

- `ENTRY_ID_RE = /^Q-\d{4,}$/` — single `Q-` namespace (see D1), zero-padded to 4 digits, width grows past `Q-9999` without a format break.
- `mintEntryIds(count: number, counterPath: string): string[]` — reads `.noldor/id-counter.json` (`{ "next": number }`; missing file ⇒ `{ next: 1 }`), returns `count` IDs, writes the bumped counter back. Synchronous FS, mirroring `resolveIsShipped`'s style in `score.ts`.
- CLI subcommand `pnpm noldor triage mint-id [--count N]` (default 1) prints one ID per line — registered next to the existing `triage` subcommands (`list-untriaged`, `score`) in the CLI dispatch (`src/cli/index.ts` / `src/cli/help.ts`).

### Unit 2 — parser support (`src/utils/parse-blocks.ts`)

- `BacklogEntry` gains `id?: string` (`src/utils/parse-blocks.ts:21`).
- `parseBlockBody` (roadmap path): add `id` to the bullet-field alternation at `parse-blocks.ts:222-223` and thread it through `parseRoadmap`'s `entries.push` (`parse-blocks.ts:145`).
- `parseEntries` (backlog path): the generic `fieldRe = /^- (\w+): (.+)$/gm` at `parse-blocks.ts:275` already captures `id` into `fields` and strips it from `description`; just map `fields.id` into the pushed entry.
- Slug derivation is untouched — `slug` remains the alias.

### Unit 3 — validation (`src/triage/validate-triage.ts`)

Three new rules in `validateTriageInputs` (which already receives both raws — the right place for a cross-file check):

- `missing-entry-id` — entry has no `- id:` bullet. **Error** on both files, but only enforced when `.noldor/id-counter.json` exists (adoption-safe: a consumer that never ran the backfill isn't blocked; the moment the counter file appears, IDs are mandatory — see D4).
- `malformed-entry-id` — `id` present but fails `ENTRY_ID_RE`. Always an error.
- `duplicate-entry-id` — same ID appears twice across roadmap **and** backlog combined (a single `Map<string, location>` over both parses, unlike the per-file `duplicate-name` check at `validate-triage.ts:81-94`). Always an error; this is the backstop for parallel-branch mint races (see Risks).

The existing per-file `REQUIRED_FIELDS_*` arrays stay as-is; `id` needs its own pass because of the counter-file gating and the cross-file dedup.

### Unit 4 — minting at creation (`.claude/skills/triage/SKILL.md`, `/new-feature`)

- `/triage` step 6 (block-write templates at SKILL.md lines 65-99): each new-entry block emits `- id: <minted>` as its **first** bullet. IDs are minted **after** batch confirmation, one `pnpm noldor triage mint-id --count <n>` call for all accepted new-entry rows (rejected rows never burn IDs — D3). Merge rows never mint (host block keeps its ID).
- `/new-feature` mints one ID via the same CLI and writes it as optional FD frontmatter `entry-id: Q-NNNN`; `/promote` lifts the source block's `- id:` into the same field when scaffolding (see D2). This adds one optional `.strict()` field to `FeatureFrontmatterSchema` in `src/features/feature-schema.ts` — the only touch outside the entry's Touches list, and it's what makes the ID survive the roadmap → FD hop instead of dying at promote.

### Unit 5 — backfill sweep (`pnpm noldor triage backfill-ids`)

- Idempotent CLI: parses roadmap then backlog, mints IDs for every entry lacking one (roadmap file order first, then backlog — deterministic), inserts `- id:` as the first bullet of each block, skips entries that already have one. Rerunning is a no-op.
- Run once in the implementation commit for this repo's ~32 entries; documented in the adoption guide path for consumer repos (`noldor upgrade` migration-chain entry is a natural follow-up but not required — the CLI is self-serve).

### Unit 6 — slug-or-ID resolution (`resolveEntryRef` in `src/triage/entry-id.ts`)

- `resolveEntryRef(ref, { roadmapRaw, backlogRaw, featuresDir }): string` — if `ref` matches `ENTRY_ID_RE`, scan parsed roadmap + backlog entries for a matching `id`, then `docs/features/*.md` frontmatter for a matching `entry-id`, and return that entry's slug; otherwise return `ref` unchanged (it's already a slug). Unknown ID resolves to itself (downstream treats it as an unshipped/unknown slug — same failure mode as a typo'd slug today).
- `resolveIsShipped` in `src/triage/score.ts:71` composes with it: `deps:` bullets may now hold `Q-0042` or `first-class-blocked-by` interchangeably; an ID pointing at a `phase: done` FD (via `entry-id`) counts as shipped.

### Unit 7 — docs

- `docs/roadmap.md` + `docs/backlog.md` preambles: one line each documenting the `- id:` bullet ("stable ID, minted at triage, never rewritten; slug is a renameable alias").
- `docs/noldor/triage.md`: new "Stable entry IDs" section — format, counter file, mint/backfill CLIs, validator rules, ID-or-slug rule for `deps:`.
- `docs/noldor/feature-md-schema.md`: `entry-id` row in the Optional-frontmatter table.

## Acceptance criteria

- `pnpm noldor triage mint-id --count 3` prints three sequential IDs and bumps `.noldor/id-counter.json`; a missing counter file starts at `Q-0001`.
- `parseRoadmap` / `parseBacklog` expose `id` on entries that carry `- id:`, and the bullet does not leak into `description` (unit tests beside the existing suites in `src/utils/__tests__/parse-blocks.test.ts`).
- With the counter file present, `pnpm noldor validate triage` errors on a roadmap or backlog entry missing `id`, on a malformed `id`, and on the same `id` appearing in both files; with the counter file absent, missing `id` is silent.
- `pnpm noldor triage backfill-ids` stamps every current entry exactly once; a second run changes nothing (`git diff` empty).
- `scoreEntry` with `deps: ['Q-0042']` where `Q-0042` resolves to a `phase: done` FD yields the same score as the slug form; unknown IDs count as unshipped.
- After the backfill lands, renaming a roadmap heading and re-running `pnpm noldor validate triage && pnpm noldor triage score --deps=<that-id>` shows no breakage — the ID reference survives the rename.
- Both preambles and both `docs/noldor/` pages document the contract (doc-links sync clean).

## Risks / trade-offs

- **Parallel-branch mint races.** Two concurrent triage/drain branches both read `next: 33` and mint `Q-0033`. Mitigation is two-layer: `.noldor/id-counter.json` is a real merge conflict (surfaces at merge, like the known roadmap.md conflicts under K>1 drains), and `duplicate-entry-id` is a hard validator error caught by pre-commit on the second merge. Accepted residual: someone hand-resolves the counter conflict wrongly — validator still blocks.
- **Counter file forgets in consumer repos.** A consumer adopting Noldor without running backfill would fail validation if `id` were unconditionally required — hence the counter-file-existence gate (D4). Trade-off: a repo that deletes the counter file silently turns enforcement off; acceptable because the same repo would break minting too, loudly, on next triage.
- **Scope creep into feature-schema.ts.** One optional field beyond the Touches list. Alternative (ID dies at promote) guts the traceability goal; kept minimal (optional, `.strict()`-compatible, no validator cross-checks in v1).
- **Two-name world.** Until consumers migrate, an entry is addressable by ID and slug; prose and trailers will mix them. The resolver makes both work; `first-class-blocked-by` establishes the ID-first convention for machine references.

## User Story

As an operator (or autonomous drain agent) managing the Noldor queue, I want every roadmap and backlog entry to carry a stable ID minted at triage and never rewritten, so that renaming a heading or moving an entry between roadmap and backlog never breaks `deps:` references, commit trailers, dashboard links, or detector output that target it.

## Usage

**Minting (automatic)** — `/triage` mints IDs for confirmed new-entry rows and writes `- id: Q-NNNN` as the first bullet of each schema-C block; `/new-feature` and `/promote` carry the ID into FD frontmatter as `entry-id`.

**CLI**

```bash
pnpm noldor triage mint-id [--count N]   # print next N IDs, bump .noldor/id-counter.json
pnpm noldor triage backfill-ids          # idempotent one-sweep stamp of all id-less entries
pnpm noldor validate triage              # now also enforces presence/format/cross-file uniqueness of ids
pnpm noldor triage score --deps=Q-0042   # deps accept IDs or slugs interchangeably
```

**Authoring rule** — never write `- id:` by hand except when resolving a counter merge conflict; never renumber; renaming a heading is now safe (slug is an alias).

**Agent API** — none beyond the CLI; agents reference entries by ID in `deps:` and (post `first-class-blocked-by`) `blocked-by:`.

## Open questions (resolved)

1. *Single `Q-` namespace or split `R-`/`B-` per file?* -> Single `Q-0042` namespace. (D1) Cross-file roadmap ↔ backlog moves are first-class per `docs/noldor/triage.md`; a per-file prefix would either lie after a move or force a rewrite, defeating "never rewritten".
2. *Does the ID survive promotion to a feature MD, and where?* -> Yes — `/promote` lifts `- id:` into optional FD frontmatter `entry-id` (one optional field added to `FeatureFrontmatterSchema`). (D2) Without it the ID dies exactly when the entry becomes long-lived, and `resolveIsShipped` could never resolve an ID to a shipped feature.
3. *Mint at proposal time or at write time?* -> At write time, after batch confirmation, one `mint-id --count <n>` call for all accepted rows. (D3) Rejected rows must not burn IDs; gaps are harmless but pointless.
4. *Is `id` required or advisory in `validate:triage`?* -> Required (error), gated on `.noldor/id-counter.json` existing. (D4) Backfill ships in the same PR here so enforcement is immediate for this repo, while consumer repos that haven't opted in aren't bricked — the counter file is the opt-in signal.
5. *How to handle concurrent minting on parallel branches?* -> Accept the counter-file git conflict as the primary guard and add the cross-file `duplicate-entry-id` validator error as the backstop; no locking. (D5) Matches the framework's existing posture for roadmap.md conflicts under parallel drains — surface at merge, block at pre-commit.
6. *Do commit trailers, dashboard URLs, and garden detectors switch to IDs now?* -> No — ship the substrate (field + parser + validator + `resolveEntryRef`) and migrate consumers incrementally, starting with `first-class-blocked-by` which already depends on this entry. (D6) A big-bang reference migration would balloon an M into an L and touch surfaces this entry's Touches list deliberately excludes.
