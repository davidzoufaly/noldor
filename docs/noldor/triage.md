---
noldor-page: triage
introduced: 0.4.0
---

# Triage

This page describes how raw ideas advance onto the engineering queue. The SDD detector contract, garden audit, and `/noldor-promote` skill that picks up from here all live on dedicated pages — see the [README route table](README.md) for navigation.

## Roadmap, Backlog, Ideas — three files

| File              | Role                                                                                                                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ideas.md`        | Raw human-generated bullets. Source for triage.                                                                                                                                                                                                                                 |
| `docs/roadmap.md` | Triaged work, hand-edited. Flat priority-ordered list — file order is priority. H3 categories (e.g. `### Noldor Framework`) group H4 entries semantically without carrying priority themselves. In-progress work is tracked via FD `phase: in-progress`, not a roadmap section. |
| `docs/backlog.md` | Parking lot. Items not on the roadmap — out-of-scope per vision, speculative, or waiting for a trigger. No `phase` field; promotion to roadmap is a `/noldor-triage` decision.                                                                                                         |

When a feature ships (`phase: done` in its feature MD), the corresponding entry in `docs/roadmap.md` is removed. Done features live in `docs/release-notes.md` and the [How-to index](../user/how-to/index.md).

### The `## Lessons` section (absorb loop)

`ideas.md` also carries a `## Lessons` section — the capture point for
operator/agent lessons and gotchas (as opposed to future-work ideas). Drop a
top-level `-` bullet there; `/noldor-absorb` classifies each unfiled bullet
(`drop` shipped-historical / `gotcha` → runbooks / `actionable` → the triage
queue / `feedback` → runbooks), files it, and stamps
`[absorbed YYYY-MM-DD → <dest>]` on the source bullet. The section is invisible
to triage tooling — `extractUntriagedBullets` walks only
`## Verticals → #### Now|Next|Later`, so lessons never surface as untriaged
ideas (a regression test locks this in). `actionable` lessons re-enter this
page's flow as ordinary `#### Later` bullets. Stamped bullets may be pruned;
git history is the audit trail. See the [skill catalog](skill-catalog.md) for
the `/noldor-absorb` contract.

## Triage flow

`/noldor-triage` is a bulk operation. Run it when `ideas.md` accumulates new top-level bullets and you want to advance them onto the engineering queue.

The skill:

1. Reads `docs/vision.md` for North Star + Posture. If `current-milestone:` is set, additionally reads `docs/milestones/<slug>.md` for gate + success criteria + out-of-scope. When the slug is absent, triage falls back to vision-only scoring (single bucket; no roadmap-next vs roadmap-later distinction).
2. Calls `pnpm noldor triage list-untriaged` to find bullets without a `[triaged …]` marker.
3. Proposes `target | area | since | slug` per untriaged bullet, where `target` is `roadmap` (with a position annotation: `top`, `after:<slug>`, or `bottom`), `backlog`, or `now`. Vision-aligned work inside the current milestone → `roadmap` (priority position chosen relative to existing entries); clearly past the current milestone → `roadmap` at a lower position or `backlog`; speculative or out-of-scope → `backlog`. `now` is the ship-next shortcut: the row lands as a roadmap insert at `top`, and after the validation chain passes the skill auto-chains `/noldor-promote <slug>` (tier `full` for size L/XL, `specs-only` otherwise) — closing the old two-step seam where the operator picked "now" intent during triage and then had to chain `/noldor-promote` by hand. Proposed only when the bullet explicitly signals immediate work, never inferred from score.
4. Asks for batch confirmation. You can override per-row.
5. Writes schema-C blocks (no `phase` — roadmap is a flat priority list and backlog is a parking lot; `phase: in-progress` lives on FDs once work starts) to the chosen file. Appends `[triaged YYYY-MM-DD → <slug>]` markers to `ideas.md`.

The skill **never commits**. Stage and commit yourself after reviewing.

**Triage does not pre-assign a gate path or `noldor-tier`.** Roadmap and backlog blocks are tier-agnostic — they represent what should be done, not how. The gate path is chosen when work starts, via [`/noldor-gate`](../../.claude/skills/noldor-gate/SKILL.md). The complexity question (brainstorm needed? new FD? attach?) is answered at that point, not during triage. The `now` target is the one deliberate exception: it carries the operator's ship-next intent through to `/noldor-promote` (tier derived from `size`: `full` for L/XL, `specs-only` otherwise — note this is deliberately coarser than `/noldor-gate` Step 0's three-way routing, which sends XS/S to `fast-track` with no FD at all), so the FD exists when the work session starts — the gate path itself is still picked at `/noldor-gate` time.

## Priority is file order

