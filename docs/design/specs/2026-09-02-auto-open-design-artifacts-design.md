# Auto-Open Design Artifacts — Design

**Slug:** auto-open-design-artifacts
**FD:** docs/features/auto-open-design-artifacts.md
**Date:** 2026-09-02
**Tier:** specs-only
**Deps:** none

## Problem

A spec is the operator's only review surface at the `specs-only-*` gate pause, and today
nothing puts it in front of them. Two distinct failures stack up.

**The artifact never opens.** `/noldor-spec` step 2.5 writes the strawman to
`docs/design/specs/<date>-<slug>-design.md` and step 5 walks the operator through it
section by section, but no part of the flow opens the file. The operator either reads the
prose pasted into chat — a digest, not the artifact — or hunts the path down by hand. At
the Step 2.5 continue-dialog they are asked to approve a document they may never have had
open.

**The path the agent reports is often a dead link.** `/noldor-spec` steps 5 and 8 both
require "a clickable markdown link to the spec file", and the VS Code Claude extension
does render a repo-relative markdown link as clickable. But it resolves that link against
the **workspace root**. Every `specs-only-*` and `full-*` session runs inside
`.worktrees/<slug>/` (`src/worktrees/worktree-paths.ts:18`), so the artifact's
repo-relative path resolves to a workspace-root path that does not exist — the link
renders, and clicking it does nothing. A `micro-chore` or `fast-track` session on `main`
has cwd equal to the workspace root, so the identical link works there. That is the
reported "sometimes it works, sometimes it doesn't": the variable is not the link syntax,
it is whether the session has a worktree.

The second failure is the more expensive one, because it is silent. A dead link is
indistinguishable from a live one until clicked, so it reads as a broken editor rather
than as a wrong path, and the operator's recovery is to ask for the path again.

## Goals

- A newly written spec or plan appears as a VS Code tab without the operator asking.
- Every artifact path the framework reports resolves from the VS Code workspace root,
  whether the session runs on `main` or inside `.worktrees/<slug>/`.
- The path is computed, not remembered — no agent has to reason about worktree prefixes.
- Runner-neutral core: codex and opencode reach the same behaviour through prose, since
  neither reads `.claude/settings.json`.
- Fails open, always. Nothing here may block an edit, a commit, or a gate step.

## Non-goals

- Opening anything other than design artifacts. Feature MDs, roadmap blocks and source
  files are not review surfaces the operator is being asked to ratify in the moment.
- Re-opening or re-focusing on every edit. The dialogue edits a spec many times; a tab
  that grabs focus on each one is worse than no tab.
- Editors other than VS Code. `openInEditor` already treats `code` as the one scriptable
  editor (`src/design/pen-bridge-cli.ts:47`), and an absent `code` is an expected,
  handled outcome rather than a configuration axis.
- A `.pen` / UI-design path. `pnpm noldor design pen-bridge` already owns opening design
  files for the pencil bridge, and its purpose is liveness, not review.

## Design

### Structural context

`noldor:cut graph tracked but stale — `pnpm noldor design graph-context` reports
`status: stale` for `src/hooks/noldor-pre-edit-guard.ts`, `src/design/pen-bridge-cli.ts`
and `src/cli/manifest.ts`, and the sanctioned regeneration is refused deliberately:
`graphify-out/graph.json` is tracked and 3.6 MB, so an `/graphify --ast-only` + `pnpm toon`
pass on this branch would attach a multi-megabyte generated diff to a three-file change.
`/noldor-release-sweep` owns that refresh. What would change the answer: a fresh graph on
`main`, at which point re-run `design graph-context` and replace this cut with the real
per-path digest — the interesting question it would answer is whether `src/cli/manifest.ts`
is the god node this change's registration edit suggests it is.`

### U1 — `noldor design open <path>`: the runner-neutral core

One command owns both halves of the problem, because both need the same two facts: where
the file is on disk, and where the VS Code workspace root is. It resolves `<path>` against
cwd, refuses a path that is not a design artifact and refuses one that is not on disk,
launches the editor on the **absolute** path, and prints on stdout the path **relative to
the workspace root** — which is the string an agent must paste into chat for the link to
resolve.

