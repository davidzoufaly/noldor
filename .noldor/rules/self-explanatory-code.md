---
id: self-explanatory-code
applies-to: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"]
stage: [code]
enforce: true
links: [.claude/engineering-rules.md, docs/noldor/rules.md]
---

Code explains itself; comments are the exception. Naming and structure carry the intent —
when a line needs a comment to be understood, first rename the identifier, extract a named
helper in the same file, or split the expression, and only then reach for prose.

A comment earns its place only when it records a *why* the code cannot state:

- **A falsified alternative** — the obvious approach was tried or reasoned out and does not
  hold, so the next reader does not "simplify" back into it.
- **An external constraint** — a platform quirk, upstream bug, protocol requirement, or
  ordering the code depends on but cannot express.
- **A deliberate deviation** — a rule or convention broken on purpose, e.g. a
  `// noldor:cut` marker from `lazy-decision-ladder`.

Everything else is noise and does not ship:

- Narration of *what* the next line does (`// loop over entries`, `// return the result`).
- Section banners and step numbers restating the function's own structure.
- History and provenance — "added for Q-0123", "was X before", "fixes #45". That belongs in
  the commit message and PR, which is where the reviewer reads it.
- A comment restating the identifier, type, or test name directly beside it.

Exported symbols keep their TSDoc — it is the public contract, per the baseline
`## Comments` section of `.claude/engineering-rules.md`. This rule governs everything
inside a body and every non-exported declaration, and it applies to test files too.

Reviewer-side reading: flag a comment that fails the three-reason test as a `[mechanical]`
finding whose fix is deletion (or a rename that makes the comment redundant). Do not flag
the *absence* of a comment unless one of the three reasons is present and unrecorded.