Within `docs/roadmap.md` and `docs/backlog.md`, **the order of entry headings in the file is the priority**. There is no `- priority: <int>` bullet field — reordering an entry means moving its block in the markdown source.

Scopes:

- **Roadmap:** priority is whole-file (no sub-buckets). The top H3 / H4 entry in `docs/roadmap.md` is the highest-priority item; the priority counter advances across H3 categories without reset. H3 categories (e.g. `### Noldor Framework`) remain as semantic groupers; they do not carry priority themselves.
- **Backlog:** priority is whole-file (no sub-buckets). The top entry is the highest-priority backlog item.

Cross-file moves between roadmap and backlog are first-class and bidirectional. Promoting a backlog entry onto the roadmap is a markdown cut from `docs/backlog.md` and paste at the chosen position in `docs/roadmap.md`. Demoting is the reverse. The move preserves the entry body verbatim; priority is re-derived from the new location.

Validation runs via `pnpm noldor validate triage`. Required fields differ per file — roadmap is committed scope, so `size` and `impact` are required there; backlog is a parking lot where the build-cost / strategic-weight estimate is a low-signal investment until promotion, so they stay advisory:

- **Roadmap errors (block commits):** duplicate entry names (file-wide); missing required field (`area`, `type`, `since`, `size`, `impact`); unknown `type` value.
- **Backlog errors (block commits):** duplicate entry names (file-wide); missing required field (`area`, `type`, `since`); unknown `type` value.
- **Backlog advisories (warn, do not block):** missing `size` / `impact`. Promote to errors with `--strict` once backlog backfill completes.

The pre-commit hook runs the validator (default mode) on any commit touching `docs/roadmap.md` or `docs/backlog.md`.

## Stable entry IDs

Every roadmap and backlog entry carries a `- id: Q-NNNN` bullet — a **stable ID minted once at triage and never rewritten**. Unlike the slug (derived from the heading, so a rename silently changes it), the ID survives heading renames *and* roadmap ↔ backlog moves. It is the canonical machine reference; the slug is a human-readable alias.

