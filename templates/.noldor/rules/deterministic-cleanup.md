---
id: deterministic-cleanup
applies-to: ["**/*.ts"]
stage: [code]
enforce: true
links: [tsconfig.json, docs/noldor/rules.md]
---

Anything acquired must be released on every path out, including the throwing one. Where a resource
has an owner scope, express that with Explicit Resource Management — `using` / `await using` plus a
`[Symbol.dispose]()` / `[Symbol.asyncDispose]()` member — rather than a `try/finally` the next
editor has to notice. The compiler then guarantees the release; a `finally` block only documents the
intention. This repo's resource shapes are exactly the ones that leak: temp directories, git
worktrees, lock and PID files, spawned subprocesses, watchers, and abort handlers.

`try/finally` remains correct where there is no owning scope — a release that must outlive the
block, or a handle handed off to a caller. What is not acceptable is neither: an acquire whose
release sits on the happy path only.
