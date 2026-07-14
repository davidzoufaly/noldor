# Vendored Systematic-Debugging Discipline — Design

**Slug:** vendored-systematic-debugging-discipline
**FD:** docs/features/vendored-systematic-debugging-discipline.md
**Date:** 2026-07-14
**Tier:** specs-only
**Deps:** none

## Problem

Noldor's north star is a **self-owned** framework: every load-bearing discipline
lives in this repo, not in a plugin a consumer may not have installed
(`docs/vision.md` — "The framework must also be self-owned"). The deep-audit
batch `.noldor/research/2026-07-13-184850` flagged two superpowers disciplines
never vendored into the framework. One — verification-before-completion — shipped
as `/noldor-verify` (Q-0045, PR #218). The other is **systematic debugging**: the
`reproduce → minimise → hypothesise → instrument → fix → regression-test` loop
that must run before proposing a fix for any bug, test failure, or unexpected
behaviour.

Today Noldor has **no** debugging-discipline skill. A consumer who runs
`noldor init` without the superpowers plugin gets no equivalent — bug fixes fall
back to ad-hoc guess-and-check. Nothing in the framework references
`superpowers:systematic-debugging`, so it is not a dependency; it is simply
absent. That absence is the gap this FD closes.

## Goals

- Vendor a self-contained `noldor-debug` skill that ports the systematic-debugging
  discipline with **zero** plugin dependency (no `superpowers:` cross-references).
- Register it exactly the way `/noldor-verify` is registered, so
  `pnpm noldor validate skill-catalog` stays green and the count-carrying prose
  docs stay accurate.
- Surface it on bug-fix work through the always-loaded engineering-rules baseline
  (the same mechanism that surfaces `/noldor-verify`), not a bespoke gate edit.
- Keep it a single lean `SKILL.md` (+ byte-identical `templates/` twin), mirroring
  the `noldor-verify` recipe rather than porting the 3 superpowers technique files.

## Non-goals

- **No gate SKILL.md edit.** The gate is size-routed (`sizeToPath` in
  `src/core/size-routing.ts`) and has no "fix path"; `noldor-verify` added zero
  gate edits. `noldor-debug` surfaces via `.claude/engineering-rules.md` (which is
  `@`-imported into every session, including bug-fix fast-tracks). (D1)
- **No separate technique files.** The superpowers `root-cause-tracing.md`,
  `defense-in-depth.md`, `condition-based-waiting.md` are not vendored; the
  essential backward-tracing quick-version is folded inline. (D2)
- **No opencode/codex shim.** Discipline rules get no runner shim by design
  (`docs/noldor/agent-runtimes.md` records this for `noldor-verify`); `noldor-debug`
  joins that no-shim list. (D3)
- **No src/ code, no new unit tests.** The change is skills + docs + rules only;
  the `validate skill-catalog` gate is the enforcing check, exactly as for verify.
- **No behavioural coupling.** `noldor-debug` is a socially-enforced discipline,
  not a hook or CLI command — nothing calls it programmatically.

## Design

The recipe is a faithful mirror of the `noldor-verify` shipment (PR #218, squash
`6fdb605`) — one squash commit whose file set IS the recipe. Ten files change
(five pairs of real + `templates/` twin), plus the already-scaffolded FD.

### Unit 1 — the skill (`.claude/skills/noldor-debug/SKILL.md` + twin)

Port `~/.claude/plugins/.../superpowers/systematic-debugging/SKILL.md` into the
`noldor-verify` house style:

- **Frontmatter:** two keys only — `name: noldor-debug` and a trigger-first
  `description` ("Use when encountering any bug, test failure, or unexpected
  behaviour, before proposing a fix … Vendored, self-contained — no plugin
  required."). No `allowed-tools`, no plugin/marketplace fields.
- **Body:** `# /noldor-debug` H1 + one-line "vendored for Noldor. Self-contained —
  no `superpowers` plugin required." subtitle, then:
  - **Overview** + **Iron Law** (`NO FIX WITHOUT ROOT-CAUSE INVESTIGATION FIRST`).
  - **When to use / don't skip when** (bug, test failure, unexpected behaviour,
    perf regression, build failure).
  - **The four phases** (root-cause investigation → pattern analysis → hypothesis
    & minimal test → implementation), each phase's checklist, with the
    root-cause backward-tracing quick-version folded into Phase 1 inline.
  - **3+-fixes-failed → question the architecture** escalation.
  - **Red flags — STOP** list and **Common rationalizations** table (the
    anti-rationalization teeth).
- **Noldor flavour, no plugin strings:** examples reference `pnpm test`,
  `pnpm verify`, `git diff`/`git log`, the gate's Step 4 ship path, and drain
  iterations. The superpowers cross-refs
  (`superpowers:test-driven-development`, `superpowers:verification-before-completion`)
  are replaced: point at the vendored `/noldor-verify` for the fix-verification
  step, and describe writing a failing test inline (TDD red-green) rather than
  linking a plugin skill. **Zero** occurrences of `superpowers` or `plugin`
  as a dependency.

The `templates/.claude/skills/noldor-debug/SKILL.md` twin is **byte-identical**
(the copy `noldor init` ships into consumers). Enforced by `diff -q` in the AC.

### Unit 2 — catalog registration (`docs/noldor/skill-catalog.md` + twin)

- Append a `## /noldor-debug` entry after `## /noldor-verify` (lines 105-110 today),
  using the 4-bullet row format: **Trigger** (`/noldor-debug`, or automatically
  before proposing any fix), **Inputs** (the failing symptom; the reproduction
  command + its fresh output; `git diff`/recent commits), **Outputs** (no file
  writes — a gate on fix-proposals: root cause identified + a failing test before
  the fix), **When to use** (any bug / test failure / unexpected behaviour, before
  proposing a fix; vendored self-contained replacement for
  `superpowers:systematic-debugging`).
- Bump line 8 count `Noldor ships 14 user-invocable skills` → `15`.
- `validate skill-catalog` (`src/core/validate-skill-catalog.ts`) asserts a
  bidirectional slug-set equality: the `noldor-debug/` dir → slug `noldor-debug`
  must match a `## /noldor-debug` heading. The prose count is hand-maintained
  (not validator-checked) — hence the AC re-checks it.

### Unit 3 — engineering-rules baseline (`.claude/engineering-rules.md` + twin)

Add a `## Systematic debugging` section parallel to the existing
`## Verification before completion` (line 35). Short always-loaded paragraph:
root cause before fixes; reproduce/minimise/hypothesise/instrument/fix/
regression-test; symptom patches are failure; 3+ failed fixes → question the
architecture. Last sentence: "The full discipline (four phases, red-flags,
rationalizations) is the `/noldor-debug` skill." This is the surfacing mechanism
(D1) — `.claude/engineering-rules.md` is `@`-imported into every context, so a
bug-fix session sees it without any gate edit.

