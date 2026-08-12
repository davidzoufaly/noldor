---
id: pr-summary-why-how-what
applies-to: ["src/core/pr-flow.ts", "src/core/pr-flow-cli.ts"]
stage: [code]
enforce: true
links: [docs/noldor/pr-flow.md]
---
A PR summary states three things, in this order:

1. **Why** — the problem or motivation. What was broken, missing, or risky.
2. **How** — the mechanism. What approach the change takes and where it hooks in.
3. **What** — the concrete outcome. Files, commands, and behaviour that shipped.

Each of the three lands in both registers: a technical rendering for the
reviewer, who needs the mechanism, and a plain-language rendering for the
operator reading release notes, who needs the reason without the jargon. A
summary that is only a changelog (what, no why) or only a design essay (why,
no what) fails this rule.

Scope is the PR-body seam only — `composeBody` in `src/core/pr-flow.ts` and any
text that ends up in `gh pr create --body`. Commit messages are out of scope:
`noldor-scope` and the trailer contract already govern them.
