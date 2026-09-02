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
the **editor's workspace folder**, while the agent writes it relative to the **session's
repo root**. Every `specs-only-*` and `full-*` session runs inside `.worktrees/<slug>/`
(`src/worktrees/worktree-paths.ts:18`), so when the editor has the main checkout open the
artifact's repo-relative path resolves to a workspace path that does not exist — the link
renders, and clicking it does nothing. A `micro-chore` or `fast-track` session on `main`
has the two roots coincide, so the identical link works there. That is the reported
"sometimes it works, sometimes it doesn't": the variable is not the link syntax, it is
whether the session's repo root and the editor's workspace folder are the same directory.

The second failure is the more expensive one, because it is silent. A dead link is
indistinguishable from a live one until clicked, so it reads as a broken editor rather
than as a wrong path, and the operator's recovery is to ask for the path again.

## Goals

- A newly written spec or plan appears as a VS Code tab without the operator asking.
- Every artifact path the framework reports resolves from the editor's workspace folder,
  whether that folder is the main checkout or a `.worktrees/<slug>` directory opened
  directly.
- The path is computed from a supplied workspace root, not derived by an agent reasoning
  about worktree prefixes.
- Runner-neutral core: codex and opencode reach the same behaviour through prose, since
  neither reads `.claude/settings.json`.
- Fails open, always. Nothing here may block an edit, a commit, or a gate step — and no
  failure to launch an editor may withhold the path.

## Non-goals

- Opening anything other than live design artifacts. Feature MDs, roadmap blocks and
  source files are not review surfaces the operator is asked to ratify in the moment, and
  archived artifacts under `docs/design/{specs,plans}/archive/` are history rather than
  review surfaces.
- Re-opening or re-focusing on every edit. The dialogue edits a spec many times; a tab
  that grabs focus on each one is worse than no tab.
- Editors other than VS Code. `openInEditor` already treats `code` as the one scriptable
  editor (`src/design/pen-bridge-cli.ts:47`), and an absent `code` is an expected,
  handled outcome rather than a configuration axis.
- Multi-root VS Code workspaces. Named as a known limitation under Risks rather than
  supported: nothing reaching this code can tell which of several folders the operator's
  markdown preview resolves against.
- A `.pen` / UI-design path. `pnpm noldor design pen-bridge` already owns opening design
  files for the pencil bridge, and its purpose is liveness, not review.

## Design

### Structural context

`noldor:cut graph tracked but stale — `pnpm noldor design graph-context` reports
`status: stale` for `src/hooks/noldor-pre-edit-guard.ts`, `src/design/pen-bridge-cli.ts`
and `src/cli/manifest.ts`, and the sanctioned regeneration is refused deliberately:
`graphify-out/graph.json` is tracked and 3.6 MB, so a `/graphify --ast-only` + `pnpm toon`
pass on this branch would attach a multi-megabyte generated diff to a three-file change.
`/noldor-release-sweep` owns that refresh. What would change the answer: a fresh graph on
`main`, at which point re-run `design graph-context` and replace this cut with the real
per-path digest — the interesting question it would answer is whether `src/cli/manifest.ts`
is the god node this change's registration edit suggests it is.`

### U0 — the workspace root is an input, never a derivation

This is the decision the rest of the design hangs off, and it is the one the first draft
got wrong. Git cannot answer "which folder did the editor open": from
`<repo>/docs/design/specs` on `main`, `git rev-parse --git-common-dir` prints the
*cwd-relative* `../../../.git`, and from the same directory inside a worktree it prints
the absolute `<main-root>/.git`. Neither output names the editor's workspace folder, and
an operator who opens `.worktrees/<slug>/` directly as their window has a workspace folder
git will never mention. Deriving the root from git therefore inverts the bug for that
layout: the `.worktrees/<slug>/…` prefix becomes the dead link and the bare repo-relative
path the live one.

