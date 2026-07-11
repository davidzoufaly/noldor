# Framework Auto-Split Suggestion for Big Features and Plans Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** A tested oversize-suggestion layer at the pipeline's commit points: a pure heuristics module (`src/core/split-suggestion.ts` — E1/E2/E3 over roadmap/backlog entry bodies, F1 over FD attach breadth, P1 over plan rows; thresholds 300 words / 6 scope bullets / 8 touches / 30 links.code / 1000 rows), a `pnpm noldor noldor split-check` CLI with `lint-plan-snippets`' exact 0 clean / 2 findings / 1 infra-error exit contract, suggestion prose at `/promote` (new step 1.7), `noldor-plan` (post-save check + `-part<N>` restructure), gate Step 2.5 `--kind plan` (alongside the existing lint pass), and the drain-mode hard guard that bounces an oversized-body entry to the escalation surface instead of shipping it (the `prefix-skills-with-noldor` mislabeled-`S` closure). Signals are informational wherever an operator is present; the framework never auto-splits and never re-sizes.

**Architecture:** Spec Units 1–5 + docs, implemented faithfully. (1) Pure module beside `size-routing.ts` (the size-policy home), reusing `extractTouches` (`src/core/extract-touches.ts`) for E3 and typed against `Pick<BacklogEntry, 'description'>` from `src/utils/parse-blocks.ts`; thresholds are exported constants, deliberately not config (spec D1/D5). (2) `src/core/split-check-cli.ts` — exported `runSplitCheck(args, cwd)` core (fixture-testable without subprocesses, per the `src/autonomous/status-cli.ts` collect/format precedent) + thin `main()` with the `lint-plan-snippets`-style direct-invocation guard; `--entry <slug>` resolves roadmap-then-backlog via `loadDocRoots` + `parseRoadmap`/`parseBacklog`, `--plan <path>` reads the file, `--fd <slug> [--add <path>…]` reads FD frontmatter `links.code` via gray-matter (the `next-priority.ts` pattern); errors emit on **stdout** (not stderr) exactly like `lint-plan-snippets`, so gate Step 2.5 can surface them in prompt descriptions; registered in the `noldor` manifest group directly beside `'lint-plan-snippets'`. (3–5) Skill prose: `/promote` step 1.7 three-way disposition (attach branch adds the `--fd … --add …` F1 check), `noldor-plan` save-then-check with part-file restructure, gate Step 2.5 plan-kind split pass appended to the lint output (the authoritative checkpoint — plans-drain executes committed plans without re-invoking the skill), gate drain-mode entry guard (exit-without-scaffolding on exit 2). Docs: "Split suggestion" subsection in `docs/noldor/complexity-gating.md`. Every skill/doc edit lands byte-identical in its `templates/` twin in the same commit.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes, oxfmt printWidth 100 — long signal messages use `+` string concatenation like `lint-plan-snippets`; run `pnpm fmt` before committing), vitest (`pnpm vitest run <path>`; subprocess exit-code tests via `pnpm exec tsx`, per `src/core/__tests__/lint-plan-snippets.test.ts` — `pnpm --silent` would normalise exit codes), gray-matter. Lefthook gates: `templates/` twins must be staged in the same commit (`checks template-sync` runs pre-commit on staged files); `.claude/skills/**` commits from a `.worktrees/` checkout need `NOLDOR_ALLOW_SHARED=1` (harmless from the main workspace); `docs/noldor/*.md` commits need a `noldor` / `noldor:<page>` scope; the `sync test-links`/`doc-links` pre-commit hooks auto-update + auto-stage FD `links.tests`/`links.docs` — expected, don't fight it. Test files start with `// @tests: framework-auto-split-suggestion-for-big-features-and-plans`.

Spec: [docs/superpowers/specs/2026-07-03-framework-auto-split-suggestion-for-big-features-and-plans-design.md](../specs/2026-07-03-framework-auto-split-suggestion-for-big-features-and-plans-design.md)

---

## File Structure

- `src/core/split-suggestion.ts` — create; pure oversize heuristics: `SplitSignal`, five exported threshold constants, `assessEntrySplit` (E1 words / E2 scope bullets / E3 `Touches:` breadth via `extractTouches`), `assessFdBreadth` (F1 dedupe-union), `assessPlanSplit` (P1 raw line count + suggested part count)
- `src/core/__tests__/split-suggestion.test.ts` — create; per-rule boundary at/over threshold, empty inputs, F1 dedupe (both directions), E3 `extractTouches` reuse (backtick + md-link forms), P1 part-count message
- `src/core/split-check-cli.ts` — create; `runSplitCheck(args, cwd)` (mode parse → resolve → assess → `{exitCode, lines}`) + thin `main()`; 0/2/1 exit contract mirroring `lint-plan-snippets`, errors on stdout
- `src/core/__tests__/split-check-cli.test.ts` — create; fixture-repo unit tests for all three modes + slug fallback + infra errors, plus subprocess exit-contract tests for `--plan` and usage
- `src/cli/manifest.ts` — modify; register `'split-check'` in the `noldor` group beside `'lint-plan-snippets'`
- `.claude/skills/promote/SKILL.md` — modify; new step 1.7 (entry check + attach-branch F1 check, three-way disposition)
- `templates/.claude/skills/promote/SKILL.md` — modify; byte-identical twin
- `.claude/skills/noldor-plan/SKILL.md` — modify; step 6 becomes save + split check, new step 7 report
- `templates/.claude/skills/noldor-plan/SKILL.md` — modify; byte-identical twin
- `.claude/skills/gate/SKILL.md` — modify; Step 2.5 "Lint pass first" runs `split-check --plan` for `kind=plan` (Task 5); drain-mode Step 0 oversize guard (Task 6)
- `templates/.claude/skills/gate/SKILL.md` — modify; byte-identical twin (Tasks 5 and 6)
- `docs/noldor/complexity-gating.md` — modify; "Split suggestion" subsection under "Size → path" (five rules, thresholds, surfaces, informational-vs-drain semantics)
- `templates/docs/noldor/complexity-gating.md` — modify; byte-identical twin
- `docs/features/framework-auto-split-suggestion-for-big-features-and-plans.md` — modify; fill frontmatter `links.code`

---

## Task 1: Pure module `split-suggestion.ts` (spec Unit 1)

**Files:**

