---
id: prefer-noldor-wait
applies-to: ["**/*"]
stage: [code, review]
enforce: false
links: [docs/features/noldor-native-wait-primitive.md, docs/noldor/rules.md]
---

Waiting on framework state — a drain heartbeat, a CR lane sink, any `.noldor/*.json` a
producer writes — goes through `pnpm noldor wait <state-file> --until <cond>` (add
`--fail-if`, `--emit <dotpath>`, `--interval-ms`, `--timeout-ms`, `--quiet`; exits 0
matched, 1 fail-if matched, 2 timeout, 3 usage error). Reach for it before any monitor, watch, or
polling tool the surrounding harness happens to offer.

The reason is runner-independence, not preference: a harness-specific monitor exists only
in that harness, so a session running under codex or opencode — or headless under the
drain supervisor — has no such tool, and prose that assumed one silently degrades into
hand-rolled `sleep` loops. The framework's primitive is present wherever Noldor is.

Not a ban on harness tooling in general: this covers waiting on a state file a Noldor
producer writes. Waiting on a background task the harness itself started, and which
notifies on completion, is that harness's own business — polling it adds nothing.