Claude Code already supplies the right value. A hook payload carries `cwd` — the session's
working directory, which is the folder the editor opened —
and `src/hooks/noldor-pre-edit-guard.ts:91` already consumes it exactly this way
(`payload.cwd ?? process.cwd()`). So the workspace root is resolved by a ladder, first rung
that answers wins:

1. `--workspace-root <abs-path>` when passed — the explicit override, and what the tests
   drive.
2. The hook payload's `cwd` (U2's path).
3. `VSCODE_CWD` from the environment, when set and absolute.
4. `path.resolve(cwd, <git rev-parse --git-common-dir output>)`'s parent directory. The
   `resolve` is what M1 corrects: a naive `dirname` on the raw output yields `../../..` on
   `main` and prints a garbage path for exactly the case that works today.
5. `process.cwd()`.

Rungs 4 and 5 are best-effort fallbacks for a bare CLI invocation, and the command never
fails because a rung did not answer. One containment rule keeps a wrong rung from printing
nonsense: if the artifact is not inside the resolved root, the command discards that root
and prints the path relative to the artifact's own repo root instead, which is the current
behaviour rather than a worse one.

### U1 — `noldor design open <path>`: the runner-neutral core

One command owns both halves of the problem, because both need the same two facts: where
the file is on disk, and where the workspace root is (U0). It resolves `<path>` against
cwd, refuses a path that is not a live design artifact and refuses one that is not on
disk, prints on stdout the path **relative to the workspace root**, and launches the
editor on the **absolute** path.

**Printing and launching are separate outcomes, and printing wins.** The path is written to
stdout before the launch is attempted, and a launch that cannot happen — no `code` on
PATH, a spawn that times out — is a warning on stderr with exit still 0. This is what
resolves the conflict between a global fail-open goal and a command other runners' prose
is required to call: a codex session on a machine with no `code` still gets its link and
its gate step still proceeds. Only a **usage** error is non-zero.

**The artifact predicate**, shared verbatim with U2 so the two cannot disagree:

- Resolve the input to an absolute path (`path.resolve`) without resolving symlinks —
  lexical containment only, so a symlinked repo is judged by the path the caller used.
- The extension must be `.md`.
- Its parent directory must be exactly the `specs` or `plans` doc root of the repo
  containing it, as `loadDocRoots` (`src/core/doc-roots.ts:56`) reports them — which is
  what admits both the `docs/design/{specs,plans}` layout and the pre-1.0.0
  `docs/superpowers/{specs,plans}` transition alias without hardcoding either.
- Direct children only. `docs/design/specs/archive/x.md` is rejected: an archived artifact
  is history, not a review surface.
- The repo whose doc roots are consulted is the one containing the *artifact*, found by
  resolving `git rev-parse --git-common-dir` from the artifact's directory — never the
  repo containing cwd. A path outside any repo is rejected as a usage error.

Consulting the artifact's own repo is what makes a path merely *ending* in the same
segments — an unrelated tree with a `docs/design/specs/` in it — a rejection rather than
an accident.

**Editor launch reuses `openInEditor` from `src/design/pen-bridge-cli.ts:48`** rather than
re-spawning `code`. That function already encodes the two decisions worth keeping: `code`
is the one scriptable editor, and a launch failure is an expected result (`OpenResult`)
rather than a throw. It gains a bounded timeout (see Error handling); everything else about
it is unchanged, and the import is one hop within `src/design/`.

`code <abs-path>` — not `--reuse-window`, not `--goto` — is deliberate. When the path sits
inside an already-open workspace folder, VS Code opens it as a tab in that window, which
is exactly the ask.

**The shared unit both entry points call:**

```ts
export interface OpenArtifactRequest {
  readonly path: string;
  readonly cwd: string;
  readonly workspaceRoot?: string;
  readonly launch?: (absPath: string, cwd: string) => OpenResult; // default: openInEditor
}

export type OpenArtifactResult =
  | { readonly kind: 'opened'; readonly absPath: string; readonly linkPath: string }
  | { readonly kind: 'not-launched'; readonly absPath: string; readonly linkPath: string;
      readonly warning: string }
  | { readonly kind: 'rejected'; readonly reason: 'not-a-file' | 'not-an-artifact' | 'no-repo';
      readonly message: string };
```

