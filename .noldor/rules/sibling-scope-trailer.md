---
id: sibling-scope-trailer
applies-to: ["docs/noldor/**/*.md"]
stage: [code]
enforce: false
links: [docs/noldor/git-and-commits.md]
---
A commit that stages this page together with any file outside `docs/noldor/` is a
mixed diff, and the `noldor-scope` commit-msg gate refuses it unless the page is
declared. Decide how before you commit, not after the rejection:

- **Keep the code scope** (`fix(core): …`) and add a trailer naming every
  staged page: `Noldor-Sibling-Scope: noldor:<page>, noldor:<page>` —
  `README.md` is `noldor:index`.
- **Or split**: the code change under its own scope, and the doc edit as its own
  `docs(noldor:<page>): …` commit. Split when the doc edit is not the twin of the
  code change.

The trailer is never injected for you — declaring the page is the point. A doc-only
commit takes the scope in the subject instead; the trailer is refused there.
