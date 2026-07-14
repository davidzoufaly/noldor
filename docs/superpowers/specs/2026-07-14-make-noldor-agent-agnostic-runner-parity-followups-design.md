# Make Noldor Agent-Agnostic — Runner Parity Follow-Ups — Design

**Slug:** make-noldor-agent-agnostic-runner-parity-followups (enhancement of parent `make-noldor-agent-agnostic`)
**FD:** docs/features/make-noldor-agent-agnostic.md
**Date:** 2026-07-14
**Tier:** full
**Deps:** none (attaches to the shipped `make-noldor-agent-agnostic` FD; no queue deps)

---

## Problem

`make-noldor-agent-agnostic` (PR #71) shipped a role-based runner registry and three-runner
capability matrix, and `docs/noldor/agent-runtimes.md:8` claims Noldor "supports three agent
runtimes as **simultaneous first-class peers**: Claude Code, Codex, opencode." The 2026-07-13
deep-audit (`.noldor/research/2026-07-13-184850`) found that claim is only half true, and left
three pieces deferred (roadmap Q-0025):

1. **Interactive-surface asymmetry.** Headless parity is real (spawn/drain/CR/research resolve
   through `src/core/agent-runner/registry.ts`), but the *interactive* surface is **14 Claude
   skills** (`.claude/skills/`) vs **2 opencode command shims**
   (`templates/.opencode/command/{noldor-gate,noldor}.md`, and `noldor.md` is a catalog pointer,
   not a skill) vs **0 codex**. The docs don't state the asymmetry. (Audit said "13" Claude
   skills; `noldor-verify` landed in PR #218, so it is now 14 — the count already drifted.)

2. **opencode structured output is unimplemented.** `agent-runtimes.md:23` grades opencode's
   structured output "`--format json` (reserved; treated as prose v1)". No code path parses it:
   opencode stdout flows through the generic prose fence-scan `parseResearchStdout`
   (`src/research/prompt.ts:43-56`), identical to Claude.

3. **`crLanes` vocabulary vs runner roles.** The CR pipeline keys config on lane names
   (`manual/codex/subagent/standalone/verify`, `src/core/lanes.ts:8`) while the registry uses
   roles (`implementer/reviewer/second-opinion/polish/verifier/researcher`,
   `src/core/agent-runner/types.ts:3-11`). Two overlapping vocabularies (`codex` is both a lane
   and a runner) confuse consumers.

A **live-runtime grounding pass (2026-07-14)** additionally found:

- **opencode 1.17.20 is installed** (floor in docs is `0.6.0`), and `opencode run --format json`
  **exists** and emits an NDJSON event stream (verified: `type:"step_start"` / `type:"text"` with
  `part.text` / `type:"step_finish"` with `part.tokens`+`part.cost`). Piece (2) is buildable for
  real.
- **A real bug:** `buildOpencodeArgv` (`src/core/agent-runner/runners/opencode.ts:11-15`)
  hard-codes `--dangerously-skip-permissions`, a **0.6-era flag absent from opencode 1.17's
  `run --help`** (1.17 uses `--auto`, same "respect explicit `deny`" semantics). Current opencode
  spawns pass a flag the installed CLI no longer advertises.
- **codex has no command-file convention.** codex reads `AGENTS.md` natively
  (`templates/AGENTS.md:4`); there is no `.codex/` directory anywhere and no per-skill codex
  files. "codex shims" therefore means AGENTS.md prose, not files.
- **A clean 1:1 `crLanes`→role migration is impossible.** Only 2/5 lanes role-route cleanly
  (`subagent`→`reviewer`, `verify`→`verifier`); `manual` (human) and `standalone` (iTerm
  deep-review, already not an orchestrate lane) have no runner; `codex` is hard-pinned
  (`src/cr/codex.ts:253-255`, bypasses `resolveRunner`) so a `second-opinion` rename would lie
  about re-routability. The `make-noldor-agent-agnostic` ADR **deliberately deferred this rename
  for sink back-compat** (the lane string is embedded in `.noldor/cr/<slug>-<kind>-<lane>.json`
  filenames + the JSON `lane` field). This FD is that revisit.

## Goals

1. **(b) Real opencode structured output.** Parse `opencode run --format json` NDJSON into the
   same `AgentResult` shape other runners return, and fix the `--auto` flag regression. Grade the
   opencode structured-output capability honestly and admit it past the registry gate.
2. **(a) Honest interactive-surface parity.** Author opencode command shims for the
   CLI-verb-backed skills, enrich `templates/AGENTS.md` so codex covers the same skills as prose,
   and flip this repo's `agents.targets` to dogfood opencode+codex so the shims are actually
   exercised (not just authored).
3. **(c) `crLanes`→role-ref aliasing migration.** Canonicalize the two clean lanes to their role
   names, keep the orphan lanes as literals (mixed vocabulary), ship the framework's first
   config-*value* migration with sink back-compat, and record the `migration-coverage` blind spot
   (a narrow lane/`crLanes` content-signal) as a documented deferred guard rather than an over-broad
   whole-file `SCHEMA_SURFACE` entry.
4. **Honesty + drift guards (cross-cutting).** Rewrite the `agent-runtimes.md` "first-class peers"
   claim to state the headless-vs-interactive reality and correct the flag/floor facts; add tests
   that pin the per-runner interactive-shim inventory and the opencode argv so the claims cannot
   silently drift.

## Non-goals

- **opencode per-event streaming into `.noldor/agent-events.jsonl`.** The registry emits one
  `spawned` + one `exited` summary row per spawn (`src/core/agent-events.ts`); per-event opencode
  rows would be net-new emission. YAGNI — deferred.
- **Changing the opencode usage adapter.** `src/core/agent-runner/usage/opencode.ts` already reads
  the on-disk message store for token telemetry and works; the `--format json` work does not touch
  it.
- **Inventing a `.codex/` command-file convention.** codex coverage is AGENTS.md prose; a new
  command-file tree + `agent-filter.ts` prefix branch is rejected as scope creep.
- **The `docs/noldor/README.md` docs-index rewrite** (adding `agent-runtimes.md`/`drain-mode.md`
  rows, fixing the "adoption-guide stub" line). Owned by **Q-0043 (README Rewrite)**; this FD only
  rewrites `agent-runtimes.md` *content*. See Open Question (D6).
- **Shimming `noldor-verify`** as a command (it is a discipline rule → AGENTS.md prose) and
  **`noldor-refactor`/`noldor-release-sweep`** deep behavior (heavy Claude-agent orchestration; a
  thin pointer can name the flow but not reproduce it). See (D3).

## Design

Ordered units, **b → a → c** (Unit 3 is last and independently droppable if runway runs out).

### Unit 1 — opencode `--format json` event parsing + `--auto` flag fix (piece b)

**1.1 Fix the permission flag.** In `src/core/agent-runner/runners/opencode.ts:11-15`, replace
`--dangerously-skip-permissions` with `--auto` (verified against `opencode run --help` on 1.17.20;
`--auto` = "auto-approve permissions that are not explicitly denied", preserving the "respect
explicit `deny` in opencode.json" semantics the current comment relies on). Update the dated
verification comment (lines 6-10) to 2026-07-14 / opencode 1.17.

**1.2 Add *conditional* `--format json` to argv.** `buildOpencodeArgv(prompt, { model?, jsonEvents? })`:
when `jsonEvents` is true, append `--format json` so the spawn emits the NDJSON event stream —
mirroring codex's conditional `--output-schema` push (`src/core/agent-runner/runners/codex.ts:18`).
The registry sets `jsonEvents` (§1.4) so only programmatically-parsed spawns opt in; human/log-facing
spawns keep opencode's default formatted output.

**1.3 New events parser.** Add `src/core/agent-runner/opencode-events.ts` exporting
`parseOpencodeEvents(stdout: string): { text: string; tokens: TokenUsage | null }`:
- Split stdout on newlines, `JSON.parse` each non-empty line, tolerate malformed lines (skip, do
  not throw — fail-open like the usage adapters, `usage/types.ts:18-24`).
- `text` = concatenation of `part.text` from every `type === 'text'` event.
- `tokens` = from the terminal `type === 'step_finish'` event's `part.tokens`
  (`{input, output, total}` mapping; `source: 'opencode-events'`), else `null`.
- Fixture-tested against the captured NDJSON sample (see Acceptance).

**1.4 Parse at the registry return boundary (single source of truth), for parsed spawns only.**
The registry sets `jsonEvents = resolved.runner === 'opencode' && <stdout piped for programmatic
use>` — i.e. **not** `stdio: 'inherit'` (drain implementer streams to the terminal) and **not**
tee/`logSink` mode (`registry.ts:126-130` forwards raw chunks to parent stdio + the sink file for
human/log display). For those parsed spawns opencode runs with `--format json`, and the registry
replaces the accumulated `stdout` (`registry.ts:204-207` accumulate → `:233` return) with
`parseOpencodeEvents(raw).text` — the single seam, so **every programmatic consumer** gets prose,
not NDJSON: `cr/lanes/subagent-dispatch.ts` (reviewer), `cr/lanes/verify-dispatch.ts` (verifier),
`release/llm-polish-summary.ts` (polish), piped `prep/spawn.ts` implementer, and `research/fanout.ts`
(researcher — whose prose fence-scan `parseResearchStdout` then runs over clean assistant text). The
**inherit/tee spawns run in opencode's default formatted mode** (no `--format json`), so the drain
terminal (`autonomous/drain-io.ts`) and CR `logSink` files keep human-readable output — **no NDJSON
display regression**. This matches Goal 1's "same `AgentResult` shape other runners return" for the
paths that read `stdout`, without degrading the paths that display it. **Tokens are NOT re-sourced
here** — `.noldor/agent-events.jsonl` `tokens` stays from the disk-store usage adapter
(`usage/opencode.ts`, a non-goal to change); `parseOpencodeEvents` *returns* `tokens` for
testability only. Capability grade stays `'events'` (`capabilities.ts:22`); the `schemaPath` gate
(`registry.ts:104-113`) is **unchanged** (codex-only) — events output is not schema output, so
events and schema stay distinct grades (D1).

**1.5 Doc twin.** Update `docs/noldor/agent-runtimes.md:23` + `templates/docs/noldor/agent-runtimes.md:23`:
opencode structured-output cell "`--format json` → NDJSON event stream, parsed by
`opencode-events.ts`" (drop "reserved; treated as prose v1"); auto-permissions cell
`--dangerously-skip-permissions` → `--auto`; version floor note `0.6.0` → verified against 1.17.

### Unit 2 — interactive shim parity (piece a)

**2.1 opencode command shims.** Add thin-pointer shims under `templates/.opencode/command/` — one
per CLI-verb-backed skill, following the existing `noldor-gate.md` skeleton (`description:`
frontmatter + prose pointing at the right `pnpm noldor` verb + `docs/noldor/*.md`). Target set
(the ~9 net-new, gate already exists): `noldor-spec`, `noldor-plan`, `noldor-triage`,
`noldor-promote`, `noldor-new-feature`, `noldor-milestone`, `noldor-draft-feature-md`,
`noldor-garden`, `noldor-research`. No `init.ts`/manifest edit needed — `templateFiles()`
auto-discovers them (`src/templates/manifest.ts:36-48`); `agent-filter.ts:11` gates them to
opencode targets by the `.opencode/` prefix. **Excluded** (D3): `noldor-verify` (a rule → AGENTS.md
prose), `noldor-refactor` / `noldor-release-sweep` (Claude-agent orchestration), `noldor-absorb`
(low-traffic, optional).

**2.2 codex coverage via AGENTS.md prose.** Enrich `templates/AGENTS.md` command catalog (lines
21-26) so the same skill set is discoverable as prose: for each shimmed skill, a line naming the
skill's job + its `pnpm noldor` verb + the `docs/noldor/*.md` to read. No command files (D2).

**2.3 Dogfood: flip this repo's `agents.targets`.** Add an `agents` block to this repo's
`.noldor/config.json` with `targets: ["claude", "codex", "opencode"]` so the shims are actually
exercised here, not merely authored. This makes `check-template-sync` + `doctor`
(`src/checks/check-template-sync.ts`, `src/cli/commands/doctor.ts`) require byte-identical **root**
twins: materialize them with `noldor init --update` (writes root `.opencode/command/*`,
`AGENTS.md`, `opencode.json`). Accept the ongoing twin-maintenance cost (D4). Note: editing root
`.claude/skills/**` from the worktree trips the `NOLDOR_ALLOW_SHARED` guard
(`src/checks/check-shared-files.ts`); root `.opencode/**` is not in its `BLOCK_LIST`, so shim
twins commit without the override.

**2.4 Shim-inventory + count drift guard.** Add a test (`src/templates/__tests__/shim-inventory.test.ts`)
that (i) asserts the exact set of `templates/.opencode/command/*.md` files and that each (except the
`noldor` catalog pointer) names a real `.claude/skills/<name>`, and (ii) **parses the runtime counts
stated in `docs/noldor/agent-runtimes.md` and asserts they match the filesystem** — the Claude count
vs `.claude/skills/`, the opencode-shim count vs `templates/.opencode/command/` (minus the `noldor`
pointer), and 0 codex command files. So the honesty prose's numbers are *enforced, not decorative*:
when skill #15 lands, the test reddens until the doc is updated. This is the mechanism the audit
found missing — pinning both the set and the count kills the drift the FD exists to close.

### Unit 3 — `crLanes` → role-ref aliasing migration (piece c)

**3.1 Mixed-vocabulary lane enum.** `src/core/lanes.ts:8` becomes the canonical enum
`['manual', 'codex', 'reviewer', 'standalone', 'verifier']` — role-refs for the two clean lanes
(`reviewer`, `verifier`), literals for the three orphans (`manual`, `codex`, `standalone`). Add
`LANE_ALIASES = { subagent: 'reviewer', verify: 'verifier' }` (legacy→canonical) and wrap the
schema in a `z.preprocess` that maps legacy names to canonical, so pre-migration configs still
validate (D5).

**3.2 Dispatch + sink normalization.** Update the `LANES` dispatch record
(`src/cr/orchestrate.ts:37-42`) and `standalone`/`verify` guards (`:172-181`) to canonical names.
Sink back-compat: the aggregate/read path and `guardLaneOverwrite` normalize legacy↔canonical when
resolving `.noldor/cr/<slug>-<kind>-<lane>.json` (check both names), so in-flight legacy sinks are
not orphaned. New sinks write canonical names. `findings-schema.ts:30` persists the canonical
`lane` value.

**3.3 First config-value migration.** Author `src/migrations/0.7.0.ts` (next minor after the
in-flight `0.6.0`) rewriting the top-level `crLanes` block values `subagent→reviewer`,
`verify→verifier` in `.noldor/config.json`. Because `crLanes` is a top-level sibling (not in the
`consumer` sub-object), round-trip the raw JSON directly — model on `writeFrameworkVersion`
(`src/core/consumer-config.ts:265-271`), not the typed `config` arg. Register in
`src/migrations/registry.ts` `MIGRATIONS`. Unit-test per `src/migrations/__tests__/0.6.0.test.ts`
(fake consumer tree, `dryRun` no-write, idempotency, both the template config and a consumer
config).

**3.4 The discipline-gap decision — author deliberately; do NOT over-broaden the detector.** The
`migration-coverage` detector matches **whole-file path equality** (`SCHEMA_SURFACE.includes(f)`,
`migration-coverage.ts:23`) and its existing entries are single-purpose. `src/core/config.ts` (~225
lines) holds ~6 unrelated schemas (`crReview`, `autonomous`, `gate`, `clones`, …) and `lanes.ts` also
holds `artifactKindSchema`; adding either whole file to `SCHEMA_SURFACE` would false-positive the
gate on every future *additive/back-compat* schema edit (which needs no migration), forcing no-op
migrations or suppressions. So this unit **authors the `0.7.0` migration deliberately (§3.3) and does
NOT broaden `SCHEMA_SURFACE`.** The residual gap — a lane/`crLanes` value rename could still be
authored un-gated later — is recorded as a deferred **narrow content-signal** enhancement to
`migration-coverage` (fire only when a diff hunk touches `laneSchema` enum values or the `crLanes`
key, not whole-file), out of scope for this elective FD (D8).

**3.5 Blast radius (rename `subagent`/`verify` in prose + config + tests).** Template config
`templates/.noldor/config.json:18-20`; 5 live docs + 5 template twins (adoption-guide,
complexity-gating, cr-pipeline, pr-flow, script-catalog); `noldor-gate` SKILL + twin (6 hits each);
4 test files (config, consumer-config, orchestrate, noldor-config). The `noldor-gate` SKILL lane
multi-select prose (Step 2.5) updates `subagent`→`reviewer`, `verify`→`verifier`.

### Unit 4 — honesty rewrite + drift guards (cross-cutting, lands with its unit)

`docs/noldor/agent-runtimes.md:8` intro rewritten: three runners are first-class **for headless
roles** (spawn/drain/CR/research resolve through the registry); the **interactive** surface is
Claude-primary (14 skills) with opencode command shims for the CLI-verb-backed skills and codex
covered via AGENTS.md prose. State the count honestly and point at the drift-guard test. Flag/floor
corrections ride Unit 1's doc edit. Drift guards: the shim-inventory test (2.4) + an opencode-argv
test update (`src/core/agent-runner/__tests__/runners.test.ts:68-79`) asserting the new
`['run', <prompt>, '--auto', '--format', 'json']` argv.

## Acceptance criteria

- [ ] `opencode run --help` on the installed CLI is re-verified; `buildOpencodeArgv` emits
      `['run', <prompt>, '--auto'](+['--model', m])` by default and appends `'--format', 'json'`
      **only** when `jsonEvents` is set; `runners.test.ts` asserts both the default and the
      `jsonEvents` argv.
- [ ] `parseOpencodeEvents` parses the captured NDJSON fixture → `text === 'OK'` and
      `tokens.input/output` match the `step_finish` event; malformed lines are skipped, never throw.
- [ ] The registry parses opencode NDJSON → prose at the `AgentResult` stdout-return boundary for
      **programmatic** spawns only (`runner === 'opencode'` + piped, non-tee, non-inherit), so every
      such consumer (reviewer/verifier/polish/piped-implementer/researcher) receives prose, not
      NDJSON; a claude spawn is byte-for-byte unchanged; inherit (drain terminal) + tee/`logSink`
      opencode spawns run default formatted mode (no `--format json`) so their display stays
      human-readable. `.noldor/agent-events.jsonl` `tokens` still come from the usage adapter
      (unchanged).
- [ ] `docs/noldor/agent-runtimes.md` + template twin: opencode structured-output cell,
      auto-permissions cell, and the intro "first-class peers" paragraph all reflect reality; no
      "reserved; treated as prose v1" string remains.
- [ ] `templates/.opencode/command/` contains the target shim set; each is a thin pointer that
      names a real `pnpm noldor` verb; `shim-inventory.test.ts` pins the set and passes.
- [ ] `templates/AGENTS.md` command catalog covers the same skills as prose.
- [ ] This repo's `.noldor/config.json` declares `agents.targets: ["claude","codex","opencode"]`;
      `noldor doctor` passes (both runtimes present, above floor); `check-template-sync` passes with
      the materialized root twins.
- [ ] `src/core/lanes.ts` enum = `['manual','codex','reviewer','standalone','verifier']`; a legacy
      config (`subagent`/`verify`) still validates via the alias preprocess.
- [ ] `src/migrations/0.7.0.ts` rewrites `crLanes` values; registered in `MIGRATIONS`; `dryRun`
      writes nothing; a second `migrate` is idempotent; both template + consumer configs covered.
- [ ] The `0.7.0` migration is authored deliberately; `migration-coverage` `SCHEMA_SURFACE` is
      **not** broadened to whole-file `config.ts`/`lanes.ts` (would false-positive unrelated additive
      schemas); the residual lane/`crLanes` auto-gate gap is documented as a deferred narrow-signal
      enhancement (D8).
- [ ] CR orchestrate resolves + dispatches `reviewer`/`verifier`; a pre-existing `-subagent.json` /
      `-verify.json` sink is still found via the normalization; `orchestrate.test.ts` green.
- [ ] `pnpm verify` green (typecheck + tests + lint) on the full branch.

## Risks / trade-offs

- **Unit 2 twin-maintenance burden.** Flipping repo targets to opencode+codex means every future
  `.claude/skills/**` or shim edit must keep root + `templates/` twins byte-identical or
  `check-template-sync` reddens. Mitigation: the drift guard + `noldor init --update`. Reversible by
  removing the `agents` block (D4).
- **Unit 3 is breaking + first-of-kind.** A config-value migration has no exact precedent (existing
  migrations only touch files/skills). Real consumers (charuy at `/Users/davidzoufaly/code/charuy`,
  the contract fixture) carry `crLanes` blocks the migration must rewrite. Mitigation: alias
  preprocess means un-migrated configs keep working; sink normalization means no orphaned in-flight
  sinks; ship last so it's droppable.
- **Mixed lane vocabulary is an honest impurity.** `laneSchema` mixes role-refs and non-role
  literals — exactly the trade-off the `make-noldor-agent-agnostic` ADR anticipated ("slight enum
  impurity traded for sink back-compat; revisit when `crLanes` vocabulary generalizes to roles").
- **opencode 1.17 vs 0.6 flag surface.** `--format json` and `--auto` are verified against 1.17;
  older opencode (≥ the doc floor 0.6.0) may differ. Mitigation: raise the documented floor note;
  the argv is verified against the installed 1.17.
- **Elective / low-impact.** Nothing forced this; the payoff is honesty + a real flag-bug fix, not
  a user-facing capability. Kept proportionate by excluding speculative shims and per-event
  streaming.

## User Story

As a Noldor consumer choosing or mixing agent runtimes, I want the framework's three-runner claim
to be *honest and enforced* — real opencode structured-output parsing, opencode/codex coverage for
the interactive skills I actually use, and a config vocabulary that matches the runner roles — so
that I can trust the runtime matrix, get correct opencode spawns on current opencode, and not be
misled by a "first-class peers" claim the interactive surface doesn't back up.

## Usage

**opencode structured output (internal / agent API).** opencode spawns now run
`opencode run <prompt> --auto --format json`; `parseOpencodeEvents` returns the assistant text +
token usage. No new user-facing CLI.

**Interactive shims.** opencode users get slash-command shims for `noldor-spec`, `noldor-plan`,
`noldor-triage`, `noldor-promote`, `noldor-new-feature`, `noldor-milestone`,
`noldor-draft-feature-md`, `noldor-garden`, `noldor-research` (plus the existing `noldor-gate`);
codex users get the same coverage as `AGENTS.md` prose. Materialized in a consumer via
`noldor init --agents claude,codex,opencode` (fresh) or `noldor init --update` (existing).

**crLanes vocabulary.** `.noldor/config.json` `crLanes` values use `reviewer` (was `subagent`) and
`verifier` (was `verify`); `manual`, `codex`, `standalone` unchanged. `noldor upgrade` runs the
`0.7.0` migration to rewrite existing configs; legacy values keep validating via the alias
preprocess.

**doctor.** `noldor doctor` now verifies opencode + codex presence/floor in this repo (targets
flipped).

## Open questions (resolved)

1. *Should opencode's `--format json` reuse the `schemaPath` capability gate, or stay a distinct
   `events` grade?* → **Distinct `events` grade; no gate change.** (D1) opencode emits a stream of
   events, not one schema-validated object; conflating it with codex's `schema` grade would break
   the `JSON.parse(whole-stdout)` contract `run-codex.ts` relies on. Parse via a runner-aware branch
   in the stdout-consuming path.
2. *Do codex "shims" take opencode's command-file form?* → **No — AGENTS.md prose.** (D2) codex
   reads `AGENTS.md` natively; there is no `.codex/` convention and inventing one is scope creep.
3. *Which of the 14 skills get shims?* → **The 9 CLI-verb-backed ones** (spec, plan, triage,
   promote, new-feature, milestone, draft-feature-md, garden, research) + existing gate. (D3)
   Exclude `noldor-verify` (rule → prose), `noldor-refactor`/`noldor-release-sweep` (Claude-agent
   orchestration a thin pointer can't reproduce), `noldor-absorb` (low-traffic; optional add).
4. *Flip this repo's `agents.targets` to dogfood, or author shims in `templates/` only?* → **Flip
   to `["claude","codex","opencode"]`.** (D4) The entry's trigger is "a non-Claude runtime exercised
   end-to-end"; both are installed; authoring-without-exercising would repeat the honesty gap.
   Accept the twin-maintenance cost (guarded by the drift test); reversible.
5. *Clean `crLanes`→role rename, or aliasing?* → **Aliasing + mixed vocabulary.** (D5) Only 2/5
   lanes role-route cleanly; `manual`/`standalone` have no runner and `codex` is hard-pinned. Rename
   the 2 clean lanes to role-refs, keep the rest as literals, alias-preprocess legacy values, and
   normalize sinks for back-compat.
6. *Fix the `docs/noldor/README.md` docs-index omission of `agent-runtimes.md` here?* → **No —
   leave to Q-0043.** (D6) Q-0043 (README Rewrite) already owns the docs-index staleness; this FD
   only rewrites `agent-runtimes.md` content to avoid a two-PR edit collision on `README.md`.
7. *Migration file version — extend `0.6.0` or new `0.7.0`?* → **New `0.7.0.ts`.** (D7) `0.6.0` is
   the in-flight skill-rename migration; a breaking config-value migration is its own concern and
   its own version bump ("each new consumer-facing schema change adds an entry in the same PR").
8. *Close the `migration-coverage` gap by adding `config.ts`/`lanes.ts` to `SCHEMA_SURFACE`?* →
   **No — author the `0.7.0` migration deliberately; defer a narrow content-signal.** (D8) The
   detector matches whole-file path equality (`migration-coverage.ts:23`); whole-file entries for
   `config.ts` (~6 unrelated schemas) / `lanes.ts` would false-positive the add-migration gate on
   every future additive/back-compat schema edit. A per-hunk signal (touches `laneSchema` values or
   the `crLanes` key) is the honest guard but is a `migration-coverage` enhancement out of scope for
   this elective FD; recorded as a deferred follow-up.
