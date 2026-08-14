---
id: pr-summary-why-how-what
applies-to: ["src/core/pr-flow.ts", "src/core/pr-flow-cli.ts", "src/core/validate-summary-body.ts", "src/hooks/validate-pushed-summaries.ts"]
stage: [code]
enforce: true
links: [docs/noldor/pr-flow.md, docs/noldor/git-and-commits.md]
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

Scope is the PR-body seam — `composeBody` in `src/core/pr-flow.ts`, the text that
ends up in `gh pr create --body`, and the commit body that seam quotes from —
**for a change that carries code**. `touchesCode` (`src/core/allowlist.ts`) is the
predicate, negated: a commit touching only docs, prose or framework bookkeeping
has no behaviour to explain, so it owes no Why/How/What and a roadmap reorder or
a README typo is not a violation of this rule. The exemption is that negation
rather than `isBookkeepingOnly`, so prose that is neither code nor bookkeeping
(`docs/noldor/**`, root `*.md`, `.claude/**`, the `templates/` prose twins) is
exempt too.

**A green push is not a compliant summary.** The mechanical floor is the
`pre-push` hook, which reads each outgoing commit **object** and enforces only
the *structure*: that a `Why —`, `How —` and `What —` section exist and are not
trivially short. (`validate summary-body` at `commit-msg` is advisory and always
exits 0 — early feedback, never a verdict.) Neither can tell whether a Why reads
plainly or in jargon, so
`Why — because resolveChangedRanges did not union ls-files output` passes the
hook and still fails this rule. The mechanical check is the floor; the two
registers above are the bar, and they are held by the reviewer and the
code-stage CR, not by the validator.

Commit *messages* remain otherwise out of scope: `noldor-scope` and the trailer
contract govern subject and trailers.
