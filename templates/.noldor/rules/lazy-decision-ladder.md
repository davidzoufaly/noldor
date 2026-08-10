---
id: lazy-decision-ladder
applies-to: ["**/*.ts"]
stage: [code]
enforce: true
links: [docs/noldor/rules.md]
---
Understand the problem first: read the code the change touches and trace the real
flow before writing anything. Lazy about the solution, never about reading. Then
climb this ladder and stop at the first rung that holds:

1. Does this need to exist? → no: skip it (YAGNI)
2. Already in this codebase? → reuse it, don't rewrite
3. Stdlib does it? → use it
4. Native platform feature? → use it
5. Installed dependency already does it? → use it
6. One line? → one line
7. Only then: the minimum that works

Never cut, at any rung: validation at trust boundaries, error handling that
prevents data loss, security, accessibility, and explicitly-requested behaviour.

Mark a deliberate, bounded corner-cut in code with
`// noldor:cut <ceiling> — <upgrade path>` — where `<ceiling>` is what the cut
deliberately stops at (a ladder rung like "one-liner", or a concrete bound like
"linear scan, fine ≤1k rules") and `<upgrade path>` is what to build when the
ceiling stops holding. A marked cut is a decision, not an omission.
