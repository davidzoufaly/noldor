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
- A decision record carries its reasoning and its rejected alternative, and names the design heading it binds.
- The block's length tracks the heading under discussion rather than the accumulated history: every entry outside that heading costs one line.
- Per-section confirmation is recorded state that goes stale visibly when the prose it approved changes.
- The complete record stays available: nothing the digest collapses becomes unreachable.

## Non-goals

- No hard wrapping, width flag, or terminal-width read. The renderer inserts no line breaks inside a value.
- No new gate: an unconfirmed or stale-confirmed section blocks no commit and no CR lane.
- No change to `normalize()`'s single-line storage rule or the forgery guarantees that rest on it.
- No migration of the repo's seven naive fence scanners onto the capable one this spec adds — [`stripCodeRegions`](../../../src/docs/docs-check.ts#L39), [`parse-blocks.ts:144`](../../../src/utils/parse-blocks.ts#L144), [`write-blocks.ts:36`](../../../src/utils/write-blocks.ts#L36), [`scaffold.ts:24`](../../../src/prep/scaffold.ts#L24), [`backlog-demote.ts:85`](../../../src/garden/backlog-demote.ts#L85), [`skill-code-drift.ts:227`](../../../src/garden/detectors/skill-code-drift.ts#L227), [`validate-triage.ts:159`](../../../src/triage/validate-triage.ts#L159). This change files the convergence backlog entry (criterion 20) and stops there.
- No prose-quality linter. Depth is a skill-prose obligation, not a checked property.
- No write-time validation of heading names. See Unit 5.
- No auto-repair of a stale confirmation or a stale heading tag. Both surface as warnings; the operator re-runs the command.

## Design

### Contracts

Every grammar and signature this design depends on, stated once so the units below can reference rather than restate them.