The unit resolves, decides, and launches; it never writes to stdout, assigns an exit code,
or reads the environment. Both callers own their own output: U1 maps `opened` and
`not-launched` to a printed `linkPath` and exit 0 (`not-launched` also writing `warning` to
stderr) and `rejected` to `message` on stderr and exit 2; U2 maps every member to exit 0.
Keeping the printing out of the unit is what lets U2 emit JSON where U1 emits a bare line.

### U2 — `noldor hooks open-artifact`: the Claude wiring

A `PostToolUse` hook matched on `Write` reads the payload from stdin, and **reuses
`filePathFromPayload`** — already exported from `src/hooks/noldor-pre-edit-guard.ts:80` —
to pull the target path, resolving a relative value against the payload's `cwd`. It then
calls U1's unit with `workspaceRoot: payload.cwd`. `.claude/settings.json` already carries
a `PreToolUse` entry routing `Edit|Write|NotebookEdit` to `noldor hooks pre-edit-guard`;
this adds the first `PostToolUse` entry, registered in the `hooks` group of
`src/cli/manifest.ts:312` beside it.

**The hook is how the agent learns the link.** A `PostToolUse` hook's plain stdout is
transcript-only and never reaches the model, so on `opened` and `not-launched` the hook
writes the JSON form instead:

```json
{ "hookSpecificOutput": { "hookEventName": "PostToolUse",
    "additionalContext": "Artifact opened. Report this path in markdown links: <linkPath>" } }
```

That is what closes the loop without a second launch: the Claude renderings of
`/noldor-spec`, `/noldor-plan` and `/noldor-gate` do **not** call `design open` — they
report the path the hook handed them. One `code` launch per artifact, and no agent deriving
a prefix.

**`Write` only, never `Edit`** is the choice that makes this stateless. The artifact is
*created* by the strawman `Write` at `/noldor-spec` step 2.5 and *refined* by `Edit` for the
rest of the dialogue (step 3 updates the drafted section on disk after every answer).
Matching `Write` opens the tab exactly once, when the file first exists; matching `Edit`
too would re-launch `code` on every recorded decision, and since `code` on an open tab
switches focus to it, the operator would be yanked out of chat repeatedly. No dedupe cache
and no marker file — the tool boundary already encodes "first time".

**Filtering cannot use cwd**, and the reason is the same one U0 exists for: a hook runs with
cwd at the directory the session started in, while `file_path` is absolute inside
`.worktrees/<slug>/`. The predicate reads the artifact's own path and its own repo, never
cwd's.

**The hook exits 0 unconditionally**, and three guards make that true rather than aspirational:
a `process.stdin.isTTY` early exit (a bare `readFileSync(0)` on an interactive terminal
blocks forever — the same reason `noldor-pre-edit-guard.ts:96` has it), a `try/catch` around
the parse, and bounded subprocess timeouts so a hung `git` or `code` cannot wedge a gate
step. Every rejection, warning and thrown error is exit 0.

### U3 — reporting a path that resolves

The prose that tells an agent to report a clickable link is corrected to tell it to report
**the path it was given** — from the hook's `additionalContext` on Claude, from
`design open`'s stdout elsewhere — rather than a repo-relative path it derived. Four
renderings say this today and all four move together, or the rule holds for one runner:

| Runner | File | Change |
| --- | --- | --- |
| Claude | `.claude/skills/noldor-spec/SKILL.md` steps 5, 8; `.claude/skills/noldor-plan/SKILL.md` artifact-report step; `.claude/skills/noldor-gate/SKILL.md` Step 2.5 | report the hook-supplied path; do not call `design open` |
| codex | `AGENTS.md` § Skills (`spec` / `plan` bullets) | call `pnpm noldor design open <path>` and report its stdout |
| opencode | `.opencode/command/noldor-spec.md`, `.opencode/command/noldor-plan.md` | same as codex |

