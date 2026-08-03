# De-Superpowers: Vendor Spec, Plan and Worktree Flows — Inline Design Context — Design

**Slug:** de-superpowers-vendor-spec-plan-and-worktree-flows-inline-design-context (enhancement of parent `de-superpowers-vendor-spec-plan-and-worktree-flows`)
**FD:** docs/features/de-superpowers-vendor-spec-plan-and-worktree-flows.md
**Date:** 2026-08-03
**Tier:** specs-only
**Deps:** none (attaches to the `de-superpowers-vendor-spec-plan-and-worktree-flows` FD; roadmap entry Q-0053, M / high impact / area tooling)

## Problem

The two design-dialogue skills — [`noldor-spec`](../../../.claude/skills/noldor-spec/SKILL.md) and [`noldor-plan`](../../../.claude/skills/noldor-plan/SKILL.md) — pose questions one per message with no surrounding state. `noldor-spec/SKILL.md:3` mandates "Ask questions ONE per message, multiple-choice preferred", and step 5 tells the agent to write sections to disk as they stabilize, but nothing requires the *question turn itself* to carry context. The operator therefore answers blind on four axes at once:

1. **Settled decisions** — what was already agreed earlier in the dialogue. Not recoverable from chat scrollback after a long session, and not in the draft until a section stabilizes.
2. **Existing support** — which real files, CLIs, and skills already cover the thing being asked about. Absent, the operator answers as if greenfield.
3. **Open threads** — the unresolved question queue. Without it the operator cannot tell whether this is the last question or one of eight, cannot reorder, cannot batch.
4. **Scope boundary** — what the entry was triaged to include. Absent, answers silently grow the feature.

All four were confirmed as equally load-bearing by the operator during this spec's own dialogue (which is itself the reproduction case).

The cost is paid every turn: the operator reconstructs "where do we stand" from memory, and reconstruction errors surface late — as a contradicted decision inside an already-written spec section, or as scope drift that only the CR gate catches.

## Goals

- Every design question posed by `noldor-spec` or `noldor-plan` is preceded, in the same message, by a rendered block covering the four axes above.
- The block is **plain inline chat text** — identical output under `claude`, `codex`, and `opencode`. No dependence on any runner's rich UI, native tool, or prompt widget.
- The running state lives on disk, so it survives context compaction, a killed session, and a `--resume` re-entry.
- Rendering is deterministic and unit-testable: the same on-disk state always produces the same block.
- The block stays bounded — detailed enough to answer from, short enough that it never buries the question.

## Non-goals

- No runner-specific rendering (no `AskUserQuestion` option previews as the delivery mechanism, no dashboard page, no TUI).
- No automatic extraction of decisions from chat history or from git — the agent records them explicitly as the dialogue proceeds.
- No change to the spec/plan **format contracts** in [`src/prep/print-format.ts`](../../../src/prep/print-format.ts). `## Open questions (resolved)` remains the finalized-artifact surface; this feature governs the *dialogue*, not the artifact.
- No gate-flow restructuring. Step 2.5 lanes, commits, and continue-dialogs are untouched.
- Not a general-purpose agent memory. The ledger is scoped to one design dialogue and is transient scratch.

## Design

### Unit 1 — Ledger file (`.noldor/design/<slug>.md`)

Single purpose: hold the running design state for one dialogue, on disk, as markdown with fixed H2 sections — append-only except `## Scope`, which is a standing statement and is overwritten in place.

