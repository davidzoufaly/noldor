---
area: tooling
category: Tooling
deps: []
links:
  spec: lost-pre-extraction
  code:
    - src/milestones/cli.ts
    - src/milestones/lib.ts
    - src/milestones/validate-milestones.ts
  tests:
    - src/milestones/__tests__/lib.test.ts
    - src/milestones/__tests__/validate-milestones.test.ts
name: Decouple Milestones from Semver
packages:
  - tooling
phase: done
noldor-tier: full
introduced: 0.5.0
---

## Summary

`docs/vision.md`'s `current-milestone: 1.0.0` ties milestone identity to semver. The two have different cadences: a milestone is a strategic gate ("public release with house-modeling agent"); semver tracks API/format compatibility. Conflating them forces premature version commitments and leaks strategic naming into the changelog. Proposal: introduce a separate milestone-naming taxonomy (codenames? phases?) and a new skill (`/noldor-milestone` or similar) for crafting milestone definitions independent of releases. Vision keeps a milestone reference; release notes keep semver. Trigger: live now — milestone vs version drift already confuses `/noldor-triage` decisions ("is this v1.0 or post-MVP?").

## User Story

- As a Noldor operator (human or agent), I want milestones expressed as codename slugs with their own draft / active / shipped lifecycle, so that strategic gates evolve independently of `pnpm release`'s semver cadence and the changelog stays free of premature strategic naming.
- As an operator running a fresh or between-milestones repo, I want the framework to validate green without any active milestone, so that milestone tracking is purely additive and never blocks shipping.

## Usage

Milestone tracking is optional — the framework validates green without any active milestone. To use it:

**Skill commands**

- `/noldor-milestone draft [<slug>]` — scaffold a new milestone at `docs/milestones/<slug>.md` with `status: draft`. Without a slug, the skill proposes a codename based on a theme or vision body and asks the operator to confirm or rename.
- `/noldor-milestone activate <slug>` — promote a draft to active; flip the previous active (if any) to shipped; update `docs/vision.md` frontmatter `current-milestone: <slug>`. Preflights all state before any write.
- `/noldor-milestone edit <slug>` — open `docs/milestones/<slug>.md` for body edits (gate, success criteria, out of scope). No status mutation.
- `/noldor-milestone list` — print all milestones grouped by status (active, draft, shipped).

**Validation**

```bash
pnpm validate:milestones    # snapshot schema + single-active + vision-slug-resolves
```

Runs automatically via pre-commit hook on changes to `docs/milestones/**` or `docs/vision.md`.

**Files**

- `docs/milestones/<slug>.md` — per-milestone definition. Frontmatter: `name` (matches filename stem), `status` (`draft` / `active` / `shipped`), optional `description`. Body: `## Gate`, `## Success Criteria`, `## Out of Scope`.
- `docs/vision.md` frontmatter — optional `current-milestone: <slug>` pointer to the active milestone file.

## PRs

<!-- @prs-since-last-release: decouple-milestones-from-semver -->

## Changelog

### Initial Release (v0.5.0)

#### Summary

This release applies code review fixes (skills count + YAML safety + triage bucket), migrates vision to public-release with dashboard resolving slug, and adds a validate-milestones CLI + pre-commit hook. It introduces listMilestones grouped by status, activateMilestone with preflight atomicity, and draftMilestone with body stubs, alongside new lib types, schemas, and readers.

<!-- generated: resources -->

## Resources

- **Spec:** _lost-pre-extraction_

<!-- /generated: resources -->
