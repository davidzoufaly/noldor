# Design-Context Decision Depth — Design

**Slug:** de-superpowers-vendor-spec-plan-and-worktree-flows-decision-context-depth
**FD:** docs/features/de-superpowers-vendor-spec-plan-and-worktree-flows.md
**Date:** 2026-08-21
**Tier:** specs-only
**Deps:** none

UI verdict: skip — `consumer.uiPaths` and `consumer.uiSurfaces` are unset in `.noldor/config.json`, and every candidate path is a CLI renderer, a ledger parser, or skill prose.

## Problem

The vendored `/noldor-spec` and `/noldor-plan` dialogues let an operator ratify decisions they cannot actually judge. Three defects, all observable in one session:

The design-context block stores and prints every value as one line. [`normalize()`](../../../src/design/ledger.ts#L78) collapses each line terminator to a space — a deliberate no-forgery guarantee — and [`renderContext`](../../../src/design/render.ts#L31) then emits `- <value>` per entry with no structure. A `Scope` lifted from a paragraph-length roadmap entry becomes a single soft-wrapped wall, and the block grows with every decision, so the operator scrolls past the very context the block exists to supply.

A decision is `Decision { id, text }` ([`src/design/ledger.ts:12`](../../../src/design/ledger.ts#L12)) — the answer and nothing else. The reasoning, the alternative that was rejected, and which part of the design the answer binds are all absent, so a decision cannot be audited later and gets re-litigated rounds afterwards.

Nothing puts the spec prose in front of the operator while it is still cheap to change. The skill writes sections to disk only at step 5, after the clarify questions that set the most expensive assumptions have already been answered against one-line ledger entries.

## Goals

- The operator judges prose, not one-line answers, from the first question onward.
- A decision record carries its reasoning and its rejected alternative, and names the design section it binds.
- The block's length tracks the section under discussion rather than the accumulated history: every entry outside that section costs one line.
- Per-section confirmation is recorded state, so it survives a context compaction.
- The complete record stays available: nothing the digest collapses becomes unreachable.

## Non-goals

- No hard wrapping, width flag, or terminal-width read. The renderer inserts no line breaks inside a value.
- No new gate: an unconfirmed section blocks no commit and no CR lane.
- No change to `normalize()`'s single-line storage rule or the forgery guarantees that rest on it.
- No convergence of the repo's existing naive fence scanners onto the capable one this spec adds. The new module is placed where they can converge later; migrating [`stripCodeRegions`](../../../src/docs/docs-check.ts#L39), [`parse-blocks.ts:144`](../../../src/utils/parse-blocks.ts#L144), [`write-blocks.ts:36`](../../../src/utils/write-blocks.ts#L36), [`scaffold.ts:24`](../../../src/prep/scaffold.ts#L24), [`backlog-demote.ts:85`](../../../src/garden/backlog-demote.ts#L85), [`skill-code-drift.ts:227`](../../../src/garden/detectors/skill-code-drift.ts#L227) and [`validate-triage.ts:159`](../../../src/triage/validate-triage.ts#L159) is its own entry.
- No prose-quality linter. Depth is a skill-prose obligation, not a checked property.
- No write-time validation of section names. See Unit 5.

## Design

### Unit 1 — ledger schema and grammar (`src/design/ledger.ts`)

`Decision` gains three optional fields — `why`, `insteadOf`, `section`; `OpenThread` gains `section`. Each is stored as a two-space-indented sub-bullet beneath its parent entry line:

```
## Decided

- D3 A decision record gains three optional fields.
  - section: Design
  - why: a one-liner drops the reasoning and the road not taken
  - instead-of: why-only; a five-field record; no schema change
```

The sub-bullet grammar is exactly `^  - (section|why|instead-of): (.+)$`. Keys may appear in any order; each key may appear at most once per entry; `why` and `instead-of` are legal only under a `- D<n>` line. Every one of these is a fail-closed condition, pushing the parent H2 into `unparsed` so `design log` refuses the file rather than erasing content on the next reserialize: an unknown key, a duplicate key, an empty value, indentation other than exactly two spaces, `why`/`instead-of` under a `- O<n>` line, and a sub-bullet with no preceding entry. This mirrors the existing unknown-H2 rule ([`ledger.ts:139`](../../../src/design/ledger.ts#L139)) — the writer reserializes from parsed state, so anything merely *ignored* is destroyed.

`LedgerState` gains `confirmed: string[]`, serialized as a `## Confirmed` H2 holding one section name per bullet. `SECTIONS` grows to six so the fail-closed rule covers it. `Confirmed` is the one section the serializer emits **only when non-empty** — [`serializeLedger`](../../../src/design/ledger.ts#L238) otherwise pushes every heading unconditionally, which would rewrite every existing ledger on its next touch. The five original headings keep emitting unconditionally; this asymmetry buys byte-stability for ledgers written before this change.

The grammar addition is otherwise additive: a flat `- D1 text` with no sub-bullets parses exactly as today. Field values run through `normalize()` like every other value, so the non-reintroducing argument holds — a value cannot contain a line terminator, therefore cannot start a line, therefore cannot forge a sub-bullet key or an H2.

### Unit 2 — fence-aware markdown scanning (`src/utils/markdown-sections.ts`, new, pure)

Placed in `src/utils/` rather than `src/design/` because generic markdown parsing is not a design-dialogue concern, and because this becomes the repo's one capable fence scanner — the seven existing ones each recognize triple backticks only. Nothing migrates onto it here (see Non-goals); the placement is what makes migration possible later.

- `listSections(md): string[]` — H2 names in document order.
- `extractSection(md, name): string | null` — that section's body, or `null` when the name is not an H2.

Heading identity: a heading line is `^ {0,3}## +(.+?)( +#+)? *$`; the captured name is trimmed, optional closing hashes stripped, and matched **case-sensitively and exactly**. When a document repeats an H2 name, the first occurrence wins and callers can detect the repeat because `listSections` returns it twice. A section body runs from the line after its heading to the line before the next H2 at the same fence depth, or to end of input, with leading and trailing blank lines trimmed and interior blank lines preserved.

The fence scan understands marker character (backtick and tilde), opening runs of three or more, up to three spaces of indentation, info strings, and a closing run at least as long as the opening. A `## Design` inside a fenced block is not a heading. [`extractSummary`](../../../src/core/fd-load.ts#L290) is the shape to follow but not to reuse — its regex is fence-blind.

### Unit 3 — artifact location (`src/design/artifact-locate.ts`, new)

`locateArtifact(cwd, { slug, kind, override })` returns an absolute path, or a reason it found none. It is synchronous and resolves everything under the `cwd` argument, matching the rest of `src/design/` ([`readLedger(cwd, …)`](../../../src/design/ledger.ts#L246), `runContext` returning a number). It reads its directory with `readdirSync` over `join(cwd, roots.specs | roots.plans)` from [`loadDocRoots`](../../../src/core/doc-roots.ts) and reuses only the pure [`extractSpecSlug`/`extractPlanSlug`](../../../src/core/fd-load.ts#L329) helpers. `listSpecs`/`listPlans` are deliberately **not** used: they are async and return paths relative to `process.cwd()`, which is wrong in a worktree and in tests.

Resolution order: an explicit `--spec <path>` override wins, provided it resolves inside `roots.specs` or `roots.plans` — a path escaping the doc roots is rejected, for the same reason [`validateSlug`](../../../src/design/ledger.ts#L86) exists, since this file's contents get printed into chat. Otherwise, candidates are the files whose extracted slug equals the dialogue slug. Exactly one candidate resolves; several — the shape [`extractPlanSlug`](../../../src/core/fd-load.ts#L347) produces for a `-part\d+` split plan — resolve to nothing and report the ambiguity, so the operator names one with `--spec`. Deriving the filename from today's date is not an option: a dialogue that crosses midnight or resumes the next morning would miss its own artifact.

### Unit 4 — digest renderer (`src/design/render.ts`)

`renderContext` becomes a digest. `RenderOpts` gains four optional fields — `section`, `sectionProse`, `sectionNames`, `full` — each with a defined absent-behaviour. Output order:

1. Header — dialogue slug and decided/open counts, plus section progress (`section 3/9 · 2 confirmed`) when `sectionNames` is non-empty.
2. Sections checklist — one marker per `sectionNames` entry: confirmed, unconfirmed, or current. Omitted entirely when `sectionNames` is empty.
3. Scope — collapsed, or whole under `full`.
4. The focus section — `sectionProse`, then the decisions whose `section` equals `section`, expanded with `why` and `instead-of` each on their own line. Omitted when `section` is absent.
5. Decided, Open, Existing support — collapsed. Under a focus section, the decisions already shown in (4) are excluded here rather than repeated.
6. Warnings — one line per stale tag: a `section` value on a decision or thread, or a name in `confirmed`, that matches no entry in `sectionNames`. Suppressed when `sectionNames` is empty, since nothing can be judged stale without an artifact.

With no `section` — the default, and what every not-yet-updated caller gets — the block is the header plus collapsed Scope, Decided, Open and Support. That is a strictly smaller block than today's, never a broken one.

Collapsing is one exported pure helper. It takes the entry, not a bare string, because the withheld-marker names fields the text does not contain: `collapse({ text, why?, insteadOf? })` returns the first sentence plus a marker for what was withheld (remaining sentence count, `+why`, `+alt`). A sentence boundary is `.`, `!`, or `?` followed by whitespace and then an uppercase letter or a digit; with no boundary the whole text renders. `full: true` expands every value — the header, checklist and section ordering stay, so it is not a byte-restoration of today's output.

**Prose containment.** Every line of `sectionProse` renders indented by four spaces. Four is load-bearing: CommonMark allows a fence or an ATX heading at most three spaces of indentation, so a four-space indent makes a `` ``` `` line, a `~~~` line and a `## …` line inside the drafted prose all inert — and a four-space-indented fence cannot close the fenced block the skill wraps the output in. This preserves the second forgery layer that [`render.ts:24-27`](../../../src/design/render.ts#L24-L27) documents, which raw verbatim prose would have broken. Interior blank lines survive, so paragraphs still read as paragraphs.

### Unit 5 — CLI surfaces

[`log-cli.ts`](../../../src/design/log-cli.ts) gains `--because`, `--instead-of`, `--section` and `--confirm-section <name>`. `--because`, `--instead-of` and `--section` bind to the single decision minted in that invocation; because `--decide` is repeatable ([`log-cli.ts:66`](../../../src/design/log-cli.ts#L66)), more than one `--decide` in an invocation carrying any of these three is rejected rather than bound by a guessed rule. `--section` is additionally valid alongside a single `--open`. `--confirm-section` is idempotent — a name already in `confirmed` is not appended twice.

[`context-cli.ts`](../../../src/design/context-cli.ts) gains `--section <name>`, `--spec <path>` and `--full`.

**Section names are never validated at write time.** `design log` stores whatever it is given; the renderer reports a tag that matches no H2 as a warning (Unit 4, item 6). One validation point means the two CLIs cannot disagree about which artifact is authoritative, `design log` needs no `--kind` or `--spec` of its own, and a typo is self-correcting — it surfaces on the next question with the legal names in view — rather than a mid-dialogue hard failure. The cost is that `--confirm-section` accepts a name no artifact carries; that is reported as a stale confirmation and never silently counted as progress.

### Unit 6 — skill prose

[`.claude/skills/noldor-spec/SKILL.md`](../../../.claude/skills/noldor-spec/SKILL.md) step 3 becomes draft-first: after grounding, write a first-pass skeleton to the real spec path with every `prep format spec` section present, each a short paragraph naming its own unknowns inline, and present it explicitly as a strawman. Every clarify question then declares its section, renders the block with `--section <name>`, and records the answer with `--because`/`--instead-of`/`--section`. Step 5 becomes the confirm beat: one to two paragraphs per section, `--confirm-section` on the operator's yes. [`.claude/skills/noldor-plan/SKILL.md`](../../../.claude/skills/noldor-plan/SKILL.md) mirrors it against the plan contract. All four twins move in lockstep — `.claude/skills/…` plus `templates/.claude/skills/…` and `templates/.opencode/command/…` for both dialogues.

## Acceptance criteria

1. A ledger whose decisions carry `section` / `why` / `instead-of` sub-bullets, and whose threads carry `section`, round-trips through `parseLedger` → `serializeLedger` unchanged.
2. A ledger written before this change — flat decision lines, five headings, no `## Confirmed` — parses with the new fields `undefined` and re-serializes byte-identically.
3. Each of these puts the parent section in `unparsed` and makes `design log` exit non-zero writing nothing: an unknown sub-bullet key, a duplicate key on one entry, an empty value, indentation other than two spaces, `why` or `instead-of` under an `O` entry, a sub-bullet with no preceding entry, and an unparseable `## Confirmed`.
4. `listSections` ignores an H2 inside a fenced block for backtick and tilde fences, fences longer than three characters, and fences indented up to three spaces; it returns a repeated H2 name twice.
5. `extractSection` returns the body with interior blank lines intact and leading/trailing blanks trimmed, tolerates optional closing hashes and up-to-three-space heading indentation, matches names case-sensitively, and returns `null` for a name that is not an H2.
6. `locateArtifact` prefers a `--spec` override inside the doc roots, rejects one outside them, returns the sole slug match otherwise, and reports ambiguity — resolving to no path — when several files share the slug.
7. `locateArtifact` resolves against its `cwd` argument, returning the worktree's artifact when `cwd !== process.cwd()`.
8. `collapse` returns the first sentence plus a withheld-marker naming remaining sentences, `+why` and `+alt` as applicable, and returns the whole text when no sentence boundary exists.
9. `design context --section <name>` renders that section's prose and expands only the decisions bound to it; every other decision renders collapsed and none renders twice.
10. Every rendered prose line carries a four-space indent, so a prose line consisting of a fence or an ATX heading appears in the output without opening a fence or a heading.
11. `design context` with no `--section` exits 0 and renders header plus collapsed Scope, Decided, Open and Support, with no checklist and no warnings.
12. `design context --full` renders every value uncollapsed, header and checklist included.
13. `design context` on a dialogue with no locatable artifact exits 0, reports the absent draft, and emits no stale-tag warnings.
14. `design context` emits one warning line per decision `section`, thread `section`, or `confirmed` name that matches no H2 in the located artifact.
15. `design log --decide … --because … --instead-of … --section …` persists all four values on that decision, and `--open … --section …` persists the section on that thread.
16. `design log` exits non-zero when more than one `--decide` accompanies `--because`, `--instead-of` or `--section`.
17. `design log --confirm-section <name>` run twice records the name once.
18. Both dialogue skills and all four twin files carry the draft-first, per-question and confirm-beat instructions, and the existing skill-twin drift detector reports no divergence.

## Risks / trade-offs

The digest reverses a documented invariant. [`render.ts:19-22`](../../../src/design/render.ts#L19-L22) argues no-caps precisely because hiding early decisions invites self-contradiction. The reconciliation is the reader split — the block serves the operator, the ledger file serves the agent, and `--full` expands everything — but that docstring must be rewritten to say so, or the next reviewer reads a live contradiction.

The block is not bounded. The focus section renders its prose in full and expands its own decisions, so a long section produces a long block; only history outside the section is capped at one line per entry. This is deliberate — the section under discussion is the thing the operator is supposed to read — but it means the volume complaint returns for any section whose draft grows past a screen, and the remedy then is splitting the section, not the renderer.

The draft-first strawman is wrong on purpose. An operator who reads it as a claim rather than a provocation will spend the dialogue correcting prose instead of deciding, which is slower than today. The skill prose has to name it a strawman at every presentation. It also means an abandoned dialogue leaves a half-true spec at the real spec path — already true of today's step 5, and still uncommitted until gate Step 2.5, but now from earlier in the session.

Confirmations and section tags are stored verbatim and never auto-pruned. Rename an H2 mid-dialogue and its decisions and its confirmation both go stale: they render under the warning line rather than disappearing, and the operator re-tags or re-confirms by hand. Auto-migration would need to guess which new heading a renamed one became, and guessing wrong loses an approval.

Storing section names without validating them means a typo is caught a question later rather than at the keystroke. Accepted for the single-authority reason in Unit 5; the failure mode is one visible warning, not lost data.

Unit 2 adds the repo's eighth fence scanner rather than removing seven. Placing the only capable one in `src/utils/` is the whole mitigation, and the convergence entry has to actually get written or this reads as duplication with a story attached.

`SKILL.md` is already dense and this adds a step to both dialogues. Mitigated by replacing step 5's prose rather than appending to it; if the file still grows past what an agent reliably follows, that split is its own entry.

## User Story

As an operator driving a Noldor spec or plan dialogue, I want each question to arrive beneath the current draft of the spec section it concerns and beneath decisions that carry their own reasoning and rejected alternatives, so that I am judging the design while it is still cheap to change instead of ratifying one-line answers I cannot evaluate.

## Usage

- Seed once, unchanged: `pnpm noldor design log --slug <dialogue-slug> [--entry <roadmap-slug>] --support "<path:line> — already does X"`.
- Draft-first: write the spec skeleton to `docs/design/specs/YYYY-MM-DD-<slug>-design.md` with every `pnpm noldor prep format spec` section present, before question 1.
- Before every question: `pnpm noldor design context --slug <dialogue-slug> --section "<H2 name>"`, and paste stdout verbatim in a fenced block above the question. Add `--full` to expand everything, `--spec <path>` when several artifacts share the slug or the artifact is not where the slug implies, `--kind plan` in a plan dialogue.
- After every answer: `pnpm noldor design log --slug <dialogue-slug> --resolve <O-id> --decide "<what was settled>" --because "<why>" --instead-of "<what was rejected and why not>" --section "<H2 name>" [--open "<new thread>" ]`. One `--decide` per invocation when any of the three field flags ride along.
- On a section the operator has blessed: `pnpm noldor design log --slug <dialogue-slug> --confirm-section "<H2 name>"`.
- Ledger inspection unchanged: `.noldor/design/<slug>.md`, read freely, never hand-edit.

## Open questions (resolved)

1. *How does `design context` locate the artifact — derived from the slug, or an explicit flag?* -> Both, override first: `--spec <path>` wins when it resolves inside the doc roots, otherwise the sole file whose extracted slug matches, because deriving the name from today's date breaks any dialogue that crosses midnight, and a `-part\d+` plan split makes "newest wins" silently pick one part of a multi-file plan.
2. *Which section names are legal for `--section`?* -> Any, at write time. Validation is a render-time warning against the located artifact's H2 list, because a second validation point is a second opinion about which artifact is authoritative, and this way `design log` needs no `--kind` or `--spec`.
3. *Do the new fields apply to open threads too?* -> `--section` yes, `--because`/`--instead-of` no: a thread is a question, so it belongs to a section but has no rationale or rejected alternative yet. A `why` or `instead-of` sub-bullet under an `O` entry is a fail-closed parse error, not a tolerated extra.
4. *What counts as a sentence boundary for collapsing?* -> `.`, `!`, or `?` followed by whitespace and then an uppercase letter or digit; no abbreviation dictionary, and no boundary means the whole text renders, so the failure mode is a long line rather than a truncated one.
5. *How does drafted prose reach chat without breaking the fenced block that wraps it?* -> A four-space indent on every prose line, which is one more space than CommonMark allows for a fence or an ATX heading, so both become inert without altering a character of the text.