- Location `.noldor/design/<slug>.md`, gitignored — mirrors the existing untracked-scratch precedent `.noldor/research/` and `.noldor/cr/` (see [`.gitignore:22,38`](../../../.gitignore)). Never committed; superseded by the finalized spec.
- `<slug>` is the *dialogue* slug: the feature slug on `*-new` paths, `<parent>-<enhancement>` on `*-attach` paths — same key that names the spec file.
- Four rendered sections, written only by code (Unit 2): `## Scope`, `## Decided`, `## Open`, `## Existing support`. Plus one non-rendered lookup key, `## Entry` — a section holding exactly one bullet, `- <roadmap-entry-slug>` (bullet form for the same no-forgery reason as every other value; readers strip the `- ` prefix before use). Needed because on attach paths the dialogue slug is not the entry slug (see Unit 3 scope resolution).
- Entries carry stable auto-assigned IDs — `D1..Dn` for decisions, `O1..On` for open threads — so a question can reference "resolves O2" and the operator can name a thread without quoting it.
- Resolved threads are struck, not deleted: `O2 ~~…~~ → D5`. History is cheap on disk and the renderer hides it (Unit 3).

### Unit 2 — Ledger writer (`noldor design log`)

Single purpose: append to the ledger with code-assigned IDs, so no format drift is possible.

```
pnpm noldor design log --slug <slug> [--entry <roadmap-slug>] [--scope <text>] [--decide <text>]... [--open <text>]... [--resolve <id>]... [--support <text>]...
```

- `--decide`, `--open`, `--resolve`, `--support` are repeatable; a single invocation can resolve `O2` and record the `D5` it produced.
- `--scope` overwrites the `## Scope` section (it is a standing statement, not a log).
- `--entry <roadmap-slug>` replaces the single bullet under `## Entry` — the roadmap lookup key for Unit 3's scope resolution. Seeded once at dialogue start on attach paths, where it differs from the dialogue slug; omitting it on `*-new` paths is fine (the dialogue slug is the entry slug there).
- `--support <text>` appends an `## Existing support` bullet — a `path:line` plus a few words on what it already covers. The agent supplies these because relevance is a judgment call no scan can make.
- Creates the ledger on first write with all five section headings present, `## Entry` included and empty; `--entry` fills it later without restructuring the file.
- **Free text is normalized on append**, so no value can forge a section boundary, an ID, or a resolution. Exactly two rules, both **non-reintroducing** — the output of each rule cannot re-create the pattern that rule removes, which is the property the guarantee rests on (they also happen to be idempotent, which is what the tests assert; the two are not the same property, and a future rule must satisfy the former):
  1. every run of whitespace containing a newline → a single space;
  2. every run of two-or-more tildes → one tilde (`/~{2,}/g → '~'`), which cannot re-form `~~` the way a `~~` → `~ ~` substitution can (`"~~~".replaceAll("~~","~ ~")` → `"~ ~~"`, still matching the resolved-marker shape).

  No `#` escaping is needed, because **every value the CLI writes is stored as a bullet at column 0** — `- D1 <text>` / `- O1 <text>` for entries, and, critically, `- <text>` for the `## Scope` body and the `## Entry` value too. Normalized text therefore never begins a line, so it cannot open a heading (`--scope "## Open"` lands as `- ## Open` inside the Scope section, not as a new section). The renderer prints the stored text verbatim; there is no unescape step, so what the operator reads is the stored string.

  **The same protection must hold at render time**, since Unit 4 pastes the renderer's stdout into chat. Two independent layers, either one sufficient, both free: the renderer never strips the `- ` prefix from a value line (so no value starts a line even unfenced), and the skill pastes the block inside a fenced code block (so nothing inside is interpreted as markdown at all). Stripping the prefix would leave the fence as the only defense — hence the rule. Note the asymmetry with `## Entry`, whose reader *does* strip `- ` before the equality compare in Unit 3: stripping is a parse-side operation on a non-rendered value, never a render-side one.

  These rules are what make the fail-closed condition below concrete: a ledger written by this CLI always has one bullet per entry under a known heading, so "cannot be parsed" means the file was hand-edited.
