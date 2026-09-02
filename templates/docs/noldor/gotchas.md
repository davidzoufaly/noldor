---
noldor-page: gotchas
introduced: 0.6.0
---

# Operator Gotchas

Hard-won operational traps that are not obvious from the code and cost a
debugging cycle each. Grouped by area. Every entry names the concrete file,
command, or condition that triggers it.

Related runbooks: [`cr-pipeline.md`](cr-pipeline.md) (CR-specific traps),
[`autonomy.md`](autonomy.md) (drain operation), [`drain-mode.md`](drain-mode.md)
(salvage), [`worktree-discipline.md`](worktree-discipline.md) (worktree split-brain).

## Docs & templates

- **`docs/noldor/*.md` are generated twins of `templates/docs/noldor/*.md`.**
  `check-template-sync` enforces byte-identical (only for files the commit
  touches). Edit **both** copies, or edit one and `cp` it over the other. A
  consumer-only edit survives typecheck/lint but **silently vanishes** when
  `pnpm test` runs: `cli.test.ts` runs `init --update` and `vitest.setup`
  chdir's to the repo root, regenerating the page in place from its template.
- **A brand-new templated file scaffolds to every consumer.** Dropping
  `templates/docs/noldor/<x>.md` auto-registers it via `templateFiles()` (a
  full-tree glob — no manifest edit needed) and it becomes a synced twin. If you
  link a new page from the templated `README.md` index, give it a template twin
  too or consumer scaffolds get a broken link.
- **A half-commented mermaid fence makes a whole markdown file scan as empty —
  green, with no diagnostic.** A flowchart edge *is* an HTML comment terminator:
  `<!--` … ` ```mermaid ` … `a --> b` … ` ``` ` … `-->` closes at the **arrow**,
  not at the trailing `-->`. So the fence's *opening* delimiter is blanked (it
  sat inside the comment) while its *closing* one survives and reads as an
  opener, and every heading to EOF disappears — `locateSection('## Usage')`
  returns `null` and the file's tags scan as `[]`. `markdown-section-scan.ts`
  answers this by requiring a hidden fence to be **born and die inside one
  comment**, so when you comment out a diagram put both fence delimiters inside
  the same `<!-- -->` pair rather than wrapping only the prose around it. The
  same constraint is why a scanner that blanks comments must interleave comment
  state with fence state in ONE pass and keep the CommonMark fence grammar in
  exactly one place: three consecutive attempts on the `fd-diagram` detector
  (Q-0185) each shipped a distinct hole, and two copies of the grammar in one
  file had already drifted on a rejected backtick opener.

## CR sinks

- **`cr aggregate` scans every `*.json` under `.noldor/cr/` as a lane sink.**
  An off-pattern filename emits a spurious `[high] non-conforming filename`
  blocker. When archiving a prior round's sink, move it to a **subdir**
  (`.noldor/cr/archive/`) — never rename it in place.
- **Stale sink after `git commit --amend`.** `cr orchestrate --rerun` does NOT
  refresh `.noldor/cr/<slug>-*-subagent.json` after an amend — the delta
  short-circuits on the stale `baseSha` and returns pre-amend findings citing
  removed line numbers. Force a fresh review: `rm .noldor/cr/<slug>-*.json`
  before re-orchestrating. (An amend also invalidates the
  `Noldor-Reviewed-Subagent` receipt, since the receipt is `HEAD^{tree}`.)
- **Re-running `cr orchestrate` over an existing sink crashes headless.** The
  interactive overwrite-guard (inquirer) has no TTY under a drain. Pass
  `--autonomous` (handles the prior sink silently) or `rm` the sink first.

## Tests

- **`src/triage/__tests__/score.test.ts` reads the LIVE repo tree.** During an
  attach session the phase-revert (`done → in-progress`) makes it fail mid-flow.
  This failure is EXPECTED during the in-progress window — run the
  phase-flip-to-`done` commit before the test gate.
