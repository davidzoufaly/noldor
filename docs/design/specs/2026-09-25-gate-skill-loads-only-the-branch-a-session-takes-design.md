# Gate Skill Loads Only the Branch a Session Takes — Design

**Slug:** gate-skill-loads-only-the-branch-a-session-takes
**FD:** docs/features/gate-skill-loads-only-the-branch-a-session-takes.md
**Date:** 2026-09-25
**Tier:** full
**Deps:** none. Q-0321 (`spec-skill-loads-its-design-steps-only-when-required`) is `blocked-by` this entry and reuses its router pattern and its ratchet.

## Problem

`.claude/skills/noldor-gate/SKILL.md` is 13,690 words (`countWords`, `src/utils/word-count.ts:15`) in 597 lines at `c7bc4bc`, the commit this spec is based on — the entry's 13,637 was counted at triage, before later edits — and Claude Code loads all of it into every gate session: interactive, `--resume`, and every headless drain child (`/noldor-gate --drain <slug>`, `src/autonomous/gate-prompt.ts:61`). A session runs one path. A micro-chore never needs Step 2.5 (3,297 words). A fast-track never needs the attach phase-revert lifecycle (451). An interactive session never needs drain and finish mode (about 1,500). Much of the rest is incident history — Q-numbers, PR numbers, round counts — woven into the rule it motivated. So every session pays about 19k tokens before its first action, and a rule that applies on only some paths sits deep in a long file, where a long context holds it least reliably. Nothing stops the file from regrowing after a cleanup: no check measures skill size.

The drain contract is also written twice. The skill's `## Drain mode` and `#### Finish mode` sections and `docs/noldor/drain-mode.md` are kept in step by prose alone (`SKILL.md:473-476`, `drain-mode.md:155-157`), and they have drifted. Only the page carries the pnpm exit-code note, the push-gate preflight, the delta re-earn recipe and the exit-code contract. Only the skill carries the `cd`-into-the-worktree step. A claude child reads only the skill; a codex or opencode child reads only the page (`gate-prompt.ts:59-73`).

## Goals

1. `SKILL.md` becomes a router of at most 3,000 words. It holds what every path runs — the entry check, the exit-code rule, Steps 0, 1, 3, 3.5 and 5, and Step 4 as an ordered checklist — plus a hard read-now line at each fork naming the file that path must read.
2. Each branch moves to its own file in `.claude/skills/noldor-gate/`, read only by the sessions that take it.
3. Drain, finish and drain-resume have one contract, `docs/noldor/drain-mode.md`. The skill sends a drain run there instead of restating it.
4. Incident history leaves the skill for `docs/noldor/gotchas.md` and the runbooks. Each rule keeps a one-line why.
5. A clean `specs-only-new` run loads under half of today's 13,690 words, and a test holds that line.
6. A skill-size ratchet refuses a push that grows any skill file past its recorded word count until the baseline is re-recorded.
7. The router cannot name a file that does not exist, and no branch file can sit unreachable from the router.

## Non-goals

- Splitting any other skill. `noldor-spec` (5,899 words) is Q-0321, which waits on this entry. `noldor-triage` and `noldor-release-sweep` stay whole.
- Changing what the gate does. Every rule keeps its meaning; only its home and wording move. A rule found wrong along the way is filed, not fixed here.
- Q-0191's general answer to duplicated prose (text imports across skill, twin, runner-neutral page and FD). This entry settles only the drain contract, by making the page canonical.
- The prose-runner drain prompt's own drift: `gate-prompt.ts:66` force-recreates the branch unconditionally, and `:50` omits `--base-sha origin/main`. Filed as a follow-up.
- Skill budgets in consumer repos. The ratchet runs in this repo only.
- Size rules for specs, plans or any other markdown. The ratchet counts `.claude/skills/` only; `docs/design/` artifacts keep `split-check`.
- Removing stale branch files from consumers after a future rename: `copyTemplate` never deletes (`src/templates/copy.ts:61-98`). This entry only adds files.
- Listing branch files on the dashboard skill page, which reads `SKILL.md` alone (`src/dashboard/data.ts:1160-1170`).

## Design

### Structural context