- Idempotence is *not* claimed for `--decide` / `--open` (an append is an append); `--resolve` on an already-resolved ID is a no-op that exits 0.
- Unknown `--resolve` ID → exit 1 with the known IDs listed. A typo must not silently drop a resolution. A `D` ID handed to `--resolve` is exactly this case: decisions are not resolvable, so it takes the unknown-ID exit-1 path.
- **Every slug-shaped input on both subcommands is validated** against the shared slugify pattern (reuse [`src/utils/slugify.ts`](../../../src/utils/slugify.ts)) before any file access: `--slug` on `design log` *and* on `design context`, plus `--entry` and `--fd`. A value containing `/` or `..` would otherwise escape `.noldor/design/` on write, or make `design context` read-and-print an arbitrary `.md` into the chat — `--slug` and `--fd` are both path components. `--entry` is never a path component (it is only an equality key against `BacklogEntry.slug`, step 2 below); it is validated as defense-in-depth and for a uniform error message, not against traversal. Invalid → exit 1 before any read or write, on both subcommands.
- **The writer fails closed on a malformed ledger.** Unlike the renderer (which degrades, Unit 3), `design log` must parse existing entries to assign the next ID; continuing from "the highest ID it can still read" would re-issue an ID and break the never-reused guarantee. So: if `## Decided` or `## Open` cannot be parsed, `design log` writes nothing and exits 1 naming the section and the file, telling the operator to fix or delete the ledger. Rendering still works throughout, so the dialogue is never blocked by this.

### Unit 3 — Renderer (`noldor design context`)

Single purpose: read the ledger and print the bounded four-section block.

```
pnpm noldor design context --slug <slug> [--kind spec|plan] [--fd <fd-slug>]
```

- Pure function `renderContext(state: LedgerState, opts): string` in `src/design/render.ts`, separated from all I/O so it is unit-testable on literal inputs.
- Section order is fixed — **Scope → Decided → Open → Existing support** — and the block is printed *above* the question, so the question is the last thing the operator reads.
- **No caps.** Every recorded decision, every open thread, and every support bullet renders, one line each. A 20-decision dialogue prints 20 lines. Hiding early decisions would remove context exactly where self-contradiction risk is highest, and a cap is untestable taste; one line per entry is the only bound.
- Resolved open threads do not render (they are visible as the decisions they became); the `Open (n)` count reflects unresolved only.
- Missing ledger → exit 0 printing just the auto-derived Scope plus `(no decisions recorded yet)`. Never fails the dialogue.
- `--kind plan` changes only the Scope header label (`Plan scope`) and nothing else: the plan dialogue reuses the same ledger, so decisions taken at spec time stay visible while planning.

**Scope resolution** — `loadScope()` in `src/design/ledger.ts`, first hit wins. The dialogue slug is *not* usable as a lookup key on attach paths (it is `<parent>-<enhancement>`, which matches neither the roadmap entry slug nor the FD filename), so both repo lookups take their key from elsewhere:

1. the ledger's `## Scope` section (explicit, written by `--scope`);
2. the `docs/roadmap.md` block whose `BacklogEntry.slug` equals the ledger's `## Entry` value — the single bullet under that heading with its `- ` prefix stripped (Unit 1/2: recorded once at seed time via `design log --entry <roadmap-slug>`), falling back to the dialogue slug when no `## Entry` was recorded — which is the `*-new` case, where the two are the same string. Parsed with `parseRoadmap()` from [`src/utils/parse-blocks.ts`](../../../src/utils/parse-blocks.ts) (the parser [`src/core/next-priority.ts:10`](../../../src/core/next-priority.ts) uses), reading `.description`. Re-read every turn, so an entry retired mid-dialogue simply falls through to the next step;
3. `## Summary` of `docs/features/<fd-slug>.md`, where `<fd-slug>` is `--fd` when passed, else the `parent` of a `specs-only-attach` / `full-attach` session marker read via `readSession()` ([`src/core/session.ts`](../../../src/core/session.ts)), else the dialogue slug. (`*-new` markers are not consulted: their `slug` *is* the dialogue slug, so the marker read would be a dead branch duplicating the fallback.)
4. literal `(scope not recorded)`.

Steps 2 and 3 are what make the *attach* path work — the flagship case for this feature, since the enhancement dialogue is exactly where the operator has least context. Both are covered by acceptance criteria with attach-shaped fixtures.

