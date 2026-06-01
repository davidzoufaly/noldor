---
id: test-real-behavior
applies-to: ["src/**/*.test.ts"]
stage: [code]
enforce: false
links: [.claude/engineering-rules.md, docs/noldor/testing-principles.md]
---
Test observable behavior, not implementation — private methods, internal state shapes, and render counts are off-limits. Use real dependencies (real schemas, real tmpdirs/filesystem) rather than mocking the unit under test; mock only at true external boundaries such as the network or the clock.