The workspace root is the main worktree's root, not cwd: `git rev-parse --git-common-dir`
from the artifact's directory yields `<main-root>/.git` in a worktree and `.git` on `main`,
so its parent is the workspace root in both cases. `src/worktrees/launch-worktrees.ts`
already parses `git worktree list --porcelain` for the same purpose; the `--git-common-dir`
form is used here because it needs no parsing and works from a bare path with no branch
context. Relative-path arithmetic is `node:path`'s `relative`, so a session on `main`
prints `docs/design/specs/x.md` and a session in a worktree prints
`.worktrees/<slug>/docs/design/specs/x.md`, with no special-casing of either.

Editor launch **reuses `openInEditor` from `src/design/pen-bridge-cli.ts:48`** rather than
re-spawning `code`. That function already encodes the two decisions worth keeping: `code`
is the one scriptable editor, and a launch failure is an expected result (`OpenResult`)
rather than a throw. Reuse means an absent `code` produces the same shape of outcome for
a spec as it does for a `.pen`. It is imported across a module boundary
(`src/design/pen-bridge-cli.ts` → the new CLI), which is the cheap direction: the new
command also lives under `src/design/`.

`code <abs-path>` — not `--reuse-window`, not `--goto` — is deliberate. When the path sits
inside an already-open workspace folder, VS Code opens it as a tab in that window, which
is exactly the ask; `.worktrees/<slug>/` is inside the workspace folder, so worktree
artifacts land in the operator's existing window rather than a new one.

Exit codes follow `pen-bridge-cli.ts`'s contract: 0 opened, 2 usage error (missing path,
not a design artifact, no such file), 2 with a remediation line when `code` is not on
PATH. This command is honest about failure; U2 is where failure is swallowed.

### U2 — `noldor hooks open-artifact`: the Claude wiring

A `PostToolUse` hook matched on `Write` reads the hook payload from stdin, pulls
`tool_input.file_path`, and calls U1's function in-process. `.claude/settings.json`
already carries a `PreToolUse` entry routing `Edit|Write|NotebookEdit` to
`noldor hooks pre-edit-guard`; this adds the first `PostToolUse` entry, registered in the
`hooks` group of `src/cli/manifest.ts:312` beside it.

**`Write` only, never `Edit`** is the load-bearing choice, and it is what makes this
stateless. The artifact is *created* by the strawman `Write` at `/noldor-spec` step 2.5
and *refined* by `Edit` for the rest of the dialogue (step 3 updates the drafted section
on disk after every answer). Matching `Write` opens the tab exactly once, at the moment
the file first exists; matching `Edit` too would re-launch `code` on every recorded
decision, and since `code` on an open tab switches focus to it, the operator would be
yanked out of chat repeatedly. No dedupe cache, no marker file, no "already opened" state
— the tool boundary already encodes "first time".

**Filtering cannot use cwd.** A Claude Code hook runs with cwd at the directory the
session started in, which for a worktree session is the *main workspace*, while
`file_path` is absolute inside `.worktrees/<slug>/`. So `loadDocRoots(cwd)` would resolve
the wrong repo's doc roots. The predicate therefore reads the artifact's own path: the
file is an artifact when its directory ends in the specs or plans doc-root segments,
covering the `docs/design/{specs,plans}` layout and the pre-1.0.0
`docs/superpowers/{specs,plans}` transition alias that `loadDocRoots`
(`src/core/doc-roots.ts:56`) still honours. The same predicate is U1's guard, so the two
cannot disagree about what an artifact is.

**The hook exits 0 unconditionally.** Every outcome — not an artifact, no `code` on PATH,
a thrown error — is exit 0. A `PostToolUse` hook that can fail is a hook that can wedge a
gate step for a cosmetic convenience, and the framework already treats editor absence as
normal.

### U3 — reporting a path that resolves

The prose that tells an agent to report a clickable link is corrected to tell it to report
**the path U1 printed**, rather than the repo-relative path it happens to hold. Three
renderings say this today and all three move together, or the rule holds only for Claude:
`/noldor-spec` steps 5 and 8, `/noldor-plan`'s artifact-report step, and the gate's Step
2.5 "surface the artifact path in one sentence". Each `.claude/skills/**/SKILL.md` edit
mirrors into its `templates/.claude/skills/**` twin and its `templates/.opencode/command/`
shim, because `pnpm noldor checks template-sync` refuses a templated file that drifts from
its `templates/` copy.

