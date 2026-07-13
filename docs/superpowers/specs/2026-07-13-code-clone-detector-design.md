# Code-Clone Detector — Design

**Slug:** code-clone-detector
**FD:** docs/features/code-clone-detector.md
**Date:** 2026-07-13
**Tier:** full

## Problem

Nothing in the framework detects copy-paste duplication. `/noldor-refactor` finds consolidation opportunities from graphify god-nodes/cohesion but does no line/token clone matching; the graphify AST graph has structural-similarity signal but no clone report. Copy-paste dups (Type-1 exact, Type-2 renamed-identifier, Type-3 near-miss) accumulate silently — the 2026-07 deep audit had to eyeball god files by LOC. The roadmap entry asks for a deterministic, no-LLM detector à la `jscpd`, surfaced in `sdd-report` and usable as an optional gate.

## Goals

- Deterministic token-based clone detection over the consumer's `scanPaths` corpus (`scanRoots()`, `src/core/repo-paths.ts`) — no LLM, no network, no new npm dependency (hand-rolled TS/JS tokenizer; repo deps deliberately exclude jscpd/ts-morph).
- Type-1 and Type-2 clones exactly (identifier/literal normalization); Type-3 approximated by merging clone fragments separated by small gaps (documented approximation, jscpd-class behavior).
- `pnpm noldor clones report [--json]` CLI + a `## Code clones` section in `sdd-report`.
- Optional gate: `noldor clones check` exits 1 when duplicated-token percentage exceeds a configured threshold; threshold unset = check always green (opt-in).
- `/noldor-refactor` feed: the JSON report lists clone groups with file:line ranges — directly consumable as refactor targets.

## Non-goals

- Semantic (Type-4) clones — explicitly the embeddings-infra entry, out of scope.
- Cross-language support — TS/JS/TSX/JSX/MTS/CTS only (the corpus `scanRoots` yields in this ecosystem); other extensions skipped.
- Auto-fix/consolidation — the report feeds `/noldor-refactor`; no codemod.
- CR-lane integration — the gate surface is the `clones check` exit-code contract (wire into lefthook/CI as desired), not a new CR lane.

## Design

### Unit 1 — tokenizer: `src/clones/tokenize.ts`

`tokenize(source: string): Token[]` where `Token = { kind, text, line }`. A small hand-rolled scanner sufficient for clone detection (NOT a full parser): handles line/block comments (skipped), string/template literals (each collapsed to one `str` token), regex literals are NOT specially handled (treated as punctuation/identifier runs — acceptable for similarity; documented), identifiers/keywords, numbers, punctuation. Keywords stay verbatim; identifiers normalize to `ID` and string/number literals to `LIT` in the *normalized* stream (Type-2), while the raw text is kept on the token for reporting. Deterministic, pure, no fs.

### Unit 2 — detector: `src/clones/detect.ts`

`detectClones(files: Map<string, string>, opts: CloneOptions): CloneReport`

- Per file: tokenize → normalized token stream with line mapping.
- Rabin-Karp rolling hash over windows of `minTokens` (default 50) normalized tokens; hash → list of `(file, tokenIndex)` occurrences.
- Windows sharing a hash are verified token-by-token (hash-collision guard), then extended greedily left/right to the maximal common run; overlapping/adjacent fragments in the same file pair with a gap ≤ `gapTokens` (default 10) merge into one clone (the Type-3 approximation).
- Self-overlap within one file counts (duplication inside a single file is a real signal); a clone must span ≥ `minLines` (default 5) source lines on each side to filter trivial runs.
- Output:

```ts
export interface CloneInstance { file: string; startLine: number; endLine: number; }
export interface CloneGroup { tokens: number; lines: number; instances: CloneInstance[]; }
export interface CloneReport {
  groups: CloneGroup[];            // sorted by tokens desc
  filesScanned: number;
  totalTokens: number;
  duplicatedTokens: number;        // tokens covered by ≥1 clone group (deduped)
  duplicationPct: number;          // duplicatedTokens / totalTokens * 100
}
```

- Test files and generated output are excluded by default: skip paths matching `__tests__/`, `*.test.*`, `*.spec.*`, `dist/`, `fixtures/` (duplication in tests is conventional). `--include-tests` disables the filter.

### Unit 3 — CLI: `src/clones/clones-cli.ts` + manifest group

`clones` group in `src/cli/manifest.ts` (`report` + `check` subs). `report`: walks `scanRoots(cwd)` (matching extensions), prints human summary (top-10 groups as `file:start-end ⇄ file:start-end (N tokens)`) or full JSON with `--json`. `check`: same scan; exit 0 when `duplicationPct <= threshold` or no threshold configured; exit 1 with the offending percentage + top groups when above.

Config: new optional top-level `clones` block in `src/core/config.ts` (non-strict side, like `crReview`): `{ minTokens?, minLines?, gapTokens?, thresholdPct? }` — flags override config, config overrides defaults.

