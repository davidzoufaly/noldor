---
id: test-mocking-boundaries
applies-to: ["src/**/*.test.ts"]
stage: [code]
enforce: true
links: [docs/noldor/testing-principles.md, .noldor/rules/test-real-behavior.md]
---
Mock at system boundaries only. Never mock an internal collaborator — a module the change itself owns. A test that mocks its own subsystem tests the mock, not the code, and stays green while the real integration is broken.

Use the real thing for: a module in the same subsystem, the filesystem (a real `mkdtemp` dir, not an in-memory shim), git (a real repo in a temp dir), schemas and parsers. Fake only at the edges: subprocess / editor / spawn seams via a hand-rolled fake injected as a parameter, time via `vi.useFakeTimers()` and randomness via a seeded generator injected as a parameter. Network should not be reachable from unit-testable logic at all — extract the pure part rather than mocking `fetch`.

Prefer a hand-rolled fake passed as a parameter over `vi.mock`. The house pattern is a scripted runner — a `Record<prefix, result>` map compiled into a plain function that answers a benign default for unmatched keys, so a case scripts only the commands it cares about and can wrap the base runner to vary one of them. See "House patterns" in `docs/noldor/testing-principles.md` for the file to copy. A function that is hard to test because it constructs its dependencies internally should accept them instead; difficulty testing is a design signal, not a mocking opportunity.

`vi.mock` of a relative path is the pattern to justify, not the default. Where one is warranted — a dispatch seam that spawns a lane — keep it to that seam and assert observable output on either side of it, never the mock's own call record alone.