Every one of those files has a `templates/` twin that must move in the same commit —
`pnpm noldor checks template-sync` refuses a templated file that drifts from its
`templates/` copy.

**The link format** is pinned so "clickable" is not left to taste. Stdout is exactly one
line: the workspace-root-relative path with POSIX `/` separators and no quoting, no
trailing whitespace. Agents wrap it as `[<basename>](<path>)`, and wrap the target in
angle brackets — `[<basename>](<path with spaces>)` → `[…](<…>)` — when the path contains a
space, `(`, `)` or `#`, which is the only construction VS Code's markdown resolver accepts
for those characters. Artifact filenames are date-and-slug generated, so the escaping
branch is defensive rather than routine.

Making the correct string *available* is what keeps this from being a rule agents forget:
the failure being fixed is an agent deriving a path, so the fix is to stop asking it to
derive one. Prose alone was rejected for that reason — it is the same instruction already
present, already producing dead links.

### Error handling

Four failure classes, four postures.

A **usage error** — no path, not a live artifact, no such file, no owning repo — is exit 2
from U1 with the reason named, and exit 0 from U2. Opening a missing file yields an empty
buffer that reads as a successful open, which is the hazard
`src/design/pen-bridge-cli.ts:78-85` already guards for `--pen`.

A **missing editor** prints the link, warns on stderr with the remediation line
`pen-bridge-cli.ts:100-104` already carries (install the shell command from the Command
Palette), and exits **0**. The path is the deliverable; the tab is the convenience.

A **hung subprocess** is bounded, not waited on: both the `git rev-parse` probe and the
`code` spawn carry an explicit timeout, and expiry is treated as "that rung did not answer"
and "the editor did not launch" respectively. `concurrency-write-discipline` requires it —
an untimed wait inside a hook is a hang, and a hang reads to the operator as a broken tool.

A **git failure or an unresolvable workspace root** degrades rather than fails: the ladder
falls through to `process.cwd()`, and the containment rule falls back to the artifact's own
repo root. The worst case is the path the prose produces today.

### Testing

The workspace-root ladder is the unit worth testing directly, and `--workspace-root` plus
the injected `launch` make it testable with no editor and no environment mutation: assert
the printed path for a workspace root at the main checkout (expect the
`.worktrees/<slug>/…` prefix), for a workspace root at the worktree itself (expect the bare
repo-relative path — the layout the first draft got backwards), and for an artifact outside
the given root (expect the containment fallback). Real git repos with a real
`git worktree add` in temp dirs, per `test-real-behavior`: a mocked `git rev-parse` would
assert the mock, and the whole point is that the real output differs in shape between the
two checkouts.

The predicate is a pure function over a path and is tested as a table: specs and plans in
both doc-root layouts, and the negatives that carry the design — an `archive/` child, a
non-`.md` file, a feature MD, a source file, a path outside any repo, and an unrelated tree
whose directories merely end in the same segments.

The process boundary is the one seam that gets mocked, and only there: the injected
`launch` reaches the missing-editor and timeout branches without depending on the runner's
machine. The hook's fail-open contract is asserted the same way — a TTY stdin, malformed
stdin, an absent `file_path`, a relative `file_path`, a non-artifact path and a throwing
launcher all exit 0 — and the `additionalContext` payload is asserted as parseable JSON
carrying the same `linkPath` the CLI prints.

Not tested: that VS Code actually shows a tab. That is the runner's behaviour, and the
Deletion Test says so — deleting such a test would change no signal, because nothing in
the suite could distinguish a real tab from a successful `execFileSync`.

## Acceptance criteria

1. `pnpm noldor design open <spec-path>` prints, on stdout as one line, the artifact's
   path relative to the resolved workspace root, and exits 0.
2. With `--workspace-root` at the main checkout the printed path carries the
   `.worktrees/<slug>/` prefix; with `--workspace-root` at the worktree itself it is the
   bare repo-relative path.
