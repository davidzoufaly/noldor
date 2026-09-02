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
- Guaranteeing the workspace root in every layout. Multi-root workspaces, and sessions
  whose cwd is not the folder the editor opened, are named as known limitations under Risks
  with `--workspace-root` as the escape hatch — nothing reaching this code can tell which
  folder the operator's markdown preview resolves against.
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

### U0 — the workspace root is an input, and it is not always knowable

This is the decision the rest of the design hangs off. **Nothing reachable from this code
can prove which folder the editor opened**, and the design says so rather than asserting a
derivation that holds only sometimes.

Git cannot answer it. From `<repo>/docs/design/specs` on `main`,
`git rev-parse --git-common-dir` prints the *cwd-relative* `../../../.git`; from the same
directory inside a worktree it prints the absolute `<main-root>/.git`. Neither output names
the editor's workspace folder, and an operator who opens `.worktrees/<slug>/` directly has
a workspace folder git will never mention.

The environment cannot answer it either. `VSCODE_CWD` is the cwd the VS Code *application*
was launched from, not the workspace folder — on this machine it is `/`, which is absolute,
would satisfy any "is it set and absolute" test, contains every path so no containment check
rejects it, and yields `Users/davidzoufaly/code/noldor/.worktrees/…`. It is therefore not a
rung at all.

What is left is a **best signal plus an explicit override**, resolved by a ladder where the
first rung that answers wins:

1. `--workspace-root <abs-path>` when passed — the explicit override, and what the tests
   drive. A relative, absent or non-directory value is a usage error, never a silent
   fallthrough.
2. The hook payload's `cwd` (U2's path). This is the session's working directory, which for
   a session the VS Code extension launched *is* the workspace folder, and
   `src/hooks/noldor-pre-edit-guard.ts:91` already consumes it this way
   (`payload.cwd ?? process.cwd()`). It is a strong default, not a guarantee — see the
   limitation under Risks.
3. `git rev-parse --show-toplevel` from the artifact's directory — the artifact's **own**
   checkout root, so a worktree artifact yields the worktree root. This is the rung that
   reproduces today's working behaviour when nothing better is available.
4. `process.cwd()`.

The command never fails because a rung did not answer. One containment rule keeps a wrong
rung from printing nonsense: if the artifact is not inside the resolved root, that root is
discarded and the path is printed relative to the artifact's own checkout root (rung 3),
which is today's behaviour rather than a worse one.

### U1 — `noldor design open <path>`: the runner-neutral core

One command owns both halves of the problem, because both need the same two facts: where
the file is on disk, and where the workspace root is (U0). It resolves `<path>` against
cwd, refuses a path that is not a live design artifact and refuses one that is not on
disk, prints on stdout the path **relative to the workspace root**, and launches the
editor on the **absolute** path.

**Resolution and launch are separate steps, in that order, and the shared unit performs
only the first.** `resolveArtifact` decides and returns; the caller prints; the caller then
calls `launch`. The unit never launches, so the required ordering — path on stdout before
any editor is touched — is expressible rather than merely asserted, which the first draft's
launch-inside-the-unit shape could not satisfy. A launch that cannot happen (no `code` on
PATH, a spawn that times out or throws) is a warning on stderr with exit still 0. That is
what reconciles the global fail-open goal with a command other runners' prose is required
to call: a codex session on a machine with no `code` still gets its link and its gate step
still proceeds. Only a **usage** error is non-zero.

**The artifact predicate**, shared verbatim with U2 so the two cannot disagree:

- Resolve the input to an absolute path (`path.resolve`) without resolving symlinks —
  lexical containment only, so a symlinked repo is judged by the path the caller used.
- `lstat` must report a **regular file**, or a symlink whose `stat` reports one. A
  directory named `*.md`, a broken symlink, and a symlink to a directory are all
  `not-a-file`. A symlink whose target lies outside the checkout is still judged by its
  lexical path, because that is the path the editor will open.
- The extension must be `.md`.
- Its parent directory must be exactly the `specs` or `plans` doc root of the checkout
  containing it, as `loadDocRoots` (`src/core/doc-roots.ts:56`) reports them — which is
  what admits both the `docs/design/{specs,plans}` layout and the pre-1.0.0
  `docs/superpowers/{specs,plans}` transition alias without hardcoding either.
