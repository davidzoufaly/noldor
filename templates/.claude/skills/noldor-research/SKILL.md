---
name: noldor-research
description: Fan out parallel read-only research agents via `pnpm noldor research fanout`. Use when facing 2+ independent read-only questions (codebase research, multi-subsystem investigation, cross-file audits, pre-spec understanding) whose answers don't depend on each other.
---

# /noldor-research

Dispatch one context-isolated researcher agent per independent question, in parallel, then synthesize. Protects the driving session's context: you read the INDEX (and selected findings), not every intermediate file dump.

## When

- 2+ independent **read-only** questions. One question → just investigate inline.
- Answers must not depend on each other (task B never consumes task A's output — if it does, run sequentially or merge into one task).
- Never fan out write-work — building/fixing in parallel is the drain's job.

## Flow

1. **Decompose.** One task per independent question. Each task self-contained: the child inherits NO session history — put everything it needs in `context`, point it at starting paths via `scope`, state what a good answer contains in `expects`.
2. **Write the tasks file** (skip for quick one-liners — use repeated `--task "<question>"` instead):

   ```json
   {
     "tasks": [
       {
         "id": "cr-guard",
         "question": "How does the CR overwrite-guard decide archive vs skip?",
         "scope": ["src/cr/"],
         "context": "CR sinks live under .noldor/cr/; the guard runs inside cr orchestrate.",
         "expects": "Name the deciding function, its inputs, and each outcome."
       }
     ]
   }
   ```

3. **Run:**

   ```bash
   pnpm noldor research fanout --tasks tasks.json [--synthesize] [--max 4] [--timeout 900000]
   ```

4. **Read `INDEX.md`** in the printed batch dir (`.noldor/research/<stamp>/`). Exit code 0 = every agent ran and parsed — NOT that questions were answered; read the status column. Pull individual `<id>.findings.md` only where the headline isn't enough; `--synthesize` adds `SYNTHESIS.md` when you want one merged artifact.
5. **Integrate.** Fold what matters into the artifact you're writing (spec, plan, audit). Cite the batch dir path so the trail survives.

## Rules

- Researchers are read-only by contract (`needsWrite: false` + prompt directive); they return findings via stdout — the CLI is the only writer.
- Task `id`s are kebab-case filename stems; duplicates are a usage error.
- The operator's explicit instructions always override this skill.
