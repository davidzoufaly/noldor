---
id: test-real-behavior
applies-to: ["src/**/*.test.ts"]
stage: [code]
enforce: true
links: [.claude/engineering-rules.md, docs/noldor/testing-principles.md]
---
The Deletion Test is the bar: if the logic under test were deleted or replaced with a trivial stub (`return []`, `return undefined`), this test must fail. A test that survives a gutted implementation verifies nothing — rewrite it or delete it.

Test observable behavior through the public surface; private helpers and internal state shapes are off-limits, and a call-count assertion may complement a behavior assertion but never stand in for one where observable output exists. Expected values are independent literals, never recomputed the way the implementation computes them, and a test that only exercises fixtures and library helpers without calling this repo's code is banned. Cover the meaningful branches, not only the early-return guard — asserting the `[]` branch of `if (x) return []; return compute(...)` survives a gutted `compute`.

Banned outright: tautologies, mock echo (asserting a mock returned what it was told to return), `toHaveBeenCalled*` as the sole assertion where observable output exists, snapshots, `.only` / `.skip` / `.todo`, and weakening an assertion to get green. A correct assertion that fails means the code or the setup is wrong — report it, never assert less. `skipIf` on a real environment precondition is a scoped test, not a disabled one; state the condition inline.

House patterns worth copying rather than reinventing are listed under "House patterns" in `docs/noldor/testing-principles.md`.