**Sub-bullet line.** Canonical form is exactly `^  - (section|why|instead-of): (\S.*)$` — two leading spaces, no more, no fewer. A sub-bullet attaches to the nearest preceding `- D<n>` / `- O<n>` line within the same H2; [`splitSections`](../../../src/design/ledger.ts#L120) already discards blank lines, so a blank line does not break attachment. Serialization order is canonical: `section`, then `why`, then `instead-of`.

**Confirmed line.** Exactly `^- (\S.*?) · ([0-9a-f]{8})$` — the heading name, a middle dot, and the first eight hex characters of the sha256 of that heading's body at confirmation time. No sub-bullets. Insertion order is preserved.

**Fail-closed conditions.** Each of these pushes its H2 into `unparsed`, so `design log` refuses the file rather than erasing content on the next reserialize — the rule [`ledger.ts:44-54`](../../../src/design/ledger.ts#L44-L54) already applies to unknown headings: a line matching the loose shape `^\s*-\s*(section|why|instead-of)\s*:` that is not the canonical form; an unknown sub-bullet key; a duplicate key on one entry; an empty value; `why` or `instead-of` under an `O` entry; a sub-bullet with no preceding entry in its H2; a `## Confirmed` line that is not the canonical form; a duplicate or empty name in `## Confirmed`.

**Heading identity.** A heading line is `^ {0,3}(#{2,3}) +(.+?)( +#+)? *$` outside any fence. The captured name is trimmed with optional closing hashes removed, and compared case-sensitively and exactly. Both H2 and H3 are addressable, which is what keeps a contract-fixed `## Design` from swallowing the whole dialogue. A repeated name resolves to its first occurrence and raises a warning.

**Fence rules.** An opening fence is three or more backticks or tildes, indented at most three spaces; a backtick opening's info string must contain no backtick, a tilde opening's is unrestricted. A closing fence has the same marker character, a run at least as long as the opening, at most three spaces of indentation, and nothing but whitespace after it. An unclosed fence runs to end of input, so every heading after it is invisible.

**`collapse` output.** `collapse({ text, why?, insteadOf? }): string` returns the first sentence, then ` (+N more)` when N ≥ 1 sentences remain, then ` (+why)`, then ` (+alt)`, in that order, omitting any that do not apply. A sentence boundary is `.`, `!`, or `?` followed by whitespace and then an uppercase letter or a digit; a trailing fragment with no terminator counts as one sentence; with no boundary at all the whole text renders with no `(+N more)`.

**`locateArtifact` result.** A discriminated union, because the three outcomes need three different CLI behaviours:

```
type LocateResult =
  | { status: 'found'; paths: string[] }
  | { status: 'none' }
  | { status: 'rejected'; reason: string }
```

`kind` is `'spec' | 'plan'`, defaulting to `'spec'` like the existing `--kind`. `paths` holds one file for a spec and one-or-more for a split plan, in ascending filename order.

### Unit 1 — ledger schema and grammar (`src/design/ledger.ts`)

`Decision` gains optional `why`, `insteadOf`, `section`; `OpenThread` gains optional `section`. Both store as sub-bullets under the parent entry line:

```
## Decided

- D3 A decision record gains three optional fields.
  - section: Unit 1 — ledger schema and grammar
  - why: a one-liner drops the reasoning and the road not taken
  - instead-of: why-only; a five-field record; no schema change
```

`LedgerState` gains `confirmed: { name: string; digest: string }[]`, serialized as `## Confirmed`. That section is the one heading the serializer emits **only when non-empty** — [`serializeLedger`](../../../src/design/ledger.ts#L238) otherwise pushes every heading unconditionally, which would rewrite every existing ledger on its next touch. The other five keep emitting unconditionally.

Round-tripping is semantic, not byte-preserving, in one respect: `Decision` stores named fields with no memory of input order, so a ledger whose sub-bullets arrive out of canonical order re-serializes in canonical order. Everything else — including a pre-existing five-heading ledger with flat decision lines — re-serializes byte-identically. Field values run through `normalize()` like every other value, so the non-reintroducing argument holds: a value cannot contain a line terminator, therefore cannot start a line, therefore cannot forge a sub-bullet key or a heading.

### Unit 2 — fence-aware markdown scanning (`src/utils/markdown-sections.ts`, new, pure)

Placed in `src/utils/` rather than `src/design/` because generic markdown parsing is not a design-dialogue concern, and because this becomes the repo's one capable fence scanner — the seven existing ones recognize triple backticks only. Nothing migrates here (Non-goals); the placement is what makes migration possible.

- `listHeadings(md): { name: string; depth: 2 | 3 }[]` — H2 and H3 names in document order, per the heading and fence rules above.
- `extractSection(md, name): string | null` — the body of the first heading with that name, or `null`. The body runs from the line after the heading to the line before the next heading of the same or shallower depth, or end of input, with leading and trailing blank lines trimmed and interior blank lines preserved.

[`extractSummary`](../../../src/core/fd-load.ts#L290) is the shape to follow but not to reuse — its regex is fence-blind.

### Unit 3 — artifact location (`src/design/artifact-locate.ts`, new)

`locateArtifact(cwd, { slug, kind, override })` is synchronous and resolves everything under its `cwd` argument, matching the rest of `src/design/` ([`readLedger(cwd, …)`](../../../src/design/ledger.ts#L246), `runContext` returning a number). It reads `roots.specs` / `roots.plans` from [`loadDocRoots(cwd)`](../../../src/core/doc-roots.ts#L54) **directly** — those are already absolute, so joining them onto `cwd` again would produce `<cwd>/<cwd>/docs/design/specs` and make every dialogue report a missing artifact forever. It reuses only the pure [`extractSpecSlug`/`extractPlanSlug`](../../../src/core/fd-load.ts#L329) helpers; `listSpecs`/`listPlans` are deliberately unused, being async and relative to `process.cwd()`.

An `override` is accepted only when all of these hold, and `rejected` with the failing reason otherwise: it ends in `.md`; `realpathSync` resolves it to a regular file; and that resolved path equals the `kind`'s resolved root or sits beneath it under a separator boundary compare — `p === root || p.startsWith(root + sep)`, so a sibling `docs/design/specs-scratch/x.md` fails where a naive prefix test would pass, and a symlink planted inside the root cannot smuggle a file whose contents get printed into chat.

With no override, candidates are the files in the kind's root whose extracted slug equals the dialogue slug. A spec resolves to one file. A plan resolves to every part: [`extractPlanSlug`](../../../src/core/fd-load.ts#L347) strips `^plan\d+-` and `-part\d+` precisely so one slug matches every part of a split plan, so `paths` holds them all in filename order, `listHeadings` unions their headings in that order, and `extractSection` searches them in that order. No match yields `none`. Deriving the filename from today's date is not an option — a dialogue that crosses midnight would miss its own artifact.

### Unit 4 — digest renderer (`src/design/render.ts`)

`renderContext` becomes a digest. `RenderOpts` gains four optional fields — `section`, `sectionProse`, `headings`, `full`. Artifact location is attempted on every invocation, independent of `--section`, so the checklist and warnings appear whenever an artifact is locatable. Output order:

1. Header — dialogue slug and decided/open counts, plus heading progress (`heading 3/14 · 2 confirmed`) when `headings` is non-empty and `section` names one of them.
2. Headings checklist — one marker per `headings` entry: confirmed, confirmed-but-edited, unconfirmed, or current. Omitted when `headings` is empty.
3. Scope — collapsed, or whole under `full`.
4. Focus heading — `sectionProse`, then the decisions whose `section` equals `section`, expanded with `why` and `instead-of` each on their own line. Omitted when `section` is absent or names no heading.
5. `Decided elsewhere (<shown> of <total>)` under a focus heading, `Decided (<total>)` without one; then Open and Existing support. Collapsed. A decision expanded in (4) is not repeated here, which is why the header names both numbers.
6. Warnings, one line each: `--section` naming no heading, listing the legal names; a decision or thread `section` naming no heading; a `confirmed` name naming no heading; a confirmed heading whose current body digest differs from the recorded one; a heading name appearing twice. Suppressed when `headings` is empty, since nothing is judgeable without an artifact.
7. The existing `⚠ ledger section unparsed` lines ([`render.ts:51-53`](../../../src/design/render.ts#L51-L53)), unchanged — `runContext`'s graceful-degradation contract depends on them.

`--section` naming no heading renders the checklist and the warning and no prose. That is the typo path Unit 5's self-correction rests on, so it is a first-class state rather than an absence.

`full: true` expands every value; header, checklist and ordering stay, so it is not a byte-restoration of today's output.

**Prose containment.** Every line of `sectionProse` renders indented by four spaces. Four is load-bearing: CommonMark allows a fence or an ATX heading at most three spaces of indentation, so a four-space indent makes a `` ``` `` line, a `~~~` line and a `## …` line inside the drafted prose all inert — and a four-space-indented fence cannot close the fenced block the skill wraps the output in. This preserves the second forgery layer [`render.ts:24-27`](../../../src/design/render.ts#L24-L27) documents, which raw verbatim prose would have broken. Interior blank lines survive, so paragraphs still read as paragraphs.

### Unit 5 — CLI surfaces

[`log-cli.ts`](../../../src/design/log-cli.ts) gains `--because`, `--instead-of`, `--section`, `--confirm-section <name>` and `--unconfirm-section <name>`. `--section` applies to every record minted in that invocation — each `--decide` and each `--open` — so a mixed invocation needs no disambiguation rule. `--because` and `--instead-of` bind to a single decision, so an invocation carrying either alongside more than one `--decide` is rejected. `--confirm-section` stores the name with the digest of that heading's current body and is idempotent on an unchanged body; re-running it after an edit replaces the digest, which is the re-confirm path. `--unconfirm-section` removes the entry and is a no-op when absent. Confirming or unconfirming a name no artifact carries is allowed and surfaces as a warning — the write side never blocks.

[`context-cli.ts`](../../../src/design/context-cli.ts) gains `--section <name>`, `--spec <path>` and `--full`. A `rejected` override is the one new failure: stderr plus exit 1, narrowing `runContext`'s "only an invalid slug ever fails" docstring ([`context-cli.ts:43-49`](../../../src/design/context-cli.ts#L43-L49)), which must be updated to say so. `none` still exits 0 and reports the absent draft.

**Heading names are never validated at write time.** `design log` stores what it is given; the renderer warns on a tag matching no heading. One validation point means the two CLIs cannot disagree about which artifact is authoritative, `design log` needs no `--kind` or `--spec`, and a typo self-corrects at the next question with the legal names in view instead of failing mid-dialogue.

### Unit 6 — skill prose

[`.claude/skills/noldor-spec/SKILL.md`](../../../.claude/skills/noldor-spec/SKILL.md) step 3 becomes draft-first: after grounding, write a first-pass skeleton to the real spec path with every `prep format spec` section present, each a short paragraph naming its own unknowns inline, and present it explicitly as a strawman. Every clarify question then declares its heading, renders the block with `--section <name>`, and records the answer with `--because`/`--instead-of`/`--section`. Because `## Design` is contract-fixed and is where most decisions land, questions about it address its H3 unit headings rather than the H2. Step 5 becomes the confirm beat: one to two paragraphs per section, `--confirm-section` on the operator's yes. [`.claude/skills/noldor-plan/SKILL.md`](../../../.claude/skills/noldor-plan/SKILL.md) mirrors it against the plan contract. All four twins move in lockstep — `.claude/skills/…`, `templates/.claude/skills/…` and `templates/.opencode/command/…` for both dialogues.

## Acceptance criteria

1. A ledger whose decisions carry `section` / `why` / `instead-of` sub-bullets in canonical order, and whose threads carry `section`, round-trips through `parseLedger` → `serializeLedger` byte-identically; sub-bullets supplied out of canonical order re-serialize in canonical order with the same values.
2. A ledger written before this change — flat decision lines, five headings, no `## Confirmed` — re-serializes byte-identically, with the new fields `undefined`.
3. Every fail-closed condition named in Contracts puts its H2 in `unparsed` and makes `design log` exit non-zero writing nothing.
4. `listHeadings` returns H2 and H3 names with depth in document order, ignoring headings inside backtick and tilde fences, fences longer than three characters, fences indented up to three spaces, and everything after an unclosed fence; a closing run followed by non-whitespace does not close, nor does a mismatched marker character.
5. `extractSection` returns the first same-named heading's body with interior blank lines intact and outer blanks trimmed, stops at the next heading of equal or shallower depth, tolerates closing hashes and up-to-three-space indentation, matches case-sensitively, and returns `null` for an unknown name.
6. `locateArtifact` returns `found` with one path for a spec, `found` with every part in filename order for a split plan, `none` when nothing matches, and `rejected` with a reason for an override that is not a `.md` regular file or resolves outside the kind's root — including a sibling directory sharing the root's prefix and a symlink planted inside the root.
7. `locateArtifact` resolves against its `cwd` argument, returning the worktree's artifact when `cwd !== process.cwd()`.
8. `collapse` emits the first sentence followed by `(+N more)`, `(+why)`, `(+alt)` in that order for the parts that apply, counts a terminatorless trailing fragment as a sentence, and returns the whole text with no `(+N more)` when no boundary exists.
9. `design context --section <name>` renders that heading's prose and expands only the decisions bound to it, none of which repeat in the collapsed bucket, whose header names both the shown and total counts.
10. `design context --section <name>` where the name matches no heading exits 0 and renders the checklist plus a warning listing the legal names, and no prose.
11. Every rendered prose line carries a four-space indent, so a prose line consisting of a fence or an ATX heading appears in the output without opening either.
12. `design context` with no `--section` exits 0 and renders header, checklist and collapsed buckets, with no focus heading.
13. `design context --full` renders every value uncollapsed, header and checklist included.
14. `design context` with `locateArtifact` returning `none` exits 0, reports the absent draft, and emits no heading warnings; with `rejected` it exits 1 naming the reason.
15. `design context` emits one warning per unknown decision tag, unknown thread tag, unknown confirmed name, digest-mismatched confirmation, and duplicated heading name, and still emits the existing `⚠ ledger section unparsed` lines.
16. `design log --decide … --because … --instead-of … --section …` persists all four values on that decision; `--section` alongside several `--decide` and `--open` values applies to every record minted.
17. `design log` exits non-zero when `--because` or `--instead-of` accompanies more than one `--decide`.
18. `design log --confirm-section <name>` records name plus body digest, is idempotent on an unchanged body, replaces the digest after an edit, and `--unconfirm-section` removes the entry and no-ops when absent.
19. Both dialogue skills and all four twin files carry the draft-first, per-heading and confirm-beat instructions, and the existing skill-twin drift detector reports no divergence.
20. `docs/backlog.md` carries an entry for converging the seven naive fence scanners onto `src/utils/markdown-sections.ts`.

## Risks / trade-offs

The digest reverses a documented invariant. [`render.ts:19-22`](../../../src/design/render.ts#L19-L22) argues no-caps precisely because hiding early decisions invites self-contradiction. The reconciliation is the reader split — the block serves the operator, the ledger file serves the agent, and `--full` expands everything — but that docstring must be rewritten to say so, or the next reviewer reads a live contradiction.

The block is not bounded. The focus heading renders its prose in full and expands its own decisions, so a long heading produces a long block; only history outside it is capped at one line per entry. Addressing H3s is what keeps this usable against the contract-fixed `## Design`, and it means the remedy for a bloated focus is a finer heading, which the spec contract permits at H3 but not at H2.

A confirmation is only as honest as its digest. The digest catches an edited body, but it is computed over the heading's own text only — a change to a *different* heading that invalidates this one's reasoning leaves the confirmation green. Detecting that needs semantics, not hashing.

The draft-first strawman is wrong on purpose. An operator who reads it as a claim rather than a provocation will spend the dialogue correcting prose instead of deciding, which is slower than today. The skill prose has to name it a strawman at every presentation. It also means an abandoned dialogue leaves a half-true spec at the real spec path — already true of today's step 5, still uncommitted until gate Step 2.5, but now from earlier in the session.

Storing heading names without validating them means a typo is caught a question later rather than at the keystroke. Accepted for the single-authority reason in Unit 5; the failure mode is one visible warning, not lost data.

Unit 2 adds an eighth fence scanner rather than removing seven. Criterion 20 makes the convergence a filed entry rather than an intention, but a filed entry is not a shipped one, and until it ships this is duplication with a plan attached.

`SKILL.md` is already dense and this adds a step to both dialogues. Mitigated by replacing step 5's prose rather than appending; if the file still outgrows what an agent reliably follows, that split is its own entry.

## User Story

As an operator driving a Noldor spec or plan dialogue, I want each question to arrive beneath the current draft of the heading it concerns and beneath decisions that carry their own reasoning and rejected alternatives, so that I am judging the design while it is still cheap to change instead of ratifying one-line answers I cannot evaluate.

## Usage

- Seed once, unchanged: `pnpm noldor design log --slug <dialogue-slug> [--entry <roadmap-slug>] --support "<path:line> — already does X"`.
- Draft-first: write the spec skeleton to `docs/design/specs/YYYY-MM-DD-<slug>-design.md` with every `pnpm noldor prep format spec` section present, before question 1.
- Before every question: `pnpm noldor design context --slug <dialogue-slug> --section "<H2 or H3 name>"`, and paste stdout verbatim in a fenced block above the question. Add `--full` to expand everything, `--spec <path>` to name the artifact explicitly, `--kind plan` in a plan dialogue.
- After every answer: `pnpm noldor design log --slug <dialogue-slug> --resolve <O-id> --decide "<what was settled>" --because "<why>" --instead-of "<what was rejected and why not>" --section "<heading>" [--open "<new thread>" ]`. One `--decide` per invocation when `--because` or `--instead-of` rides along.
- On a heading the operator has blessed: `pnpm noldor design log --slug <dialogue-slug> --confirm-section "<heading>"`. Re-run it after editing that heading to re-confirm; `--unconfirm-section` withdraws it.
- Ledger inspection unchanged: `.noldor/design/<slug>.md`, read freely, never hand-edit.

## Open questions (resolved)

1. *How does `design context` locate the artifact — derived from the slug, or an explicit flag?* -> Both, override first: `--spec <path>` wins when it is a `.md` regular file resolving inside the kind's root under a separator boundary compare, otherwise the slug match. Deriving the name from today's date breaks any dialogue that crosses midnight.
2. *Which heading names are legal for `--section`?* -> Any, at write time; validation is a render-time warning against the located artifact's headings. A second validation point would be a second opinion about which artifact is authoritative, and this way `design log` needs no `--kind` or `--spec`.
3. *H2 only, or H3 too?* -> Both. `## Design` is fixed by the `prep format spec` contract and is where nearly every decision lands, so an H2-only focus degenerates on the densest section of every spec.
4. *Do the new fields apply to open threads too?* -> `--section` yes, `--because`/`--instead-of` no: a thread is a question, so it belongs to a heading but has no rationale or rejected alternative yet. Either field under an `O` entry is a fail-closed parse error, not a tolerated extra.
5. *What happens to a confirmation when its prose is edited afterwards?* -> `## Confirmed` stores a sha256 prefix of the body, and a digest mismatch renders as a stale confirmation; re-running `--confirm-section` replaces it, `--unconfirm-section` withdraws it. Auto-pruning would need to guess which heading a renamed one became, and guessing wrong discards an approval.
6. *How does drafted prose reach chat without breaking the fenced block that wraps it?* -> A four-space indent on every prose line, one more than CommonMark allows for a fence or an ATX heading, so both become inert without altering a character of the text.