The renderer itself stays pure: resolution happens in the loader and the resolved string is passed in.

### Unit 4 — Skill contract (prose, both skills + `templates/` twins)

Single purpose: make the render-before-question step mandatory, and the ledger write mandatory after each answer.

- `noldor-spec/SKILL.md` step 3 gains: at dialogue start seed with `design log --slug <dialogue-slug> --entry <roadmap-slug> --support "…"` (one `--support` per relevant anchor found while grounding, `--entry` only when it differs from the dialogue slug); then run `design context` and paste its stdout verbatim, inside a fenced code block, immediately above **every** question (the fence is the render-time half of the no-forgery guarantee in Unit 2, and keeps the block visually distinct from the question); after the operator answers, `design log --decide/--resolve` before the next question. Flag names are quoted exactly as Unit 2 defines them — `--support`, not `--existing-support` — since skill prose is the executable contract and an unknown option aborts the seeding call.
- `noldor-plan/SKILL.md` step 1 gains the same loop with `--kind plan`, seeded from the spec it reads.
- Both files have byte-identical twins under [`templates/.claude/skills/`](../../../templates/.claude/skills/) — every edit is mirrored or the template-sync gate fails.

### Data flow

```
operator answer
   → design log --decide/--resolve/--open        (Unit 2 writes .noldor/design/<slug>.md)
   → design context                              (Unit 3 reads it, prints block)
   → agent pastes block + next question          (Unit 4 prose mandates both calls)
   → operator answers with all four axes visible
```

Dialogue end: the finalized spec absorbs the ledger's Decided section into `## Open questions (resolved)`; the ledger stays on disk, untracked, and is irrelevant thereafter.

### Error handling

- Malformed / hand-edited ledger → the parser keeps the sections it can read and prints a `⚠ ledger section unparsed: <name>` line inside the block. A broken scratch file must degrade, never block a design dialogue.
- Unwritable `.noldor/` → `design log` exits 1 with the path; the skill surfaces it and continues the dialogue without the block rather than halting.
- Concurrent dialogues in separate worktrees never collide: each worktree has its own `.noldor/`.

### Unit 5 — Registration (mandatory framework wiring)

Single purpose: make the two subcommands first-class so the framework's own gates accept them.

- [`src/cli/manifest.ts`](../../../src/cli/manifest.ts) gains a `design` group with `subs: { context: { src: 'design/context-cli.ts' }, log: { src: 'design/log-cli.ts' } }` — same shape as the `research` group at `manifest.ts:67`.
- [`docs/noldor/script-catalog.md`](../../../docs/noldor/script-catalog.md) gains an entry per subcommand (Trigger / Inputs / Outputs), or [`src/cli/validate-script-catalog.ts`](../../../src/cli/validate-script-catalog.ts) fails the commit — the gate landed by Q-0042.
- Root [`.gitignore`](../../../.gitignore) and the transient-state block that `noldor init` writes (`.gitignore:59-66`) both gain `.noldor/design/`, so consumer repos never commit a ledger.

## Acceptance criteria