The change is mostly prose. The code it touches sits in small, interior communities, and no god node is defined or changed. `src/garden/detectors/skill-code-drift.ts` and `src/checks/check-skill-portability.ts` share community c96 (owned by `skill-vs-code-drift-detector`); their only cross-community edges run to `garden-detect.ts` (c14), the CLI manifest (c18) and `cli-entry.ts` (c81). The two existing ratchets are separate communities — `src/clones/baseline.ts` in c44, `src/indirection/baseline.ts` in c115 — and both reach the state-file seam (`writeJsonState` / `readJsonState`, c109). The new ratchet joins that seam. `src/checks/check-template-sync.ts` sits in c31 beside `src/templates/manifest.ts`, whose `templateFiles()` walks every file under `templates/`. The digest is from a fresh graph; `graph.brainstorm-summary.toon` was older than the graph and was not read. The session's candidate set was empty — the entry declares no `Touches:` and the FD has no `links.code` yet — so these paths are the code files the entry body names.

### Router (`SKILL.md`)

The router keeps the gate's step numbers, so every outside reference ("gate Step 2.5", "Step 4's baseline write-back") still lands. In order: frontmatter (unchanged); a one-line purpose; `## Parameters`; `## How this skill loads` — the load table and the read-now rule; then `## Flow`: the entry check, the exit-code rule, Step 0 (priority pickup, the option budget, `suggestedPath` handling), Step 1 (path picker), Step 2 (one line per path, with the `specs-only-new` / `full-new` scaffolds inline because they are short and common), a Step 2.5 pointer, Step 3, Step 3.5, Step 4 as an ordered checklist, `pr-flow`, the worktree cleanup, and Step 5. A short interactive `## --resume mode` closes it.

Step 4 stays in the router as a sequence because its order is the contract — refresh, archive, write-backs, flip, review, bootstrap, `pr-flow` — and that order interleaves concerns owned by different files. Each checklist line names who runs it and which file holds it, for example: "FD-carrying paths: archive this session's design artifacts — **Read now:** `fd-close.md`." Step 0 is 896 words today and keeps every rule; its incident notes move out, and criterion 1 bounds the router as a whole.

### Branch files

| File | Read by | Carries today's | Budget |
|---|---|---|---|
| `micro-chore.md` | `micro-chore` | Step 2 micro-chore scaffold and temp-branch handoff; its roadmap-retirement variant; its merge cleanup | 800 |
| `fast-track.md` | `fast-track` | Step 2 fast-track scaffold; roadmap-entry retirement; Step 4 doc-impact check | 900 |
| `attach.md` | `*-attach` | parent and enhancement prompts; input localization; phase-revert lifecycle; attach-scoped FD refresh | 700 |
| `artifact-review.md` | `specs-only-*`, `full-*` | Step 2.5: lint, commit, lanes, orchestrate, summary, continue dialog, abort | 1,300 |
| `blockers.md` | any red round | address-blockers, auto-fix seam, bounded re-round rule, split-back; code-stage auto-fix and escalation | 1,500 |
| `code-review.md` | `fast-track`, `specs-only-*`, `full-*` | Step 4: wait for standalone, push-gate preflight, code-stage orchestrate, delta re-earn, aggregate, context cleanup | 1,200 |
| `fd-close.md` | FD-carrying paths | Step 4: FD body refresh, archive, phase flip, bootstrap immunity | 800 |
| `design-writeback.md` | UI- or architecture-bearing sessions | approval drift at Step 2.5; UI and architecture baseline write-back; UI freshness | 1,000 |
| `autonomous.md` | `full-*` after `proceed-autonomous` | autonomous mode | 500 |

The files are cut by job, not by path. A shared seam such as code review or the FD close-out then lives in exactly one file, and each path still reads only two to four of them. One file per path was the alternative: a session would read a single file, but the shared seams would be copied into three to five files and drift apart, the way the skill and `drain-mode.md` already have. The pattern is recorded in [ADR 0008](../../adr/0008-large-skills-load-as-a-router-and-branch-files.md).

A branch file may route to another with its own read-now line: `artifact-review.md` and `code-review.md` both send a red round to `blockers.md`. Budgets are targets for the plan; the ratchet records what lands. `blockers.md` stays one file because the auto-fix seam and the round cap work the same way at both stages.

### Load table and read-now forks

