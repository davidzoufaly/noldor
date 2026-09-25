---
noldor-page: milestones
introduced: 0.5.0
---

# Milestones

Milestones are **optional** strategic gates, decoupled from semver. A milestone is
a named target (`POC`, `MVP`, `1.0.0`, or anything) that groups the features it
must contain. The whole layer is a no-op when no milestone is declared — Noldor
never forces the abstraction on a project that grows organically.

## Where they live

- **File:** `docs/milestones/<slug>.md`. The filename stem is the milestone's
  slug; `draftMilestone` writes `name: <slug>` into the frontmatter, so name ==
  slug today.
- **Frontmatter:** `name`, `status` (`draft` | `active` | `shipped`), optional
  `description`, optional `since: YYYY-MM-DD`. `draft` stamps `since` with the
  day it ran; `milestones show` and the dashboard order each status oldest
  `since` first (undated last, name breaks ties), so the ladder reads in the
  real sequence rather than alphabetically. Edit `since` to reorder. Body sections (`## Gate`, `## Out of Scope`, `## Success Criteria`)
  feed `/noldor-triage` bucketing and the `milestoneAligned` next-priority suggestion.
- **Active pointer:** `docs/vision.md` frontmatter `current-milestone: <slug>`,
  written by `/noldor-milestone activate`.

## Lifecycle

```
draft ──activate──▶ active ──(next activate)──▶ shipped
```

`/noldor-milestone activate <slug>` is atomic: it flips the previously-active milestone
to `shipped`, sets the target to `active`, and updates vision's
`current-milestone:` — preflighting all state before any write so a partial
failure leaves the filesystem unchanged. The state machine lives in
[`src/milestones/lib.ts`](../../src/milestones/lib.ts) and never changes here.

Manage milestones with the [`/noldor-milestone`](../../.claude/skills/noldor-milestone/SKILL.md)
skill (`draft` | `activate` | `edit` | `list`) — see the
[skill catalog](skill-catalog.md#noldor-milestone).

## Feature membership (optional)

An FD may declare which milestone it belongs to:

```yaml
milestone: mvp # slug of a docs/milestones/<slug>.md file
```

- The field is **optional**. When absent, every milestone surface is a silent
  no-op.
- A **dangling reference is a hard error**: `validate:features` fails when an FD
  declares `milestone: ghost` but `docs/milestones/ghost.md` does not exist
  (consistent with Noldor's strict-frontmatter posture). The check only fires
  when the field is present.
- `/noldor-triage` proposes `- milestone: <active-slug>` per roadmap bullet **only**
  when an active milestone is set and the bullet aligns with its `## Gate`;
  override or drop per row, exactly like `confidence` / `deps`. `/noldor-promote` copies
  the line verbatim into the scaffolded FD frontmatter.
- **Tagging after the fact** — `pnpm noldor milestones assign <milestone> <slug|Q-NNNN>...`
  writes the milestone onto roadmap entries, backlog entries and FDs in one call,
  for work filed before the milestone existed. A target already naming another
  milestone refuses unless `--replace` is given; a name that matches both a queue
  block and an FD refuses too — pass the `Q-NNNN` to pick one. Any refusal writes
  nothing, and a re-run is a no-op.

## What gets surfaced

- **CLI** — `pnpm noldor milestones show <slug>` lists the milestone's FDs with a
  done/total count and its queued entries, then how many roadmap entries,
  backlog entries and in-progress FDs name no milestone at all — the work no
  membership list can show.

- **Garden** — `pnpm garden:detect` flags any feature whose milestone is
  `status: shipped` while its own `phase != done` (the
  `milestone-shipped-incomplete` detector) — the drift that signals a falsely
  "shipped" milestone with open work behind it. Informational, not blocking.
- **Dashboard** — the **Milestones** page (`/milestones`) lists milestones grouped
  by status, each with its member features and a done/total roll-up; a shipped
  milestone with open members renders in the `warn` style. The `/features` list
  shows a milestone chip per feature. An empty-state renders when no milestones
  exist.

## What milestones are NOT

- Not coupled to semver — names are arbitrary.
- Not auto-assigned — the operator (via `/noldor-triage`) chooses; membership is never
  inferred from score.
- Not mandatory — no migration back-fills `milestone:` onto existing FDs, and the
  framework validates green with zero milestones declared.
