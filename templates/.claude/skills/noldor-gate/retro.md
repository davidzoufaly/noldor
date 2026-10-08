# /noldor-gate — session retro (Step 4.12)

Every path, after Step 4.11's cleanup, before Step 5. Nothing here names the next roadmap entry.

## Collect

- **Follow-ups** — found and not done: verifier notes, deferred or unfiled review lows, spec drift, skipped or unpriced scope.
- **Lessons** — a trap that cost a debugging cycle and is not obvious from the code.

One concrete line each, naming the file, command or condition. **An empty retro is a correct answer** — never pad.

## Write

```
pnpm noldor triage retro --slug <slug> --pr <pr-number> \
  --lesson "<one line>" --followup "<one line>"
pnpm noldor triage retro --slug <slug> --pr <pr-number> --none
```

`<slug>` is the session slug (the enhancement on attach paths); the PR number comes from the `PR merged: <url>` line. The command writes the main checkout's `ideas.md` from any worktree (lessons → `## Lessons`, follow-ups → `## Not groomed`, sections created when missing) and never commits. **Never put these notes in private memory instead.**

Exit 2 is a usage error: fix and re-run. Exit 1 is I/O or a held lock: re-run once, then report stderr and continue. Step 5 prints the result as its second line: `Retro: <n> lessons, <m> follow-ups → ideas.md` or `Retro: nothing to capture`.
