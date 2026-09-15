---
id: state-file-schema-additive
applies-to: ["src/**/*.ts"]
stage: [code]
enforce: true
links: [src/core/state-file.ts, src/clones/baseline.ts, docs/noldor/rules.md]
---

A `.noldor/` state file is a compatibility surface, not an internal shape. It is written by
one framework version and read by a later one — the tracked ones are committed and travel
across upgrades in every consumer repo — so its zod schema is a published contract. A
**required** field added to one fails `safeParse` against every file recorded before the
addition. That is required-ness alone, in any `z.object` — `.strict()` is a different hazard,
governing the opposite direction (see below), so a non-strict state schema is not exempt. The
reader turns the failure into its distrust verdict: `readBaseline` returns
`kind: 'unreadable'`, `clones check` exits 3, and the ratchet is off across every consumer on
their next push — bought with a field nobody asked them to record.

So: a field added to a persisted state-file schema is `.optional()`, and the reader owns the
`undefined` branch with a message naming the remedy, never a silent fallback —
`baseline predates per-file attribution - re-record with 'noldor clones baseline'`. That
branch is one `if`; the required field is a red gate every consumer earns by changing
nothing. `perFile` in `cloneBaselineSchema` and `noisePolicy` in the nested
`baselineOptionsSchema` (both in `src/clones/baseline.ts`) are the worked example, and each
carries the reason inline so the next editor does not have to rediscover it.

Removing, renaming or retyping a key breaks the same contract from the other side, and
optionality cannot save it. Two answers, not three: keep reading the old key alongside the
new one, or version the shape and let the reader route an older file to a *skip* verdict
rather than a distrust one — `indirectionBaselineSchema.algorithmVersion` and the clones
options mismatch (`kind: 'stale'`, "not comparable, skipped") are both that move.

`.strict()` governs the mirror direction — a *newer* file read by an *older* schema. A strict
schema rejects the unknown key outright where a plain `z.object` strips it, so strictness is
what turns a version downgrade, or a consumer whose CI is pinned behind its checkout, into a
hard failure rather than a tolerated extra. Optionality does nothing for that direction, and
widening a value is the same hazard inside it: a writer emitting an enum member an older
reader's schema does not list has shipped a break whether the field is optional or not.

Scope is the *persisted* shape. A schema over subprocess output, hook stdin, or an in-memory
value the same version wrote and dropped has no older file to break, and there `.strict()`
with required fields is the better, stricter choice. What this rule covers is the tracked set
— `clones-baseline.json`, `indirection-baseline.json`, `retired-entry-ids.json`,
`id-counter.json`, `config.json` — plus the untracked files a later version still reads: the
CR sinks, the autofix ledgers, the arbitration records, `session.json`.

Audit the nesting level you are actually editing, not the block's top keys: `config.json`
alone is read by two schemas (`noldorConfigSchema` in `src/core/config.ts` and, for the
`consumer:` block, `ConsumerConfigSchema` in `src/core/consumer-config.ts`), each several
levels deep, and optionality one level up protects nothing below it. Do not reason from the
loader to the blast radius either — what a rejected file does to a given command depends on
that call site, and they differ. Establish the consequence by running the command against a
file the new schema would reject.

There is no mechanical counterpart — nothing diffs a schema against its predecessor — so this
is caught by reading the diff or not at all.