3. The workspace root resolves by the U0 ladder — explicit flag, hook payload `cwd`,
   `VSCODE_CWD`, resolved `--git-common-dir` parent, `process.cwd()` — and an artifact
   outside the resolved root falls back to its own repo root.
4. The command launches the VS Code CLI on the artifact's **absolute** path.
5. It still prints the path and exits 0 when the editor cannot be launched, writing a
   remediation warning naming the VS Code shell-command install to stderr.
6. It exits 2 without launching anything when the path names no file, is not a `.md` direct
   child of a specs or plans doc root, or lies outside any git repository — including a
   path under `docs/design/specs/archive/`.
7. The predicate accepts both the `docs/design/{specs,plans}` and
   `docs/superpowers/{specs,plans}` layouts, resolved from the repo containing the
   artifact rather than the repo containing cwd.
8. Writing a new file under a specs or plans doc root in a Claude session results in
   exactly one editor launch for that file; editing an existing artifact results in none.
9. `pnpm noldor hooks open-artifact` exits 0 for every input — TTY stdin, malformed stdin,
   absent `file_path`, relative `file_path`, non-artifact path, failing launcher, and a
   subprocess that exceeds its timeout.
10. On a successful open the hook emits parseable JSON carrying
    `hookSpecificOutput.additionalContext` with the same workspace-root-relative path the
    CLI prints.
11. Both the `git` probe and the editor spawn carry an explicit timeout, and expiry is
    handled as a non-answer rather than a throw or a hang.
12. Every runner rendering names the reporting rule: the Claude skill files report the
    hook-supplied path without calling `design open`, while `AGENTS.md` and the
    `.opencode/command/` shims call it and report its stdout.
13. `pnpm noldor checks template-sync` passes, and `pnpm noldor --help` lists `design open`
    and `hooks open-artifact`.

## Risks / trade-offs

**Multi-root VS Code workspaces are not supported.** With several folders open, no signal
available here says which one a markdown link resolves against, so the ladder picks the
session's `cwd` and may be wrong. Stated as a limitation rather than papered over; the
escape hatch is `--workspace-root`.

**Focus stealing is the behaviour, not a bug, and it is unavoidable.** `code <path>` brings
the window forward and VS Code's CLI has no background-tab flag. Firing on `Write` only
keeps this to one interruption per artifact instead of one per dialogue turn. If one per
artifact still proves wrong the escape hatch is a config knob — but shipping the knob first
would configure away a problem nobody has reported.

**A `Write` that overwrites an existing artifact re-opens it.** Accepted: rare (the
dialogue uses `Edit`), and re-opening a file the operator is being asked to re-review is
defensible rather than wrong.

**The `Write`-only rule is a Claude Code tool-semantics dependency**, and
`additionalContext` is a second one. If a future runner creates files through an
`Edit`-shaped call, or drops that hook-output field, the tab or the link text stops
arriving — a silent degradation to today's behaviour, not a break. The prose step is the
backstop, which is part of why U3 covers every runner rather than only the two without
hooks.

**A first `PostToolUse` entry is new surface in a template-synced file.** Every consumer
gets it at `noldor init --update`. The mitigation is the fail-open contract: on a consumer
with no `code` on PATH the hook is an exit-0 no-op.

**One subprocess per `Write` tool call.** The filter runs in the hook process, so a
source-file `Write` pays a Node startup and nothing else — small against the `PreToolUse`
guard already on the same tool.

## User Story

As an operator reviewing a spec at the gate's approval pause, I want the artifact to open
in a VS Code tab the moment it is written and every reported path to be clickable from my
workspace, so that I ratify a document I have actually read instead of one summarised to
me in chat.

## Usage

Automatic in a Claude Code session: writing a spec or plan under a specs or plans doc root
opens it as a VS Code tab, via the `PostToolUse` hook in `.claude/settings.json`, and hands
the agent the path to report. No operator action.

By hand, or from a codex/opencode session:

```
pnpm noldor design open docs/design/specs/2026-09-02-my-feature-design.md
```

