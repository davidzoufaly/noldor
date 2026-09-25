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
- **A Claude Code `@path` import resolves against the directory of the file that
  holds it, not the repo root.** So `.claude/CLAUDE.md` reaches the root rules
  file with `@../AGENTS.md`, while `@AGENTS.md` there names `.claude/AGENTS.md`.
  A wrong import fails silently: the file simply never loads. The Q-0252 spec got
  this wrong for both CLAUDE files and passed three review rounds; implementation
  caught it only by re-reading
  code.claude.com/docs/en/memory.md#import-additional-files. Check every `@path`
  against the importing file's own directory. (PR #535)
- **The first `// @fd:` tag an FD gains drops its hand-kept `links.code`.**
  `pnpm noldor sync code-links` keeps an FD's hand-written list only while none
  of its files carries a tag; after that it projects from tags alone and drops
  every untagged file. Tagging a new seeder `// @fd: sdd-co-tag-detector` made the
  sync drop `src/garden/graph-fd-lookup.ts`. When a change adds an FD's first tag,
  tag the files it already lists in the same change, after checking no other FD
  lists them. Mirror of the `test-links` trap under Tests. (PR #542)

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
- **Tagging one test with an FD drops that FD's untagged test links.** `sync
  test-links` keeps an FD's hand-written `links.tests` only while no test file
  names the FD in its `// @tests:` header. The first tag switches the FD to
  tag-derived links, and every untagged entry falls off. When a change tags a
  test with an FD, tag every test that FD already lists. A `sync code-links` in
  the same session can also rewrite an unrelated FD — `git checkout` any FD the
  change did not mean to touch. (Q-0260)
- **The pre-commit `test-links` job writes the FD but does not stage it.** Its
  `stage_fixed: true` re-adds only the staged files its glob matched
  (`**/*.test.ts`), so the `links.tests` it writes into
  `docs/features/<slug>.md` stays unstaged, and right after the first commit that
  adds tagged tests the FD shows as modified. Commit it on its own
  (`docs(features:<slug>): link the tests`) before the phase flip, or the flip
  commit silently carries it. (PR #535)
- **vitest 3.2.4's JSON reporter never says "timed out".** A timed-out test's
  `failureMessages[0]` starts `Error: STACK_TRACE_ERROR` from `@vitest/runner`'s
  `chunk-hooks.js`: the error is built when the test is defined (to capture its
  location), only its message is rewritten when the timer fires, and the reporter
  prints the stack. So grepping a JSON report for "timed out" finds zero timeouts
  in a run full of them — grep `STACK_TRACE_ERROR` instead. A test that timed out
  inside synchronous work (`execSync`) also reports a duration ABOVE its bound
  (14.5s against 10s), because vitest cannot interrupt it. (Q-0238)

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
- **`src/dashboard/static/dist/*.js` are tracked build artifacts that nothing in
  `bin/build.mjs` regenerates and no test diffs against their `.ts` source.** The
  recipe that reproduces the tracked bytes exactly is
  `node_modules/.bin/tsc -p src/dashboard/static/tsconfig.json` followed by
  `node_modules/.bin/oxfmt src/dashboard/static/dist/drag.js src/dashboard/static/dist/agents.js`
  — tsc alone emits 4-space output and diffs everywhere. A browser-side change
  that skips the fmt step lands a 400-line whitespace diff; one that skips both
  ships stale JS while the `.ts` reads fixed, with nothing red. (See the
  `drag.ts` recompile bullet above for why the pre-commit fmt step then rewrites
  what tsc emitted.)
- **`src/dashboard/layout.ts` `STYLE` is a JS template literal, so a backtick
  anywhere in a CSS comment ends the string.** oxlint reports
  `Expected a semicolon or an implicit semicolon` at the backtick's column and
  every dashboard test file fails to import — neither message says "template
  literal". Write class names in CSS comments bare. (Q-0231)
- **A JS-revealed control "missing" on a consumer is usually a stale-install
  zombie, not CSS.** Q-0231 reported the description Show-more control absent;
  the consumer's dashboard process predated its noldor install, so pages rendered
  from memory while `/static/drag.js` 500'd — the inline CSS clamped every
  description and the JS that reveals the control never ran. Restarting the
  process showed 45/45 controls. Before debugging CSS, compare the server's start
  time to the install date:
  `ps -o lstart= -p $(lsof -ti tcp:<port> -sTCP:LISTEN)`. (Q-0231; PR #482 then
  made the clamp opt-in so a missing script can no longer trap content.)
- **Browser-level verification of a dashboard change is doable headless from a
  drain child.** noldor ships no playwright, but a consumer's `node_modules` has
  one; the probe script must sit under a `node_modules/.cache/` dir (or import by
  absolute path) for resolution to work. `PORT=<n> pnpm noldor dashboard server`
  run from a worktree serves *that worktree's* `src/`,
  `page.route('**/static/drag.js', r => r.abort())` reproduces the zombie above in
  one line, and `chromium.launch({ channel: 'chrome' })` drives the operator's
  real installed Chrome. (Q-0231)

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
- **A background `git commit -F <file>` can exit 1 with zero output, and the
  identical retry passes.** Seen once (2026-09-19): the files stayed staged,
  nothing was lost, and a hand-run `pnpm exec lefthook run pre-commit` was green
  in between. Cause unknown. Check `git log` and `git status` *before* debugging
  a silent commit failure — the cheap retry is right more often than the
  investigation.

## Shell & tooling traps

- **`pnpm noldor <cmd>` reports every failure as exit 1.** pnpm flattens a
  script's non-zero exit, so `split-check`'s 2 (signals), `cr autofix plan`'s
  10 / 11 and `cr orchestrate`'s 3 / 4 all read as 1 — the "infra error"
  branch. The CLI restates any code of 2 or higher on stderr as
  `noldor: exit code <n>` when a package script runs it; branch on that line.
  Running `node bin/noldor.mjs …` directly keeps the real status (self-host
  only — a consumer's install has no `bin/` at the root).
- **`pnpm noldor <cmd>` exits 137 with zero output when one argument is long.**
  An endpoint agent (seen on SentinelOne/Kandji macOS) SIGKILLs any
  `node <script>` given a single argument of 935+ characters, before any JS
  runs — so a multi-paragraph `pnpm noldor commit -m "<body>"` dies silently and
  looks like a hook failure. Pass long text through a file or stdin instead
  (`pnpm noldor commit -F <file>` / `-F -`). Reproduce:
  `node <any>.mjs "$(printf 'x%.0s' {1..935})"; echo $?`. See
  [git-and-commits.md](git-and-commits.md#piped-commits-mask-hook-failures).
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
- **An unquoted `--include=*.ts` aborts the command before it runs.** zsh
  globs the flag's *value* against the cwd, and `grep -rn foo src
  --include=*.ts` dies with `zsh: no matches found: --include=*.ts` — the
  whole line fails, grep never executes, and the failure reads like a broken
  search rather than a quoting bug. Always `--include='*.ts'`. Same class as
  the `$var` word-splitting trap.
- **`pnpm` re-expands every argument through `sh`, so a backtick in a CLI
  argument runs as a command.** `pnpm noldor design log --confirm-section
  'Unit 1 — `isEntrypoint` in `src/core/cli-entry.ts`'` prints
  `sh: isEntrypoint: command not found` / `sh: src/core/cli-entry.ts:
  Permission denied`, and the CLI then receives the heading with both code
  spans **deleted** (`'Unit 1 —  in '`) — which it correctly refuses. Single
  quotes do not help: pnpm hands script arguments to `sh -c` inside double
  quotes, so the expansion happens in pnpm's own shell, after the outer shell is
  done. It hits any `pnpm noldor` argument containing backticks, and spec H3
  headings are full of inline code, so `design context --section` and
  `design log --confirm-section` were the routine casualties. Both now take a
  heading's number (the `heading N/M` position in the checklist) or a
  backtick-free prefix of its name — `--section 3` or `--section 'Unit 1 —
  isEntrypoint'` — so name the heading that way. For any other argument, call
  `node bin/noldor.mjs …` directly when a backtick is unavoidable. (Q-0261,
  Q-0283)
- **Piping ANY exit-code-bearing noldor command to `tail` reports `tail`'s
  status.** `cr aggregate … | tail -20` then `echo $?` prints `0` over text that
  says `ok=false` — during Q-0246 that turned a genuine red round into an
  apparent green one. `PIPESTATUS` is empty in this shell, so it cannot rescue
  the pipe either. The only reliable shape is redirect-then-cat:
  `cmd > /tmp/out 2>&1; echo "EXIT:$?"; cat /tmp/out`. Same class as the
  `git commit | tail` trap in
  [`git-and-commits.md`](git-and-commits.md) — that one has a purpose-built
  escape (`pnpm noldor commit`); every other command does not. (Q-0246)
- **One import added to a hub module moves the indirection ratchet once per
  importer.** `src/cr/findings-schema.ts` sits in the closure of 31 modules
  above the threshold, so a single new edge from it to a leaf moved the ratchet
  983 → 1014. Putting the new enum beside `FINDING_CLASSES` in
  `src/cr/finding-class.ts`, which the hub already imports, brought it back to
  +3. Before re-recording a large jump, diff `node bin/noldor.mjs indirection
  report --json` per module against `main`: a uniform +1 across many modules
  points at one new edge from a hub. The reverse move is not free either:
  extracting a function from a hub into its own leaf can RAISE the number,
  because every module that imports the hub then counts the leaf too. Q-0252
  pulled `loadAgentsConfig` out of `agent-runner/registry.ts` for +16; the same
  function in its own leaf measured +53. Measure the alternative before
  extracting to lower the ratchet; if the edge is the price of the change,
  re-record the baseline as its own `chore(indirection)` commit. (Q-0263,
  PR #535)
- **A `Co-Authored-By` paragraph after the `Noldor-*` trailers hides them, and
  the rejection names the wrong cause.** git reads trailers from the message's
  last paragraph only. A blank line between `Noldor-Phase-Revert: 1` and
  `Co-Authored-By:` left the phase-revert trailer invisible, and
  `noldor-validate-trailer` refused with "specs-only-attach requires a spec file
  at …" — the very check that trailer bypasses. Put every trailer in one final
  paragraph; `git interpret-trailers --parse < msg` shows what git sees.
  (Q-0261)

## Pencil / UI design

- **"A file needs to be open in the editor" is a bridge-liveness gate, not a
  per-file lock.** Pencil MCP is the write API, and every call fails with that
  message until *some* `.pen` is open in VS Code. Once any file is open,
  `execute` routes to any *existing* `.pen` by `filePath` — including a scratch
  copy that was never opened. So the fix is to open a file, not to change the
  path you asked for: `pnpm noldor design pen-bridge` finds and opens one
  (exit 1 = the repo tracks no `.pen` and the editor must author one; exit 3 =
  the pen.dev extension is not installed).
- **That same message also means the MCP server is pinned to the wrong editor —
  and nothing distinguishes the two cases.** The server derives its socket as
  `~/.pencil/socket/pencil-<app>.sock` from its own `--app` flag, so a server
  started with `--app desktop` talks past a perfectly healthy VS Code forever,
  reporting exactly the liveness error above. Both sockets can be live at once
  (`pencil-desktop.sock` and `pencil-visual_studio_code.sock` were both listening
  on this machine on 2026-09-04), which is why the wrong pin fails silently
  rather than loudly. `pnpm noldor checks pen-bridge` is what tells the cases
  apart: it names the scope and file holding the effective pencil entry, and the
  expected value is `visual_studio_code`. The flag is read once, at startup, so
  a fix needs a Claude Code restart.
- **The pencil MCP server does not connect under the Claude Code VS Code
  extension.** Same `~/.claude.json`, same `--app` pin, same installed
  editor: from a terminal `claude` the server connects, and under the extension it
  reports `CONNECTION_CLOSED` at session start and none of its tools exist for
  the rest of the session. This failure looks nothing like the other two — there
  is no `A file needs to be open in the editor` to match on, because there is no
  tool to call — so a session hunting the bridge-liveness recipe finds nothing
  wrong and waives the UI-design step. `pnpm noldor checks pen-bridge` leads with
  the harness row for exactly this reason: it reads `CLAUDE_CODE_ENTRYPOINT`
  (`cli` = terminal, `claude-vscode` = the extension; the variable survives into
  spawned processes, so the check sees the harness that would make the call). No
  configuration edit helps — do `.pen` work from terminal Claude Code, or hand
  the step to the operator. An entrypoint nobody has measured reads as
  indeterminate, never as a finding. **This is the bug that once justified moving
  `.pen` to the desktop app** — the blame landed on the pen.dev VS Code extension
  when the harness was at fault, and no choice of `.pen` editor could ever have
  fixed it. (found 2026-09-04)
- **A `.pen` is plain, unencrypted UTF-8 JSON.** Every `.pen` in the charuy
  consumer parses with `JSON.parse` across three format versions (2.13, 2.14,
  2.17), top-level keys `version, children, variables, fileToken`. The framework
  claimed the opposite for months — "encrypted, so pencil MCP is the only
  reader" — and that false premise is load-bearing in places that have not all
  been revisited yet (the CR lane prompts still tell agents never to open one
  with a file-reading tool). The consequence you *will* hit: with no editor
  association VS Code renders the design as text, because there is no binary
  guard to stop it. `noldor init` seeds
  `workbench.editorAssociations: {"*.pen": "pencil.designEditor"}` for exactly
  that reason, merging into a consumer's existing `.vscode/settings.json` rather
  than replacing it. (found 2026-09-04)
- **A launch is not an open.** Handing a file to an already-running editor works
  from a tool shell, but nothing reachable from a tool shell can confirm a canvas
  came up. So `pen-bridge` reports that the open was *requested*, never that it
  succeeded; retrying the pencil MCP call is the only proof.
- **A `filePath` that does not exist is a silent write to the open canvas, not
  an error.** Routing holds only while the file is there; otherwise the edit
  lands on whatever document the editor currently has open, with no diagnostic. A
  worktree-relative path while the app held a baseline `.pen` from
  `docs/design/ui/baseline/` deleted four pages from that baseline, and the editor then auto-saved the same
  session document over both the baseline and another feature's archived
  `.pen`; they came out byte-identical, and `git status` in the **main**
  workspace was the only signal — the worktree's own status stayed clean. So
  call `get_app_state` and confirm the open document IS the target before every
  write. `checks shared-files` rejects the class after the fact (baseline `.pen`
  from a worktree; any archived `.pen` modified or moved out of `archive/`;
  `NOLDOR_ALLOW_PEN_WRITE=1` waives both for the gate's one sanctioned baseline
  write-back). (Q-0187)
- **VS Code is the `.pen` editor, via the pen.dev extension
  `highagency.pencildev` (custom editor `pencil.designEditor`).** One editor for
  everything: `.pen` designs and `.md` artifacts both go through
  `openInEditor`, and `checks pen-bridge` expects `--app visual_studio_code`.
  `.pen` briefly moved to the pen.dev desktop app (`dev.pencil.desktop`) and came
  back — see the Claude Code harness bullet above for why the move was
  misdiagnosed. The desktop app is gone from this path rather than kept as a
  fallback: two editors mean two sockets, and a file open in one while the server
  is pinned to the other is a permanently dead bridge with no error naming the
  cause. `pen-bridge` therefore checks `code --list-extensions` for the extension
  *before* launching — without it VS Code opens the `.pen` in the text editor and
  shows raw JSON, a launch that looks fine and wakes nothing (exit 3).
- **Waive the UI-design step only after a wake attempt.** A closed editor and
  an absent editor look identical from Node, and recording `uiWaiver` for the
  first one buys permanent baseline debt for a fixable five-second problem.
- **Exactly ONE VS Code window owns the pencil socket, and a `.pen` open in any
  other window is invisible to the MCP.** `~/.pencil/socket/pencil-<app>.sock`
  is a single global file; one extension host holds the listener. The server
  asks *that* window, which truthfully answers `A file needs to be open in the
  editor` — true from where it stands, and maximally misleading to an operator
  looking straight at a rendered canvas in a different window. The misdirection
  is total: a direct stdio probe of the server binary returns the same error, so
  the usual triage step ("probe the binary to tell a broken bridge from a broken
  Claude Code connection") reports a healthy bridge as broken. `design
  pen-bridge` cannot help — it exits 0 printing `open requested`, and its
  `code -r` reuses the LAST-ACTIVE window, which is usually not the owner. With
  several windows open, find the owner before anything else:
  `lsof -U | grep pencil` names the listening pid. One session was lost to this
  with six windows open (2026-09-16). Two adjacent papercuts ride along:
  `checks pen-bridge` calls a `visual_studio_code` pin an ERROR and tells you to
  set `--app desktop` — wrong advice for a working VS Code setup, already
  documented above as "do not follow it"; and the extension rewrites the MCP
  server binary on self-update, killing an already-connected stdio server so the
  tools vanish mid-session with no diagnostic.
- **The pen.dev desktop app does not persist `.pen` edits and discards them
  silently on close.** With the VS Code socket unreachable, driving
  `--app desktop` succeeds for every read and write — 8 states drawn,
  `get_app_state` and `Get` confirming all of them — and the file on disk never
  changes. Closing the window drops the lot: same mtime, same
  `git hash-object`, no warning anywhere. The VS Code bridge, by contrast, wrote
  the equivalent edits to disk twice unprompted within ~2 minutes. Treat the
  desktop app as read-only in practice and route every `.pen` write through the
  VS Code bridge — "the MCP call succeeded" is not evidence the work exists.
  (Q-0275)
- **The `.pen` seed names the baseline unconditionally, and a stale baseline
  designs onto a surface that no longer exists.** `noldor-spec` step 1.5 says
  `cp docs/design/ui/baseline/<surface>.pen docs/design/ui/<date>-<key>.pen`; the
  skill branches on "empty/missing baseline" and has no branch for "stale".
  Shipping Q-0275 that baseline was six days old and still held the horizontal
  bar a dep had replaced with a vertical rail the day before, so the seeded
  file's `BASE:` pages showed a surface the feature attaches to and that does not
  exist. The right source was the dep's own `FINAL:` `.pen`. The framework
  already knows — `pnpm noldor checks ui-design-freshness` reports the surface
  stale — so run it before seeding, and when it is stale seed from the newest
  `FINAL:` `.pen` of an FD named in `deps:` instead. (Q-0275)
- **Reseeding a `.pen` path the editor already has open is invisible to the
  editor and one save from destroying the new file.** The seed is a filesystem
  `cp`, but the canvas is a buffer: after `cp`-ing a corrected source over a
  seeded path, `get_app_state` still reported the *old* document's pages, and any
  save from that window would have written 1.9 MB of the wrong content back over
  the 608 KB that was right. Recovery needs a human
  `Developer: Reload Window`, which then kills Claude Code's pencil MCP link and
  costs a `/mcp` reconnect. Seed to a path the editor has never buffered, or
  close the file first — a fresh path loads from disk correctly. (Q-0275)
- **Diagnose a failing capture diff from the two PNGs, not from the component
  tree.** Charuy's Q-0278 was scoped as "glass over the WebGL canvas" and the
  first fix hid the wrong layer; one look at the live and re-rendered images
  showed the thing behind the glass was a blurred gallery, and that the glass
  layer is a child of the dialog root. Whenever a fidelity diff fails, write
  both PNGs to a scratch dir and look before theorising. (charuy Q-0278)
- **An architecture arrow is a loose path, not a connector.** pen.dev has no
  sticky arrows, so dragging a box leaves its arrows where they were — and
  `checks arch-baseline` stays green, because it reads layer names, not
  geometry. After moving boxes run `pnpm -s noldor design arch-route --pen
  <path> --view <view>` and pass its stdout to pencil `execute`. Save first
  when you drew a new arrow: the matching reads the file on disk.
  (architecture-design-phase)
- **On an architecture canvas the layer name is the contract, not the label.**
  A module box means its layer name (`src/cr`), an arrow its `<from> -> <to>`
  name; the text inside a box is decoration. Renaming the label without the
  layer changes nothing the check sees, a typo in the layer name surfaces as
  `unknown-module` or `dangling-edge`, and a duplicated box keeps its
  original's name — `duplicate-module` until the copy is renamed.
  (architecture-design-phase)
- **Pasted mermaid SVG is not an architecture baseline.** pen.dev turns pasted
  SVG into editable nodes but drops arrow tips (`<marker>`) and HTML labels
  (`foreignObject`), and every pasted box arrives unnamed, so the check sees
  none of it. Emit the `.pen` from data with the names set as each node is
  created, as this repo's baseline was. (architecture-design-phase)

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
- **A green `--preflight` does not survive the clock: the `sdd-report` gate can
  red minutes later on a line nothing touched.** The report's override-record
  list is filtered by a **30-day rolling window**, so a commit can age out of it
  mid-sweep and re-drift the file. v1.10.0 aborted exactly this way. The
  release-sweep's step 5.5 / 6.5 pre-empts cannot help — they re-run the regen at
  a point in time, and any later clock-derived line drifts again before
  `pnpm release` reaches its own gate. The adjacent `Review-skip count` line *is*
  masked (`VOLATILE_METRIC_IDS`, `src/garden/sdd-report-format.ts`), but the
  override-record bullets it sits under are not, so only the bullets block. Cost
  when it fires: one micro-chore PR to commit the aged regen, then a second
  `pnpm release` run. (#469; the masking gap is still open.)
- **A registry-visibility timeout is not a failed publish — `--resume`, don't
  re-release.** v1.10.0 and v1.13.0 both published cleanly (`+ @david.zoufaly/noldor@…`,
  signed provenance, workflow green in under a minute) and the release still
  aborted on the wait. The cause was caching: the registry serves the packument
  with `max-age=300`, and the preflight's `npm view` had cached the pre-publish
  copy, so a plain `npm view` kept reading E404 for the whole 300s wait. The wait
  now polls with `--prefer-online` and gives up after 11 minutes (above two cache
  lifetimes). If it still times out, `pnpm release --resume` finishes the
  release. Check the workflow and the registry before treating the abort as a
  publish failure.
