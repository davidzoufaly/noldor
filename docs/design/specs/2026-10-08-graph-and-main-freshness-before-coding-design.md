# Graph and Main Freshness Before Coding — Design

**Slug:** graph-and-main-freshness-before-coding
**FD:** docs/features/graph-and-main-freshness-before-coding.md
**Date:** 2026-10-08
**Tier:** specs-only

## Problem

A spec/full session checks the knowledge graph once — `noldor-spec` step 1.7 runs `pnpm noldor design graph-context`, rebuilds on `stale`, then restores `graphify-out/` — and never again. A long session (spec → several review rounds → code) then plans and codes against whatever the graph and `origin/main` looked like at spec time. Worktrees are cut from a freshly fetched `origin/main` (`resolveBase` in `src/worktrees/create-worktree.ts`), and `pr-flow` fetches at the very end (`src/core/pr-flow.ts`), but nothing fetches in between. Merges from other sessions surface only as a conflict at push, after the code is written.

## Goals

- One command, run at gate Step 3.5 before the first edit, that answers two questions: is the graph still fresh for the files I am about to touch, and has `origin/main` moved under me — and does any of that movement touch those files?
- Never block a session. Every answer is advisory; a failed fetch or a missing graph is a reported state, not an error.
- Leave the worktree as it found it: a graph rebuild done for the read is restored afterwards, never committed.

## Non-goals

- The command merging anything itself. It reports; the gate prose tells the agent when to merge.
- Re-checking during implementation or before the code-stage CR. `pr-flow` already fetches `origin/main` at delivery; one check at the start of coding closes the long spec-review gap.
- Changing how CI refreshes the graph (`update-knowledge-graph` workflow).
- Rewriting `noldor-spec` step 1.7 to call the new command. It could — the rebuild-and-restore recipe is the same — but that is a separate skill edit; a follow-up, not this session.

## Design

### Structural context

Digest from `pnpm noldor design graph-context` (status `fresh`):

- `src/design/graph-context.ts` sits in community c46 with `src/release/graph-freshness.ts`; no god nodes; cross-community edges out to `repo-paths.ts` (`scanRoots`), `doc-roots.ts`, `fd-load.ts`, `graph-fd-lookup.ts`, `branch-added.ts`. The new unit reuses it as a library, so it adds one more inbound edge to c46.
- `src/rules/cli-brief.ts` is in c17 (rules-cascade-v1, 10 files), interior apart from `cli-entry.ts` and `session.ts`. This design does **not** edit it — the new check is its own command, so c17 stays untouched.
- `src/worktrees/worktree-status.ts` and `create-worktree.ts` share c10 (worktree tooling). `gatherStats` already computes ahead/behind against local `main`; the new unit needs the same count against a freshly fetched `origin/main`, so it lands next to them.

No file here defines a god node; all four are interior or near-interior.

UI verdict: skip — no `uiPaths` match; this is a CLI + skill-prose change.

Architecture verdict: skip — no new directory, package or external; one new import edge from the worktree tooling to `src/design/graph-context.ts`.

### Unit 1 — `freshness` core (`src/worktrees/code-freshness.ts`)

`codeFreshness({ cwd, files, rebuild, runGit })` returns two independent legs:

- **graph** — calls `graphContext({ cwd, paths: files })`. On `stale` with `rebuild: true`: confirm `git status --porcelain -- graphify-out/` is empty, run `pnpm noldor graphify build`, re-run `graphContext` once, then restore `graphify-out/` (`git restore --source=HEAD --staged --worktree -- graphify-out/ && git clean -fdq -- graphify-out/`) — the same recipe `noldor-spec` step 1.7 uses as prose today. A dirty `graphify-out/` skips the rebuild and says so. Result: `skipped | fresh | stale | rebuilt-fresh | rebuilt-stale`, plus the digests when fresh.
- **main** — `git fetch -q origin main`, then `git rev-list --count HEAD..origin/main` for "main moved N commits since this branch's base", and `git log --name-only HEAD..origin/main -- <files>` for which of those commits touch the given files. Commits whose only changes are under `graphify-out/` (the self-merging graph-refresh PR) are counted separately, since they are noise for this question. Fetch failure → `unknown` with the reason.