- `pnpm noldor design log --slug s --decide "a" --decide "b"` creates `.noldor/design/s.md` with decisions `D1` and `D2`, in that order.
- A second `design log --slug s --decide "c"` appends `D3` — IDs never reused, never renumbered.
- `design log --slug s --open "x" --open "y"` records `O1`,`O2`; a later `--resolve O1 --decide "z"` marks `O1` resolved and records the new decision.
- `design log --slug s --resolve O9` (unknown ID) exits 1 and lists the known IDs; the ledger is unchanged.
- `design log --slug s --resolve O1` twice exits 0 both times, and `O1` appears resolved exactly once.
- `renderContext()` output places sections in the order Scope, Decided, Open, Existing support; every unresolved open thread and every decision appears; resolved threads do not.
- `renderContext()` on an empty ledger returns a block containing the resolved Scope and `(no decisions recorded yet)` — never an empty string, never a throw.
- `design context --slug s` for a slug with no ledger exits 0 and prints the roadmap-derived Scope (asserted against a fixture roadmap).
- Scope resolution honours the documented precedence: with both a ledger `## Scope` and a matching roadmap block present, the ledger text is rendered.
- **Attach case, roadmap:** ledger slug `parent-enh` whose `## Entry` section holds the bullet `- some-entry-slug` (bullet form, matching Unit 1 — not a `## Entry: <value>` inline heading) and no `## Scope` resolves Scope from the fixture roadmap block `some-entry-slug` — the case that would silently render `(scope not recorded)` without the `## Entry` key.
- **Attach case, FD:** with the roadmap block absent and a session marker `{ path: 'specs-only-attach', parent: 'p', enhancement: 'enh' }`, `design context --slug p-enh` resolves Scope from `docs/features/p.md` `## Summary`; `--fd p` produces the same output with no marker present.
- `design log --slug s --entry e1` then `--entry e2` leaves exactly one `- `-prefixed bullet under `## Entry`, holding `e2` (overwrite, not append — asserting the heading count instead would pass vacuously, since there is always exactly one heading line).
- A value containing a backtick run — `design log --slug s --decide '``` end'` — cannot close the fence the skill wraps the block in, because every rendered value line carries the `- ` prefix, and a closing fence may be preceded only by up to three spaces of indent (CommonMark) — never by other characters.
- `design log --slug "../escape"` exits 1 and creates no file outside `.noldor/design/`; `design context --slug "../../etc/passwd"` and `design context --slug s --fd "../secret"` likewise exit 1 and print nothing (asserted per input: `--slug` on both subcommands, `--entry`, `--fd`).
- `design log --slug s --decide $'line one\n## Open\nforged'` — ANSI-C quoting, unquoted, so a real newline reaches the CLI (inside double quotes `$'\n'` is literal and the test would pass with normalization absent) — yields exactly one `D1` line under `## Decided` and no new `## Open` section; a subsequent `design context` shows one decision and zero open threads. Unit tests assert the same against `"line one\n## Open"` passed directly to the writer, bypassing shell quoting entirely.
- `design log --slug s --scope "## Open"` leaves the ledger with exactly five line-anchored headings (`/^## /gm`, not a substring count — the stored `- ## Open` bullet contains `## ` mid-line by design); `design context` shows that text as the Scope bullet, still `- `-prefixed, and reports zero open threads.
- `normalize()` output never matches the patterns the rules remove — no `/~{2,}/`, no newline-bearing whitespace run — asserted directly, since non-reintroduction (not idempotence) is the property the no-forgery guarantee rests on.
- `design log --slug s --open $'thread ~~done~~ → D3'` records an *unresolved* `O1`; `design context` still lists it under Open, i.e. the marker syntax in free text does not forge a resolution. Same assertion for the recombination input `~~~done~~~ →`, and `normalize(normalize(x)) === normalize(x)` for both.
- `design log --slug s --resolve D1` exits 1 (decisions are not resolvable) and leaves the ledger unchanged.
- `design log` against a ledger whose `## Decided` section is mangled exits 1, names the section, and writes nothing — while `design context` on that same ledger still exits 0 with the `⚠` line.
- A ledger whose `## Decided` heading has been hand-mangled still renders the other three sections plus one `⚠ ledger section unparsed: Decided` line.
- `design context --slug s --kind plan` differs from `--kind spec` only in the Scope header label (asserted by diffing the two outputs).
- `pnpm noldor design --help` lists both subcommands (existing subcommand-help guard).
- `pnpm noldor validate script-catalog` passes with the two new subcommands documented.
- `pnpm verify` is green, and the twin check passes for both edited SKILL.md files.
- `.gitignore` matches `.noldor/design/<anything>.md` (asserted via `git check-ignore`).

## Risks / trade-offs