- Direct children only. `docs/design/specs/archive/x.md` is rejected: an archived artifact
  is history, not a review surface.
- The checkout whose doc roots are consulted is found with
  **`git rev-parse --show-toplevel` from the artifact's directory** — never
  `--git-common-dir`, and never the repo containing cwd. A path in no repository is
  rejected.

The `--show-toplevel` choice is load-bearing and is where the first draft was fatally
wrong. `--git-common-dir` names the **main** checkout even when run from inside a worktree
(verified: from `.worktrees/<slug>/docs/design/specs/` it prints `<main>/.git`), so
`loadDocRoots` would have returned `<main>/docs/design/specs` and the parent-equals-doc-root
test would have failed for *every* `specs-only-*` and `full-*` artifact — rejecting the
primary case the feature exists for. `--show-toplevel` returns the worktree root from a
worktree and the repo root from `main` (both verified), which is the checkout whose doc
roots actually contain the file. `--git-common-dir` survives nowhere in this design;
U0 rung 3 uses `--show-toplevel` too.

Consulting the artifact's own checkout is what makes a path merely *ending* in the same
segments — an unrelated tree with a `docs/design/specs/` in it — a rejection rather than
an accident.

**Editor launch reuses `openInEditor` from `src/design/pen-bridge-cli.ts:48`** rather than
re-spawning `code`. That function already encodes the two decisions worth keeping: `code`
is the one scriptable editor, and a launch failure is an expected result (`OpenResult`)
rather than a throw. It gains an explicit `timeout` (see Error handling); everything else
about it is unchanged, and the import is one hop within `src/design/`.

`code <abs-path>` — not `--reuse-window`, not `--goto` — is deliberate. When the path sits
inside an already-open workspace folder, VS Code opens it as a tab in that window, which
is exactly the ask.

**The shared contract both entry points call:**

```ts
export interface ResolveArtifactRequest {
  readonly path: string;
  readonly cwd: string;
  /** U0 rung 1. Must be absolute and an existing directory, else `bad-workspace-root`. */
  readonly workspaceRoot?: string;
  /** Injected in tests; default probes real git with GIT_TIMEOUT_MS. */
  readonly git?: (args: readonly string[], cwd: string) => string | undefined;
}

export type ResolveArtifactResult =
  | { readonly kind: 'artifact'; readonly absPath: string; readonly linkPath: string }
  | {
      readonly kind: 'rejected';
      readonly reason: 'no-path' | 'not-a-file' | 'not-an-artifact' | 'no-repo' | 'bad-workspace-root';
      readonly message: string;
    };

export type LaunchOutcome =
  | { readonly kind: 'launched' }
  | { readonly kind: 'not-launched'; readonly warning: string };

/** Never throws: a throwing or timing-out launcher becomes `not-launched`. */
export function launchArtifact(
  absPath: string,
  cwd: string,
  launch?: (absPath: string, cwd: string) => OpenResult,
): LaunchOutcome;
```

Two functions, because the ordering demands two: `resolveArtifact` is decision-only (a
bounded git probe and filesystem stats, no spawn of an editor, no stdout, no exit code, no
environment reads beyond what its caller passes), and `launchArtifact` is best-effort and
**cannot throw** — a launcher that throws, times out, or reports failure all become
`not-launched` with a `warning`. There is no unexpected-I/O result member because there is
no unexpected-I/O outcome: a failed stat is `not-a-file`, a failed or timed-out git probe
means that rung did not answer, and every launch failure is `not-launched`.

Both callers own their own output. U1: print `linkPath`, call `launchArtifact`, write any
`warning` to stderr, exit 0; on `rejected` write `message` to stderr and exit 2. U2: the
same sequence, but every outcome — `rejected` included — exits 0, and the report goes out as
JSON rather than a bare line. Keeping printing out of the unit is what lets the two entry
points differ in format while agreeing on the decision.

### U2 — `noldor hooks open-artifact`: the Claude wiring

