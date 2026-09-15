---
id: state-file-schema-additive
applies-to: ["src/**/*.ts"]
stage: [code]
enforce: true
links: [src/core/state-file.ts, src/clones/baseline.ts, docs/noldor/rules.md]
---

A `.noldor/` state file is a compatibility surface, not an internal shape. It is written by
one framework version and read by a later one — the tracked ones are committed and travel
across upgrades in every consumer repo — so its zod schema is a published contract. Most of
those schemas are `.strict()`, so a **required** field added to one fails `safeParse` against
every file recorded before the addition, and the reader turns that into its distrust verdict:
`readBaseline` returns `kind: 'unreadable'`, `clones check` exits 3, and the ratchet is off
across every consumer on their next push — bought with a field nobody asked them to record.

So: a field added to a persisted state-file schema is `.optional()`, and the reader owns the
`undefined` branch with a message naming the remedy, never a silent fallback —
`baseline predates per-file attribution - re-record with 'noldor clones baseline'`. That
branch is one `if`; the required field is a red gate every consumer earns by changing
nothing. `perFile` and `noisePolicy` in `cloneBaselineSchema` are the worked example, and
each carries the reason inline so the next editor does not have to rediscover it.

Removing, renaming or retyping a key breaks the same contract from the other side, and
optionality cannot save it. Two answers, not three: keep reading the old key alongside the
new one, or version the shape and let the reader route an older file to a *skip* verdict
rather than a distrust one — `indirectionBaselineSchema.algorithmVersion` and the clones
options mismatch (`kind: 'stale'`, "not comparable, skipped") are both that move. Widening a
value is the same hazard wearing a different hat: a writer that emits a new enum member an
older reader's schema rejects has shipped a required addition.

Scope is the *persisted* shape. A schema over subprocess output, hook stdin, or an in-memory
value the same version wrote and dropped has no older file to break, and there `.strict()`
with required fields is the better, stricter choice. What this rule covers is the tracked set
(`clones-baseline.json`, `indirection-baseline.json`, `retired-entry-ids.json`,
`id-counter.json`, `config.json` — the last already correct by construction: not `.strict()`,
every key optional) plus the untracked files a later version still reads: the CR sinks, the
autofix ledgers, the arbitration records, `session.json`. There is no mechanical counterpart
— nothing diffs a schema against its predecessor — so this is caught by reading the diff or
not at all.