- Create: `src/core/split-suggestion.ts`
- Test: `src/core/__tests__/split-suggestion.test.ts`

- [ ] **Step 1: Write the failing heuristics tests**

Create `src/core/__tests__/split-suggestion.test.ts` with exactly:

```ts
// @tests: framework-auto-split-suggestion-for-big-features-and-plans
import { describe, expect, it } from 'vitest';

import {
  ENTRY_BULLET_THRESHOLD,
  ENTRY_TOUCHES_THRESHOLD,
  ENTRY_WORD_THRESHOLD,
  FD_LINKS_CODE_THRESHOLD,
  PLAN_ROW_THRESHOLD,
  assessEntrySplit,
  assessFdBreadth,
  assessPlanSplit,
} from '../split-suggestion.js';

function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
}

function bullets(n: number): string {
  return Array.from({ length: n }, (_, i) => `- scope item ${i}`).join('\n');
}

function touchesClause(n: number): string {
  const paths = Array.from({ length: n }, (_, i) => `\`src/mod-${i}.ts\``).join(', ');
  return `Touches: ${paths}.`;
}

describe('assessEntrySplit', () => {
  it('returns [] for an empty description', () => {
    expect(assessEntrySplit({ description: '' })).toEqual([]);
  });

  it('E1: [] at exactly the word threshold, one signal one word over', () => {
    expect(assessEntrySplit({ description: words(ENTRY_WORD_THRESHOLD) })).toEqual([]);
    const signals = assessEntrySplit({ description: words(ENTRY_WORD_THRESHOLD + 1) });
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      rule: 'E1',
      value: ENTRY_WORD_THRESHOLD + 1,
      threshold: ENTRY_WORD_THRESHOLD,
    });
    expect(signals[0].message).toContain('301 words');
  });

  it('E2: [] at exactly the bullet threshold, one signal one bullet over', () => {
    expect(assessEntrySplit({ description: bullets(ENTRY_BULLET_THRESHOLD) })).toEqual([]);
    const signals = assessEntrySplit({ description: bullets(ENTRY_BULLET_THRESHOLD + 1) });
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      rule: 'E2',
      value: ENTRY_BULLET_THRESHOLD + 1,
      threshold: ENTRY_BULLET_THRESHOLD,
    });
  });

  it('E2 counts indented scope bullets too', () => {
    const description = Array.from(
      { length: ENTRY_BULLET_THRESHOLD + 1 },
      (_, i) => `  - sub ${i}`,
    ).join('\n');
    expect(assessEntrySplit({ description }).map((s) => s.rule)).toEqual(['E2']);
  });

  it('E3: counts Touches paths via extractTouches — [] at 8, signal at 9 (backtick form)', () => {
    expect(assessEntrySplit({ description: touchesClause(ENTRY_TOUCHES_THRESHOLD) })).toEqual([]);
    const signals = assessEntrySplit({ description: touchesClause(ENTRY_TOUCHES_THRESHOLD + 1) });
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      rule: 'E3',
      value: ENTRY_TOUCHES_THRESHOLD + 1,
      threshold: ENTRY_TOUCHES_THRESHOLD,
    });
  });

  it('E3: md-link path form counts too (mixed with backticks)', () => {
    const backticks = Array.from({ length: 8 }, (_, i) => `\`src/mod-${i}.ts\``).join(', ');
    const description = `Touches: ${backticks}, [src/extra.ts](../../src/extra.ts).`;
    const signals = assessEntrySplit({ description });
    expect(signals.map((s) => s.rule)).toEqual(['E3']);
    expect(signals[0].value).toBe(9);
  });

  it('fires one signal per tripped rule, in rule order, when all three trip', () => {
    const description = [
      words(ENTRY_WORD_THRESHOLD + 1),
      bullets(ENTRY_BULLET_THRESHOLD + 1),
      touchesClause(ENTRY_TOUCHES_THRESHOLD + 1),
    ].join('\n');
    expect(assessEntrySplit({ description }).map((s) => s.rule)).toEqual(['E1', 'E2', 'E3']);
  });
});

describe('assessFdBreadth', () => {
  const thirty = Array.from({ length: FD_LINKS_CODE_THRESHOLD }, (_, i) => `src/f${i}.ts`);

  it('returns null at exactly the threshold with no additions', () => {
    expect(assessFdBreadth(thirty, [])).toBeNull();
  });

  it('fires F1 when one new touch pushes the union over the threshold', () => {
    const signal = assessFdBreadth(thirty, ['new.ts']);
    expect(signal).toMatchObject({
      rule: 'F1',
      value: FD_LINKS_CODE_THRESHOLD + 1,
      threshold: FD_LINKS_CODE_THRESHOLD,
    });
    expect(signal?.message).toContain('child FD');
  });

  it('dedupes: added paths already in links.code do not double-count', () => {
    expect(assessFdBreadth(thirty, [thirty[0], thirty[1]])).toBeNull();
  });

  it('dedupes: duplicate added paths count once', () => {
    expect(assessFdBreadth(thirty.slice(0, 29), ['new.ts', 'new.ts'])).toBeNull();
  });

  it('returns null on empty inputs', () => {
    expect(assessFdBreadth([], [])).toBeNull();
  });
});