- **Prose compliance is the weak link.** Units 1-3 are enforceable code, but "render before every question" lives in skill prose (Unit 4) — the same class of instruction the current failure already ignores. Accepted: a dialogue turn has no commit to gate on, so there is nothing to hook. The mitigation is that the block is now *cheap* (one command, deterministic output) rather than a reconstruction effort, which is what actually drives compliance.
- **Two extra subprocess calls per question turn** (`log`, then `context`). Adds latency to a human-paced loop; negligible against the operator's read time.
- **Ledger is untracked**, so a design dialogue's reasoning trail is lost if the worktree is deleted before the spec finalizes. Accepted — the spec's `## Open questions (resolved)` is the durable record; the ledger is scratch by design.
- **A stale ledger can mislead.** Re-entering a dialogue for the same slug months later renders decisions from the first round as if current. No expiry is implemented (YAGNI); the Scope line names the slug, and the operator can delete the file.
- **Attach-path Scope still depends on one prose-driven seed.** `## Entry` is only present if the agent passed `--entry` at dialogue start. Forgetting it degrades Scope to the FD `## Summary` (parent-level, coarser but still useful) and only then to `(scope not recorded)` — a graceful ladder, not a cliff, which is why no gate enforces the seed.
- **`--kind plan` reuses the spec ledger.** If a plan-stage decision contradicts a spec decision, both render, with no marker of which stage produced which. Deferred: recording a stage per entry can be added without a format break.

## User Story

As a framework operator answering design questions from `noldor-spec` or `noldor-plan`, I want the running design state — scope, decisions so far, open threads, and the existing support the answer must fit — rendered as plain text immediately above every question, so that I can answer from visible state instead of reconstructing it from memory, in any runner.

## Usage

- Seed at dialogue start (agent does this before question 1; `--entry` only on attach paths, where the dialogue slug differs from the roadmap entry slug):
  `pnpm noldor design log --slug <parent>-<enhancement> --entry <roadmap-slug> --support "src/foo.ts:12 — already does X"`
- After each ratified answer:
  `pnpm noldor design log --slug <slug> --resolve O2 --decide "chose CLI-backed ledger"`
- Before each question (agent pastes stdout verbatim above the question — on `claude`, in the assistant message that precedes the `AskUserQuestion` call):
  `pnpm noldor design context --slug <slug>`
- Plan stage, same ledger:
  `pnpm noldor design context --slug <slug> --kind plan`
- Inspect the raw ledger at any time: `.noldor/design/<slug>.md` (untracked).

## Open questions (resolved)

1. *Should compliance be enforced by anything stronger than skill prose — e.g. a counter the gate checks?*
   → **No.** A design question is not a commit; there is no hook point, and a counter would only prove the command ran, not that its output reached the operator. Rationale (D7): the honest lever is making the block cheap and deterministic, plus the existing [skill-vs-code-drift detector](../../features/skill-vs-code-drift-detector.md) catching prose that names a command that no longer exists.
2. *Does the ledger need cleanup — garden pruning, TTL, `noldor design clear`?*
   → **No, ship without it.** Untracked scratch under `.noldor/` has no precedent for pruning (`.noldor/research/`, `.noldor/cr/` both accumulate). Rationale (D8): `rm` is the interface; add pruning only if ledgers are observed to mislead.
3. *One ledger per slug, or one per dialogue round (spec vs plan vs re-round after `address-blockers`)?*
   → **One per slug.** Rationale (D9): the point of the feature is continuity — a plan-stage or re-round question benefits from spec-stage decisions being visible, and splitting files would recreate the blindness at exactly the boundary where it hurts.
4. *Should `design context` also auto-derive the Existing-support bullets (e.g. from the parent FD's `links.code`)?*
   → **No.** Rationale (D10): a dump of 12 `links.code` paths is noise; relevance to *this question* is a judgment only the agent holds, so bullets stay agent-supplied via `--support`.
5. *`<slug>` key on attach paths — feature slug or `<parent>-<enhancement>`?*
   → **`<parent>-<enhancement>`.** Rationale (D11): matches the spec filename convention already used by the gate, so a parent FD carrying several enhancements gets one ledger per enhancement rather than a merged one.
