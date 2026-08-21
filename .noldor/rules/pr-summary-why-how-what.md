---
id: pr-summary-why-how-what
applies-to: ["src/core/pr-flow.ts", "src/core/pr-flow-cli.ts", "src/core/summary-body-contract.ts"]
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

Two further carve-outs, matching what `composeBody` can actually render:
`release-sweep` sessions (the sweep PR body is a deterministic automation
template with no prose seam — its code motion is reviewed at the sweep's own
confirmation gate, not through a PR summary) and retirement-only branches
(their Why/How/What is rendered from a deterministic template, and they carry
no code anyway). `validatePrSummary` exempts exactly these.

**A green delivery is not a compliant summary.** The mechanical floor is
`validatePrSummary` (`src/core/pr-flow.ts`), which runs at the top of
`openAndAutoMerge` and enforces only the *structure*: that a `Why —`, `How —`
and `What —` section exist in the composed PR Summary and are not trivially
short. It cannot tell whether a Why reads plainly or in jargon, so
`Why — because resolveChangedRanges did not union ls-files output` passes the
gate and still fails this rule. The mechanical check is the floor; the two
registers above are the bar, and they are held by the reviewer and the
code-stage CR, not by the validator.

Commit *messages* are out of scope entirely: bodies are free-form (the
per-commit pre-push gate is retired — the contract binds once, at the PR seam),
and `noldor-scope` plus the trailer contract govern subject and trailers.