describe('assessPlanSplit', () => {
  it('returns [] for a plan at exactly the row threshold', () => {
    const md = Array.from({ length: PLAN_ROW_THRESHOLD }, () => 'row').join('\n');
    expect(assessPlanSplit(md)).toEqual([]);
  });

  it('fires P1 one row over and names 2 parts in the message', () => {
    const md = Array.from({ length: PLAN_ROW_THRESHOLD + 1 }, () => 'row').join('\n');
    const signals = assessPlanSplit(md);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      rule: 'P1',
      value: PLAN_ROW_THRESHOLD + 1,
      threshold: PLAN_ROW_THRESHOLD,
    });
    expect(signals[0].message).toContain('2 part');
  });

  it('suggests 3 parts for a plan just over twice the threshold', () => {
    const md = Array.from({ length: PLAN_ROW_THRESHOLD * 2 + 1 }, () => 'row').join('\n');
    expect(assessPlanSplit(md)[0].message).toContain('3 part');
  });

  it('returns [] for an empty string (one row)', () => {
    expect(assessPlanSplit('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they FAIL**

```bash
pnpm vitest run src/core/__tests__/split-suggestion.test.ts
```

Expected output: 1 failed test file — module-load error `Cannot find module '../split-suggestion.js'` (the module does not exist yet).

- [ ] **Step 3: Implement the pure module**

Create `src/core/split-suggestion.ts` with exactly:

```ts
/**
 * Oversize-assessment heuristics behind `pnpm noldor noldor split-check`.
 *
 * Lives next to `size-routing.ts` (the size-policy home). `sizeToPath()`
 * routes purely on the operator's `size:` label; nothing cross-checks the
 * label against the body it describes — a mislabeled `S` with an L-sized body
 * sails through to a doomed drain iteration (the `prefix-skills-with-noldor`
 * incident). These heuristics measure the artifact itself at each commit
 * point (/promote step 1.7, noldor-plan post-save, gate Step 2.5 kind=plan,
 * headless drain entry) and *suggest* a split; the framework never
 * auto-splits and never re-sizes.
 *
 * Thresholds are deliberately exported constants, not config (spec D1/D5):
 * they fire only on genuine outliers, and tuning is a one-line diff here.
 */
import type { BacklogEntry } from '../utils/parse-blocks.js';
import { extractTouches } from './extract-touches.js';

export interface SplitSignal {
  readonly rule: string; // 'E1' | 'E2' | 'E3' | 'F1' | 'P1'
  readonly value: number;
  readonly threshold: number;
  readonly message: string; // human sentence incl. suggested remedy
}

export const ENTRY_WORD_THRESHOLD = 300;
export const ENTRY_BULLET_THRESHOLD = 6;
export const ENTRY_TOUCHES_THRESHOLD = 8;
export const FD_LINKS_CODE_THRESHOLD = 30;
export const PLAN_ROW_THRESHOLD = 1000;

const SCOPE_BULLET_RE = /^\s*-\s+/;

/**
 * E1/E2/E3 heuristics over a roadmap/backlog entry body — the free-text
 * `description` that `parseRoadmap`/`parseBacklog` already separate from the
 * `- key: value` bullet fields. One signal per tripped rule, in rule order.
 * All comparisons are strictly greater-than: a body AT a threshold is clean.
 */
export function assessEntrySplit(entry: Pick<BacklogEntry, 'description'>): SplitSignal[] {
  const signals: SplitSignal[] = [];
  const trimmed = entry.description.trim();
  const words = trimmed === '' ? 0 : trimmed.split(/\s+/).length;
  if (words > ENTRY_WORD_THRESHOLD) {
    signals.push({
      rule: 'E1',
      value: words,
      threshold: ENTRY_WORD_THRESHOLD,
      message:
        `entry body is ${words} words (threshold ${ENTRY_WORD_THRESHOLD}) — split the block ` +
        `into sibling entries, one per concern, before committing to a path.`,
    });
  }
  const bullets = entry.description.split('\n').filter((l) => SCOPE_BULLET_RE.test(l)).length;
  if (bullets > ENTRY_BULLET_THRESHOLD) {
    signals.push({
      rule: 'E2',
      value: bullets,
      threshold: ENTRY_BULLET_THRESHOLD,
      message:
        `entry body has ${bullets} scope bullets (threshold ${ENTRY_BULLET_THRESHOLD}) — each ` +
        `scope bullet is a candidate sibling entry; split before promoting.`,
    });
  }
  const touches = extractTouches(entry.description).paths.length;
  if (touches > ENTRY_TOUCHES_THRESHOLD) {
    signals.push({
      rule: 'E3',
      value: touches,
      threshold: ENTRY_TOUCHES_THRESHOLD,
      message:
        `Touches: clause names ${touches} paths (threshold ${ENTRY_TOUCHES_THRESHOLD}) — split ` +
        `by subsystem so each slice touches a reviewable file set.`,
    });
  }
  return signals;
}

/**
 * F1 — "attach would make this parent an everything-FD". Fires when the
 * deduplicated union of the parent's `links.code` and the attach's pending
 * touches exceeds the threshold. Returns `null` when within bounds.
 */
export function assessFdBreadth(
  linksCode: readonly string[],
  addedTouches: readonly string[],
): SplitSignal | null {
  const union = new Set([...linksCode, ...addedTouches]).size;
  if (union <= FD_LINKS_CODE_THRESHOLD) return null;
  return {
    rule: 'F1',
    value: union,
    threshold: FD_LINKS_CODE_THRESHOLD,
    message:
      `attach would grow the parent's links.code to ${union} paths (threshold ` +
      `${FD_LINKS_CODE_THRESHOLD}) — scaffold a child FD instead of attaching.`,
  };
}

/**
 * P1 — plan bulk. A "row" is a raw markdown line (`split('\n').length`), per
 * the roadmap entry's ~1000-rows framing (spec D4); one part ≈ 1000 rows, so
 * the suggested part count is `ceil(rows / threshold)`.
 */
export function assessPlanSplit(planMd: string): SplitSignal[] {
  const rows = planMd.split('\n').length;
  if (rows <= PLAN_ROW_THRESHOLD) return [];
  const parts = Math.ceil(rows / PLAN_ROW_THRESHOLD);
  return [
    {
      rule: 'P1',
      value: rows,
      threshold: PLAN_ROW_THRESHOLD,
      message:
        `plan is ${rows} rows (threshold ${PLAN_ROW_THRESHOLD}) — restructure into ${parts} ` +
        `part files (docs/superpowers/plans/YYYY-MM-DD-<slug>-part<N>.md), each independently ` +
        `shippable.`,
    },
  ];
}
```

- [ ] **Step 4: Run the tests to verify they PASS**

```bash
pnpm vitest run src/core/__tests__/split-suggestion.test.ts
```

Expected output: `Test Files  1 passed (1)`, `Tests  16 passed (16)`.

- [ ] **Step 5: Commit**

```bash
pnpm fmt
git add src/core/split-suggestion.ts src/core/__tests__/split-suggestion.test.ts
git commit -m "feat(core): add split-suggestion oversize heuristics (E1-E3, F1, P1)" -m "Noldor-FD: framework-auto-split-suggestion-for-big-features-and-plans"
```

(The `sync test-links` pre-commit hook may auto-update and auto-stage `links.tests` in the FD — expected.)

---

## Task 2: `split-check` CLI + manifest registration (spec Unit 2)

**Files:**

- Create: `src/core/split-check-cli.ts`
- Modify: `src/cli/manifest.ts`
- Test: `src/core/__tests__/split-check-cli.test.ts`

- [ ] **Step 1: Write the failing CLI tests**

Create `src/core/__tests__/split-check-cli.test.ts` with exactly:

```ts
// @tests: framework-auto-split-suggestion-for-big-features-and-plans
import { describe, expect, it } from 'vitest';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runSplitCheck } from '../split-check-cli.js';

const OVERSIZED_BODY = [
  'One block, seven scopes.',
  ...Array.from({ length: 7 }, (_, i) => `- scope ${i} — its own concern`),
].join('\n');

function makeFixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'split-check-'));
  mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
  writeFileSync(
    join(dir, 'docs', 'roadmap.md'),
    [
      '# Roadmap',
      '',
      '### Giant Entry',
      '',
      '- area: tooling',
      '- size: S',
      '',
      OVERSIZED_BODY,
      '',
      '### Tidy Entry',
      '',
      '- area: tooling',
      '- size: S',
      '',
      'One small change.',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, 'docs', 'backlog.md'),
    ['### Parked Giant', '', '- area: tooling', '', OVERSIZED_BODY, ''].join('\n'),
  );
  const thirty = Array.from({ length: 30 }, (_, i) => `    - src/f${i}.ts`).join('\n');
  writeFileSync(
    join(dir, 'docs', 'features', 'wide-parent.md'),
    ['---', 'links:', '  code:', thirty, '---', '', '## Summary', ''].join('\n'),
  );
  return dir;
}

