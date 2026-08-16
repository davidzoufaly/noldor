---
id: recompute-over-maintained-state
applies-to: ["**/*.ts"]
stage: [code]
enforce: true
links: [docs/noldor/rules.md]
---

Prefer a recomputed decision over maintained state whenever the state has many mutation
sites: when a flag, set, or cache must be updated at every branch that could change it,
replace it with a pure function that recomputes the answer at each use point.
Reviewer-side reading: repeated findings of the same missed-update class against one piece
of state are one design finding — replace the maintained state — not N separate bugs.
