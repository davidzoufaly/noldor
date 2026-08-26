---
id: react-19-idioms
applies-to: ["**/*.tsx"]
stage: [code]
enforce: true
links: [.claude/engineering-rules.md]
---

React 19 removed the ceremony around several patterns; the old spelling is now noise, and in two
cases an actual bug.

`ref` is an ordinary prop — `forwardRef` is not needed and should not be added. A context is its own
provider: `<Ctx value={v}>`, not `<Ctx.Provider value={v}>`. A ref callback may return a teardown
function, so an observer or listener attached in one no longer needs a paired effect.

Do not fetch in `useEffect`. Read a promise with `use()` under a `<Suspense>` boundary, or hand the
fetch to the router / data layer that already owns caching and cancellation. The effect version has
to hand-roll the race guard, the abort, and the loading flag, and most implementations get at least
one of the three wrong.

A mutation with pending and error state is `useActionState` (plus `useOptimistic` where an optimistic
echo is cheap to roll back), not three `useState` calls around a `try/catch/finally`. This is the
rule that removes a real bug class: the hand-rolled version double-submits on a double click, and
`useActionState` sequences that for free. Reach for `useEffectEvent` when an effect must read a
current value without that value becoming a dependency — that is the supported form of the
ref-holding-latest-callback workaround.

The React Compiler owns memoization: no hand-written `useMemo` / `useCallback` / `memo` unless a
profiler proved a hot path the compiler bailed out of. Its precondition is rules-of-hooks
compliance, which `react/rules-of-hooks` enforces at lint time (it is in no oxlint category and is
named explicitly in `.oxlintrc.json` for exactly this reason). A rules-of-hooks error is the
compiler telling you it cannot optimize this component — it is never a reason to opt the file out.