- **A micro-chore session marker requires `startedAt`.** `SessionMarkerSchema`
  (`src/core/session.ts`) demands `startedAt: z.string().min(1)`. Writing just
  `{ path: 'micro-chore' }` → pre-commit ZodError and a silent commit failure
  (exit 1, no clear message in the lefthook tail). Use
  `{ path: 'micro-chore', startedAt: new Date().toISOString() }`.

## Worktrees

- **Main-workspace-absolute edit paths in a worktree session are a FALSE
  GREEN.** The edits land on `main`'s working copy while `pnpm typecheck` and
  `pnpm test` run inside the unchanged worktree — both pass, and the pass
  proves nothing about the change. Cheap tell: `git -C <worktree> status` is
  clean when it should be dirty. Reliable tell: the test COUNT did not grow
  after adding tests — a suite that never loaded them still reports green.
  Lossless recovery:
  `git -C <main> diff -- src/ > p && git -C <worktree> apply --3way p && git -C <main> checkout -- src/`,
  then re-verify. `worktrees create` prints the `Edit-path prefix:` line at
  scaffold time — prefix every Edit/Write with it.
- **A backgrounded git invocation leaves the shell CWD back at the main
  workspace.** `cr orchestrate` and `pr-flow` both amend or commit; after any
  backgrounded git step a bare `cat .noldor/cr/<slug>-code-reviewer.json`
  reads the WRONG repo and a bare `git log -1` shows a previous feature's
  commit — which reads exactly like a lost CR receipt. Every post-commit check
  in a worktree session must use `git -C <worktree>` or an absolute path;
  never trust CWD persistence.

## Dashboard

- **Editing `src/dashboard/static/drag.ts` needs a manual recompile + fmt.**
  Recompile via `pnpm exec tsc -p src/dashboard/static/tsconfig.json` and commit
  the regenerated git-tracked `static/dist/drag.js`. `.oxfmtrc.json`
  `ignorePatterns:["dist/**"]` does NOT match the nested
  `src/dashboard/static/dist/`, so bulk `pnpm fmt` skips it while the lefthook
  pre-commit fmt step (explicit staged-file list) does format it — the tsc
  output is auto-fixed and re-staged at commit time, so the committed
  `drag.js` differs from what tsc emitted. Run
  `pnpm exec oxfmt src/dashboard/static/dist/drag.js` yourself if you want the
  working tree to match before committing.
- **Add-form field values land verbatim in a schema-C block body.** Reject
  leading-`#` / `### ` headings and unbalanced code fences (400) or they corrupt
  `scanBlocks`/`parseRoadmap` (guarded in `handleAdd`).

## Drain / headless sessions

- **`git commit` via the foreground Bash tool hangs in a drain-spawned session.**
  In `claude --print` sessions under `noldor autonomous run`, a foreground
  `git commit` blocks past 10 min even though lefthook finishes in seconds when
  run manually — the foreground stdin pipe stalls the git → lefthook → pnpm hook
  chain. Run every `git commit` in these sessions with `run_in_background: true`
  (log to scratchpad, await the task notification).
- **Manual `pnpm noldor sync fd-resources` rewrites ~26+ drifted FDs on main.**
  Only staged FDs ride commits (via `stage_fixed`); discard the non-staged drift
  with `git checkout -- docs/features/`.

## Shell & tooling traps

- **zsh eats a bare `===` / `====`** inside a compound command (parses as the
  `==` command → "=== not found"). Quote separator strings: `echo "==="`.
- **`tsx -e` cannot top-level await** ("not supported with cjs output"). Write
  a `.mts` script file to the scratchpad and run `pnpm exec tsx <file>.mts`.
- **`lsof -ti tcp:<port>` matches CLIENT sockets too** (undici keep-alive), so
  a `kill` on its output can reap the caller itself. Filter listeners:
  `lsof -ti tcp:<port> -sTCP:LISTEN`.
- **The literal `**/` inside a JSDoc block comment closes the comment** (it
  contains `*/`) → esbuild syntax error far from the edit. Reword comments;
  glob strings in code are fine.
