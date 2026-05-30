---
noldor-page: worktree-discipline
introduced: 0.4.0
---

# Worktree Discipline

## Commands

| Trigger                                             | What it does                                                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `git worktree add .worktrees/<name> -b feat/<name>` | Create a new worktree from main. Run from main.                                                             |
| `pnpm noldor worktrees status`                      | Print per-tree table (path, branch, port, ahead/behind, dirty, last commit). Warn on cap / drift / overlap. |
| `pnpm noldor worktrees launch`                      | Spawn one iTerm2 window per non-main worktree, each running `claude` with the launch-prompt template.       |
| `git worktree remove [--force] .worktrees/<name>`   | Remove a worktree after merge. Pair with `git branch -d feat/<name>`.                                       |
| `CHARUY_ALLOW_SHARED=1 git commit ...`              | Override `check:shared-files` block when intentionally editing a shared root file from a worktree.          |

**Finish sequence (autonomous, no prompt):** tests pass → fast-forward into `main` → `git push origin main` → `git worktree remove` → `git branch -d`.

## Always work in a worktree

- **[`/gate`](../../.claude/skills/gate/SKILL.md) is the canonical worktree entry for paths 2–6** — it creates the worktree and sets the session marker in one step. `micro-chore` (path 1) is the documented exception: no worktree is needed because the diff scope is restricted to the allowlist, and the pre-commit hook validates it.
- **Always work in a worktree** — `git worktree add .worktrees/<name> -b feat/<name>` from main before any implementation (or just run `/gate`). Worktrees over plain feature branches: enables parallel development on multiple features without branch-switching friction or stash juggling. `.worktrees/` is gitignored. Never commit implementation directly to main. Spec/plan commits on main are fine; only implementation goes on the worktree branch

## Exceptions

The "always work in a worktree" rule has exactly one named exception:

### `release-sweep` carve-out

The `release-sweep` gate path operates directly on the `main` workspace from a temporary `release-sweep/<ts>` branch — no worktree.

**Rationale.** Sweep operates against the release-time view of `main` itself: `/graphify` reads main's tip for the dependency snapshot, `pnpm docs:build` regenerates typedoc against the current source tree, `pnpm noldor garden sdd-report --release` reads main's commit history for the release-range. A worktree's base ref would falsify all three.

**Boundary.** Every other gate path (`fast-track`, `specs-only-*`, `full-*`, `micro-chore`) stays under the worktree rule above. The carve-out is enforced narrowly by the `release-sweep` allowlist (`RELEASE_SWEEP_GLOBS` in `scripts/noldor/allowlist.ts`) — sweep cannot launder a source-code edit by piggy-backing on a graphify regen.

See [release-sweep-process-hardening](../features/release-sweep-process-hardening.md) for the underlying FD.

## Parallel worktrees — multiple features concurrently

- **Parallel worktrees** — multiple worktrees can run concurrently for independent features.
  - **Cap 3 active feature worktrees.** More = context thrash; warning surfaced by `pnpm noldor worktrees status`
  - **Pick disjoint graphify communities.** Before starting a parallel feature, check `graph.brainstorm-summary.toon` and pick a community that isn't already touched by another active worktree
  - **Port-per-tree.** `apps/web` Vite dev server reads `PORT` from `.env.local` at the worktree root. Don't set manually — `pnpm noldor worktrees status` auto-assigns from `5174-5179` (main holds Vite default `5173`)
  - **Daily rebase on main.** Drift compounds. Status script flags trees `>=12` commits behind main
  - **Merge order = ship order.** First worktree finished merges first; later ones rebase. No "save the big one for last"
  - **Shared root files → main worktree only.** Pre-commit blocks edits to `CLAUDE.md`, `.claude/engineering-rules.md`, `package.json`, `pnpm-lock.yaml`, `.claude/skills/**`, `.claude/commands/**` from inside `.worktrees/`. Override: `CHARUY_ALLOW_SHARED=1`
  - **Run `pnpm install` once per fresh worktree.** A new worktree has no `node_modules`, so `pnpm exec lefthook`, `pnpm test:scripts`, `pnpm vitest`, etc. fail with `command not found` until install runs. `pnpm install` from inside the worktree populates its own `node_modules` and re-installs lefthook hooks via `postinstall`. Hoisting is stable across worktrees in current pnpm; the prior "main-only" rule was a defensive carry-over and silently bypassed lefthook on early commits (`Can't find lefthook in PATH`). [`/gate`](../../.claude/skills/gate/SKILL.md) and the `superpowers:using-git-worktrees` skill it invokes already run the install as part of Step 3 (Project Setup) — running `/gate` is the cleanest path. Skip the install only when restoring an existing worktree (`node_modules` already present)
  - **`pnpm noldor worktrees status`** — run from any tree. Prints table (path, branch, port, ahead/behind, dirty, last commit), warns on cap, drift, stale dirty changes, file overlap across trees
  - **Parallel feature dev = one Claude Code terminal per worktree, NOT subagents.** Use `pnpm noldor worktrees launch` to auto-spawn one iTerm2 window per non-main worktree, each running `claude` with the templated initial prompt from `.claude/launch-prompt.md` (substitutes `{{slug}}` / `{{branch}}` / `{{path}}`). The template tells each fresh session to read its feature MD and run `/brainstorm <slug>`. Never spawn parallel `Agent` calls to brainstorm or write specs across features — subagents can't dialogue with the user mid-flow, so they guess intent and produce shallow specs. `superpowers:subagent-driven-development` is for _executing_ an already-written plan with independent tasks inside one tree, not for the upstream design phases

## Parallel worktrees are for unrelated features, not stages of one

- **Don't fragment a single feature across "parallel streams" of worktrees.** When a spec tries to parallelise one feature into Stream A / Stream B trees, the streams almost always have data dependencies (e.g. Stream B's tests typecheck against Stream A's schema). Once those dependencies fire, the streams serialise — only the tail of A overlaps with the head of B, often a 15-min window on a 60-min feature. Cost of revising the plan + orchestrating two windows + handling rebase-on-main on each tree usually exceeds the savings. Write a single-stream sequential plan instead.
- **`pnpm noldor worktrees launch` is the right tool when developing 2-3 unrelated features simultaneously** — different graphify communities, no shared schema/skill changes. If a "parallel-execution plan" section appears in a spec for a single feature, sanity-check at plan-writing time: are the streams actually independent end-to-end, or do they merge-gate each other? If gated, propose collapsing to sequential.

## Finishing a worktree

- **Finishing a worktree** — once tests pass, run the full sequence without asking: fast-forward merge into `main` → `git push origin main` → `git worktree remove [--force] .worktrees/<name>` → `git branch -d feat/<name>`. Skip the 4-option menu. Don't ask first — the user prefers autonomous finish; verify tests as the gate, not a prompt
