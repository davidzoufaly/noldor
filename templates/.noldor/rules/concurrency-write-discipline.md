---
id: concurrency-write-discipline
applies-to: ["src/**/*.ts"]
stage: [code]
enforce: true
links: [.claude/engineering-rules.md]
---

Non-atomic read-modify-write on shared files is a race: write multi-reader files via
temp-file + rename through the repo's atomic-write helper, never in place. Keep git,
subprocess, and poll loops sequential on purpose — `eslint/no-await-in-loop` is off
deliberately, because parallelizing such steps races the index or the remote. Liveness is
a fresh probe (a process listing, an actual connect), never trust in a stale lock or PID
file. (`eslint/no-async-promise-executor` covers the machine half; `require-atomic-updates`
has no oxlint implementation, which is why this rule exists.)
