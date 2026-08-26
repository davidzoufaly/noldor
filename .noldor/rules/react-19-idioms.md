---
id: react-19-idioms
applies-to: ["**/*.tsx"]
stage: [code]
enforce: true
links: [.claude/engineering-rules.md]
---

**Precondition.** This rule describes React 19, and applies only where the package that owns the
file declares `react` at `^19` or later — `useEffectEvent` specifically is React 19.2+. On React 18
none of these spellings exist and every one of them is a build error, so the rule does not apply
there; the `applies-to` glob cannot express a version and the store has no version predicate, which
is why the floor is stated here in prose. TSX that is not React at all (Solid, Preact's own
idioms) is likewise out of scope — read the rule as scoped to React components, not to the
extension.

React 19 removed the ceremony around several patterns; the old spelling is now noise, and in one
case it hides a real bug class.

`ref` is an ordinary prop — `forwardRef` is not needed and should not be added. A context is its own
provider: `<Ctx value={v}>`, not `<Ctx.Provider value={v}>`. A ref callback may return a teardown
function, so an observer or listener attached in one no longer needs a paired effect.

Do not fetch in `useEffect`. Read a promise with `use()` under a `<Suspense>` boundary, or hand the
fetch to the router / data layer that already owns caching and cancellation. The effect version has
to hand-roll the race guard, the abort, and the loading flag, and most implementations get at least
one of the three wrong.

A mutation with pending and error state is `useActionState` (plus `useOptimistic` where an optimistic
echo is cheap to roll back), not three `useState` calls around a `try/catch/finally`. What it buys is
the state machine — pending, error and result move together, and the pending flag it hands back is
the one the submit control disables on. What it does **not** buy is double-submit safety: two
activations still invoke the action twice, and sequencing them does not make a non-idempotent
mutation safe. So a mutation that must not run twice needs the pending flag wired to the control
*and* an idempotency key or dedup on the server — the hook is not a substitute for either. Reach for
`useEffectEvent` when an effect must read a current value without that value becoming a dependency —
that is the supported form of the ref-holding-latest-callback workaround.

The React Compiler owns memoization: no hand-written `useMemo` / `useCallback` / `memo` unless a
profiler proved a hot path the compiler bailed out of. Its precondition is rules-of-hooks
compliance, which `react/rules-of-hooks` enforces at lint time (it is in no oxlint category and is
named explicitly in `.oxlintrc.json` for exactly this reason). A rules-of-hooks error is the
compiler telling you it cannot optimize this component — it is never a reason to opt the file out.