describe('runSplitCheck', () => {
  it('--entry: oversized roadmap entry → exit 2 with one line per signal', () => {
    const dir = makeFixtureRepo();
    const res = runSplitCheck(['--entry', 'giant-entry'], dir);
    expect(res.exitCode).toBe(2);
    expect(res.lines).toHaveLength(1);
    expect(res.lines[0]).toContain('[E2]');
  });

  it('--entry: clean entry → exit 0, no output', () => {
    const dir = makeFixtureRepo();
    expect(runSplitCheck(['--entry', 'tidy-entry'], dir)).toEqual({ exitCode: 0, lines: [] });
  });

  it('--entry: falls back to backlog when the slug is not in the roadmap', () => {
    const dir = makeFixtureRepo();
    const res = runSplitCheck(['--entry', 'parked-giant'], dir);
    expect(res.exitCode).toBe(2);
    expect(res.lines[0]).toContain('[E2]');
  });

  it('--entry: unknown slug → exit 1 infra error naming the slug', () => {
    const dir = makeFixtureRepo();
    const res = runSplitCheck(['--entry', 'no-such-slug'], dir);
    expect(res.exitCode).toBe(1);
    expect(res.lines.join('\n')).toContain('no-such-slug');
  });

  it('--plan: 1001-row plan → exit 2 with a P1 line; 1000 rows → exit 0', () => {
    const dir = makeFixtureRepo();
    writeFileSync(join(dir, 'big-plan.md'), Array.from({ length: 1001 }, () => 'row').join('\n'));
    writeFileSync(join(dir, 'ok-plan.md'), Array.from({ length: 1000 }, () => 'row').join('\n'));
    const over = runSplitCheck(['--plan', 'big-plan.md'], dir);
    expect(over.exitCode).toBe(2);
    expect(over.lines[0]).toContain('[P1]');
    expect(runSplitCheck(['--plan', 'ok-plan.md'], dir).exitCode).toBe(0);
  });

  it('--plan: unreadable path → exit 1', () => {
    const dir = makeFixtureRepo();
    expect(runSplitCheck(['--plan', 'missing.md'], dir).exitCode).toBe(1);
  });

  it('--fd: one --add over the breadth threshold → exit 2 F1; duplicate adds count once', () => {
    const dir = makeFixtureRepo();
    const over = runSplitCheck(['--fd', 'wide-parent', '--add', 'src/new.ts'], dir);
    expect(over.exitCode).toBe(2);
    expect(over.lines[0]).toContain('[F1]');
    const dup = runSplitCheck(
      ['--fd', 'wide-parent', '--add', 'src/f0.ts', '--add', 'src/f0.ts'],
      dir,
    );
    expect(dup.exitCode).toBe(0);
  });

  it('--fd: missing FD → exit 1', () => {
    const dir = makeFixtureRepo();
    expect(runSplitCheck(['--fd', 'nope'], dir).exitCode).toBe(1);
  });

  it('no mode / conflicting modes / dangling flag → exit 1 usage', () => {
    const dir = makeFixtureRepo();
    expect(runSplitCheck([], dir).exitCode).toBe(1);
    expect(runSplitCheck([], dir).lines[0]).toContain('usage');
    expect(runSplitCheck(['--entry', 'x', '--plan', 'y'], dir).exitCode).toBe(1);
    expect(runSplitCheck(['--entry'], dir).exitCode).toBe(1);
  });
});

describe('CLI exit-code contract (subprocess, mirrors lint-plan-snippets)', () => {
  // pnpm --silent normalises any non-zero exit to 1, so we invoke tsx directly
  // via pnpm exec to get the real exit code from the script.
  const rootDir = new URL('../../..', import.meta.url).pathname;
  function runCli(args: string[]): { stdout: string; status: number } {
    try {
      const stdout = execFileSync(
        'pnpm',
        ['exec', 'tsx', join(rootDir, 'src/core/split-check-cli.ts'), ...args],
        { encoding: 'utf8', cwd: rootDir },
      );
      return { stdout, status: 0 };
    } catch (err) {
      const e = err as { stdout?: Buffer | string; status?: number };
      const stdout = typeof e.stdout === 'string' ? e.stdout : (e.stdout?.toString() ?? '');
      return { stdout, status: e.status ?? 1 };
    }
  }

  it('exits 2 with signal lines on stdout for an oversized plan', () => {
    const dir = mkdtempSync(join(tmpdir(), 'split-cli-'));
    const path = join(dir, 'plan.md');
    writeFileSync(path, Array.from({ length: 1001 }, () => 'row').join('\n'));
    const { stdout, status } = runCli(['--plan', path]);
    expect(status).toBe(2);
    expect(stdout).toContain('[P1]');
  });

  it('exits 0 silently for a small plan', () => {
    const dir = mkdtempSync(join(tmpdir(), 'split-cli-clean-'));
    const path = join(dir, 'plan.md');
    writeFileSync(path, '# tiny\n');
    const { stdout, status } = runCli(['--plan', path]);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe('');
  });

  it('exits 1 with usage on stdout when no mode flag is given', () => {
    const { stdout, status } = runCli([]);
    expect(status).toBe(1);
    expect(stdout.toLowerCase()).toContain('usage');
  });
});
```

- [ ] **Step 2: Run the tests to verify they FAIL**

```bash
pnpm vitest run src/core/__tests__/split-check-cli.test.ts
```

Expected output: 1 failed test file — module-load error `Cannot find module '../split-check-cli.js'`.

- [ ] **Step 3: Implement the CLI**

Create `src/core/split-check-cli.ts` with exactly:

```ts
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import matter from 'gray-matter';