A `PostToolUse` hook matched on `Write` reads the payload from stdin, and **reuses
`filePathFromPayload`** — already exported from `src/hooks/noldor-pre-edit-guard.ts:80` —
to pull the target path, resolving a relative value against the payload's `cwd`. It then
calls U1's unit with `workspaceRoot: payload.cwd`. `.claude/settings.json` already carries
a `PreToolUse` entry routing `Edit|Write|NotebookEdit` to `noldor hooks pre-edit-guard`;
this adds the first `PostToolUse` entry, registered in the `hooks` group of
`src/cli/manifest.ts:312` beside it.

**The hook is how the agent learns the link.** A `PostToolUse` hook's plain stdout is
transcript-only and never reaches the model, so the hook writes the JSON form instead — for
**every** `artifact` resolution, whether or not the editor launched, because the path is the
deliverable and withholding it when `code` is absent would contradict the fail-open goal:

```json
{ "hookSpecificOutput": { "hookEventName": "PostToolUse",
    "additionalContext": "Design artifact written. Report this path in markdown links: <linkPath>" } }
```

The message names the *writing*, not the opening, so the one string is honest in both
cases; when the launch failed, the `warning` is appended to it so the agent can tell the
operator no tab appeared. A `rejected` resolution emits no `additionalContext` at all —
there is nothing to report and every `Write` to a source file takes that branch.

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
the parse, and the pinned subprocess timeouts below, so a hung `git` or `code` cannot wedge a
gate step. Every rejection, warning and thrown error is exit 0.

**The accepted payload** is `{ cwd?: string, tool_input?: { file_path?, notebook_path?, path? } }`
— the shape `noldor-pre-edit-guard.ts:69-77` already declares, read through its exported
`filePathFromPayload`. Unknown fields are ignored, a missing `tool_input` resolves to no
path (`rejected: no-path`, exit 0), and a relative `file_path` is resolved against
`payload.cwd ?? process.cwd()`.

### U3 — reporting a path that resolves

The prose that tells an agent to report a clickable link is corrected to tell it to report
**the path it was given** — from the hook's `additionalContext` on Claude, from
`design open`'s stdout elsewhere — rather than a repo-relative path it derived. Every
rendering of the reporting rule moves together, or the rule holds for one runner only:

| Runner | Files (each with its `templates/` twin) | Change |
| --- | --- | --- |
| Claude | `.claude/skills/noldor-spec/SKILL.md` steps 5 + 8; `.claude/skills/noldor-plan/SKILL.md` artifact-report step; `.claude/skills/noldor-gate/SKILL.md` Step 2.5 artifact-surfacing sentence and its Input-localization note | report the hook-supplied path; do **not** call `design open` |
| codex | `AGENTS.md` § Skills — the `spec`, `plan` and `gate` bullets | call `pnpm noldor design open <path>` and report its stdout verbatim |
| opencode | `.opencode/command/noldor-spec.md`, `.opencode/command/noldor-plan.md`, `.opencode/command/noldor-gate.md` | same as codex |

The gate rendering is included for all three runners deliberately: gate Step 2.5 surfaces
the artifact path in its own sentence, so a fix that covered only the spec and plan skills
would leave the gate's own report dead. Every listed file has a `templates/` twin that must
move in the same commit — `pnpm noldor checks template-sync` refuses a templated file that
drifts from its `templates/` copy.

**The link format** is pinned so "clickable" is not left to taste. Stdout is exactly one
line: the workspace-root-relative path with POSIX `/` separators, no quoting and no
trailing whitespace. Agents construct `[<label>](<destination>)` where:

- the **destination** percent-encodes the characters that break a markdown target — space
  as `%20`, and `#` `%` `(` `)` `<` `>` `?` as their `%XX` forms — encoding `%` first so an
  already-encoded sequence is not double-read;
- the **label** is the basename with `[` and `]` backslash-escaped.

Artifact filenames are date-and-slug generated, so both branches are defensive rather than
routine — but the predicate accepts any `.md` direct child of a doc root, so it cannot
promise the generated shape and the encoding rule is stated instead of assumed.

