---
status: accepted
date: 2026-09-25
---

# Links Code Means What A File Is About

## Context

A feature doc's `links.code` lists the files that belong to the feature. Two readers turn that
list into claims about other files:
- The co-tag detector (`computeMissingCoTags`, `src/garden/graph-fd-lookup.ts`) expects every
  test to tag each FD that owns a file the test imports.
- `pnpm noldor features owners` names the FDs a changed file belongs to, and the fast-track
  doc-impact check reads it.

Nothing said what "belongs" means, so FDs added any file they edited: shared helpers such as
`src/core/consumer-config.ts` and `src/core/doc-roots.ts`, and whole directories such as
`src/cr/`. On 2026-09-25 that produced 606 proposed co-tags over 215 tests. Only 61 of them came
from a file exactly one FD claimed.

Git history cannot sort this out after the fact. The early squash commits that added most shared
files carry no `Noldor-FD:` trailer. A filter in the detector that skips files with several
owners was weighed and set aside: it would hide the bad claims from one reader while
`features owners` kept returning them.

## Structural context

The rule is enforced on data, not code, but its readers sit in community c27
(`src/garden/graph-fd-lookup.ts`, `src/features/seed-test-tags.ts`, `features-owners-cli.ts`).
`graph-fd-lookup.ts` is the bridge that `garden-detect.ts` [c57] and `sdd-report.ts` [c11]
import, so what `links.code` means moves the co-tag detector, the untagged-test and
orphan-owner suggestions, and `features owners` together. `src/sync/sync-code-links.ts` rebuilds
`links.code` from `// @fd:` headers, so the rule binds those headers too.

## Decision

A file belongs in an FD's `links.code`, or carries that FD in its `// @fd:` header, only when the
file is *about* that feature. Having edited the file is not enough.

- By default a file has **one** owner.
- A second owner is allowed when its `## Summary` describes what the file does.
- A directory entry is allowed only when every file under it is about the feature.
- A shared helper that is about no single feature may have **no** owner.

## Consequences

Easier:
- A test's `// @tests:` line names what the test covers, so a red test points at the features
  it breaks.
- `features owners` returns the FDs a change should update, not every FD that once touched the
  file.
- A new over-claim shows up by itself as fresh co-tag rows at the next garden pass.

Harder:
- Picking an owner is a judgment call, and an FD that really does depend on a helper no longer
  lists it.
- Helpers with no owner can show up as code-orphan rows in `garden detect`. For a pure helper
  that is the honest answer.

Ruled out:
- Using `links.code` as a record of which features touched a file. Git history holds that.