import { parseBacklog, parseRoadmap, type BacklogEntry } from '../utils/parse-blocks.js';
import { loadDocRoots } from './doc-roots.js';
import {
  assessEntrySplit,
  assessFdBreadth,
  assessPlanSplit,
  type SplitSignal,
} from './split-suggestion.js';

/**
 * `pnpm noldor noldor split-check` — suggest a split when an entry/FD/plan
 * exceeds the `split-suggestion.ts` size thresholds.
 *
 * Exit contract mirrors `lint-plan-snippets` exactly so skills shell out to
 * both uniformly: 0 = clean, 2 = signals present (one stdout line per
 * signal), 1 = infra error (unknown slug, unreadable path, bad usage).
 * Errors emit on stdout (not stderr) so /gate Step 2.5 and the skills can
 * surface them in prompt descriptions; the CLI's consumers capture stdout.
 */
export interface SplitCheckResult {
  readonly exitCode: 0 | 1 | 2;
  readonly lines: readonly string[];
}

const USAGE = 'usage: split-check --entry <slug> | --plan <path> | --fd <slug> [--add <path>...]';

function usageError(detail: string): SplitCheckResult {
  return { exitCode: 1, lines: [USAGE, `error: ${detail}`] };
}

function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** Resolve a slug to its entry — `docs/roadmap.md` first, then `docs/backlog.md`. */
function findEntry(slug: string, cwd: string): BacklogEntry | null {
  const roots = loadDocRoots(cwd);
  const roadmapRaw = readFileOrNull(roots.roadmap);
  if (roadmapRaw !== null) {
    const hit = parseRoadmap(roadmapRaw).find((e) => e.slug === slug);
    if (hit !== undefined) return hit;
  }
  const backlogRaw = readFileOrNull(roots.backlog);
  if (backlogRaw !== null) {
    const hit = parseBacklog(backlogRaw).find((e) => e.slug === slug);
    if (hit !== undefined) return hit;
  }
  return null;
}

function formatSignal(s: SplitSignal): string {
  return `[${s.rule}] ${s.message}`;
}

function toResult(signals: readonly SplitSignal[]): SplitCheckResult {
  if (signals.length === 0) return { exitCode: 0, lines: [] };
  return { exitCode: 2, lines: signals.map(formatSignal) };
}

export function runSplitCheck(args: readonly string[], cwd: string): SplitCheckResult {
  let entry: string | undefined;
  let plan: string | undefined;
  let fd: string | undefined;
  const add: string[] = [];
  let i = 0;
  while (i < args.length) {
    const flag = args[i];
    if (flag !== '--entry' && flag !== '--plan' && flag !== '--fd' && flag !== '--add') {
      return usageError(`unknown argument ${flag}`);
    }
    const value = args[i + 1];
    if (value === undefined) return usageError(`missing value after ${flag}`);
    if (flag === '--entry') entry = value;
    else if (flag === '--plan') plan = value;
    else if (flag === '--fd') fd = value;
    else add.push(value);
    i += 2;
  }
  const modes = [entry, plan, fd].filter((m) => m !== undefined);
  if (modes.length !== 1) return { exitCode: 1, lines: [USAGE] };

  if (entry !== undefined) {
    const found = findEntry(entry, cwd);
    if (found === null) return usageError(`no roadmap/backlog entry with slug "${entry}"`);
    return toResult(assessEntrySplit(found));
  }

  if (plan !== undefined) {
    const path = isAbsolute(plan) ? plan : join(cwd, plan);
    const md = readFileOrNull(path);
    if (md === null) return usageError(`cannot read plan at ${path}`);
    return toResult(assessPlanSplit(md));
  }

  const fdPath = join(loadDocRoots(cwd).features, `${fd}.md`);
  const raw = readFileOrNull(fdPath);
  if (raw === null) return usageError(`cannot read FD at ${fdPath}`);
  const data = matter(raw).data as { links?: { code?: unknown } };
  const rawCode = data.links?.code;
  const code = Array.isArray(rawCode)
    ? rawCode.filter((p): p is string => typeof p === 'string')
    : [];
  const signal = assessFdBreadth(code, add);
  return toResult(signal === null ? [] : [signal]);
}

function main(): void {
  const result = runSplitCheck(process.argv.slice(2), process.cwd());
  for (const line of result.lines) {
    process.stdout.write(`${line}\n`);
  }
  process.exit(result.exitCode);
}

const invokedDirect = /[\\/]split-check-cli\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) {
  main();
}
```

- [ ] **Step 4: Register the subcommand in the CLI manifest**

In `src/cli/manifest.ts`, inside the `noldor` group, replace

```ts
      'lint-plan-snippets': {
        src: 'core/lint-plan-snippets.ts',
        desc: 'Lint code snippets in plans',
      },
```

with

```ts
      'lint-plan-snippets': {
        src: 'core/lint-plan-snippets.ts',
        desc: 'Lint code snippets in plans',
      },
      'split-check': {
        src: 'core/split-check-cli.ts',
        desc: 'Suggest a split when an entry/FD/plan exceeds size thresholds',
      },
