---
id: platform-over-dependency
applies-to: ["**/*.ts", "**/*.tsx"]
stage: [code]
enforce: true
links: [tsconfig.json, docs/noldor/rules.md, src/invariants/toolchain-floor.ts]
---

The toolchain's `lib` reaches `ESNext` and it runs on a current engine, so reach for the language
before reaching for a package. That floor is asserted, not assumed: the `toolchain-floor` invariant
blocks a `lib` below es2025 (`lib-es-builtins`), because a rule mandating these APIs while the
config stops at ES2023 would mandate code the compiler rejects — `Object.groupBy`,
`Promise.withResolvers`, the Set operations, the iterator helpers and `RegExp.escape` are each a
TS2550 "change the lib option" error under `lib: ["ES2023"]`. Where a consumer waives that id, the
APIs below it declines are off the table there and the rest of this rule still applies.
**The type floor is not a runtime floor.** `lib` proves the compiler knows these APIs, not that the
deployment target implements them — `Set.prototype.union` and the iterator helpers need Node 22+,
`RegExp.escape` and `Symbol.dispose` Node 24+, with the evergreen-browser cutoffs roughly a year
earlier. This rule assumes a current engine (Node 24+ or a browser matrix no older than that) and
nothing checks that assumption, because a deploy target is not visible in the repo. A consumer
shipping to an older runtime should waive `lib-es-builtins` and treat the APIs above its own floor as
out of scope; the rest of this rule stands unchanged. Reaching for a built-in the runtime lacks is
the one case where a polyfill or a package is the correct answer.

`Object.groupBy` / `Map.groupBy` over a hand-rolled reducer or a lodash import; Set operations (`union`, `intersection`, `difference`, `isSubsetOf`, `isDisjointFrom`)
over helper functions; `Promise.withResolvers()` over the hand-built deferred antipattern;
`structuredClone` over a deep-copy dependency; `Array.fromAsync` over an accumulate-then-return
loop. A dependency that only wraps a built-in is deletable, and deleting it is the higher-leverage
edit.

Iterator helpers are the case worth naming: `values().filter().map().take(n).toArray()` is lazy
and allocates no intermediate arrays, so it is the correct shape for a stream whose end you do not
control — subprocess output, a log tail, an SSE feed. Materializing such a source into an array to
`.map()` over it is both slower and a memory bug waiting for a big input.

Do not mutate a collection you received. ES2023 gives the non-mutating twin of every array
operation — `toSorted`, `toReversed`, `with`, `toSpliced` — and those are the default for anything
that crossed a boundary into your function. `unicorn/no-array-sort` is off deliberately (a blanket
`toSorted()` swap silently drops the result where a caller relies on the in-place mutation), which
makes this the prose half: in-place `.sort()` / `.reverse()` / `.splice()` is legitimate **only** on
an array this function built itself and still solely owns.

Dates and times: ISO 8601 with an explicit zone at every boundary, and no arithmetic on `Date` —
day and month math on `Date` is wrong across DST transitions, not merely awkward. Where real
calendar arithmetic is needed, that is Temporal's job (polyfill until the runtime floor carries it),
not a hand-rolled millisecond calculation.

When a regex is genuinely unavoidable (see the `Avoid regex` principle) and any part of the pattern
comes from a value rather than a literal, it goes through `RegExp.escape` — interpolating an
unescaped string into `new RegExp` is a correctness bug for any input containing `.`, `(`, or `+`.
