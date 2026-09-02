# pen.dev Desktop App Bridge — Design

**Slug:** desktop-app-bridge
**FD:** docs/features/pendev-ui-design-phase.md
**Date:** 2026-09-02
**Tier:** specs-only
**Deps:** none

## Problem

The `.pen` bridge is written against VS Code plus the `highagency.pencildev`
extension. `src/design/pen-bridge.ts:24` declares `PENCIL_EDITOR_DEFAULT =
'vscode'`, and the comment above it justifies the choice by asserting that the
pen.dev desktop app "has no scriptable open, so it is the fallback a human
drives." That assertion is false. `/Applications/Pen.app` (bundle id
`dev.pencil.desktop`, v1.2.7, notarized to High Agency Inc.) registers
`CFBundleDocumentTypes` for extension `pen` with role `Editor`, so
`open -g -b dev.pencil.desktop <abs path>.pen` opens that exact file — verified
this session against a file at a repo path, confirmed on screen by the operator,
with no copy appearing under `~/.pencil/documents/`.

The consequence is not merely a stale comment. Every recovery instruction the
framework emits sends an agent to `code <file>.pen`: `penBridgeRecipe`
(`pen-bridge.ts:85`) is interpolated into two lane prompts, and `renderPlan`'s
bootstrap branch (`pen-bridge-cli.ts:159`) names the VS Code extension as the
only way to author a first `.pen`. An operator who works in the desktop app is
told to install something they do not want, and the framework's own default
points away from the editor they actually use.

A second, quieter failure sits underneath. The pencil MCP server is launched
with an `--app` flag and derives its transport socket as
`~/.pencil/socket/pencil-<app>.sock`. Pinned to `visual_studio_code`, it talks to
the extension no matter which app has a `.pen` open, and every call fails with
`A file needs to be open in the editor` — the same message a genuinely closed
editor produces. Nothing in the framework can tell those two apart, so the
operator reads a configuration mismatch as a dead bridge and waives the
UI-design step.

## Goals

- Make the pen.dev desktop app the `.pen` editor the framework opens, names, and
  recovers through, on the strength of a real scriptable open rather than a
  human-driven fallback.
- Keep `.pen` files inside the consumer repo. A file the app opens from a repo
  path stays there; the one case that escapes — a document the app authors
  itself, which lands in `~/.pencil/documents/<uuid>/` — must be steered back
  into the repo by the bootstrap instruction rather than left to chance.
- Give the `--app` mismatch a name. An operator whose MCP is pinned to the wrong
  app should be told exactly that, with the edit to make, instead of inferring it
  from a message about a closed editor.
- Leave the spec/plan `.md` open path exactly as it is.

## Non-goals

- Writing the operator's MCP configuration. `~/.claude.json` is personal and
  harness-owned; the framework reports and never edits it.
- Supporting the `pencil://` URL scheme. The app registers one, but the file-arg
  open works and its contract is documented by macOS; reverse-engineering a URL
  shape buys nothing here.
- Cold-starting the app from an agent. Established this session: a GUI launch
  from the Claude Code Bash tool fails silently whether or not the sandbox is on,
  while the same command works from the operator's terminal. Handing a file to an
  *already running* app does work from the tool shell, so that is the capability
  the design rests on.
- Authoring a `.pen` from Node. The format is encrypted and `execute` cannot
  create one at a path (Q-0187). Bootstrap stays a human step.
- Removing the VS Code extension path for `.md` artifacts, or changing anything
  in `src/design/open-artifact.ts`.

## Design

### Structural context

noldor:cut graph is stale — regenerating it needs the `/graphify` skill, which is
out of proportion to this change. What follows is read from the graph on disk at
its `built_at_commit` `2c18fdb`, and the staleness is itself load-bearing: see
the absent node below.

`src/design/pen-bridge.ts` and `src/design/pen-bridge-cli.ts` sit together in
community **c111**, degree 8 and 10. Neither is a god node; this is a small,
interior pair, which is why the change is contained.