```

- [ ] **Step 5: Run the tests to verify they PASS**

```bash
pnpm vitest run src/core/__tests__/split-check-cli.test.ts
```

Expected output: `Test Files  1 passed (1)`, `Tests  12 passed (12)`.

- [ ] **Step 6: Smoke the manifest wiring through the real CLI**

```bash
pnpm --silent noldor noldor split-check --plan docs/roadmap.md; echo "exit=$?"
pnpm --silent noldor noldor split-check; echo "exit=$?"
```

Expected output: first command prints nothing and `exit=0` (roadmap.md is far under 1000 rows); second prints the `usage: split-check …` line and `exit=1`.

- [ ] **Step 7: Commit**

```bash
pnpm fmt
git add src/core/split-check-cli.ts src/core/__tests__/split-check-cli.test.ts src/cli/manifest.ts
git commit -m "feat(core): add noldor split-check CLI with lint-style 0/2/1 exit contract" -m "Noldor-FD: framework-auto-split-suggestion-for-big-features-and-plans"
```

---

## Task 3: `/promote` step 1.7 (spec Unit 3)

**Files:**

- Modify: `.claude/skills/promote/SKILL.md`
- Modify: `templates/.claude/skills/promote/SKILL.md`

- [ ] **Step 1: Insert step 1.7 after the attach-detection step**

In `.claude/skills/promote/SKILL.md`, replace

````markdown
If the operator picks (1) or (2): execute the attach branch (step 6.alt).
If (3) or no candidates fired: continue to step 2 (existing scaffold flow).
````

with

````markdown
If the operator picks (1) or (2): execute the attach branch (step 6.alt).
If (3) or no candidates fired: continue to step 2 (existing scaffold flow).

1.7. **Split suggestion (oversize check).** Run `pnpm noldor noldor split-check --entry <slug>` and capture stdout + exit code. On the attach branch (a parent was picked at step 1.5), additionally run `pnpm noldor noldor split-check --fd <parent-slug> --add <path>...` with one `--add` per path in the source block's `Touches:` clause (run `extractTouches` over the block body now — the same helper step 6.4 uses later). Exit 0 = clean → continue silently. Exit 1 = infra error → mention it and continue; never block on checker infra. Exit 2 = signals present → present ONE AskUserQuestion with every captured signal line verbatim:

```
Split suggested for "<heading>":
  <split-check stdout, one line per signal — includes the F1 parent-breadth line on attach>

Choose:
  (a) proceed anyway — accept the scope as one FD / one attach
  (b) split first — split the source block into sibling blocks (same write-back
      mechanics as residue disposition 6.5(b): H3/H4 placement per source level,
      carried `- area:`/`- type:`/`- size:`/`- impact:` bullets, and
      `- recovered: YYYY-MM-DD` provenance), then re-run /promote on one slice
  (c) abort and re-size — leave the block in place; fix its `- size:` label
