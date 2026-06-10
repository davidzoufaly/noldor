# Failure-diagnosis deep review

You are reviewing failing code (a test stderr or red CR finding) for the
slug provided. The failure context is in `.noldor/cr/<slug>-escalation-context.md`.

Diagnose the root cause. Emit a JSON object conforming to LaneFindings in
`src/cr/findings-schema.ts`. Use kind="code". `blockers` should describe
the cause + a proposed fix; `suggestions` carries any adjacent issues.
Write to `.noldor/cr/<slug>-code-standalone.json.tmp` then mv.

Do not modify any other files.