Making the correct string *available* is what keeps this from being a rule agents forget:
the failure being fixed is an agent deriving a path, so the fix is to stop asking it to
derive one. Prose alone was rejected for that reason — it is the same instruction already
present, already producing dead links.

### Error handling

Four failure classes, four postures.

A **usage error** — `no-path`, `not-a-file`, `not-an-artifact`, `no-repo`,
`bad-workspace-root` — is exit 2 from U1 with the reason named, and exit 0 from U2.
Opening a missing file yields an empty buffer that reads as a successful open, which is the
hazard `src/design/pen-bridge-cli.ts:78-85` already guards for `--pen`. An explicit
`--workspace-root` that is relative, absent from disk, or not a directory is
`bad-workspace-root` rather than a fallthrough to rung 2: an operator who names a root has
stated an intent, and silently substituting a different one would print a path they did not
ask for.

A **missing editor** prints the link, warns on stderr with the remediation line
`pen-bridge-cli.ts:100-104` already carries (install the shell command from the Command
Palette), and exits **0**. The path is the deliverable; the tab is the convenience.

A **hung subprocess** is bounded, not waited on. Both waits carry a pinned deadline —
`GIT_TIMEOUT_MS = 2_000` on each `git rev-parse` probe and `EDITOR_TIMEOUT_MS = 5_000` on
the `code` spawn, passed as `execFileSync`'s `timeout` option — so the whole hook is bounded
by one git probe plus one editor spawn, under 8 s including Node startup even in the worst
case. Expiry is treated as "that rung did not answer" and "the editor did not launch"
respectively, never as a throw. `concurrency-write-discipline` requires the deadline: an
untimed wait inside a hook is a hang, and a hang reads to the operator as a broken tool.
The constants are module-level and not configurable — a knob here would be a second way to
produce a hang.

A **git failure or an unresolvable workspace root** degrades rather than fails: the ladder
falls through to `process.cwd()`, and the containment rule falls back to the artifact's own
checkout root. The worst case is the path the prose produces today.

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

The predicate is tested as a table against real temp trees, because its `--show-toplevel`
leg is exactly what the first draft got wrong: a spec **inside a real
`git worktree add`ed checkout** must resolve as an artifact, which is the regression test
for that defect. The negatives that carry the design ride the same table — an `archive/`
child, a non-`.md` file, a directory named `*.md`, a broken symlink, a symlink to a
directory, a feature MD, a source file, a path in no repository, and an unrelated tree whose
directories merely end in the same segments.

The process boundary is the one seam that gets mocked, and only there: the injected
`launch` reaches the missing-editor, throwing-launcher and timeout branches without
depending on the runner's machine, and the injected `git` reaches the probe-failed and
probe-timed-out rungs. The hook's fail-open contract is asserted the same way — a TTY
stdin, malformed stdin, an absent `tool_input`, an absent `file_path`, a relative
`file_path`, a non-artifact path, a throwing launcher and a timed-out probe all exit 0 — and
the `additionalContext` payload is asserted as parseable JSON carrying the same `linkPath`
the CLI prints, present on a failed launch and absent on a `rejected` resolution.

Link construction is a pure function and is tested on the characters that break a markdown
target: a space, `#`, `%`, parentheses and angle brackets in both the destination and the
label, including a path already containing a `%XX` sequence (asserting the `%`-first
ordering does not double-encode it).

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
   `git rev-parse --show-toplevel` from the artifact's directory, `process.cwd()` — and an
   artifact outside the resolved root falls back to its own checkout root. `VSCODE_CWD` is
   never consulted.
4. The path reaches stdout before any editor spawn is attempted, and the command launches
   the VS Code CLI on the artifact's **absolute** path.
5. It still prints the path and exits 0 when the editor cannot be launched — absent `code`,
   a throwing launcher, or a spawn that exceeds its timeout — writing a remediation warning
   naming the VS Code shell-command install to stderr.
6. It exits 2 without launching anything when the path names no file, is not a `.md`
   regular-file direct child of a specs or plans doc root, or lies in no git repository —
   including a path under `docs/design/specs/archive/`, a directory named `*.md`, a broken
   symlink, and a symlink to a directory.
