# /noldor-gate — session retro (Step 4.12)

Read by every session, on every path, after Step 4.11's cleanup and before the Step 5 handoff. The PR exists by now, so its number is known; the always-clear rule in Step 5 still holds, so nothing here names the next roadmap entry.

## What to collect

Look back over this session — the dialogue, the review rounds, the test runs — and list two kinds of note:

- **Follow-ups** — work this session found and did not do: verifier notes, review lows that were deferred or not filed, spec drift the implementation introduced, a skipped or unpriced piece of scope.
- **Lessons** — a trap that cost a debugging cycle and is not obvious from the code: a hook that rejected a commit for a non-obvious reason, a command whose exit code lied, a flag that silently did nothing.

One line each, concrete: name the file, command or condition. Nothing that git history or the merged PR already records.

**An empty retro is a correct answer.** Most sessions learn nothing worth keeping. Do not pad the list to have something to say.

## Write it

One call, every note in it:

```
pnpm noldor triage retro --slug <slug> --pr <pr-number> \
  --lesson "<one line>" --followup "<one line>"
```

or, when there is nothing to capture:

```
pnpm noldor triage retro --slug <slug> --pr <pr-number> --none
```

`<slug>` is the session's slug (the enhancement slug on an attach path); `<pr-number>` comes from the `PR merged: <url>` line Step 4 kept. The command writes the main checkout's `ideas.md` from any worktree — lessons under `## Lessons`, follow-ups under `## Not groomed`, each section created when missing — and never stages or commits. A tracked `ideas.md` is left modified on `main`; the next local-main sync carries it across with `--autostash`.

**Never write these notes to private memory instead.** That is the leak this step exists to close: a lesson in one assistant's memory never reaches the next operator or the next consumer. `/noldor-absorb` files `## Lessons` into the runbooks later; the operator moves ready follow-ups under `## Verticals` for `/noldor-triage`.

## When it fails

The step is advisory. Exit 2 is a usage error — fix the arguments and re-run. Exit 1 is I/O or a lock held by another writer — re-run once, then report the stderr line and continue to Step 5. Never let the retro hold up the handoff.

Step 5's report carries the result as its second line: `Retro: <n> lessons, <m> follow-ups → ideas.md`, or `Retro: nothing to capture`.
