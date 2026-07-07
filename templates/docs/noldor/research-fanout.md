---
noldor-page: research-fanout
introduced: 0.5.0
---
# Research Fanout

Parallel read-only research agents: `pnpm noldor research fanout` takes N independent task specs, spawns one context-isolated `researcher` agent per task through the [agent-runner registry](agent-runtimes.md) (max K concurrent), and writes findings + a deterministic `INDEX.md` to a gitignored staging dir. The build-side twin of this read-side primitive is the K-concurrent drain.

## CLI

```bash
pnpm noldor research fanout --tasks tasks.json --synthesize --max 4 --timeout 900000
pnpm noldor research fanout --task "quick question A" --task "quick question B"
```

- `--tasks <file.json>` — canonical input; zod-validated `{ "tasks": [{ id, question, scope?, context?, expects? }] }`. `id` is a kebab-case filename stem; duplicates error.
- `--task "<question>"` — repeatable sugar; ids are namespaced `cli-task-<n>` and concatenate after the file's tasks.
- `--max <n>` (default 4) — concurrency cap. More than 8 tasks warns (each task is a full agent spawn).
- `--timeout <ms>` (default 900000) — per-task; timeout SIGKILLs the child's process group.
- `--synthesize` — after collection, one extra agent reads the findings files and writes `SYNTHESIS.md`. Skipped below 2 ok findings; failure degrades to a warning.
- `--dry-run` / `--json` — list without spawning / machine output.

## Output layout

`.noldor/research/<YYYY-MM-DD-HHMMSS>[-n]/` (gitignored; suffix claims a fresh dir atomically when two batches start the same second):

- `<id>.findings.md` — per-task findings (raw child output preserved even when the envelope fails to parse)
- `INDEX.md` — findings table: id, status (`answered|partial|blocked`), confidence, headline, spawn status, link
- `manifest.json` — machine twin of INDEX
- `SYNTHESIS.md` — only with `--synthesize`

**Exit code 0 means every agent ran and its envelope parsed — NOT that questions were answered.** A batch of all-`blocked` findings still exits 0; headless callers read the INDEX status column (or `manifest.json`), not just the exit code.

## Return contract (envelope)

Children are read-only (`needsWrite: false` + prompt directive) and return everything via stdout: markdown findings terminated by one fenced ```json block — `{"status","headline","confidence","refs"}`. The CLI takes the LAST json fence as meta; a missing/invalid fence falls back to `status: blocked` with the raw output preserved. The CLI is the only writer.

## Telemetry

Every spawn appends an [agent-event](agent-runtimes.md) with `role: researcher` and `site: research.fanout` (`research.synthesize` for the synthesis pass).

## Integration points

The primitive is caller-agnostic; invoke it from:

- **Gate spec-stage** — "understand X before we spec it" (via the `noldor-research` skill)
- **Plan-stage investigation** — survey the files a plan will touch
- **`/garden` deep-dives** — parallel audits of drift candidates
- **Standalone operator research** — quick `--task` one-liners

Auto-wiring these flows is deliberately out of scope; each adoption is its own roadmap entry.