### Unit 4 — runtime-asymmetry prose (`docs/noldor/agent-runtimes.md` + twin)

- Line 16: `**14 Claude skills**` → `**15 Claude skills**`.
- Lines 20-21 no-shim list: add `noldor-debug` alongside `noldor-verify` as a
  discipline rule with no shim by design.

### Unit 5 — AGENTS.md discipline note (`AGENTS.md` + twin)

Lines 44-46 already note `noldor-verify` is a discipline rule; extend to name
`noldor-debug` too so codex (which reads `AGENTS.md` prose, no shims) knows the
discipline exists.

### Unit 6 — FD (already scaffolded)

`docs/features/vendored-systematic-debugging-discipline.md` exists (promote
step). Its `User Story` / `Usage` are refreshed and `phase: in-progress → done`
is flipped at gate Step 4 (`/noldor-draft-feature-md --refresh` + `phase-flip-done`).

### Commit mechanics

The single feature commit stages shared-root files from a `.worktrees/` tree, so
two guards fire (both confirmed against `src/checks/check-shared-files.ts` and
`src/core/validate-noldor-scope.ts`):

- `NOLDOR_ALLOW_SHARED=1` must be exported — the diff stages
  `.claude/skills/noldor-debug/*` (matches the skills block regex) and
  `.claude/engineering-rules.md` (exact block-list match).
- A `Noldor-Sibling-Scope: noldor:skill-catalog,noldor:agent-runtimes` trailer is
  required — the commit's subject scope is non-`noldor` (e.g. `feat(skills)`) but
  it stages two `docs/noldor/*.md` pages, so the trailer must cover every staged
  noldor page. (`templates/docs/noldor/*` does not count — it starts `templates/`.)

## Acceptance criteria

- `pnpm noldor validate skill-catalog` exits 0 (15 skill dirs ↔ 15 `## /` headings,
  `noldor-debug` present in both).
- `diff -q .claude/skills/noldor-debug/SKILL.md templates/.claude/skills/noldor-debug/SKILL.md`
  reports identical; same for `engineering-rules.md`, `skill-catalog.md`,
  `agent-runtimes.md`, `AGENTS.md` real/twin pairs that changed.