The router opens with a table, one row per path and mode, in two columns: the files a clean run reads, and the files read only on a named condition. A clean run is one with no red review round, no UI or architecture design, and no `proceed-autonomous`; those three conditions are exactly what the second column names (`blockers.md`, `design-writeback.md`, `autonomous.md`). Every fork in the steps carries one line of a fixed shape, `**Read now:** [`<file>`](<file>) — <condition>`, linking a file beside `SKILL.md` or a repo page by relative path. The router states the rule once: a read-now line is part of its step; read the named file in full at that point, before acting; read it again after a context compaction; never act on a fork from memory. The files sit in the skill's base directory, which Claude Code prints when the skill loads. The drain, finish and drain-resume rows name `docs/noldor/drain-mode.md` alone: for those runs the page is the whole contract, and no router step after the entry check runs.

A vitest test parses the table and asserts that `SKILL.md` plus the clean-run files of the `specs-only-new` row come to under 6,845 words (half of 13,690). Today's estimate from the budgets above is about 6,200.

### Drain: one canonical page

The entry check reads: a `--drain` run, or `NOLDOR_DRAIN=1`, reads `docs/noldor/drain-mode.md` now and follows it; Steps 0 and 1 do not run. `--resume` under `NOLDOR_DRAIN=1` follows the page's Resume path. The skill's three drain sections go (`## Drain mode`, `#### Finish mode`, and the `### Drain mode` under `--resume`). The page absorbs the rules only the skill held — for example, that the session marker, `set-autonomous` and `pr-flow` all run from inside the worktree — and loses nothing it has. Its Resume path also gains the FD close-out that today's skill runs for a plans-source child through Step 4, as runner-neutral commands: the FD body refresh, `pnpm noldor design archive`, the design write-backs as printed debt (a headless child cannot drive the editor), `pnpm noldor features phase-flip-done` and `pnpm noldor cr bootstrap`; its roadmap path gains the `pnpm noldor checks arch-baseline` debt line. Those steps then live twice — in `fd-close.md` for interactive sessions and on the page for drains — which is the skill-versus-page duplication Q-0191 weighs, so a test holds the pair together: every `pnpm noldor` command `fd-close.md` names also appears in the page's Resume path. A claude drain child then loads about 5,700 words (router plus page) instead of 13,690, and both runner families read the same contract. A `drain.md` branch file beside the router was the alternative: claude would keep a claude-shaped copy, but the prose-only sync that has already failed would stay.

### Incident history out, one-line why in

A sentence that records what happened — a Q-number, a PR number, a round count, a dated incident — moves. The rule stays, with a clause saying why it exists. For example, the bounded re-round rule keeps "an unbounded operator loop feeds itself: every fix is new prose for the next delta review to flag", and the Q-0073 / Q-0078 / Q-0124 / Q-0112 round counts move to `docs/noldor/cr-pipeline.md`. Homes: `gotchas.md` sections (Drain / headless sessions, CR sinks, Worktrees, Pencil / UI design) for traps; `cr-pipeline.md` for review-loop history; `pr-flow.md` for the push-gate and receipt history (Q-0112, Q-0165); `drain-mode.md` for drain salvage. Links to code (`src/core/lanes.ts`) stay: they are pointers, not history.

### Router integrity

`checks template-sync`, the skill-code-drift detector and `checks skill-portability` already walk every `.md` in a skill folder — `templateFiles()` (`src/templates/manifest.ts:68-80`) and `collectSkillMd` (`skill-code-drift.ts:103-121`) recurse with no name filter — so branch files are synced, drift-scanned and portability-checked with no code change. Tests pin that. Two blocking rules join `checks skill-portability` (`src/checks/check-skill-portability.ts`) for shipped skill folders: `missing-branch-file` — a read-now link whose target does not exist; and `unreachable-branch-file` — a `.md` beside `SKILL.md` that no chain of read-now links from `SKILL.md` reaches. Plain links stay the drift detector's advisory job.

### Skill-size ratchet