Making the correct string *available* is what keeps this from being a rule agents forget:
the failure mode being fixed is an agent deriving a path, so the fix is to stop asking it
to derive one. Prose alone was rejected for that reason — it is the same instruction that
is already there and already produces dead links.

For codex and opencode the prose step is the whole mechanism, since neither reads
`.claude/settings.json` and neither has a `PostToolUse` equivalent. Their renderings gain
an explicit `pnpm noldor design open <path>` call at the point the artifact is written.
Claude gets both: the hook opens the tab, and the prose supplies the link text.

### Error handling

Three failure classes, three postures. A **usage error** (no path, not an artifact, no
such file) is exit 2 from U1 with the reason named — opening a missing file yields an
empty buffer that reads as a successful open, which is the hazard
`pen-bridge-cli.ts:78-85` already guards for `--pen`. A **missing editor** is exit 2 from
U1 carrying the same remediation line `pen-bridge-cli.ts:100-104` prints (install the
shell command from the Command Palette), and exit 0 from U2. A **git failure** while
resolving the workspace root degrades rather than fails: U1 falls back to printing the
cwd-relative path, which is what today's prose already produces, so the worst case is the
current behaviour rather than a broken command.

### Testing

The workspace-root arithmetic is the unit worth testing directly, and it is testable
without an editor: given an artifact path and a repo, assert the printed path is
workspace-root-relative on `main` and carries the `.worktrees/<slug>/` prefix from inside
a worktree. Real git repos in temp dirs, per `test-real-behavior` — a mocked
`git rev-parse` would assert the mock, and the whole point is that the real
`--git-common-dir` output differs between a worktree and a main checkout.

The artifact predicate is a pure function over a path string and is tested as a table:
specs, plans, both doc-root layouts, and the negatives that matter — a feature MD, a
source file, and a path merely *containing* `docs/design/specs` deeper in a tree.

The editor launch is the one seam that gets mocked, and only at the process boundary: an
injected launcher, so the "no `code` on PATH" branch is reachable in a test without
depending on the runner's machine. The hook's fail-open contract is asserted the same way
— malformed stdin, a non-artifact path, and a throwing launcher all exit 0.

Not tested: that VS Code actually shows a tab. That is the runner's behaviour, and the
Deletion Test says so — deleting such a test would change no signal, because nothing in
the suite could distinguish a real tab from a successful `execFileSync`.

## Acceptance criteria

1. `pnpm noldor design open <spec-path>` exits 0 and launches the VS Code CLI on the
   artifact's absolute path.
2. That command prints, on stdout, the artifact's path relative to the VS Code workspace
   root — `docs/design/specs/<f>.md` from a `main` checkout, `.worktrees/<slug>/docs/design/specs/<f>.md`
   from inside `.worktrees/<slug>`.
3. It exits 2 without launching anything when the path names no file on disk.
4. It exits 2 without launching anything when the path is not under a specs or plans
   doc root.
5. It exits 2 with a remediation message naming the VS Code shell-command install when
   `code` is not on PATH.
6. It prints the cwd-relative path and still exits 0 when the workspace root cannot be
   resolved from git.
7. Writing a new file under `docs/design/specs/` or `docs/design/plans/` in a Claude
   session results in one editor launch for that file.
8. Editing an existing artifact results in no editor launch.
9. `pnpm noldor hooks open-artifact` exits 0 for every input, including malformed stdin,
   a non-artifact `file_path`, an absent `file_path`, and a failing editor launch.
10. `pnpm noldor checks template-sync` passes with the new `.claude/settings.json`
    `PostToolUse` entry and every edited skill file.
11. `pnpm noldor --help` lists `design open` and `hooks open-artifact`.
12. The artifact predicate accepts both the `docs/design/{specs,plans}` layout and the
    `docs/superpowers/{specs,plans}` transition alias, and rejects feature MDs and source
    files.

## Risks / trade-offs

**Focus stealing is the behaviour, not a bug, and it is unavoidable.** `code <path>`
brings the window forward; VS Code's CLI has no background-tab flag. Firing on `Write`
only is what keeps this to one interruption per artifact instead of one per dialogue turn.
If one interruption per artifact still proves wrong, the escape hatch is a config knob
rather than a redesign — but shipping the knob first would be configuring away a problem
nobody has reported yet.

