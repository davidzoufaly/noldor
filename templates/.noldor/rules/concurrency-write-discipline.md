---
id: concurrency-write-discipline
applies-to: ["**/*.ts"]
stage: [code]
enforce: true
links: [docs/noldor/rules.md]
---

Non-atomic read-modify-write on shared files is a race: write multi-reader files via
temp-file + rename through the repo's atomic-write helper, never in place. Keep git,
subprocess, and poll loops sequential on purpose — `eslint/no-await-in-loop` is off
deliberately, because parallelizing such steps races the index or the remote. Liveness is
a fresh probe (a process listing, an actual connect), never trust in a stale lock or PID
file. (`eslint/no-async-promise-executor` covers the machine half; `require-atomic-updates`
has no oxlint implementation, which is why this rule exists.)
Every wait carries a deadline and a cancellation path. A poll loop, a subprocess wait, or a network
read takes an `AbortSignal`, and where both a caller's cancellation and a timeout apply they compose
into one signal — `AbortSignal.any([signal, AbortSignal.timeout(ms)])` — rather than two independent
racing mechanisms. Sequential-on-purpose is not the same as unbounded: an untimed wait inside a hook
or a CLI is a hang, and a hang reads to the operator as a broken tool.