`pnpm noldor skill-size check` and `pnpm noldor skill-size baseline`, a verb group like `clones` and `indirection`, implemented in `src/checks/skill-size.ts` — no new module. It counts every `.md` under `.claude/skills/` — each `SKILL.md` and each branch file beside it, one entry per file, so growth cannot move out of a router into a branch file unseen — with `countWords`, frontmatter and fences included, since the agent loads all of it. Nothing outside `.claude/skills/` is counted: specs, plans and docs keep their own size signal, `split-check`, and their own formats. The baseline, `.noldor/skill-size-baseline.json`, maps each path to its count, plus `algorithmVersion` (the ratchet's own constant, bumped when what it counts changes) and `recordedAt`, and is written through `writeJsonState` (`src/core/state-file.ts`).

`check` exits 1 naming each file that has more words than its entry, or no entry at all — a new file is growth too. Shrinkage is green and nothing auto-tightens; a manual `baseline` does. A missing or unreadable baseline, or one recorded under another `algorithmVersion`, exits 3 with the `baseline` remedy: the baseline is committed in this repo, so its absence is a fault, and a silent pass would disarm the ratchet. (`clones` treats a missing baseline as green because consumers are never seeded; this ratchet has no consumers.) `baseline` always writes, and prints per file whether it rose, fell, is new or was dropped. The job runs at pre-push from the root `lefthook.yml` — the self-host file that already carries the `build` job — so consumers never see it; `checks push-gates` replays it with no code change (`src/checks/check-push-gates.ts:8-33`). The re-recorded baseline rides the same push as the growth. On the micro-chore lane, the only lane that edits a skill without an override, it must ride the one commit, so `.noldor/skill-size-baseline.json` joins `MICRO_CHORE_GLOBS` (`src/core/allowlist.ts:3`).

### Delivery

Every new or changed skill file lands byte-identical under `templates/.claude/skills/noldor-gate/`, and every changed `docs/noldor/` page under `templates/docs/noldor/`; `checks template-sync` enforces both. Commits that touch `.claude/skills/**` from this worktree carry `NOLDOR_ALLOW_SHARED=1` (`src/checks/check-shared-files.ts:27`). A commit that mixes code with `docs/noldor/` pages carries `Noldor-Sibling-Scope`. Consumers need no migration: `noldor init --update` adds the branch files and overwrites `SKILL.md`, and the new router and the absorbing `drain-mode.md` ship in the same package version. The new verb needs a `docs/noldor/script-catalog.md` entry and a regenerated capability index. Any page, skill or FD that names a moved section ("Finish mode", "Roadmap-entry retirement", "Phase-revert lifecycle", the bounded re-round rule) is repointed to its new file in the same change.

UI verdict: skip — the repo declares no `consumer.uiPaths`, and the change is skill prose, docs and one check.

Architecture verdict: skip — the ratchet lives in `src/checks/`, which already imports `src/core` and `src/utils`, so the change adds no module, package, external or cross-module import, and the FD has no milestone. Gate Step 4's `checks arch-baseline` still catches a module-level change the build adds by surprise.

## Acceptance criteria

1. `.claude/skills/noldor-gate/SKILL.md` is at most 3,000 words.
2. The router's load table has a row for each of the six paths and for the drain, finish and resume modes, and every file it names exists.
3. `SKILL.md` plus the clean-run files of the `specs-only-new` row total under 6,845 words, asserted by a test that reads the table.
4. Every section and bullet of the pre-split `SKILL.md` (at `c7bc4bc`) has one row in the plan's move ledger — a table in `docs/design/plans/<date>-gate-skill-loads-only-the-branch-a-session-takes.md` naming the file and heading that now holds it — and that destination holds it.
5. The gate skill folder has no drain, finish or drain-resume section; the router sends those runs to `docs/noldor/drain-mode.md`, which holds every rule either rendering held before.
6. The page's Resume path names every `pnpm noldor` command `fd-close.md` names, and its roadmap path names `checks arch-baseline`; a test asserts both.
7. No `Q-NNNN` id or `PR #N` reference remains in the gate skill folder; each moved story sits in `gotchas.md` or a runbook, and the rule it motivated keeps a one-line why.
8. `pnpm noldor checks skill-portability` exits 1 when a shipped skill folder has a read-now link to a missing file or a `.md` unreachable from `SKILL.md`, and exits 0 on the new gate folder.
9. Tests show `checks template-sync`, the skill-code-drift detector and `checks skill-portability` each covering a branch file beside `SKILL.md`.
10. `pnpm noldor skill-size check` exits 1 naming the file when any `.md` under `.claude/skills/` has more words than its baseline entry or has none; exits 0 otherwise; exits 3 on a missing, unreadable or other-version baseline.
11. `pnpm noldor skill-size baseline` records every file's count, and a micro-chore commit that grows a skill can carry the new baseline.
12. A push from this repo runs `skill-size check`, and `pnpm noldor checks push-gates` replays it; `lefthook/noldor.yml` (the consumer file) does not run it.
13. Every new file has a byte-identical `templates/` twin, and `noldor doctor` reports no drift for a fresh consumer after `init --update`.

## Risks / trade-offs

- **An agent skips a read-now line and acts from memory.** The rules behind that fork are then lost for the session. Mitigation: one fixed line shape, the load table at the top, and the stated rule that a fork's file is part of its step. This risk is the main cost of the design and cannot be closed in code.
- **A context compaction drops a branch file mid-session.** The router tells the agent to re-read at the fork; the files are small, so a re-read is cheap.
- **Ratchet friction.** Every skill edit that adds a word needs a re-record in the same push. Accepted: making growth deliberate is the point.
- **Ratchet slack.** With no auto-tighten, words freed by a cleanup can be re-spent without a re-record until someone runs `baseline`. The same trade-off as `clones` and `indirection`.
- **A change to `countWords` shifts every count.** Files whose count rose read red until a re-record. Accepted: `countWords` is shared with `split-check` and changes rarely.
- **Two renderings of the FD close-out.** `fd-close.md` and the page's Resume path both list it. The command-parity test (criterion 6) catches a command added to one and not the other, but not a reworded rule.
- **The load test binds a test to a prose table.** A reworded table fails the test loudly rather than passing silently — the failure mode wanted.
- **Router and branch file from different versions.** The router is read once, when the skill loads; a branch file is read from disk at its fork. If local `main` moves mid-session, a session can pair an old router with a newer branch file. The skew is bounded to whatever one merge changed, and the same exposure exists today for every `docs/noldor/` page a skill points at.
- **A runner-neutral page for claude children.** `drain-mode.md` names no gate step numbers, so a claude child follows the page's own sequence rather than Steps 0–5 with overrides. The move ledger (criterion 4) lists every claude-only drain rule with its new home on the page, so none is dropped silently.

## User Story

As an agent running `/noldor-gate`, interactive or as a drain child, I want the skill to load only the steps my session's path runs, so that I start with under half of today's 19k tokens and the rules that apply to my path are the ones in front of me.

## Usage

- **Agent.** `/noldor-gate` loads the router. At each fork a `**Read now:**` line names a file in the skill folder; read it in full before acting. A drain child goes from the entry check straight to `docs/noldor/drain-mode.md`.
- **Skill author.** Change a skill file; if it grew, the push is refused naming the file. Run `pnpm noldor skill-size baseline` and commit `.noldor/skill-size-baseline.json` in the same push — inside the one commit on the micro-chore lane.
- **Check.** `pnpm noldor skill-size check` — exit 0 within baseline, 1 grown or unrecorded, 3 missing or unreadable baseline. `pnpm noldor checks skill-portability` also reports `missing-branch-file` and `unreachable-branch-file`.

## Open questions (resolved)

1. *How is the skill split?* → By job: nine concern files that paths share. (D1) A shared seam then lives in one file; one file per path would copy it into three to five.
2. *Where does drain mode live?* → `docs/noldor/drain-mode.md`, canonical; the skill routes to it. (D2) Prose runners already read only the page, and one contract ends the drift.
3. *What does the ratchet measure?* → Every `.md` under `.claude/skills/`, per file. (D3) Ratcheting `SKILL.md` alone would let growth move into branch files that every session of a path loads.
4. *Does the change need an architecture design?* → No. (D4) The ratchet lives in `src/checks/` behind a `skill-size` verb group: the same commands as the other ratchets, with no new module or import edge.
5. *Does the ratchet run in consumer repos?* → No, only from the root `lefthook.yml`. (D5) A consumer's skill files are framework copies that change on every `init --update`, so a consumer baseline would red the first push after an upgrade.
6. *Is a skill file with no baseline entry red?* → Yes. (D6) A new file is growth, and recording it is one command.
7. *How is "under half" measured?* → The clean-run row of the load table, summed by a test. (D7) A number a test holds does not erode unseen.
8. *How big may the router be?* → At most 3,000 words. (D8) The entry's "roughly 3k", made checkable.
9. *One feature, or split the ratchet out?* → One. (D9) The ratchet is small, and Q-0321 needs both halves.
10. *May a branch file route to another?* → Yes, through read-now lines; reachability is counted from `SKILL.md`. (D10) `blockers.md` serves both review stages.
11. *Where do drain children get the FD close-out?* → On the page's Resume path, as runner-neutral commands, held to `fd-close.md` by a command-parity test. (D11) Every runner then closes an FD the same way; codex and opencode children following the page skip the archive and bootstrap steps today.