Prints the workspace-root-relative path to report as a markdown link, then opens the
artifact. Exit 0 even when `code` is absent (the path is printed, a warning goes to
stderr); exit 2 with a named reason when the path is not a live design artifact or is not
on disk. `--workspace-root <abs-path>` overrides the resolved root for a layout the ladder
guesses wrong, such as a multi-root workspace.

The hook form reads a Claude Code `PostToolUse` payload on stdin, emits its path as
`hookSpecificOutput.additionalContext`, and always exits 0:

```
pnpm noldor hooks open-artifact
```

## Open questions (resolved)

1. *Should this fire for plans as well as specs, or specs only?*
   -> Both. (D1) A plan is the review surface at the `full-*` kind=plan pause exactly as a
   spec is at kind=spec, so scoping to specs would leave `full-*` sessions with the problem
   this feature exists to remove.

2. *Should the framework open feature MDs too, since they are also doc-tracked?*
   -> No. (D2) An FD is edited continuously across a session and is never the object of a
   single approval pause, so opening it buys an interruption with no decision attached.

3. *Should non-Claude runners get a prose step, or is Claude-only auto-open acceptable?*
   -> Prose step for all runners. (D3) `AGENTS.md` promises "same rules, one gate" across
   runners, the CLI exists either way, and the marginal cost is one line per rendering.

4. *Should the dead-link fix be prose-only ("remember the worktree prefix") or should the
   path be supplied to the agent?*
   -> Supplied. (D4) The instruction to report a clickable link is already in the prose and
   already produces dead links, so the defect is in asking an agent to derive a path at all.

5. *How does the Claude agent obtain the path, given `PostToolUse` stdout never reaches the
   model?*
   -> The hook emits `hookSpecificOutput.additionalContext`. (D5) The alternative — Claude
   prose also calling `design open` — fires `code` twice per artifact and breaks the
   one-launch guarantee.

6. *Is the VS Code workspace root derivable from git?*
   -> No; it is an input. (D6) `--git-common-dir` names the main checkout, which is simply a
   different thing from the folder the editor opened — an operator who opens
   `.worktrees/<slug>/` directly would get the inverse of the bug. The hook payload's `cwd`
   is the authoritative signal and `src/hooks/noldor-pre-edit-guard.ts:91` already consumes
   it that way; git is rung 4 of a fallback ladder, with `path.resolve` applied because the
   raw output is cwd-relative on `main`.

7. *Should a missing editor be a non-zero exit?*
   -> No. (D7) Other runners' prose is required to call this command, so a non-zero exit on
   a machine with no `code` would turn a cosmetic absence into a gate failure; printing the
   path and warning keeps the deliverable and the fail-open goal consistent.

8. *Should the hook debounce re-opens with a marker file instead of matching `Write` only?*
   -> No marker. (D8) The `Write`/`Edit` boundary already means "created" versus "refined",
   so matching `Write` is a free dedupe; a marker file would add shared mutable state to a
   cosmetic convenience.

9. *Should `code --reuse-window` or `--goto <path>:1` be used instead of a bare
   `code <path>`?*
   -> Bare `code <path>`. (D9) The artifact sits inside the open workspace folder, so VS
   Code already opens it as a tab in the existing window; the flags would add behaviour with
   no case that needs it.

10. *Should archived artifacts under `docs/design/{specs,plans}/archive/` open?*
    -> No. (D10) An archived artifact is history rather than a review surface, and
    restricting the predicate to direct children excludes them without a second rule.

11. *Should `openInEditor` move out of `pen-bridge-cli.ts` now that it has a second caller?*
    -> Leave it. (D11) `abstraction-cost` prices reuse from the third call site, not the
    second, and both callers live under `src/design/` — one hop within a module, not a
    cross-cutting dependency.

12. *Should the stale graph be regenerated so `### Structural context` carries a real
    digest?*
    -> No, cut it with a reason. (D12) `graphify-out/graph.json` is tracked at 3.6 MB, so
    regenerating on this branch would attach a multi-megabyte generated diff to a
    three-file change; `/noldor-release-sweep` owns that refresh.