- **Format** — `Q-NNNN`, a single `Q-` namespace shared by both files (a per-file `R-`/`B-` prefix would lie after a cross-file move). Zero-padded to 4 digits, width grows past `Q-9999` without a format break. Regex: `^Q-\d{4,}$`.
- **Counter** — `.noldor/id-counter.json` (`{ "next": N }`; missing ⇒ starts at `Q-0001`). Minting bumps it. The file is a real merge conflict under parallel drains — that plus the `duplicate-entry-id` validator error is the two-layer guard against mint races; there is no lock.
- **Minting** — `/noldor-triage` mints IDs for confirmed **new-entry** rows after batch confirmation (one `pnpm noldor triage mint-id --count <n>` call for all accepted rows; rejected rows never burn an ID; merge rows keep the host's ID). `/noldor-new-feature` mints one into FD frontmatter `entry-id:`; `/noldor-promote` lifts the source block's `- id:` into the same field.
- **Backfill** — `pnpm noldor triage backfill-ids` stamps every id-less entry exactly once (roadmap order first, then backlog); idempotent, so a re-run is a no-op. Run it once at adoption.
- **Validation** — once `.noldor/id-counter.json` exists, `validate:triage` errors on a missing `id` (`missing-entry-id`), a malformed `id` (`malformed-entry-id`), and the same `id` in two entries across both files (`duplicate-entry-id`). With no counter file, missing `id` is silent — a consumer that hasn't opted in isn't blocked.
- **References** — `blocked-by:` bullets (legacy alias: `deps:`) may reference an ID (`Q-0042`) or a slug interchangeably; `resolveEntryRef` (`src/triage/entry-id.ts`) resolves an ID to its slug (scanning roadmap + backlog, then FD `entry-id:` frontmatter). An unknown ID resolves to itself and counts as unshipped, the same failure mode as a typo'd slug. `validate:triage` additionally flags refs that resolve to no known entry ID, entry slug, or feature MD (`unknown-blocked-by-ref` — advisory, error under `--strict`), and `/noldor-garden`'s `circular-blocked-by` detector flags cycles in the blocked-by graph.

**Authoring rule:** never write `- id:` by hand (except resolving a counter merge conflict), never renumber, never reuse. Gaps in the sequence (rejected/dropped rows) are permanent and harmless.

## Scoring rubric

`/noldor-triage` proposes a numeric score per row, computed from four bullet fields:

| Field        | Source                                                                         | Weights                                                           |
| ------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `size`       | `- size: <XS \| S \| M \| L \| XL>` bullet                                     | `XS=0.5, S=1, M=2, L=3, XL=5` (denominator — smaller = faster)    |
| `impact`     | `- impact: <low \| med \| high \| critical>` bullet                            | `low=1, med=2, high=4, critical=8` (numerator — geometric)        |
| `confidence` | `- confidence: <low \| med \| high>` bullet (silently optional; default `med`) | `low=0.5, med=0.75, high=1.0` (multiplier on impact)              |
| `blocked-by` | `- blocked-by: <slug\|Q-id, …>` bullet (alias `deps:`; optional; default empty) | `1 / (1 + unshipped_dep_count)` factor; unshipped = ref not done  |

Formula: `score = round(100 × (impact × confidence × dependency_factor) / effort)`. Range ≈ 10-1600 (max: `XS / critical / high / no deps = 1600`; min above the dep floor: `XL / low / low / no deps = 10`). Higher = higher priority.

Example — `size: M, impact: high, confidence: med, deps: []` → `round(100 × 4 × 0.75 × 1 / 2) = 150`.

The score is **derived**, not persisted. `/noldor-triage` recomputes on every run from the bullet fields, so a tuning of the formula in `src/triage/score.ts` takes effect without rewriting any markdown. The score column in the confirmation table guides the operator's insert-position pick (`top` / `after:<slug>` / `bottom`); the operator can override.

Dependency-weight reads the `- blocked-by:` bullet — its legacy alias `- deps:` is still accepted and the two are unioned (dedup) at parse time (comma-separated refs — each a kebab slug or a `Q-NNNN` entry ID). For each ref, the resolver in `src/triage/score.ts` first maps an ID to its slug via `resolveEntryRef`, then `resolveIsShipped` returns true iff `docs/features/<slug>.md` exists AND its frontmatter `phase` field reads exactly `done`. Every other state — file missing, `phase: in-progress`, ref only in roadmap, ref only in backlog, unknown ref — counts as unshipped. Items with multiple unshipped blockers are discounted proportionally.

Backwards compatibility: entries without `- confidence:` default to `med`. Entries without a `- blocked-by:`/`- deps:` bullet default to no discount. `validate:triage` does not warn or error on a missing dependency bullet — it is silently optional; the `unknown-blocked-by-ref` check only fires on refs that are present but resolve to nothing.

## Vision document

`docs/vision.md` is the strategic source. Frontmatter optionally declares the active milestone slug (`current-milestone: <slug>` → `docs/milestones/<slug>.md`). The milestone file carries the gate paragraph, success criteria, and out-of-scope list. Vision body stays paragraph-form: North Star, Posture. **Specific features and infra picks live in `docs/roadmap.md` and `docs/backlog.md`, not in vision.** When no milestone is active (a valid framework state), triage scores against North Star + Posture only.

Update `vision.md` when milestone goals shift. Triage decisions made before the shift may need re-triage if the new vision invalidates them — run `pnpm noldor garden sdd-report` (see [`garden-and-drift.md`](garden-and-drift.md)) to surface in-progress features that may now be out of scope.

## Commands

```bash
/noldor-triage                       # bulk triage skill
pnpm noldor triage list-untriaged    # JSON of untagged bullets
pnpm noldor triage mint-id [--count N]   # print next N stable IDs, bump .noldor/id-counter.json
pnpm noldor triage backfill-ids          # idempotent one-sweep stamp of `- id:` on all entries
pnpm noldor triage score --blocked-by=Q-0042  # refs accept IDs or slugs (--deps is the legacy alias)
pnpm noldor validate triage              # enforces id presence/format/cross-file uniqueness (once counter exists)
```

For `/noldor-promote` (roadmap/backlog → feature MD) see [`workflow.md`](workflow.md). For `/noldor-garden`, `pnpm noldor garden sdd-report`, and the 13-detector contract see [`garden-and-drift.md`](garden-and-drift.md).

## Triage gotchas

- **Verify a friction/bug report against the CURRENT code before triaging or
  fixing** — grep the actual seam, not the report's own text. A phase-3 pass
  mis-marked a "typescript → deps" item critical when a lazy-import had already
  fixed it. Reports describe the state when written; code moves.
- **Watch for inherited/stale premises.** Some entries were authored against a
  parent repo before extraction and can describe debt/state that no longer
  exists here. Before scaffolding an entry that cites historical counts, file
  paths, or "discovered during vX", verify the premise against live code + a
  fresh `pnpm noldor garden detect` + a `git log` grep. If the described state is
  absent, confirm supersession before committing to the work. Retire-only items
  → retire via micro-chore, not a build.
- **`pnpm noldor triage list-untriaged` only scans `## Verticals → Now|Next|Later`
  in `ideas.md`** — NOT `## Priority` or `## Not groomed`. Bullets pasted under
  those headings are invisible to the CLI; triage them in place with a
  `[triaged YYYY-MM-DD → slug]` marker.
- **`lockstepPackages` entries are `package.json` PATHS**, not package names —
  `release-packages.ts` `readFile`s them.