**A `Write` that overwrites an existing artifact re-opens it.** Accepted. It is rare (the
dialogue uses `Edit`), and re-opening a file the operator is being asked to re-review is
defensible behaviour rather than a wrong outcome.

**The `Write`-only rule is a Claude Code tool-semantics dependency.** If a future runner
creates files through an `Edit`-shaped call, the tab stops appearing — a silent
degradation to today's behaviour, not a break. The prose step is the backstop, which is
part of why U3 covers all runners rather than only the two without hooks.

**A first `PostToolUse` entry is new surface in a template-synced file.** Every consumer
gets it at `noldor init --update`. The mitigation is the fail-open contract: on a consumer
with no `code` on PATH the hook is an exit-0 no-op, and the cost is one subprocess per
`Write`.

**One subprocess per `Write` tool call.** The filter runs in the hook process, so a
source-file `Write` pays a Node startup and nothing else. Measurable but small against
the `PreToolUse` guard already on the same tool.

## User Story

As an operator reviewing a spec at the gate's approval pause, I want the artifact to open
in a VS Code tab the moment it is written and every reported path to be clickable from my
workspace, so that I ratify a document I have actually read instead of one summarised to
me in chat.

## Usage

Automatic in a Claude Code session: writing a spec or plan under `docs/design/specs/` or
`docs/design/plans/` opens it as a VS Code tab, via the `PostToolUse` hook in
`.claude/settings.json`. No operator action.

By hand, or from a codex/opencode session:

```
pnpm noldor design open docs/design/specs/2026-09-02-my-feature-design.md
```

Opens the artifact and prints the workspace-root-relative path to report as a markdown
link. Exit 2 with a named reason when the path is not an artifact, is absent, or `code` is
not on PATH.

The hook form reads a Claude Code `PostToolUse` payload on stdin and always exits 0:

```
pnpm noldor hooks open-artifact
```

## Open questions (resolved)

1. *Should this fire for plans as well as specs, or specs only?*
   -> Both. (D1) A plan is the review surface at the `full-*` kind=plan pause exactly as a
   spec is at kind=spec, so scoping to specs would leave `full-*` sessions with the
   problem this feature exists to remove.

2. *Should the framework open feature MDs too, since they are also doc-tracked?*
   -> No. (D2) An FD is edited continuously across a session and is never the object of a
   single approval pause, so opening it buys an interruption with no decision attached.

3. *Should non-Claude runners get a prose step, or is Claude-only auto-open acceptable?*
   -> Prose step for all runners. (D3) `AGENTS.md` promises "same rules, one gate" across
   runners, the CLI exists either way, and the marginal cost is one line per rendering.

4. *Should the dead-link fix be prose-only ("remember the worktree prefix") or should the
   CLI print the path?*
   -> CLI prints it. (D4) The instruction to report a clickable link is already in the
   prose and already produces dead links, so the defect is in asking an agent to derive a
   path at all.

5. *Should the hook debounce re-opens with a marker file instead of matching `Write` only?*
   -> No marker. (D5) The `Write`/`Edit` boundary already means "created" versus
   "refined", so matching `Write` is a free dedupe; a marker file would add shared mutable
   state to a cosmetic convenience.

6. *Should `code --reuse-window` or `--goto <path>:1` be used instead of a bare
   `code <path>`?*
   -> Bare `code <path>`. (D6) The artifact always sits inside the open workspace folder
   (`.worktrees/` is a subdirectory of it), so VS Code already opens it as a tab in the
   existing window; the flags would add behaviour with no case that needs it.

7. *Should `openInEditor` move out of `pen-bridge-cli.ts` into a shared module now that it
   has a second caller?*
   -> Leave it. (D7) `abstraction-cost` prices reuse from the third call site, not the
   second, and both callers live under `src/design/` — the import is one hop within a
   module, not a cross-cutting dependency.

8. *Should the stale graph be regenerated so `### Structural context` carries a real
   digest?*
   -> No, cut it with a reason. (D8) `graphify-out/graph.json` is tracked at 3.6 MB, so
   regenerating on this branch would attach a multi-megabyte generated diff to a
   three-file change; `/noldor-release-sweep` owns that refresh.