It lives in `src/worktrees/`, next to `gatherStats`: the main leg is the new code, and the graph leg is one call into `src/design/graph-context.ts`. Both legs take a `runGit` seam (the `RunGit` type from `src/core/branch-added.ts`) and a `runBuild` seam for the graph rebuild, so tests never fetch or spawn Python.

### Unit 2 — CLI `pnpm noldor worktrees freshness --file <p>... [--rebuild] [--json]`

Thin wrapper, `runIfDirect` like its siblings. Prints the graph verdict + digests, then the main line, then one remedy line when commits touch the files (`git merge origin/main` before the first edit). Exit 0 for every verdict, 2 for usage errors. Registered in the CLI manifest, so the capability index and script catalog regenerate.

### Unit 3 — gate Step 3.5 prose

`.claude/skills/noldor-gate/SKILL.md` Step 3.5 gains a paragraph: on the **first** brief of the session, also run `pnpm noldor worktrees freshness --rebuild` with the same `--file` set. The command only reports; acting on it is the agent's job:

- **No commits touch the files** (including the common case where `origin/main` moved only by graph-refresh commits) → carry on; nothing to do.
- **Commits touch the files** → run `git merge origin/main` before the first edit, so the code is written on top of what is actually there. A clean merge is the whole step.
- **The merge conflicts** → `git merge --abort`, leaving the branch as it was. Interactive: surface the conflicting files and ask the operator whether to resolve now or code first and resolve at push. Drain: log it and carry on — the conflict resurfaces at `pr-flow`, where the existing push-time handling already applies, and parking a drain child over a conflict it may never hit would cost more than it saves.

`docs/noldor/drain-mode.md` "Rule brief before editing" gets the same three bullets in its headless form. Drain children are fast-track and cut seconds earlier from a fresh `origin/main`, so for them the main leg is nearly always a no-op; it is there for the long-running child.

## Acceptance criteria

1. `worktrees freshness --file <p>` exits 0 and prints a graph verdict and a main verdict, for every combination of graph state and fetch result.
2. With a stale graph and `--rebuild`, the graph is rebuilt, re-read once, and `git status --porcelain -- graphify-out/` is empty afterwards.
3. With `graphify-out/` already dirty, `--rebuild` does not rebuild and does not touch `graphify-out/`, and says why.
4. When `origin/main` has commits not in `HEAD`, the count is reported; commits touching a given `--file` are listed by short sha.
5. Commits that only touch `graphify-out/` are counted apart from the rest.
6. A failed fetch reports the main leg as unknown and still exits 0.
7. With no graph tracked, the graph leg reports skipped and the main leg still runs.
8. Gate Step 3.5 and drain mode name the command, the merge-on-overlap rule and the abort-on-conflict rule.
9. The command appears in the capability index and the script catalog.

## Risks / trade-offs

- **Fetch latency** at the first edit (~1 s, more offline). Acceptable once per session.
- **Rebuild cost** ~15 s plus a Python dependency; skipped cleanly when unavailable.
- **Notice fatigue**: the graph-refresh PR makes `origin/main` move after almost every merge. Splitting graph-only commits out keeps the signal readable.
- **Prose-only trigger**: an agent can skip Step 3.5. The code-stage CR and `pr-flow` remain the backstop.

## User Story

As an agent (or operator) about to write the first line of code in a long spec session, I want one command that tells me whether the graph is still fresh for my files and whether `origin/main` has moved under them, so that I merge before coding instead of discovering the drift as a conflict at push.

## Usage

```sh
pnpm noldor worktrees freshness --file src/foo.ts --file src/bar.ts --rebuild
```

Run by gate Step 3.5 alongside `pnpm noldor rules brief` on the session's first edit. `--json` for scripts.

## Open questions (resolved)

1. _Separate command, or fold into `rules brief`?_ -> Separate command. `rules brief` re-runs per file family; fetching and rebuilding each time would be slow, and it keeps c17 untouched. (D1)
2. _Also re-check before the code-stage CR?_ -> No. `pr-flow` already fetches; one check at first edit is the cheap high-value point. (D2)
3. _Who merges `origin/main` when commits overlap?_ -> The agent, following gate prose; the command itself only reports. A conflicting merge is aborted, then the operator decides (drain: logs and carries on). (D3)
4. _Where does the core live?_ -> `src/worktrees/`, next to `gatherStats`. (D4)
