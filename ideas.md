# Ideas

Raw entry point for human-generated ideas. `/triage` promotes bullets into `docs/roadmap.md` (flat priority-ordered list) or `docs/backlog.md` (parking lot).

- 3 verticals: tooling, business, core product
- roadmap: flat priority-ordered list (file order = priority); every entry is a `### <Entry Name>` heading at one fixed level — never a `### <Category>` container (`validate:triage` errors on `empty-group-heading`)
- noUncheckedIndexedAccess: true v baseconfig?

## Notes

## Priority

- kromě quick win a top priority mít tam lijnu pro bugfixes -> doporučovat (sortovat) ty s největším impactem
- PR should had task ID as first line in summary

## Not groomed

- Clone ratchet counts thin typed façades as duplication. On the 2026-08-30 release sweep the whole-corpus ratchet reds at +112 tokens over the baseline PR #406 recorded, and the largest new group is `src/design/design-approval.ts:63-92` vs `src/design/ui-capture.ts:76-108` (82 tokens). Neither site holds copied logic: both are one-line delegations to the already-shared receipt store (`parseReceiptWith`, `writeReceiptFile`, `readReceiptFile`), each binding a *different* schema, dir-segment tuple and return type. The tokenizer skips comments but normalizes identifiers to `ID` for Type-2 matching, so two same-shaped one-line delegations match structurally. The rest of the delta is import blocks (`src/design/ledger.ts` vs `src/cr/orchestrate.ts`, `src/metrics/compute.ts`, `src/garden/garden-detect.ts`). Extracting is strictly worse — one generic untyped wrapper, indirection added, zero logic shared. Options: skip a group whose every span is a single `return <call>(…)` statement, or exclude leading import runs from the token stream. Deletion test: a file pair whose only overlap is imports plus a delegating one-liner produces no group. Rebaselined to 28844 to unblock the sweep. (found 2026-08-30, release sweep)

## Lessons

Raw capture point for operator/agent lessons + gotchas. `/noldor-absorb` classifies each unfiled bullet (`drop | gotcha | actionable | feedback`), files it into framework docs, and stamps `[absorbed YYYY-MM-DD → <dest>]`. Stamped bullets may be pruned — git history is the audit trail.

- `toolchain-floor` reads root tsconfigs only (`TSCONFIG_CANDIDATES` = `tsconfig.base.json`, `tsconfig.json`), so a nested config below the lib floor passes unseen. Found live: `src/dashboard/static/tsconfig.json` sat at `lib: ["ES2023", "DOM"]` while `platform-over-dependency` and `deterministic-cleanup` both bind `**/*.ts` — which includes `drag.ts` and `agents.ts` — and mandate `Set.prototype.union` and `Symbol.dispose`, each a TS2550 under that lib. The `lib-inherited` guard cannot help: it stays quiet because the *root* config declares a `lib`, and it is decided repo-wide by design. So two enforced rules mandated code a real config in this repo rejects, and nothing reported it. Options: walk every tsconfig the workspace scan already finds (the manifest walk is right there), or assert that a nested config either declares no `lib` — inheriting the base — or meets the floor itself. Worth noting `lib` REPLACES rather than merges on `extends`, so putting the floor in a base config protects only children that omit `lib` entirely. (found 2026-08-26, CR on the tsconfig-shared-base refactor)

- A markdown scanner that blanks HTML comments must interleave comment state with fence state in ONE pass, and the interaction is nastier than it looks. Three consecutive attempts each shipped a distinct hole on the `fd-diagram` detector (Q-0185): (1) blanking only inside a located section let a `## Diagram` inside a comment *enrol* an FD that predated the contract, breaking a presence-gating guarantee outright; (2) blanking the whole body before locating fixed that but treated `<!--` inside a fenced example as a real comment, so an unterminated one blanked the rest of the file and the FD silently left scope; (3) making the blanker fence-aware fixed that but exposed a worse one — a commented-out mermaid fence blanks its *opening* delimiter (it sits inside the comment) while the *closing* ```` ``` ```` survives past the `-->`, and `tagLines` reads that stray delimiter as an opener, so every heading to EOF vanishes. `locateSection('## Usage')` → `null`; the whole FD returns `[]`. Root cause is that `<!-- ... ```mermaid ... a --> b ... ``` ... -->` closes at the mermaid ARROW, because a flowchart edge *is* `-->`. Two candidate fixes named at review: keep blanking through a fence that was opened inside a comment, or make `tagLines` ignore an unmatched closer. Worth noting the CommonMark fence grammar ended up implemented twice in one file (`tagLines` and `blankComments`) and the two copies already disagreed on a rejected backtick opener — the exact fork the module docstring existed to prevent. Deletion test: an FD quoting this framework's own `## Diagram` scaffold inside a fenced sample is still scanned. (found 2026-08-29, three CR rounds on Q-0185)
- `locateSection` used two different heading predicates: the opener compared `line.trim()` (accepting CommonMark's ≤3-space ATX indent) while the terminator and `ancestorOk` ran `/^(#{1,6})\s/` on the untrimmed line (rejecting it). A one-space-indented `## Usage` therefore fails to close the preceding section and its prose is measured as the previous section's. One `atxHeading(line)` helper at all three sites. (found 2026-08-29, CR on Q-0185)
- `listMd`/`readText` in `src/core/markdown-section-scan.ts` swallow every IO error with a bare `catch {}`, while `src/core/fd-load.ts` already exports `readFileIfExists`/`listDirIfExists` doing the job properly — its docstring even names the hazard: "swallowing it would make a detector or report claim a clean pass over a file it never read". An EACCES on `docs/features` makes both detectors report zero stubs, green. Violates `error-result-types`. No import cycle blocks the swap. (found 2026-08-29, CR on Q-0185)

## Verticals

### Core Product

#### Now

#### Next

#### Later

## Triaged