```

On (a) continue to step 2 (or step 6.alt on the attach branch); for an F1 signal the (b) remedy is instead: scaffold a child FD rather than attaching. On (b) or (c) stop this promotion after any sibling write-backs — no FD is scaffolded and the source block is not removed. Signals are informational — the operator decides; the framework never auto-splits.
````

- [ ] **Step 2: Mirror the skill twin byte-identically**

```bash
cp .claude/skills/promote/SKILL.md templates/.claude/skills/promote/SKILL.md
```

- [ ] **Step 3: Verify template sync PASSES**

```bash
pnpm noldor checks template-sync .claude/skills/promote/SKILL.md templates/.claude/skills/promote/SKILL.md
```

Expected output: `template-sync OK`.

- [ ] **Step 4: Commit (shared-files guard: `.claude/skills/**` edits from a `.worktrees/` checkout need the override)**

```bash
git add .claude/skills/promote/SKILL.md templates/.claude/skills/promote/SKILL.md
NOLDOR_ALLOW_SHARED=1 git commit -m "docs(promote): add step 1.7 split suggestion before scaffold/attach" -m "Noldor-FD: framework-auto-split-suggestion-for-big-features-and-plans"
```

(When running from the main workspace the `NOLDOR_ALLOW_SHARED=1` prefix is harmless — the shared-files guard only fires inside `.worktrees/` checkouts.)

---

## Task 4: `noldor-plan` post-save check (spec Unit 4, skill half)

**Files:**

- Modify: `.claude/skills/noldor-plan/SKILL.md`
- Modify: `templates/.claude/skills/noldor-plan/SKILL.md`

- [ ] **Step 1: Turn step 6 into save + split check, add step 7 report**

In `.claude/skills/noldor-plan/SKILL.md`, replace

```markdown
6. **Save** to `docs/superpowers/plans/YYYY-MM-DD-<slug>.md`, report the path, and stop. The gate owns sequencing (Step 2.5 `--kind plan`: lint → commit → CR lanes).
```

with

```markdown
6. **Save + split check.** Save to `docs/superpowers/plans/YYYY-MM-DD-<slug>.md`, then run `pnpm noldor noldor split-check --plan <path>` and capture stdout + exit code. Exit 0 → continue. Exit 1 = infra error → note it and continue; never block on checker infra. Exit 2 → report the P1 signal verbatim, then restructure the plan into `docs/superpowers/plans/YYYY-MM-DD-<slug>-part<N>.md` parts — each part independently shippable software (same bar as step 1's one-plan-per-subsystem rule) — delete the monolith file, and re-run the split check on each part before continuing.
7. **Report** the saved path(s) and stop. The gate owns sequencing (Step 2.5 `--kind plan`: lint → commit → CR lanes).
```

- [ ] **Step 2: Mirror the skill twin byte-identically**

```bash
cp .claude/skills/noldor-plan/SKILL.md templates/.claude/skills/noldor-plan/SKILL.md
```

- [ ] **Step 3: Verify template sync PASSES**

```bash
pnpm noldor checks template-sync .claude/skills/noldor-plan/SKILL.md templates/.claude/skills/noldor-plan/SKILL.md
```

Expected output: `template-sync OK`.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/noldor-plan/SKILL.md templates/.claude/skills/noldor-plan/SKILL.md
NOLDOR_ALLOW_SHARED=1 git commit -m "docs(noldor-plan): run split-check after save, restructure oversized plans into parts" -m "Noldor-FD: framework-auto-split-suggestion-for-big-features-and-plans"
```

---

## Task 5: Gate Step 2.5 `--kind plan` split pass (spec Unit 4, gate half)

**Files:**

- Modify: `.claude/skills/gate/SKILL.md`
- Modify: `templates/.claude/skills/gate/SKILL.md`

- [ ] **Step 1: Extend the "Lint pass first" paragraph**

In `.claude/skills/gate/SKILL.md` (Step 2.5, the paragraph currently at line ~113), replace

```markdown
**Lint pass first.** Run `pnpm noldor noldor lint-plan-snippets <artifact-path>` and capture stdout + exit code. Exit code 0 = clean; exit code 2 = findings present (include the captured stdout verbatim in the AskUserQuestion description so the operator sees them before choosing); exit code 1 = script error (mention the error in the description but still proceed to the prompt — never block on linter infra). Findings are informational; they do not gate the choice.
```

with

```markdown
**Lint pass first.** Run `pnpm noldor noldor lint-plan-snippets <artifact-path>` and capture stdout + exit code. When the artifact kind is `plan`, also run `pnpm noldor noldor split-check --plan <artifact-path>` (same 0/2/1 exit contract) and append its stdout to the captured lint output. Exit code 0 = clean; exit code 2 = findings present (include the captured stdout verbatim in the AskUserQuestion description so the operator sees them before choosing); exit code 1 = script error (mention the error in the description but still proceed to the prompt — never block on linter infra). Findings are informational; they do not gate the choice. This Step 2.5 pass is the authoritative split checkpoint: autonomous/plans-drain paths execute committed plans without re-invoking the `noldor-plan` skill, so its post-save self-check may never have run.
```

- [ ] **Step 2: Mirror the skill twin byte-identically**

```bash
cp .claude/skills/gate/SKILL.md templates/.claude/skills/gate/SKILL.md
```

- [ ] **Step 3: Verify template sync PASSES**

```bash
pnpm noldor checks template-sync .claude/skills/gate/SKILL.md templates/.claude/skills/gate/SKILL.md
```

Expected output: `template-sync OK`.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/gate/SKILL.md templates/.claude/skills/gate/SKILL.md
NOLDOR_ALLOW_SHARED=1 git commit -m "docs(gate): run split-check --plan alongside lint at Step 2.5" -m "Noldor-FD: framework-auto-split-suggestion-for-big-features-and-plans"
```

---

## Task 6: Gate drain-mode oversize guard (spec Unit 5)

**Files:**

- Modify: `.claude/skills/gate/SKILL.md`
- Modify: `templates/.claude/skills/gate/SKILL.md`

- [ ] **Step 1: Add the guard after the drain-mode `suggestedPath` check**

In `.claude/skills/gate/SKILL.md` (the "Drain mode (`NOLDOR_DRAIN=1`)" section near the end, **Step 0** bullet), replace

```markdown
  `NOLDOR_DRAIN_SKIP` (the comma-separated skip-set the supervisor passes through) and, if the chosen
  entry's `suggestedPath !== 'fast-track'`, exit without scaffolding (defensive — the supervisor
  pre-filters scope, so this should not happen).
```

with

```markdown
  `NOLDOR_DRAIN_SKIP` (the comma-separated skip-set the supervisor passes through) and, if the chosen
  entry's `suggestedPath !== 'fast-track'`, exit without scaffolding (defensive — the supervisor
  pre-filters scope, so this should not happen). Then run
  `pnpm noldor noldor split-check --entry <slug>` and capture stdout + exit code. On exit 2, **exit
  without scaffolding**: echo the captured signal lines to stderr and exit non-zero so the
  supervisor's retry-then-skip surfaces them on the escalation channel. An entry whose *label*
  routes to fast-track but whose *body* trips the oversize signals is the mislabeled-`S` failure
  mode (`prefix-skills-with-noldor`) — a human must re-size or split it; never ship it headless.
  On exit 1 (checker infra error), continue — never block a drain on checker infra.
```

- [ ] **Step 2: Mirror the skill twin byte-identically**

```bash
cp .claude/skills/gate/SKILL.md templates/.claude/skills/gate/SKILL.md
```

- [ ] **Step 3: Verify template sync PASSES**

```bash
pnpm noldor checks template-sync .claude/skills/gate/SKILL.md templates/.claude/skills/gate/SKILL.md
```

Expected output: `template-sync OK`.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/gate/SKILL.md templates/.claude/skills/gate/SKILL.md
NOLDOR_ALLOW_SHARED=1 git commit -m "docs(gate): drain-mode oversize guard exits without scaffolding on split signals" -m "Noldor-FD: framework-auto-split-suggestion-for-big-features-and-plans"
```

- [ ] **Step 5: Mirror the guard into the prose-canonical drain-mode page**

`docs/noldor/drain-mode.md` is the runner-neutral rendering of the gate skill's drain-mode section (prose-dispatch runners — codex/opencode — consume it instead of the skill; the two renderings must stay in sync per the skill section's own header). In `docs/noldor/drain-mode.md`, in the top eligibility bullet list (after the `NOLDOR_DRAIN_SKIP` bullet at ~line 25-26), insert:

```markdown
- **Oversize guard:** before scaffolding anything, run
  `pnpm noldor noldor split-check --entry <slug>` and capture stdout + exit
  code. On exit 2, exit non-zero without scaffolding and echo the signal
  lines to stderr — an entry whose *label* routes to fast-track but whose
  *body* trips the oversize heuristics needs a human re-size or split, never
  a headless ship. On exit 1 (checker infra error), continue — never block a
  drain on checker infra.
```

- [ ] **Step 6: Mirror the doc twin byte-identically and verify**

```bash
cp docs/noldor/drain-mode.md templates/docs/noldor/drain-mode.md
pnpm noldor checks template-sync docs/noldor/drain-mode.md templates/docs/noldor/drain-mode.md
```

Expected output: `template-sync OK`.

- [ ] **Step 7: Commit (separate commit — noldor-scope validator requires a `noldor`/`noldor:<slug>` scope for `docs/noldor/` files, so this cannot ride the `docs(gate)` commit)**

```bash
git add docs/noldor/drain-mode.md templates/docs/noldor/drain-mode.md
git commit -m "docs(noldor:drain-mode): mirror drain oversize guard into prose-canonical page" -m "Noldor-FD: framework-auto-split-suggestion-for-big-features-and-plans"
```

---

## Task 7: `docs/noldor/complexity-gating.md` "Split suggestion" subsection (spec Docs)

**Files:**

- Modify: `docs/noldor/complexity-gating.md`
- Modify: `templates/docs/noldor/complexity-gating.md`

- [ ] **Step 1: Add the subsection at the end of "Size → path"**

In `docs/noldor/complexity-gating.md`, replace

```markdown
The mapping is encoded once in [`sizeToPath()`](../../src/core/size-routing.ts) (with `sizeToTier()` and `sizeSkipsSpec()`); `getSuggestions()` stamps each entry surfaced at `/gate` Step 0 with a `suggestedPath` so the gate reads the verdict instead of re-deriving it in prose. Because XS/S route to `fast-track` (no FD, no `/promote`), `/gate` retires the source roadmap block itself when the fast-track ships — see the gate skill's "Roadmap-entry retirement" step.

## Allowlist for `micro-chore`
```

with

```markdown
The mapping is encoded once in [`sizeToPath()`](../../src/core/size-routing.ts) (with `sizeToTier()` and `sizeSkipsSpec()`); `getSuggestions()` stamps each entry surfaced at `/gate` Step 0 with a `suggestedPath` so the gate reads the verdict instead of re-deriving it in prose. Because XS/S route to `fast-track` (no FD, no `/promote`), `/gate` retires the source roadmap block itself when the fast-track ships — see the gate skill's "Roadmap-entry retirement" step.

### Split suggestion

`sizeToPath` routes on the operator's `size:` label; nothing above cross-checks the label against the body it describes. The split-suggestion layer ([`src/core/split-suggestion.ts`](../../src/core/split-suggestion.ts), surfaced via `pnpm noldor noldor split-check`) measures the artifact itself at each commit point and *suggests* a split when a threshold trips — it never auto-splits and never re-sizes. All comparisons are strictly greater-than; a body exactly at a threshold is clean.

| Rule | Measures                                        | Threshold    | Surfaces at                                       |
| ---- | ----------------------------------------------- | ------------ | ------------------------------------------------- |
| `E1` | entry-body word count                           | > 300 words  | `/promote` step 1.7; headless drain entry         |
| `E2` | entry-body scope bullets (`- ` lines)           | > 6 bullets  | `/promote` step 1.7; headless drain entry         |
| `E3` | `Touches:` path count (via `extractTouches`)    | > 8 paths    | `/promote` step 1.7; headless drain entry         |
| `F1` | parent FD `links.code` ∪ attach touches, deduped | > 30 paths   | `/promote` step 1.7 attach branch                 |
| `P1` | plan row count (raw markdown lines)             | > 1000 rows  | `noldor-plan` post-save; `/gate` Step 2.5 `plan`  |

The CLI's exit contract mirrors `lint-plan-snippets` exactly — 0 = clean, 2 = signals (one stdout line per signal), 1 = infra error — so skills shell out to both uniformly and never block on checker infra. Modes: `split-check --entry <slug>` (roadmap-then-backlog body heuristics), `split-check --fd <slug> --add <path>...` (attach breadth), `split-check --plan <path>` (row count; the P1 message names the suggested part count, one part ≈ 1000 rows).

**Informational vs drain.** Wherever an operator is present the signals are informational: `/promote` offers proceed / split-first / abort-and-re-size, the `noldor-plan` skill restructures oversized plans into `-part<N>` files before reporting done, and gate Step 2.5 shows split findings alongside lint findings in the continue-dialog. The one hard stop is the headless drain — no operator can absorb the signal there, so a drain entry whose body trips E1/E2/E3 exits without scaffolding and surfaces on the escalation channel instead of shipping (the `prefix-skills-with-noldor` mislabeled-`S` failure mode). Thresholds are exported constants in `split-suggestion.ts`, deliberately not config (`docs/vision.md` posture: opinionated, not configurable); tuning is a one-line diff.

## Allowlist for `micro-chore`
```

- [ ] **Step 2: Mirror the docs twin byte-identically**

```bash
cp docs/noldor/complexity-gating.md templates/docs/noldor/complexity-gating.md
```

- [ ] **Step 3: Verify template sync PASSES**

```bash
pnpm noldor checks template-sync docs/noldor/complexity-gating.md templates/docs/noldor/complexity-gating.md
```

Expected output: `template-sync OK`.

- [ ] **Step 4: Commit (own commit — `docs/noldor/*.md` needs the `noldor:<page>` scope)**

```bash
git add docs/noldor/complexity-gating.md templates/docs/noldor/complexity-gating.md
NOLDOR_ALLOW_SHARED=1 git commit -m "docs(noldor:complexity-gating): document split-suggestion rules, thresholds, surfaces" -m "Noldor-FD: framework-auto-split-suggestion-for-big-features-and-plans"
```

(The `sync doc-links` pre-commit hook may auto-update and auto-stage the FD's `links.docs` — expected.)

---

## Task 8: FD `links.code` + full verification sweep

**Files:**

- Modify: `docs/features/framework-auto-split-suggestion-for-big-features-and-plans.md`

- [ ] **Step 1: Fill the FD's `links.code`**

In `docs/features/framework-auto-split-suggestion-for-big-features-and-plans.md`, replace

```yaml
links:
  code: []
```

with

```yaml
links:
  code:
    - src/core/split-suggestion.ts
    - src/core/split-check-cli.ts
    - src/cli/manifest.ts
```

(Leave `docs:`/`tests:`/`spec:` lines untouched — the `sync test-links`/`doc-links` hooks own `links.tests`/`links.docs` and may have already filled them in earlier commits. An empty `links.code` is a repeat CR blocker; fill it by hand.)

- [ ] **Step 2: Run the feature's test files**

```bash
pnpm vitest run src/core/__tests__/split-suggestion.test.ts src/core/__tests__/split-check-cli.test.ts
```

Expected output: `Test Files  2 passed (2)`, `Tests  28 passed (28)`.

- [ ] **Step 3: Run the full verification suite**

```bash
pnpm verify
```

Expected output: lint, fmt:check, typecheck, and the whole vitest suite all green; exit 0.

- [ ] **Step 4: Verify all template twins are in sync repo-wide**

```bash
pnpm noldor checks template-sync
```

Expected output: `template-sync OK`.

- [ ] **Step 5: Commit**

```bash
git add docs/features/framework-auto-split-suggestion-for-big-features-and-plans.md
git commit -m "docs(features:framework-auto-split-suggestion-for-big-features-and-plans): fill links.code" -m "Noldor-FD: framework-auto-split-suggestion-for-big-features-and-plans"
```