The one cross-community edge that matters is `penBridgeRecipe`. The graph places
it in **c39** — the CR-lanes community — while its defining file sits in c111, so
the recipe is a bridge, not an interior helper. It has **two** importers:
`src/cr/lanes/ui-review-dispatch.ts:9` and
`src/cr/lanes/render-export-dispatch.ts:11`. The second was found by the graph
and not by reading; a rewrite that considered only the first would have left one
lane telling agents to run `code <file>.pen`.

`src/cli/commands/doctor.ts` is in **c75**, degree 26, alongside
`src/core/prerequisites.ts`, `src/checks/check-install-freshness.ts` and
`bin/engines-check.mjs` — the environment-preflight cluster. A check that asks
"is your MCP pointed at the right app" is the same kind of question those ask,
so the new check joins an existing neighbourhood rather than starting one.

`src/design/open-artifact.ts` is **absent from the graph**. It shipped in PRs
#416–#418, after `2c18fdb`. That absence is the concrete cost of the staleness,
because that file holds the seam this design most has to respect — and the graph
cannot see it. It was found by reading instead.

### Unit 1 — the pen-only launcher

A new exported function in `src/design/pen-bridge-cli.ts` that opens a `.pen` in
the pen.dev desktop app and returns the existing `OpenResult`. It runs
`open -g -b dev.pencil.desktop <path>` via `spawnSync` under
`EDITOR_TIMEOUT_MS`, resolving the app by **bundle id** rather than a
`/Applications` path so a relocated or user-installed copy still resolves.

Success is judged the way `openInBackground` already judges it: `open` exits 0
even when it cannot find the application, printing to stderr, so a zero exit with
empty stderr is the only success and everything else is a failure. That rule is
already documented in this file; the new function reuses it rather than restating
it.

`-g` keeps the launch from stealing focus, matching the posture PR #417
established for `.md` artifacts.

### Unit 2 — the launcher seam stays split

`openInEditor` is imported by `src/design/open-artifact.ts:16` and used by
`launchArtifact` to open **spec and plan `.md`** files; its `classify` rejects
any path not ending in `.md` (`open-artifact.ts:212`). The two callers are
therefore disjoint by input but share one launcher today.

They stop sharing it. `openPenFile` becomes the `.pen` route and `openInEditor`
keeps the `code` route unchanged for `.md`. `appBundleFor` and the
`openInBackground` helper stay where they are — they serve the `.md` path and are
not VS-Code-specific in any way that this change touches. Nothing in
`open-artifact.ts` is edited.

The distinction to hold on to: "rip VS Code out" is scoped to the `.pen` path.
Applying it to the shared launcher would break three shipped PRs.

### Unit 3 — the recipe and the bootstrap instruction

`PENCIL_EDITOR_DEFAULT` becomes `'desktop'` and `PENCIL_EXTENSION_ID` is
deleted, along with the comment paragraph that justified the VS Code default on
grounds now known to be false. A new exported constant carries the bundle id so
the launcher and the prose share one definition.

What that constant means changes, and the change is worth stating because unit 4
reads it. It stops being a switch and becomes a record: after this change there
is exactly one `.pen` route, the desktop one, and `openPenFile` opens that app
unconditionally. The constant declares which app the framework has settled on, so
that the check has something to compare an MCP config against without restating
the opinion. Its `'vscode'` value therefore survives only as a value the *map* in
unit 4 can interpret when reading a config an operator has not migrated yet — not
as a route this code can take.

`penBridgeRecipe` is rewritten to tell an agent that the bridge is woken by
`pnpm noldor design pen-bridge --pen <path>`, and that when the app is not
running the operator has to start it — an agent cannot. Both lane prompts pick
the new text up for free, since both interpolate the same function.

`renderPlan`'s bootstrap branch is the one place where "keep files in the repo"
is enforced by prose rather than by code. It must say: open the app, create a
document, then **Save As** to `docs/design/ui/bridge-scratch.pen` inside this
repo. A document the app creates for itself is parked under
`~/.pencil/documents/<uuid>/` and will never be committed, so an instruction that
stops at "create one" produces a design nobody can review.