- **`??` misses empty arrays.** `config.scanPaths ?? fallback` keeps `[]`
  (the schema default) and skips the fallback — use
  `x?.length ? x : fallback` when empty-array means "unset".
- **`pnpm pack --pack-destination` prints an ABSOLUTE tarball path** —
  `join(dir, output)` doubles it. Guard with `isAbsolute` before joining.
- **`git checkout <sha> -- <paths>` STAGES the paths** — a later selective
  `git add` + commit silently picks them all up.
- **oxlint `--deny-warnings` rejects `new Array(n)`** (unicorn/no-new-array) —
  use `Array.from({ length: n })`.
- **Roadmap/backlog block headings are Title-Case names, not slugs** — a grep
  for the slug finds nothing, and it fails in the safe-looking direction: a
  script reading `grep -q "$slug" docs/roadmap.md` as "already shipped" skips
  every live entry with a clean exit. Use `pnpm noldor roadmap has-block
  <slug|Q-NNNN>` (exit 0 present / 1 absent / 2 error) instead of re-deriving
  the predicate; it honours the entry-ID alias. To find the block by hand,
  derive the heading from the slug or grep `ideas.md` for its
  `[triaged → <slug>]` marker.
- **`pnpm noldor <cmd> --json` is unparseable.** pnpm prints its own
  `> @scope/noldor@x.y.z noldor …` banner on **stdout**, so `JSON.parse` dies
  on `Unexpected token '>'` while the exit code stays 0 — the crash names the
  payload, not the wrapper. Call `node bin/noldor.mjs <cmd> --json` instead,
  or strip leading non-JSON lines.
- **`clones` `diffScope` push gate is independent of the ratchet.** The
  pre-push `noldor-clones` step reds on any clone group the change touches
  even when total duplicated tokens FALL below the recorded baseline —
  `clones baseline` cannot clear it, and import blocks count (two files whose
  `import` lists share ~50 tokens are a group). Fixes that work, in order of
  value: extract the shared helper the detector points at, or split a file so
  its import block drops under the floor. Perturbation (hoisting a
  conditional spread out of an object literal) is honest only for a
  coincidental token match between unrelated code. A standalone
  `pnpm noldor clones check` can also disagree with the hook on the same tree:
  the diff-scoped verdict resolves its base as "upstream if set, else
  `origin/HEAD`", so the range it judges depends on whether the branch has been
  pushed yet. Preflight with `pnpm noldor checks push-gates`, which replays the
  hook itself. Read its verdicts from the HEAD of the output, not the tail —
  the three verdicts are independent and a green line prints after a red one.
  (Q-0145, Q-0165)
