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
- Give the `--app` mismatch a name, and name the file that has to change.
- Never report a wake that did not happen.
- Leave the spec/plan `.md` open path exactly as it is.

## Non-goals

- Writing the operator's MCP configuration. It is personal and harness-owned;
  the framework reports and never edits it.
- Supporting the `pencil://` URL scheme. The app registers one, but the file-arg
  open works and its contract is documented by macOS.
- Cold-starting the app from an agent. Established this session: a GUI launch
  from the Claude Code Bash tool fails silently — `open` exits 0, stderr is
  empty, no app appears — whether or not the sandbox is on, while the same
  command works from the operator's terminal. Handing a file to an *already
  running* app does work from the tool shell. This asymmetry is load-bearing and
  unit 1 is designed around it.
- A configurable `.pen` editor. After this change there is one route.
- Authoring a `.pen` from Node. The format is encrypted and `execute` cannot
  create one at a path (Q-0187). Bootstrap stays a human step.
- Changing anything in `src/design/open-artifact.ts`.

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

```ts
export type PenLaunch =
  | { kind: 'dispatched' }
  | { kind: 'not-installed'; error: string }
  | { kind: 'failed'; error: string }
  | { kind: 'unsupported-platform'; platform: string };

export interface PenLaunchDeps {
  readonly platform: string;                       // defaults to process.platform
  readonly run: (cmd: string, args: readonly string[], cwd: string)
    => { status: number | null; stderr: string; error?: Error };
}

export function openPenFile(
  absPath: string,
  cwd: string,
  deps?: Partial<PenLaunchDeps>,
): PenLaunch;
```

Synchronous, in `src/design/pen-bridge-cli.ts`, beside the existing launcher.
`absPath` must already be absolute — the CLI owns resolution (unit 2a) so that
this function has one input contract and `open` is never handed a relative path
whose meaning depends on the child's cwd. `deps` exists so tests drive every
branch without spawning anything; the default `run` is `spawnSync` bounded by
`EDITOR_TIMEOUT_MS`.

Off `darwin` it returns `unsupported-platform` **without spawning** — there is no
`open` and no bundle id, and the `code` fallback is gone from this path. The
caller renders the resolved path and tells the operator to open it by hand.

On `darwin` it runs `open -g -b dev.pencil.desktop <absPath>`. `-g` keeps the
launch from stealing focus, matching PR #417's posture for `.md`.

**The outcome is `dispatched`, never `opened`.** A cold start from a non-GUI
context exits 0 with empty stderr and no app — measured this session — so a
success claim here would be exactly the false wake the goals forbid. The name,
and every message derived from it, says only that the file was handed to macOS.
Whether a canvas actually came up is answerable only by pencil MCP, in-session,
by retrying a call — which is what the recipe tells the reader to do.

Failure is classified, not merely detected. Anything on stderr, or a non-zero
exit, or a spawn error is a failure; among those, stderr containing
`LSCopyApplicationURLsForBundleIdentifier` is `not-installed` and everything else
is `failed`. That marker is the measured signature of an unregistered bundle id
(`open -g -b <unknown> <file>` → exit 1 plus that message, 2026-09-02), and it is
the whole mechanism behind the install-versus-launch distinction — there is no
second probe.

### Unit 2 — the launcher seam stays split

`openInEditor` is imported by `src/design/open-artifact.ts:16` and used by
`launchArtifact` to open **spec and plan `.md`** files; its `classify` rejects
any path not ending in `.md` (`open-artifact.ts:212`). The two callers are
disjoint by input but share one launcher today.

They stop sharing it. `openPenFile` becomes the `.pen` route and `openInEditor`
keeps the `code` route unchanged for `.md`. `appBundleFor` and `openInBackground`
stay where they are — they serve the `.md` path. Nothing in `open-artifact.ts` is
edited.

"Rip VS Code out" is scoped to the `.pen` path. Applying it to the shared
launcher would break three shipped PRs.

**2a — the path contract.** `main()` already validates `--pen`: it must end in
`.pen` and exist on disk (`pen-bridge-cli.ts:171-179`). That validation stays and
gains one step — resolve to an absolute path against `cwd` before handing it on,
so `openPenFile`'s precondition is established at the one place a caller-supplied
path enters. Ranked candidates from `trackedPenFiles` are repo-relative and get
the same `join(cwd, …)` treatment.