### Unit 4 — the pen-bridge check

A new module `src/checks/check-pen-bridge.ts` following the shape of
`check-install-freshness.ts`: a pure function over an injected filesystem view
returning a typed result, with the CLI and `doctor.ts` doing the printing. It is
registered in `src/cli/manifest.ts` under `checks` and imported by
`src/cli/commands/doctor.ts` the way `checkInstallFreshness` already is.

It reports three things:

1. **The `--app` pin.** Read the pencil MCP server entry and inspect its `--app`
   argument. The expected value is derived from `PENCIL_EDITOR_DEFAULT`, not
   hardcoded: the framework already declares which editor it opens `.pen` files
   in, and a check that restated that opinion would produce a false finding for
   any consumer still running the VS Code extension — a setup that works. A
   mismatch is printed with the exact replacement value and the fact that Claude
   Code must be restarted before it takes effect.

   The two vocabularies are not the same, so the comparison goes through an
   explicit mapping rather than a string equality: `PENCIL_EDITOR_DEFAULT` is
   `'vscode' | 'desktop'` while the MCP flag takes `visual_studio_code |
   desktop`. That map is the single place the correspondence is written down, and
   an editor value with no mapping is a "cannot determine", never a finding.
2. **A stale desktop socket.** `~/.pencil/socket/pencil-desktop.sock` being a
   *symlink* is a finding — it is the hand-made workaround for the pin, and the
   desktop app replaces it with a real socket on startup. A real socket there is
   correct and silent; an absent one only means the app is not running, which is
   not a misconfiguration.
3. **The app itself.** Whether a bundle with id `dev.pencil.desktop` resolves.

Every row is advisory. The check never writes configuration and never blocks a
commit.

### Unit 5 — documentation

The parent FD's Usage section, `docs/noldor/gotchas.md`, and the `/noldor-spec`
and `/noldor-gate` skill prose all instruct `code <file>.pen` today. Each is
updated and mirrored into `templates/`, without which `doctor` drift reds
`cli.test.ts`.

`docs/noldor/gotchas.md` is where the operational facts belong, per the vision's
self-ownership rule: the bundle id, the socket-path derivation, the `--app` pin,
and the fact that an agent cannot cold-start the app.

## Acceptance criteria

1. `openPenFile` runs `open` with `-g`, `-b dev.pencil.desktop`, and the given
   path, and is bounded by `EDITOR_TIMEOUT_MS`.
2. `openPenFile` reports failure when `open` exits non-zero, when it errors, and
   when it exits 0 with non-empty stderr.
3. `openInEditor` still spawns `code` for a `.md` path, and `launchArtifact`'s
   behaviour for spec and plan artifacts is unchanged.
4. `pnpm noldor design pen-bridge --pen <existing .pen>` routes through
   `openPenFile`, not through `code`.
5. `PENCIL_EDITOR_DEFAULT` is `'desktop'` and no symbol named
   `PENCIL_EXTENSION_ID` is exported from `src/design/pen-bridge.ts`.
6. `penBridgeRecipe`'s output contains no `code <path>` instruction, and both
   `ui-review-dispatch.ts` and `render-export-dispatch.ts` render the new text.
7. `renderPlan`'s bootstrap output names `docs/design/ui/bridge-scratch.pen` and
   instructs a save into the repo.
8. `checks pen-bridge` exits non-zero and names the required value when the MCP
   entry's `--app` does not match the app mapped from `PENCIL_EDITOR_DEFAULT`,
   and reports no finding when it does — for both mapped editor values.
9. `checks pen-bridge` reports a finding when the desktop socket path is a
   symlink, and no finding when it is a socket or absent.
10. `checks pen-bridge` exits 0 with no findings on a correctly configured
    machine, and degrades to a reported "cannot determine" rather than throwing
    when no MCP configuration is found.
