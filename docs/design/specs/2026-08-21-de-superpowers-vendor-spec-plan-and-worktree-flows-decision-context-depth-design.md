# Design-Context Decision Depth — Design

**Slug:** de-superpowers-vendor-spec-plan-and-worktree-flows-decision-context-depth
**FD:** docs/features/de-superpowers-vendor-spec-plan-and-worktree-flows.md
**Date:** 2026-08-21
**Tier:** specs-only
**Deps:** none

UI verdict: skip — `consumer.uiPaths` and `consumer.uiSurfaces` are unset in `.noldor/config.json`, and every candidate path is a CLI renderer, a ledger parser, or skill prose.

## Problem

The vendored `/noldor-spec` and `/noldor-plan` dialogues let an operator ratify decisions they cannot actually judge. Three defects, all observable in one session:

The design-context block stores and prints every value as one line. [`normalize()`](../../../src/design/ledger.ts#L78) collapses each line terminator to a space — a deliberate no-forgery guarantee — and [`renderContext`](../../../src/design/render.ts#L31) then emits `- <value>` per entry with no structure. A `Scope` lifted from a paragraph-length roadmap entry becomes a single soft-wrapped wall, and the block grows without bound as decisions accumulate, so the operator scrolls past the very context the block exists to supply.

A decision is `Decision { id, text }` ([`src/design/ledger.ts:12`](../../../src/design/ledger.ts#L12)) — the answer and nothing else. The reasoning, the alternative that was rejected, and which part of the design the answer binds are all absent, so a decision cannot be audited later and gets re-litigated rounds afterwards.

Nothing puts the spec prose in front of the operator while it is still cheap to change. The skill writes sections to disk only at step 5, after the clarify questions that set the most expensive assumptions have already been answered against one-line ledger entries.

## Goals

- The operator judges prose, not one-line answers, from the first question onward.
- A decision record carries its reasoning and its rejected alternative, and names the design section it binds.
- The rendered block stays readable at 20 decisions: bounded height, current section in full, everything else legible at a glance.
- Per-section confirmation is recorded state, so it survives a context compaction.
- The complete record stays available: nothing the digest collapses becomes unreachable.

## Non-goals

- No hard wrapping, width flag, or terminal-width read. The renderer inserts no line breaks inside a value.
- No new gate: an unconfirmed section blocks no commit and no CR lane.
- No change to `normalize()`'s single-line storage rule or the forgery guarantees that rest on it.
- No refactor of `stripCodeRegions` in [`src/docs/docs-check.ts`](../../../src/docs/docs-check.ts). The fence-aware scanner this spec needs is local to `src/design/`.
- No prose-quality linter. Depth is a skill-prose obligation, not a checked property.

## Design

### Unit 1 — ledger schema and grammar (`src/design/ledger.ts`)

`Decision` gains three optional fields — `why`, `insteadOf`, `section`; `OpenThread` gains `section`. Each is stored as a two-space-indented sub-bullet beneath its `- D<n> <text>` / `- O<n> <text>` line:

```
## Decided

- D3 A decision record gains three optional fields.
  - section: Design
  - why: a one-liner drops the reasoning and the road not taken
  - instead-of: why-only; a five-field record; no schema change
```

`LedgerState` gains `confirmed: string[]`, serialized as a new `## Confirmed` H2 holding one section name per bullet. `SECTIONS` grows to six entries, so the existing fail-closed rule covers the new section unchanged: an unparseable `Confirmed` makes `design log` refuse the file rather than erase it.

The grammar addition is additive. A flat `- D1 text` with no sub-bullets parses exactly as today, so every existing ledger keeps working. Field values run through `normalize()` like every other value, so the non-reintroducing argument holds: a value cannot contain a line terminator, therefore cannot start a line, therefore cannot forge a sub-bullet key or an H2.

### Unit 2 — artifact sections (`src/design/artifact-sections.ts`, new, pure)

Two functions over raw markdown:

- `listSections(md): string[]` — H2 names in document order.
- `extractSection(md, name): string | null` — that section's body verbatim, paragraph breaks preserved. This is the one place text reaches the operator with its newlines intact, which is what makes "no wrapping" readable.

Both run over a fence-aware line scan that understands marker character (backtick and tilde), opening length of three or more, up-to-three-space indentation, info strings, and a closing fence of at least the opening length. A `## Design` inside a fenced example is not a section. `extractSummary` in [`src/core/fd-load.ts:290`](../../../src/core/fd-load.ts#L290) is the shape to follow but not to reuse — its regex is fence-blind.

### Unit 3 — artifact location (`src/design/artifact-locate.ts`, new)

`locateArtifact(cwd, { slug, kind, override })` returns the path of the dialogue's spec or plan, or `null`. An explicit `--spec <path>` override wins. Otherwise it lists the kind's directory via the existing [`listSpecs`/`listPlans`](../../../src/core/fd-load.ts#L296) helpers, keeps the files whose [`extractSpecSlug`/`extractPlanSlug`](../../../src/core/fd-load.ts#L329) equals the dialogue slug, and takes the lexically greatest filename — the date prefix makes that the newest. Deriving the filename from today's date would break a dialogue that crosses midnight.

### Unit 4 — digest renderer (`src/design/render.ts`)

`renderContext` becomes a digest. `RenderOpts` gains `section`, `sectionProse`, `sectionNames`, and `full`. Output order:

1. Header — dialogue slug, decided/open counts, and section progress (`section 3/9 · 2 confirmed`) when `sectionNames` is non-empty.
2. Sections checklist — every `sectionNames` entry with a confirmed / unconfirmed / current marker.
3. Scope — collapsed, or whole under `full`.
4. The focus section — `sectionProse` verbatim, then the decisions whose `section` matches, expanded with their `why` and `instead-of` on their own lines.
5. Decided elsewhere, Open, Existing support — collapsed.

Collapsing is one exported pure helper, `collapse(text)`, returning the first sentence plus a marker for what was withheld (remaining sentence count, `+why`, `+alt`). A sentence boundary is `.`, `!`, or `?` followed by whitespace and then an uppercase letter or a digit; when no boundary is found the whole text renders. `full: true` expands everything and is the honest answer to the current no-caps docstring — the block is the operator's digest, the ledger file is the complete record, and the agent reads the file.

### Unit 5 — CLI surfaces

[`log-cli.ts`](../../../src/design/log-cli.ts) gains `--because`, `--instead-of`, `--section` (each attaching to the decision minted in the same invocation, `--section` also valid on `--open`), and `--confirm-section <name>`, which is idempotent — a name already in `confirmed` is not appended twice. [`context-cli.ts`](../../../src/design/context-cli.ts) gains `--section <name>`, `--spec <path>`, and `--full`.

Section names are validated against the located artifact's own H2 list, never a hardcoded vocabulary — so the `prep format spec` contract and dynamic plan task names both work, and the contract can change without a code change. When no artifact exists yet, any name is accepted.

### Unit 6 — skill prose

[`.claude/skills/noldor-spec/SKILL.md`](../../../.claude/skills/noldor-spec/SKILL.md) step 3 becomes draft-first: after grounding, write a first-pass skeleton to the real spec path with every `prep format spec` section present, each a short paragraph naming its own unknowns inline; then every clarify question declares its section, renders the block with `--section <name>`, and records the answer with `--because`/`--instead-of`/`--section`. Step 5 becomes the confirm beat — one to two paragraphs per section, `--confirm-section` on the operator's yes. [`.claude/skills/noldor-plan/SKILL.md`](../../../.claude/skills/noldor-plan/SKILL.md) mirrors it against the plan contract. Both twins move in lockstep: `templates/.claude/skills/…` and `templates/.opencode/command/…`.

## Acceptance criteria

1. A ledger whose decisions carry `why` / `instead-of` / `section` sub-bullets round-trips through `parseLedger` → `serializeLedger` unchanged.
2. A pre-existing ledger with only flat `- D<n> <text>` decision lines parses with the new fields `undefined` and re-serializes byte-identically.
3. An unparseable `## Confirmed` section puts `Confirmed` in `unparsed`, and `design log` exits non-zero writing nothing.
4. `listSections` ignores an H2 inside a fenced block for backtick and tilde fences, fences longer than three characters, and up-to-three-space-indented fences.
5. `extractSection` returns the body with its blank lines intact, and `null` for a name that is not an H2.
6. `locateArtifact` prefers `--spec`, otherwise returns the greatest-dated file matching the dialogue slug, and `null` when none matches.
7. `collapse` returns the first sentence plus a withheld-marker, and the whole text when no sentence boundary exists.
8. `design context --section <name>` renders that section's body verbatim and expands only the decisions bound to it; every other decision renders collapsed.
9. `design context --full` renders every value uncollapsed.
10. `design context` on a dialogue with no artifact on disk exits 0 and reports the absent draft rather than failing.
11. `design log --section <name>` and `--confirm-section <name>` exit non-zero listing the legal names when the located artifact has no such H2, and accept any name when no artifact exists.
12. `design log --confirm-section <name>` is idempotent — re-running it records the name once.

## Risks / trade-offs

The digest reverses a documented invariant. [`render.ts:19-22`](../../../src/design/render.ts#L19-L22) argues no-caps precisely because hiding early decisions invites self-contradiction. The reconciliation is the reader split — the block serves the operator, the ledger file serves the agent, and `--full` restores the old output exactly — but the docstring must be rewritten to say so, or the next reviewer reads a live contradiction.

The draft-first strawman is wrong on purpose. An operator who reads it as a claim rather than a provocation will spend the dialogue correcting prose instead of deciding, which is slower than today. The skill prose has to name the strawman as a strawman every time it is presented.

Draft-first also means an abandoned dialogue leaves a half-true spec at the real spec path. That is already true of today's step 5, and the artifact is uncommitted until gate Step 2.5, so the exposure does not grow — but it grows earlier in the session.

Section-name validation against the artifact's own headings couples `--section` to whatever the draft currently contains. Renaming an H2 mid-dialogue orphans decisions already tagged with the old name. Accepted: orphaned tags render under "Decided elsewhere" rather than being lost, and the alternative is a hardcoded vocabulary that goes stale against `prep format`.

`SKILL.md` is already dense, and this adds a step. Mitigated by replacing step 5's prose rather than appending to it; if the file still grows past what an agent reliably follows, the split is its own entry, not this one.

## User Story

As an operator driving a Noldor spec or plan dialogue, I want each question to arrive beneath the current draft of the spec section it concerns and beneath decisions that carry their own reasoning and rejected alternatives, so that I am judging the design while it is still cheap to change instead of ratifying one-line answers I cannot evaluate.

## Usage

- Seed once, unchanged: `pnpm noldor design log --slug <dialogue-slug> [--entry <roadmap-slug>] --support "<path:line> — already does X"`.
- Draft-first: write the spec skeleton to `docs/design/specs/YYYY-MM-DD-<slug>-design.md` with every `pnpm noldor prep format spec` section present before question 1.
- Before every question: `pnpm noldor design context --slug <dialogue-slug> --section "<H2 name>"` and paste stdout verbatim in a fenced block above the question. Add `--full` to expand everything, `--spec <path>` when the artifact is not where the slug implies, `--kind plan` in a plan dialogue.
- After every answer: `pnpm noldor design log --slug <dialogue-slug> --resolve <O-id> --decide "<what was settled>" --because "<why>" --instead-of "<what was rejected and why not>" --section "<H2 name>" [--open "<new thread>"]`.
- On a section the operator has blessed: `pnpm noldor design log --slug <dialogue-slug> --confirm-section "<H2 name>"`.
- Ledger inspection unchanged: `.noldor/design/<slug>.md`, read freely, never hand-edit.

## Open questions (resolved)

1. *How does `design context` locate the spec file — derived from slug plus docs roots, or an explicit flag?* -> Both, override first: `--spec <path>` wins, otherwise the greatest-dated file whose `extractSpecSlug` matches the dialogue slug, because deriving the name from today's date breaks any dialogue that crosses midnight or resumes the next morning.
2. *Which section names are legal for `--section`?* -> The H2 names present in the located artifact, because that covers the fixed spec contract and dynamic plan task names with one rule and cannot go stale against `prep format`.
3. *Do the new fields apply to open threads too?* -> `--section` yes, `--because`/`--instead-of` no: a thread is a question, so it belongs to a section but has no rationale or rejected alternative yet.
4. *What counts as a sentence boundary for collapsing?* -> `.`, `!`, or `?` followed by whitespace and then an uppercase letter or digit; no abbreviation dictionary, and no boundary means the whole text renders, so the failure mode is a long line rather than a truncated one.