Repo-containment is deliberately **not** enforced. `--pen` is an operator-typed
argument and the bridge's whole job is to wake on whatever `.pen` is reachable;
refusing an out-of-repo path would break the documented recovery where any open
`.pen` unblocks MCP for every other file. Symlinks are followed by `existsSync`
and passed through unresolved, matching `open-artifact.ts`'s rule that the leaf
stays lexical. `bootstrap` creates no directory: nothing writes a `.pen` from
Node, so a directory made here would be an empty promise.

### Unit 3 — the recipe and the bootstrap instruction

`PENCIL_EDITOR_DEFAULT` becomes `'desktop'` and its type narrows to that single
literal — after this change there is one `.pen` route and no switch, so a union
type would advertise a choice no code can make. `PENCIL_EXTENSION_ID` is deleted
along with the comment paragraph that justified the VS Code default on grounds
now known to be false. A new exported `PENCIL_BUNDLE_ID = 'dev.pencil.desktop'`
gives the launcher and the prose one definition.

`penBridgeRecipe` is rewritten. It must carry three things the old text did not:
that the wake command is `pnpm noldor design pen-bridge --pen <path>`; that a
dispatch is not a confirmed open, so the reader retries the MCP call to find out;
and that **an agent cannot start the app** — a not-running app is an operator
action. Both lane prompts pick the new text up for free.

`renderPlan`'s bootstrap branch is where "keep files in the repo" is enforced by
prose rather than by code. It must say: open the app, create a document, then
**Save As** to `docs/design/ui/bridge-scratch.pen` inside this repo. A document
the app creates for itself is parked under `~/.pencil/documents/<uuid>/` and will
never be committed, so an instruction that stops at "create one" produces a
design nobody can review.

### Unit 4 — the pen-bridge check

```ts
export type PenBridgeRow =
  | { kind: 'mcp-app-ok'; source: string }
  | { kind: 'mcp-app-mismatch'; source: string; found: string }
  | { kind: 'mcp-indeterminate'; reason: string }
  | { kind: 'app-ok' }
  | { kind: 'app-missing' }
  | { kind: 'app-indeterminate'; reason: string }
  | { kind: 'not-applicable'; platform: string };

export interface PenBridgeCheckDeps {
  readonly platform: string;
  readonly home: string;
  readonly readFile: (path: string) => string | undefined;  // undefined = unreadable
  readonly probeBundle: (bundleId: string) => 'ok' | 'missing' | 'indeterminate';
}

export function checkPenBridge(
  cwd: string,
  deps?: Partial<PenBridgeCheckDeps>,
): readonly PenBridgeRow[];
```

A new module `src/checks/check-pen-bridge.ts` shaped like
`check-install-freshness.ts` — a function returning typed rows, with the CLI and
`doctor.ts` doing every bit of printing. Registered in `src/cli/manifest.ts`
under `checks`; imported by `src/cli/commands/doctor.ts` the way
`checkInstallFreshness` already is. Off `darwin` it returns a single
`not-applicable` row and probes nothing.

**Row 1 — the `--app` pin.** The expected value is the literal `desktop`. There
is no editor→app map and no derivation: `openPenFile` opens the desktop app
unconditionally, so a `visual_studio_code` pin genuinely is a mismatch and saying
otherwise would describe a configurability this design removed.

Discovery reads two sources in order and **stops at the first that yields a
pencil entry**: `<cwd>/.mcp.json`, then `<home>/.claude.json`. A server entry is
"the pencil entry" when its key under `mcpServers` is `pencil`; key match only,
because a command-path heuristic would misfire on a renamed binary. In
`~/.claude.json` the `mcpServers` object may be nested per-project, so every
`mcpServers` object in the document is searched and a `pencil` key at any depth
qualifies — matching how the file is actually written.

The `--app` value is read from the entry's `args` array in either accepted form:
`["--app", "desktop"]` or `["--app=desktop"]`. First occurrence wins if repeated.
Every other shape is `mcp-indeterminate` with the reason named — absent `args`,
`--app` present with no following value, unparseable JSON, an unreadable file, no
pencil entry in either source. **Indeterminate is never a mismatch**: the check's
value is naming a specific misconfiguration, and inventing one from an absent or
unfamiliar file would be worse than silence, especially for a consumer on another
harness.