11. `doctor` surfaces the pen-bridge rows without its own exit code becoming
    blocking on them.
12. `pnpm noldor checks template-sync` passes with the updated docs and skills.

## Risks / trade-offs

**The design rests on macOS-only mechanics.** `open` and bundle ids do not exist
on Linux or Windows. The framework already had this exposure — `openInBackground`
is `darwin`-gated — but there the `code` fallback covered the gap, and for `.pen`
there is no equivalent. See D1.

**An agent cannot recover the bridge alone.** Verified this session: a cold GUI
launch from the tool shell fails silently. The recipe must therefore be honest
that a not-running app is an operator action, which makes the UI-design step
slightly more human-dependent than the VS Code arrangement claimed to be — though
that claim was never tested, and `code` from a hook has its own failure modes.

**The check reads a file it does not own.** `~/.claude.json` is harness-owned and
its schema can change. A parse that fails must degrade to "cannot determine"
rather than to a false finding; criterion 10 pins this.

**Nothing here is exercised in this repo.** Zero `.pen` files are tracked, so
`design pen-bridge` always takes the bootstrap branch locally. The launcher's
real exercise is in a consumer, which means the tests carry more of the
verification weight than usual.

## User Story

As an operator running the UI-design step, I want `.pen` files to open in the
pen.dev desktop app I actually use, on files that stay inside my repo, so that I
can design without installing a VS Code extension and so a misconfigured MCP
tells me it is misconfigured instead of looking like a closed editor.

## Usage

- Open a `.pen`: `pnpm noldor design pen-bridge --pen docs/design/ui/<file>.pen`.
  A bare `pnpm noldor design pen-bridge` picks a tracked `.pen` by ranking.
- First `.pen` in a repo: run the command, follow the bootstrap instruction —
  open the app, create a document, Save As to `docs/design/ui/bridge-scratch.pen`
  inside the repo, then retry the failing pencil MCP call.
- Check the wiring: `pnpm noldor checks pen-bridge`, or `pnpm noldor doctor`
  which includes it. When it reports the `--app` pin, edit the pencil MCP entry
  in `~/.claude.json` to `"--app", "desktop"` and restart Claude Code.

## Open questions (resolved)

1. *What does the `.pen` launcher do on Linux and Windows, where there is no
   `open` and no bundle id?*
   -> Report a platform-specific failure naming the path to open by hand, and
   keep the resolved path in the message. (D1) A silent no-op would report a wake
   that never happened, and the recipe already treats "open it yourself" as a
   legitimate terminal state; a wrong-but-quiet launcher is worse than an honest
   refusal.

2. *Standalone `checks pen-bridge`, or folded into an existing doctor probe?*
   -> Standalone module, registered under `checks`, imported by `doctor`. (D2)
   This is exactly how `check-install-freshness.ts` relates to `doctor.ts` in the
   same graph community, and a standalone command is runnable on its own when an
   operator is debugging the bridge rather than the whole environment.

3. *How does the check find the MCP configuration on a consumer that may not use
   `~/.claude.json`?*
   -> Probe a small ordered list — project `.mcp.json`, then `~/.claude.json` —
   and report "cannot determine" when neither yields a pencil entry. (D3) The
   check's value is naming a specific misconfiguration; inventing one from an
   absent file would be worse than silence, and a consumer on another harness
   should not be told their setup is wrong.

4. *What should `pen-bridge` do when Pen.app is not installed at all?*
   -> Fail with a message naming the app and where to get it, distinct from the
   "could not launch" message. (D4) The two have different remedies — install
   versus start the app — and collapsing them reproduces exactly the ambiguity
   this design is trying to remove from the `--app` mismatch.

5. *Should the framework detect that the app is running before trying to open a
   file in it?*
   -> No. Attempt the open and report what `open` says. (D5) A liveness probe
   would be a second source of truth about the same question, and the honest
   answer is already available from the call itself; the recipe carries the "an
   agent cannot start it, you must" instruction for the case where it fails.
