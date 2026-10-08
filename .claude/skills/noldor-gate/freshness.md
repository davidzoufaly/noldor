# /noldor-gate — freshness before coding (Step 3.5)

Read on every worktree-backed path at the session's first rule brief: the one check between spec time and push time.

## Run it

```
pnpm noldor worktrees freshness --rebuild --file <path> [--file <path> …]
```

Same `--file` set as the brief; none known yet → no `--file`. It always exits 0 — acting on the verdicts is this page's job. `--rebuild` rebuilds a stale graph and restores `graphify-out/` afterwards.

## Act on the `main:` verdict

- **No `next:` line** — nothing under your files moved. Carry on.
- **`next: git rebase origin/main …`** — run `git rebase origin/main` before the first edit, then run the command once more so the graph leg reads the rebased tree. Rebase, not merge: a merge commit carries main's files into the `commit-msg` scope hooks, which reject it. Nothing is pushed yet and `pr-flow` pushes with `--force-with-lease`.
- **The rebase conflicts** — `git rebase --abort`, name the conflicting files, and ask the operator whether to resolve now or at push.
- **`main: unknown`** — the fetch failed. Say so and carry on; `pr-flow` fetches again.

## Act on the `graph:` verdict

`fresh` / `rebuilt-fresh` — read the digest for your files. Any other verdict — carry on; the reason line says why. A `warning:` line means the `graphify-out/` restore failed: check `git status graphify-out/` before the first commit.