`source` carries the file that supplied the effective entry, and every mismatch
message names that file as the one to edit. Without it the diagnostic can send an
operator to `~/.claude.json` while a higher-priority project `.mcp.json` holds
the real pin, and the prescribed fix does nothing.

**Row 2 — the app.** `probeBundle` resolves `PENCIL_BUNDLE_ID`; its three states
map to `app-ok`, `app-missing` (with the install hint) and `app-indeterminate`.
It is a dependency rather than inline code precisely because it is not a
filesystem read, which keeps the rest of the function deterministic under test.

There is **no socket row**. `~/.pencil/socket/pencil-desktop.sock` may be a
leftover symlink from the hand workaround, but the desktop app replaces it with a
real socket on startup — so the finding is observable only while the app is down,
which is not a misconfiguration. A row that is silent exactly when it would
matter is not worth its error surface.

**Exit status.** `checks pen-bridge` exits 1 when any row is `mcp-app-mismatch`
or `app-missing`, and 0 otherwise — indeterminate and not-applicable rows print
but never set it. `doctor` prints the same rows and **never** lets them change
its own exit code. "Advisory" means precisely that: the standalone command
reports a real finding honestly through its exit code for anyone scripting it,
while no commit or push gate consumes this check at all.

### Unit 5 — documentation

Four surfaces instruct `code <file>.pen` today and each is updated, then mirrored
into `templates/` (without which `doctor` drift reds `cli.test.ts`): the parent
FD's Usage section, `docs/noldor/gotchas.md`, and the `/noldor-spec` and
`/noldor-gate` skill prose.

`docs/noldor/gotchas.md` is where the operational facts belong, per the vision's
self-ownership rule — the bundle id, the `pencil-<app>.sock` derivation, the
`--app` pin and its restart requirement, and the fact that an agent cannot
cold-start the app. Template-sync proves the copies match; it cannot prove the
facts are present, so criterion 11 pins the content directly.

## Acceptance criteria

1. `openPenFile` returns `unsupported-platform` off `darwin` and spawns nothing;
   on `darwin` it runs `open` with `-g`, `-b dev.pencil.desktop` and the given
   absolute path, bounded by `EDITOR_TIMEOUT_MS`.
2. `openPenFile` returns `not-installed` when stderr carries
   `LSCopyApplicationURLsForBundleIdentifier`, `failed` on any other non-zero
   exit, stderr or spawn error, and `dispatched` only on exit 0 with empty
   stderr.
3. No success path of `pen-bridge` claims the file was opened; the rendered text
   says the file was handed to the app and directs the reader to retry the
   pencil MCP call.
4. `pen-bridge` resolves `--pen` and ranked candidates to absolute paths before
   launching, still rejects a non-`.pen` or non-existent `--pen` with exit 2, and
   accepts a path outside the repo.
5. `pnpm noldor design pen-bridge --pen <existing .pen>` routes through
   `openPenFile`; `openInEditor` still spawns `code` for a `.md` path and
   `launchArtifact`'s behaviour for spec and plan artifacts is unchanged.
6. `PENCIL_EDITOR_DEFAULT` is `'desktop'`, `PENCIL_BUNDLE_ID` is exported, and no
   symbol named `PENCIL_EXTENSION_ID` is exported from `src/design/pen-bridge.ts`.
7. `penBridgeRecipe`'s output contains no `code <path>` instruction, states that
   an agent cannot start the app, and is rendered by both
   `ui-review-dispatch.ts` and `render-export-dispatch.ts`.
8. `renderPlan`'s bootstrap output names `docs/design/ui/bridge-scratch.pen` and
   instructs a save into the repo.
9. `checkPenBridge` returns `mcp-app-mismatch` for `--app visual_studio_code` and
   `mcp-app-ok` for `desktop`, in both `["--app","desktop"]` and
   `["--app=desktop"]` forms, from `.mcp.json` in preference to `~/.claude.json`,
   with `source` naming the file that supplied the entry.
10. `checkPenBridge` returns an indeterminate row — never a mismatch, never a
    throw — for unparseable JSON, an unreadable file, a missing pencil entry, an
    absent `args`, and `--app` with no value; and a single `not-applicable` row
    off `darwin`.
11. `checks pen-bridge` exits 1 on mismatch or missing app and 0 otherwise;
    `doctor` prints the rows without its exit code changing.
