---
status: accepted
date: 2026-09-25
---

# Large Skills Load as a Router and Branch Files

## Context

`.claude/skills/noldor-gate/SKILL.md` grew to 13,690 words and loads whole into every gate session, though each session runs one path: a micro-chore, a fast-track, one of four spec paths, or a drain. A rule that applies to only some paths sat deep in a long file, where a long context holds it least reliably, and every drain child paid the full load. `noldor-spec` (5,899 words) has the same shape.

Claude Code loads a skill's `SKILL.md` when the skill is invoked and nothing else in its folder until the agent reads it, so the folder can hold text that only some sessions need. Two ways to cut it were weighed: one file per path, and one file per job. Cut per path, a session reads a single file, but the seams every path shares — code review, the feature-doc close-out, blocker handling — are copied into three to five files, and copies kept in step by prose drift apart. The gate skill and `docs/noldor/drain-mode.md` had already drifted that way.

## Structural context

The decision moves prose, not code. The checks that read skill text already walk every `.md` in a skill folder: `checks template-sync` through `templateFiles()` (`src/templates/manifest.ts`), and the skill-code-drift detector and `checks skill-portability` through `collectSkillMd` (community c96). Branch files join their coverage with no new edge. The skill-size ratchet that holds the result lives in `src/checks/` and reaches the state-file seam (c109), as the clones and indirection ratchets do.

## Decision

A skill too large to load whole is a router plus branch files in its own folder. `SKILL.md` holds what every session of the skill runs, and a load table naming, for each path or mode, the files a clean run reads and the files read only on a named condition. Every fork carries a `**Read now:**` line linking the file that branch needs, and the agent reads that file in full at the fork, before acting.

Branch files are cut by job, so a seam several paths share lives in exactly one file. A branch file may send the session on to another through its own read-now line. Every branch file is reachable from `SKILL.md` through read-now links, and every read-now link names a file that exists; `checks skill-portability` refuses either failure. Every `.md` in a skill folder is ratcheted by word count (`pnpm noldor skill-size`).

## Consequences

Easier:
- A session loads the router and its own branch files, not the whole skill.
- A rule several paths share is edited in one place.
- A path-specific rule sits in a short file that the session reads at the moment it applies.

Harder:
- The agent has to obey read-now lines. A fork acted on from memory loses that branch's rules, and no check can see it.
- Moving a rule means choosing its one home, and the load table has to stay true.
- Growing any skill file needs a re-recorded ratchet baseline in the same push.

Ruled out:
- One branch file per path, with the shared seams copied into each.
- Restating a contract that already has a canonical page. The router links the page instead, as the gate's drain mode links `docs/noldor/drain-mode.md`.
- Branch files that no read-now line reaches.
