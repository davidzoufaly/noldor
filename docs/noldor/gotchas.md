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
  for the slug finds nothing. Derive the heading from the slug or grep
  `ideas.md` for its `[triaged → <slug>]` marker.

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