- No `superpowers:`-namespaced cross-reference or import in
  `.claude/skills/noldor-debug/SKILL.md` (`grep -oE 'superpowers:[a-z-]+'` returns
  nothing). The plain-word self-contained disclaimer ("no `superpowers` plugin
  required") is allowed and expected — it mirrors the verify precedent, which
  itself contains the bare word twice without depending on the plugin.
- `.claude/engineering-rules.md` contains a `## Systematic debugging` section whose
  final sentence names `/noldor-debug`.
- `docs/noldor/skill-catalog.md` line 8 reads `15`; `docs/noldor/agent-runtimes.md`
  reads `15 Claude skills` and lists `noldor-debug` as no-shim-by-design.
- `pnpm noldor validate features` stays green (FD unbroken).
- `pnpm verify` (composite) exits 0.

## Risks / trade-offs

- **Count drift (silent).** Two prose spots hardcode the skill count by hand
  (`docs/noldor/skill-catalog.md:8`, `docs/noldor/agent-runtimes.md:16`) and the
  validator does not check the number. A missed bump rots quietly. Mitigation: the
  AC greps both. (`AGENTS.md` carries no numeric count — only a named discipline
  note — so there is no third spot.) Accepted — same risk `noldor-verify` carries;
  no framework mechanism auto-counts prose today.
- **Twin drift.** Real vs `templates/` copies must stay byte-identical; nothing
  auto-syncs them at author time. Mitigation: AC `diff -q` per pair; the
  `graph-freshness`/shared-file guards catch a later divergence.
- **Discipline is social, not enforced.** No hook makes an agent run the loop —
  same as verify. Accepted: disciplines are prompts, not gates; the value is the
  always-loaded baseline nudging the behaviour.
- **Literal-vs-spirit on "reference from the gate."** The roadmap block said
  "reference from the gate fast-track/fix paths." Since no fix path exists and
  verify set the eng-rules-baseline precedent, D1 satisfies the *intent* (surfaced
  on bug fixes) without a gate edit. Trade-off ratified by the operator.

## User Story

As an agent (or human) fixing a bug in a Noldor consumer repo without the
superpowers plugin installed, I want a vendored systematic-debugging discipline
surfaced before I propose a fix, so that I find the root cause and write a failing
test first instead of guess-and-check patching symptoms.

## Usage

- Invoke directly: `/noldor-debug` when you hit any bug, test failure, or
  unexpected behaviour — before proposing a fix.
- Automatic surfacing: `.claude/engineering-rules.md` (`@`-imported into every
  session) carries the `## Systematic debugging` baseline, so the discipline is
  present on every bug-fix fast-track without a gate step.
- The skill is a socially-enforced rule (no CLI, no hook): work the four phases
  (root cause → pattern → hypothesis+minimal test → fix+regression test), then
  verify the fix with `/noldor-verify` before claiming it works.

## Open questions (resolved)

1. *How is "reference from the gate fast-track/fix paths" satisfied when the gate
   has no fix path and verify added no gate edits?* → **eng-rules baseline only.**
   Add the discipline to `.claude/engineering-rules.md` (+ twin); it is
   `@`-imported into every session, so it surfaces on bug-fix work already. (D1)
   Rationale: mirrors the operator-set `noldor-verify` precedent and avoids editing
   the shared gate SKILL.md + twin. Ratified by operator.
2. *How much of the 297-line source + 3 technique files to port?* → **one lean
   self-contained SKILL.md** (verify-sized); fold the essential root-cause
   backward-tracing inline; drop the separate technique files. (D2) Rationale:
   the task says "self-contained SKILL.md"; single-file matches the verify recipe
   and keeps one twin pair, not four. Ratified by operator.
3. *Does `noldor-debug` get an opencode/codex shim?* → **no.** It joins the
   `noldor-verify` no-shim-by-design list in `docs/noldor/agent-runtimes.md`. (D3)
   Rationale: discipline rules are prose behaviours, not CLI-backed commands;
   runners without native skills read the rule via `AGENTS.md`, not a shim.
4. *Any new tests / src changes?* → **none.** `validate skill-catalog` is the
   enforcing gate; the change touches no `src/`, so no `@tests:` tag and no unit
   test — identical to the verify shipment. (D4) Rationale: there is no runtime
   surface to unit-test; the guards (`validate skill-catalog`, shared-files,
   noldor-scope) already cover the invariants.
