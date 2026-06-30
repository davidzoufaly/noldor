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
  `description`. Body sections (`## Gate`, `## Out of Scope`, `## Success Criteria`)
  feed `/triage` bucketing and the `milestoneAligned` next-priority suggestion.
- **Active pointer:** `docs/vision.md` frontmatter `current-milestone: <slug>`,
  written by `/milestone activate`.

## Lifecycle

```
draft ──activate──▶ active ──(next activate)──▶ shipped
```

`/milestone activate <slug>` is atomic: it flips the previously-active milestone
to `shipped`, sets the target to `active`, and updates vision's
`current-milestone:` — preflighting all state before any write so a partial
failure leaves the filesystem unchanged. The state machine lives in
[`src/milestones/lib.ts`](../../src/milestones/lib.ts) and never changes here.

Manage milestones with the [`/milestone`](../../.claude/skills/milestone/SKILL.md)
skill (`draft` | `activate` | `edit` | `list`) — see the
[skill catalog](skill-catalog.md#milestone).

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
- `/triage` proposes `- milestone: <active-slug>` per roadmap bullet **only**
  when an active milestone is set and the bullet aligns with its `## Gate`;
  override or drop per row, exactly like `confidence` / `deps`. `/promote` copies
  the line verbatim into the scaffolded FD frontmatter.

## What gets surfaced

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
- Not auto-assigned — the operator (via `/triage`) chooses; membership is never
  inferred from score.
- Not mandatory — no migration back-fills `milestone:` onto existing FDs, and the
  framework validates green with zero milestones declared.
