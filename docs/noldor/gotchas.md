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

## Dashboard

- **Editing `src/dashboard/static/drag.ts` needs a manual recompile + fmt.**
  Recompile via `pnpm exec tsc -p src/dashboard/static/tsconfig.json` and commit
  the regenerated git-tracked `static/dist/drag.js`. `.oxfmtrc.json`
  `ignorePatterns:["dist/**"]` does NOT match the nested
  `src/dashboard/static/dist/`, so bulk `pnpm fmt` skips it but the lefthook
  pre-commit fmt step (explicit staged-file list) rejects the tsc output — run
  `pnpm exec oxfmt src/dashboard/static/dist/drag.js` before commit.
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