- **TypeScript 7 removed the in-process JS compiler API.** The `typescript`
  package exports only `version` plus `unstable/*` (parsing there means
  spawning the tsgo API server against a real tsconfig project) — anything
  that did `ts.createSourceFile` on loose text has no in-process replacement;
  a hand-rolled scan is usually right for doc-lints. Separately,
  `dependency-cruiser` accepts `typescript >=2 <6` only, so under TS7 it
  silently extracts **zero** dependencies from a `.ts` tree — a false green,
  not an error. `@swc/core` restores its parsing; the boundaries invariant
  fails loudly via `allExtensions` when neither parser is installed. (PR #358)

## Pencil / UI design

- **"A file needs to be open in the editor" is a bridge-liveness gate, not a
  per-file lock.** `.pen` is encrypted, so pencil MCP is the only reader, and
  every call fails with that message until *some* `.pen` is open in the pen.dev
  desktop app. Once any file is open, `execute` routes to any *existing* `.pen`
  by `filePath` — including a scratch copy that was never opened. So the fix is
  to open a file, not to change the path you asked for: `pnpm noldor design
  pen-bridge` finds and opens one (exit 1 = the repo tracks no `.pen` and the
  app must author it, since Node cannot).
- **That same message also means the MCP server is pinned to the wrong app —
  and nothing distinguishes the two cases.** The server derives its socket as
  `~/.pencil/socket/pencil-<app>.sock` from its own `--app` flag, so a server
  started with `--app visual_studio_code` talks past a perfectly healthy desktop
  app forever, reporting exactly the liveness error above. `pnpm noldor checks
  pen-bridge` is what tells them apart: it names the scope and file holding the
  effective pencil entry. The flag is read once, at startup, so a fix needs a
  Claude Code restart.
- **An agent cannot start the desktop app.** A GUI launch from a tool shell
  exits 0, prints nothing, and starts nothing — sandbox on or off — while the
  same command works from the operator's terminal. Handing a file to an
  *already running* app does work from a tool shell. So `pen-bridge` reports
  that the open was *requested*, never that it succeeded; retrying the pencil
  MCP call is the only proof, and a still-dead bridge is an operator action.
- **The desktop app parks documents it authors itself under
  `~/.pencil/documents/<uuid>/`.** A file opened from a repo path stays at that
  path and is edited in place, but one created inside the app lands in its own
  library where nothing in the repo will ever commit it. Bootstrapping a repo's
  first `.pen` therefore needs an explicit **Save As** into
  `docs/design/ui/`.
- **A `filePath` that does not exist is a silent write to the open canvas, not
  an error.** Routing holds only while the file is there; otherwise the edit
  lands on whatever document the app currently has open, with no diagnostic. A
  worktree-relative path while the app held a baseline `.pen` from
  `docs/design/ui/baseline/` deleted four pages from that baseline, and the app then auto-saved the same
  session document over both the baseline and another feature's archived
  `.pen`; they came out byte-identical, and `git status` in the **main**
  workspace was the only signal — the worktree's own status stayed clean. So
  call `get_app_state` and confirm the open document IS the target before every
  write. `checks shared-files` rejects the class after the fact (baseline `.pen`
  from a worktree; any archived `.pen` modified or moved out of `archive/`;
  `NOLDOR_ALLOW_PEN_WRITE=1` waives both for the gate's one sanctioned baseline
  write-back). (Q-0187)
- **The pen.dev desktop app is the `.pen` editor, addressed by bundle id
  `dev.pencil.desktop`.** It registers `.pen` as a document type, so
  `open -g -b dev.pencil.desktop <abs path>.pen` opens that exact file — the
  older claim that it "has no scriptable open" was wrong, and the VS Code
  extension it justified is gone from this path. Spec and plan `.md` artifacts
  still open via `code`; only `.pen` moved. An unregistered bundle id exits 1
  with `LSCopyApplicationURLsForBundleIdentifier` in stderr, which is how "not
  installed" is told from "launch failed".
- **Waive the UI-design step only after a wake attempt.** A closed editor and
  an absent editor look identical from Node, and recording `uiWaiver` for the
  first one buys permanent baseline debt for a fixable five-second problem.

## Release & publish

- **A worktree regen of `docs/sdd-report.md` commits empty metrics — cosmetic
  only, no longer a release blocker.** The `cr-effectiveness`,
  `drain-reliability`, and `tokens-per-feature` blocks read local untracked
  `.noldor/` state, which a worktree sees empty. The release gate masks those
  blocks before diffing (`VOLATILE_METRIC_IDS`), so the main-workspace regen
  folds into the release commit instead of aborting. Every other metric is
  git-derived and still aborts on drift — prefer the main workspace when you
  want the committed numbers to be real.
- **CI `NPM_TOKEN` must bypass 2FA.** A Classic *Publish* token or a plain
  granular token 403s ("Two-factor authentication or granular access token
  with bypass 2fa enabled is required"). Use a Classic **Automation** token
  (or granular with 2FA bypass). A FIRST publish also needs create-package
  permission — a token scoped only to the not-yet-existing package can't
  create it.
- **Publish failed AFTER `pnpm release` tagged+pushed → re-fire the tag,
  don't re-release.** Fix on main via fast-track, then
  `git tag -f v<x> HEAD && git push -f origin v<x>` re-runs `publish.yml`
  with the fix — no second `pnpm release`, no re-hitting the graph/garden/sdd
  gates. Then `rm .noldor/release-state.json` (resume can't finalize once
  HEAD moved past the bump commit).
