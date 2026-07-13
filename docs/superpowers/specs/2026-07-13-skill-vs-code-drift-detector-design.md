# Skill-vs-Code Drift Detector — Design

**Slug:** skill-vs-code-drift-detector
**FD:** docs/features/skill-vs-code-drift-detector.md
**Date:** 2026-07-13
**Tier:** specs-only

## Problem

Skill bodies (`.claude/skills/**/SKILL.md` + their `templates/.claude/skills/**` twins) reference three classes of repo artifacts that rot silently after reorgs:

1. `pnpm <script>` invocations that no longer exist in `package.json` `scripts`.
2. `noldor <group> <sub>` CLI commands that no longer exist in the `MANIFEST` (`src/cli/manifest.ts`).
3. Repo-relative file paths that no longer exist on disk.

Live incidents: the release-sweep skill needed a full manual path audit (PR #124); the gate skill body carried the same drift class; doc-links hooks miss skill files entirely (they only cover `docs/`). Nothing today validates skill bodies against the code they orchestrate.

## Goals

- A deterministic garden detector (no LLM) that flags all three drift classes across every `SKILL.md` under `.claude/skills/` and `templates/.claude/skills/`.
- Findings ride the existing `pnpm noldor garden detect` surface — JSON category + human-readable section + `/noldor-garden` checklist — and the release auto-restamp gate (`runGardenDetectViaCli`).
- Near-zero false positives on the current tree: placeholders, globs, and transient paths are excluded by construction; the current repo scan must come back clean (or every hit fixed in the same PR).

## Non-goals

- No auto-fix. Findings are advisory (`action: 'investigate'`) — the operator or a follow-up chore fixes the skill body.
- No prose/semantic drift ("the skill describes behavior the code no longer has") — that stays with the existing `source-drift` detector's pair mechanism and human review.
- No scanning of non-skill markdown (`docs/**` already has doc-links/fd-link-rot coverage).
- No validation of flags/arguments of a `noldor` subcommand — existence of `<group> <sub>` only.

## Design

### Unit 1 — `src/garden/detectors/skill-code-drift.ts` (new)

Follows the single-file detector convention (cf. `detectors/allowlist-drift.ts`, `detectors/fd-link-rot.ts`).

```ts
export interface SkillDriftFinding {
  readonly skillPath: string;     // repo-relative, e.g. .claude/skills/noldor-gate/SKILL.md
  readonly line: number;          // 1-based line of the offending token
  readonly kind: 'pnpm-script' | 'noldor-subcommand' | 'missing-path';
  readonly token: string;         // the offending script name / subcommand / path
  readonly detail: string;        // one-line human explanation
  readonly action: 'investigate';
}

export async function detectSkillCodeDrift(repo: string): Promise<SkillDriftFinding[]>
```

**Corpus.** Recursive walk of `<repo>/.claude/skills/` and `<repo>/templates/.claude/skills/` collecting `SKILL.md` plus sibling `*.md` reference files (skills ship `references/*.md`). Missing roots are skipped silently (consumer repos may have neither).

**Extraction — per line, fenced-block aware.** The scanner walks lines, tracking fenced-code state (` ``` ` toggles). Tokens are extracted from BOTH prose (inline backticks) and fenced blocks — command snippets live in both.

- **Class 1, pnpm scripts:** regex `\bpnpm\s+(?:run\s+)?([A-Za-z0-9:_.-]+)\b`. The captured name is checked against the union of `package.json` `scripts` keys (read once from `<repo>/package.json`). Skip list: pnpm built-ins (`install`, `add`, `remove`, `exec`, `dlx`, `pack`, `publish`, `test`, `link`, `create`, `why`, `update`, `-*` flag tokens) and `noldor` (handled by class 2). A `pnpm` hit inside a `templates/` twin is checked against the ROOT `package.json` — templates describe consumer repos, but self-host is the only tree we can stat; accepted imprecision, documented in the detector TSDoc.
- **Class 2, noldor subcommands:** regex `\b(?:pnpm\s+)?noldor\s+([a-z-]+)(?:\s+([a-z][a-z0-9:-]*))?\b` over the same lines. Validate `group` exists as a `MANIFEST` key (static import of `MANIFEST` from `../../cli/manifest.js` — same-repo import, no subprocess). When the group's subs are not the single `''` leaf, also validate the captured `sub`. A missing/flag-like second capture (starts with `-`) validates group-existence only. Skip pseudo-groups used in prose (`noldor` alone, `<sub>` placeholders).
- **Class 3, repo-relative paths:** candidate tokens are backtick-inline code spans and markdown link targets that (a) contain `/`, (b) match `^(src|docs|scripts|templates|bin|e2e|samples|\.claude|\.github)/` after resolution, or are relative (`../`-prefixed, resolved from the skill file's directory). Resolution: relative targets resolve against the skill file dir then re-relativize to repo root. Check `existsSync`. Skip when the token contains placeholder/glob chars (`<`, `>`, `*`, `{`, `}`, `$`, `NNNN`, `YYYY`), points under transient roots (`.noldor/`, `.worktrees/`, `graphify-out/`, `node_modules/`), or ends with `/` and the directory exists.

**Ordering:** findings sorted by `skillPath`, then `line` — deterministic output for tests and diffs.

### Unit 2 — wiring into the garden surface (3 edits, all mechanical)

- `src/garden/garden-detect.ts`: add `skillDrift: readonly SkillDriftFinding[]` to `GardenFindings`; call `detectSkillCodeDrift(repo)` inside `detectAll`'s existing `Promise.all` batch; include in the returned object and in the human-readable print section (mirrors how `allowlistDrift` findings render: one line per finding `skillPath:line — kind: token (detail)`).
- `src/garden/garden-detect-runner.ts`: append `'skillDrift'` to `FINDING_CATEGORIES` so the release auto-restamp gate counts these findings.
- `.claude/skills/noldor-garden/SKILL.md` (+ template twin): add `skillDrift` to the detector list the checklist renders, under the safe **non**-auto-action group (investigate-only; no auto-fix analogous to archive/drop).

### Data flow

`detectAll(repo)` → `detectSkillCodeDrift(repo)` reads `package.json` once + imports `MANIFEST` statically + walks ≤ ~60 skill files → findings array → `--json` consumers (`runGardenDetectViaCli`, `/noldor-garden`) see category `skillDrift`.

### Error handling

- Unreadable skill file → skip that file (fail-open, consistent with other detectors' `try/catch → []`).
- Unparseable `package.json` → return `[]` for class 1 checks (never throw out of `detectAll`); classes 2/3 still run.
- The detector never shells out — pure fs + static import; no git dependency.

### Testing

`src/garden/detectors/__tests__/skill-code-drift.test.ts` (tagged `// @tests: skill-vs-code-drift-detector`), fixture-driven with `mkdtempSync` repos:

1. Skill referencing a `pnpm` script absent from `package.json` → one `pnpm-script` finding; a present script → none.
2. `pnpm noldor bogus subcmd` → `noldor-subcommand` finding; valid `garden detect` / leaf group (`init`) → none; flag-only tail validates group only.
3. Backtick path to a missing `src/…` file → `missing-path`; existing path, placeholder (`docs/features/<slug>.md`), glob, and `.noldor/` transient → none.
4. Relative `../../../src/…` link resolved from skill dir.
5. Fenced-block extraction: command inside ``` fence is scanned.
6. Missing `.claude/skills/` root → `[]`.
7. Self-scan smoke: `detectSkillCodeDrift(<repo root>)` over the real tree returns `[]` (guards both detector precision and the skills themselves; failing hits are fixed in this PR).

Plus one-line assertions in existing `garden-detect` tests that `GardenFindings.skillDrift` is present and `FINDING_CATEGORIES` includes it.

## Acceptance criteria

- `pnpm noldor garden detect --json` emits a `skillDrift` array; introducing a bogus `pnpm nope` / `noldor nope` / dead path into any SKILL.md makes exactly one finding appear with correct `skillPath`, `line`, `kind`, `token`.
- Placeholders (`<slug>`, `Q-NNNN`, globs) and transient paths produce zero findings.
- Real-tree self-scan is clean at merge (test 7 enforces).
- `runGardenDetectViaCli` counts skillDrift findings toward the auto-restamp gate.
- `pnpm vitest run` + `pnpm typecheck` green; no new module-boundary violation (garden → cli import allowed: `core-is-foundation` restricts `src/core` only, and no existing rule forbids `garden → cli`; verified against `.noldor/config.json` boundaries).

## Risks / trade-offs

- **False positives in prose** (e.g. a historical mention of a removed script). Mitigated by placeholder/transient skips + the self-scan test forcing a clean baseline; residual hits are advisory-only and cheap to fix or reword.
- **Template twins checked against self-host tree** — a template referencing consumer-only scripts would flag. Accepted: templates today mirror self-host skills 1:1 (template-sync check enforces); revisit if consumer-divergent templates appear.
- **`garden → cli` import direction** is new (manifest import). It's a leaf `const` with no side effects; boundaries config permits it. Alternative (spawn `noldor --help` and parse) rejected: slower, brittler.

## User Story

As a framework maintainer, I want `garden detect` to flag skill bodies whose `pnpm` scripts, `noldor` subcommands, or file paths no longer exist, so that skill/code drift surfaces automatically at gardening time instead of via manual path audits after something breaks.

## Usage

- `pnpm noldor garden detect` — human output gains a `skill drift` section listing `skillPath:line — kind: token`.
- `pnpm noldor garden detect --json` — machine output gains the `skillDrift` category (consumed by `/noldor-garden` and the release auto-restamp gate).
- `/noldor-garden` — checklist surfaces skillDrift findings as investigate-only items.

## Open questions (resolved)

1. *Should the detector also scan `references/*.md` companion files inside skill dirs?*
   -> Yes — same corpus walk, trivial cost. (D1) Drift hides in reference files exactly as in SKILL.md (the superpowers platform files proved this).
2. *Validate `noldor` subcommand flags too?*
   -> No — existence of `<group> <sub>` only. (D2) Flag schemas live in each entrypoint's argv parsing; extracting them is a different, much larger detector.
3. *Should findings block release (receipt-stale) or stay advisory?*
   -> Advisory via the existing auto-restamp gate — findings prevent auto-stamp but the operator can stamp after review, same as every other garden category. (D3) Consistent severity model; no new gate semantics.
4. *Scan consumer repos' `.claude/skills` (via scanRoots/repo-paths provider)?*
   -> Self-host layout only for v1: walk `<repo>/.claude/skills` + `<repo>/templates/.claude/skills` directly. (D4) Consumers get the detector automatically for their own skill dirs; template-vs-consumer script mismatch is the documented imprecision.