### Unit 4 — sdd-report section

`src/garden/sdd-report.ts` main() gains a `## Code clones` section (always rendered, like Summary): one line `N clone groups, X.Y% duplicated tokens across M files` + top-5 groups as bullets. Reuses `detectClones` directly over the same `resolveScanRoots` corpus already loaded there. Output strings avoid `_`/`*` (oxfmt mangles them in generated md — known gotcha from the metrics section).

### Data flow

`scanRoots` → read files (fail-open per file) → `tokenize` → `detectClones` → report object → CLI text/JSON | sdd-report section | `check` exit code.

### Error handling

- Unreadable file → skipped silently (consistent with detector conventions), counted out of `filesScanned`.
- Tokenizer never throws on malformed source — unknown chars emit punctuation tokens; worst case is a noisier stream, never a crash.
- `check` with malformed config threshold (non-number) → treated as unset (fail-open, config error surfaces via config validation elsewhere).

### Testing

`src/clones/__tests__/tokenize.test.ts` + `detect.test.ts` + `clones-cli.test.ts` (tagged `// @tests: code-clone-detector`):

1. Tokenizer: comments/strings/templates collapsed; identifiers vs keywords; line numbers correct.
2. Type-1: two identical 60-token functions in different files → one group, correct line ranges.
3. Type-2: same shape with renamed identifiers + changed literals → still one group.
4. Type-3 merge: two fragments split by a small insertion (≤ gapTokens) merge into one clone; a large gap keeps them separate groups.
5. Below `minTokens`/`minLines` → no group. Test-file exclusion honored; `--include-tests` includes.
6. duplicationPct math: dedup of overlapping group coverage.
7. CLI: `report --json` shape; `check` exit 0/1 vs threshold; unset threshold always 0.
8. Determinism: same input twice → deep-equal reports.

## Acceptance criteria

- `pnpm noldor clones report` on this repo completes in seconds and prints a deterministic summary; `--json` emits the `CloneReport` shape.
- Seeding two copies of a ≥50-token function into scanned source makes exactly one clone group appear with correct file:line ranges; renaming identifiers in one copy (Type-2) still detects it.
- `clones check` exits 1 only when a configured `clones.thresholdPct` is exceeded.
- `docs/sdd-report.md` regen contains a `## Code clones` section; oxfmt-clean (test-enforced by the existing sdd-report fmt test).
- No new npm dependencies; suite + typecheck green.

## Risks / trade-offs

- **Hand-rolled tokenizer fidelity** — regex literals and exotic syntax degrade to punctuation runs. Consequence is bounded: false-negative/positive clone edges, never a crash; jscpd itself is token-heuristic. Accepted for zero-dep determinism.
- **Performance** — corpus is ~350 src files; rolling hash is O(total tokens). Sub-second expected; no incremental cache in v1 (YAGNI until a consumer corpus proves slow).
- **Type-3 is an approximation** (gap-merge, not edit-distance). Stated in docs; matches the entry's "à la jscpd" framing.
- **sdd-report drift** — the new section changes generated output once; lands with the same PR so the regen test stays green.

## User Story

As a framework maintainer, I want a deterministic token-based clone report over the configured source roots, so that copy-paste duplication surfaces in sdd-report and refactor sessions target real duplicate blocks instead of guessing from file sizes.

## Usage

**Agent/Programmatic API**

- `pnpm noldor clones report` — human summary (top groups, duplication %); `--json` for the full `CloneReport` (feeds `/noldor-refactor`).
- `pnpm noldor clones check` — exit 1 when `clones.thresholdPct` (`.noldor/config.json`) is exceeded; unset threshold = always green. Wire into CI/lefthook for a hard gate.
- Flags: `--min-tokens N` (50), `--min-lines N` (5), `--gap-tokens N` (10), `--include-tests`.
- `sdd-report` — `## Code clones` section renders group count + duplication % + top-5 groups on every regen.

## Open questions (resolved)

1. *Hand-rolled tokenizer vs adding jscpd as a dependency?*
   -> Hand-rolled. (D1) jscpd pulls a large dep tree into a package that ships to consumers; the needed scanner is ~100 lines and fully unit-tested; deterministic posture favors owning it.
2. *Where does the gate hook in — CR lane, garden gate-compliance, or exit-code CLI?*
   -> Exit-code CLI (`clones check`). (D2) Cheapest composable surface; consumers wire it into lefthook/CI themselves; no new CR-lane or release-gate semantics.
3. *Count test files?*
   -> Excluded by default, `--include-tests` opt-in. (D3) Test scaffolding duplication is conventional and would drown the signal.
4. *Garden `detectAll` wiring (like skillDrift)?*
   -> No — sdd-report section only. (D4) Clone volume is a trend metric, not a per-item drift finding; garden's finding lists suit discrete items, and the release auto-restamp gate would otherwise flip red on any duplication.