7. A spec inside a `git worktree add`ed checkout resolves as an artifact: the predicate
   consults `git rev-parse --show-toplevel` from the artifact's directory, never
   `--git-common-dir`, and accepts both the `docs/design/{specs,plans}` and
   `docs/superpowers/{specs,plans}` layouts.
8. An explicit `--workspace-root` that is relative, absent from disk, or not a directory
   exits 2 rather than falling through to another rung.
9. Writing a new file under a specs or plans doc root in a Claude session results in
   exactly one editor launch for that file; editing an existing artifact results in none.
10. `pnpm noldor hooks open-artifact` exits 0 for every input — TTY stdin, malformed stdin,
    absent `tool_input`, absent `file_path`, relative `file_path`, non-artifact path,
    failing or throwing launcher, and a subprocess that exceeds its timeout.
11. The hook emits parseable JSON carrying `hookSpecificOutput.additionalContext` with the
    same workspace-root-relative path the CLI prints, on every `artifact` resolution
    including one whose launch failed, and emits no `additionalContext` on a `rejected`
    resolution.
12. Both the `git` probe and the editor spawn carry a pinned timeout (2 s and 5 s), and
    expiry is handled as a non-answer rather than a throw or a hang.
13. Markdown link construction percent-encodes space, `#`, `%`, `(`, `)`, `<`, `>` and `?`
    in the destination and backslash-escapes `[` / `]` in the label, without
    double-encoding an existing `%XX` sequence.
14. Every runner rendering named in the U3 table carries the reporting rule, gate rendering
    included: the Claude skill files report the hook-supplied path without calling
    `design open`, while `AGENTS.md` and the `.opencode/command/` shims call it and report
    its stdout.
15. `pnpm noldor checks template-sync` passes, and `pnpm noldor --help` lists `design open`
    and `hooks open-artifact`.

## Risks / trade-offs

**The workspace root is a best guess, and two layouts defeat it.** This is the feature's
honest ceiling, not an oversight.

*Multi-root workspaces.* With several folders open, no signal available here says which one
a markdown link resolves against, so the ladder picks the session's `cwd` and may be wrong.

*A session whose cwd is not the workspace folder.* Rung 2 holds when the extension launched
the session in the folder it opened, which is the ordinary case. It does not hold for a
session started elsewhere and moved — notably a native-worktree session, where `cwd` becomes
`.worktrees/<slug>` while the editor still shows the main checkout. The hook then prints the
bare repo-relative path: a dead link, the exact bug being fixed, in that one mode. Preferring
the parent checkout whenever `cwd` sits inside a `.worktrees/` of it was considered and
rejected — it would break the operator who genuinely opened the worktree as their window,
trading one silent wrong answer for another.

The escape hatch for both is `--workspace-root <abs-path>`, and the reason it is worth
shipping anyway is that the common case — extension-launched session, one workspace folder,
gate worktree underneath it — is the case that is broken today and is fixed here.

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

6. *Is the VS Code workspace root derivable from git or the environment?*
   -> Neither; it is a supplied input with a fallback ladder. (D6) `--git-common-dir` names
   the main checkout, a different thing from the folder the editor opened, and `VSCODE_CWD`
   is the cwd the VS Code application was launched from — on this machine `/`, which is
   absolute and contains every path, so it would answer the ladder and defeat the
   containment check simultaneously. The hook payload's `cwd` is the best available signal
   and `src/hooks/noldor-pre-edit-guard.ts:91` already consumes it that way, with
   `--show-toplevel` as rung 3 and the residual failure modes named under Risks rather than
   claimed away.

6b. *Which git probe does the artifact predicate use to find the doc roots?*
   -> `--show-toplevel`, never `--git-common-dir`. (D6b) From inside a worktree
   `--git-common-dir` names the **main** checkout, so `loadDocRoots` would return
   `<main>/docs/design/specs` and the parent-equals-doc-root test would reject every
   `specs-only-*` and `full-*` artifact — the primary case. `--show-toplevel` returns the
   worktree root from a worktree and the repo root from `main`, both verified against the
   real command.

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