12. `docs/noldor/gotchas.md` states the bundle id, the `pencil-<app>.sock`
    derivation, the restart requirement, and that an agent cannot cold-start the
    app; no `code <file>.pen` instruction survives in the FD, gotchas, either
    skill, or their `templates/` mirrors; `checks template-sync` passes.

## Risks / trade-offs

**macOS-only, with no fallback.** `open` and bundle ids do not exist elsewhere,
and unlike the `.md` path there is no `code` route left to degrade to. A Linux or
Windows consumer gets a resolved path and an instruction, which is a real
capability loss — accepted because the `.pen` format's only reader is a macOS app
plus a VS Code extension the operator is deliberately leaving behind.

**An agent cannot recover the bridge alone.** The `dispatched` naming and the
recipe are honest about this, but the UI-design step becomes more
human-dependent than the VS Code arrangement *claimed* to be — a claim never
tested, and `code` from a hook has its own failure modes.

**The check reads files it does not own.** Schemas can change under it. Every
unfamiliar shape degrades to indeterminate rather than to a finding; criterion 10
pins this, and it is the reason discovery matches on the `pencil` key alone.

**Nothing here is exercised in this repo.** Zero `.pen` files are tracked, so
`design pen-bridge` always takes the bootstrap branch locally. The tests carry
more of the verification weight than usual, which is why unit 1 and unit 4 both
take injected dependencies.

## User Story

As an operator running the UI-design step, I want `.pen` files to open in the
pen.dev desktop app I actually use, on files that stay inside my repo, so that I
can design without installing a VS Code extension and so a misconfigured MCP
tells me which file to fix instead of looking like a closed editor.

## Usage

- Open a `.pen`: `pnpm noldor design pen-bridge --pen docs/design/ui/<file>.pen`.
  A bare `pnpm noldor design pen-bridge` picks a tracked `.pen` by ranking. The
  command reports that the file was handed to the app — retry the pencil MCP call
  to confirm the bridge is live, and start the app yourself if it is not running.
- First `.pen` in a repo: run the command, follow the bootstrap instruction —
  open the app, create a document, Save As to `docs/design/ui/bridge-scratch.pen`
  inside the repo, then retry the failing pencil MCP call.
- Check the wiring: `pnpm noldor checks pen-bridge`, or `pnpm noldor doctor`
  which includes it. A mismatch row names the configuration file holding the
  pencil entry; set its `--app` to `desktop` in **that** file and restart Claude
  Code.

## Open questions (resolved)

1. *What does the `.pen` launcher do on Linux and Windows, where there is no
   `open` and no bundle id?*
   -> Return `unsupported-platform` without spawning, and render the resolved
   path with an open-it-yourself instruction. (D1) A silent no-op would report a
   wake that never happened; the recipe already treats manual opening as a
   legitimate terminal state.

2. *Standalone `checks pen-bridge`, or folded into an existing doctor probe?*
   -> Standalone module under `checks`, imported by `doctor`. (D2) It mirrors how
   `check-install-freshness.ts` relates to `doctor.ts` in the same graph
   community, and stays runnable alone when the bridge is what is being debugged.

3. *How does the check find the MCP configuration on a consumer that may not use
   `~/.claude.json`?*
   -> Project `.mcp.json` first, then `~/.claude.json`, matching on the
   `mcpServers.pencil` key at any depth, first hit wins, and "cannot determine"
   when neither yields one. (D3) The diagnostic names the file it actually read,
   so the prescribed fix lands on the entry that is in force.

4. *What should `pen-bridge` do when Pen.app is not installed?*
   -> Report `not-installed` with an install hint, distinguished from a launch
   failure by the `LSCopyApplicationURLsForBundleIdentifier` marker macOS emits
   for an unregistered bundle id. (D4) The two have different remedies, and this
   marker makes the distinction free rather than requiring a second probe.

5. *Should the framework probe whether the app is running before opening a file?*
   -> No, but the outcome is renamed. (D5) A liveness probe would be a second
   source of truth about a question pencil MCP answers definitively; the honest
   fix is to stop claiming an open ever happened. Hence `dispatched`, and prose
   that sends the reader to the MCP retry.

6. *Should the check flag a leftover `pencil-desktop.sock` symlink?*
   -> No; the row is dropped. (D6) The desktop app overwrites the symlink with a
   real socket on startup, so the finding is visible only while the app is down —
   which the design already treats as normal, not as misconfiguration.
