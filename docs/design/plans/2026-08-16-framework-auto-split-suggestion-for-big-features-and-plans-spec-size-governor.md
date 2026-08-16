# Spec Size Governor Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Add a `--spec` mode to `split-check` (S1 word-bulk >6000, S2 criteria-bloat >20), wire it into gate Step 2.5 for `kind=spec` artifacts, and teach the `noldor-spec` skill three authoring rules that shrink the review self-consistency surface.

**Architecture:** Two new assessor rules in `src/core/split-suggestion.ts` (shared `countWords()` with E1), a fourth mode branch in `src/core/split-check-cli.ts` mirroring `--plan`, and prose/doc sync across the mode-enumerating surfaces (complexity-gating + script-catalog twins, manifest desc, gate + spec skill twins, parent FD Usage).

**Tech Stack:** TypeScript (Node), vitest, existing `runSplitCheck` CLI contract (exit 0/2/1, stdout-only).

---

## File Structure

- `src/core/split-suggestion.ts` — add `countWords()` helper (E1 + S1 share it), `SPEC_WORD_THRESHOLD`, `SPEC_CRITERIA_THRESHOLD`, `assessSpecSplit()`; update `SplitSignal.rule` comment + module JSDoc commit-point list
- `src/core/split-check-cli.ts` — `--spec <path>` mode branch (mirror of `--plan`), widened exactly-one-mode check, USAGE line, module JSDoc
- `src/core/__tests__/split-suggestion.test.ts` — `assessSpecSplit` unit tests (existing file, existing `// @tests:` tag)
- `src/core/__tests__/split-check-cli.test.ts` — `--spec` CLI tests (existing file)
- `src/cli/manifest.ts` — `split-check.desc` gains `/spec`
- `templates/docs/noldor/complexity-gating.md` + `docs/noldor/complexity-gating.md` — S1/S2 table rows + Modes sentence (byte-identical twin pair; edit both)
- `templates/docs/noldor/script-catalog.md` + `docs/noldor/script-catalog.md` — split-check mode list (twin pair; edit both)
- `.claude/skills/noldor-gate/SKILL.md` + `templates/.claude/skills/noldor-gate/SKILL.md` — Step 2.5 lint pass runs `--spec` on kind=spec (twin pair)
- `.claude/skills/noldor-spec/SKILL.md` + `templates/.claude/skills/noldor-spec/SKILL.md` — three authoring rules in `## Rules` (twin pair)
- `docs/features/framework-auto-split-suggestion-for-big-features-and-plans.md` — Usage fence gains the `--spec` line; in-flow item 3 covers `--kind spec`

---

## Task 1: `assessSpecSplit()` + shared `countWords()` in split-suggestion.ts

**Files:**
- Modify: `src/core/split-suggestion.ts`
- Test: `src/core/__tests__/split-suggestion.test.ts`

- [ ] **Step 1: Write the failing tests.** Append this `describe` block at the end of `src/core/__tests__/split-suggestion.test.ts` (after the `assessPlanSplit` block), and extend the import list at the top of the file with `SPEC_CRITERIA_THRESHOLD`, `SPEC_WORD_THRESHOLD`, `assessSpecSplit` (keep alphabetical order within the braces):

```ts
function specWith(criteriaCount: number, extra = ''): string {
  const criteria = Array.from({ length: criteriaCount }, (_, i) => `- criterion ${i}`).join('\n');
  return `# Spec\n\n## Design\n\nprose here\n\n## Acceptance criteria\n\n${criteria}\n\n## Risks\n\n- a risk bullet\n${extra}`;
}

describe('assessSpecSplit', () => {
  it('returns [] for an empty string', () => {
    expect(assessSpecSplit('')).toEqual([]);
  });

  it('S1: [] at exactly the word threshold, one signal one word over', () => {
    expect(assessSpecSplit(words(SPEC_WORD_THRESHOLD))).toEqual([]);
    const signals = assessSpecSplit(words(SPEC_WORD_THRESHOLD + 1));
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      rule: 'S1',
      value: SPEC_WORD_THRESHOLD + 1,
      threshold: SPEC_WORD_THRESHOLD,
    });
    expect(signals[0].message).toContain('6001 words');
  });

  it('S2: [] at exactly the criteria threshold, one signal one bullet over', () => {
    expect(assessSpecSplit(specWith(SPEC_CRITERIA_THRESHOLD))).toEqual([]);
    const signals = assessSpecSplit(specWith(SPEC_CRITERIA_THRESHOLD + 1));
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      rule: 'S2',
      value: SPEC_CRITERIA_THRESHOLD + 1,
      threshold: SPEC_CRITERIA_THRESHOLD,
    });
    expect(signals[0].message).toContain('~12');
  });

  it('S2: a bare "## Acceptance" heading is matched', () => {
    const criteria = Array.from({ length: 21 }, (_, i) => `- c${i}`).join('\n');
    const md = `# Spec\n\n## Acceptance\n\n${criteria}\n`;
    expect(assessSpecSplit(md).map((s) => s.rule)).toEqual(['S2']);
  });

  it('S2: nested bullets and bullets outside the acceptance section do not count', () => {
    const nested = Array.from({ length: 25 }, (_, i) => `  - nested ${i}`).join('\n');
    const md = `# Spec\n\n## Acceptance criteria\n\n- top one\n${nested}\n\n## Risks\n\n${Array.from(
      { length: 25 },
      (_, i) => `- risk ${i}`,
    ).join('\n')}\n`;
    expect(assessSpecSplit(md)).toEqual([]);
  });

  it('S2: counting stops at the next ## heading', () => {
    const md = specWith(SPEC_CRITERIA_THRESHOLD); // Risks section holds 1 more bullet
    expect(assessSpecSplit(md)).toEqual([]);
  });

  it('S2: no ## Acceptance* heading → no S2 even with many bullets', () => {
    const bulletsOnly = Array.from({ length: 30 }, (_, i) => `- item ${i}`).join('\n');
    expect(assessSpecSplit(`# Spec\n\n## Design\n\n${bulletsOnly}\n`)).toEqual([]);
  });

  it('fires S1 then S2 in rule order when both trip', () => {
    const md = specWith(SPEC_CRITERIA_THRESHOLD + 1, `\n${words(SPEC_WORD_THRESHOLD + 1)}\n`);
    expect(assessSpecSplit(md).map((s) => s.rule)).toEqual(['S1', 'S2']);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/core/__tests__/split-suggestion.test.ts
```

Expected output: the file fails to compile — `SPEC_WORD_THRESHOLD`, `SPEC_CRITERIA_THRESHOLD`, `assessSpecSplit` are not exported from `../split-suggestion.js` (TS2305 / vitest transform error). Existing tests do not run.

- [ ] **Step 3: Implement.** In `src/core/split-suggestion.ts`:

3a. Replace the constants block (currently lines 26–30) with:

```ts
export const ENTRY_WORD_THRESHOLD = 300;
export const ENTRY_BULLET_THRESHOLD = 6;
export const ENTRY_TOUCHES_THRESHOLD = 8;
export const FD_LINKS_CODE_THRESHOLD = 30;
export const PLAN_ROW_THRESHOLD = 1000;
export const SPEC_WORD_THRESHOLD = 6000;
export const SPEC_CRITERIA_THRESHOLD = 20;
```

3b. Update the `SplitSignal.rule` comment (line 20):

```ts
  readonly rule: string; // 'E1' | 'E2' | 'E3' | 'F1' | 'P1' | 'S1' | 'S2'
```

3c. In the module JSDoc (line 9), extend the commit-point list `(/noldor-promote step 1.7, noldor-plan post-save, gate Step 2.5 kind=plan, headless drain entry)` to `(/noldor-promote step 1.7, noldor-plan post-save, gate Step 2.5 kind=plan and kind=spec, headless drain entry)`.

3d. Add the shared word counter directly below the `SCOPE_BULLET_RE` line, and switch E1 to it — in `assessEntrySplit`, replace the two lines

```ts
  const trimmed = entry.description.trim();
  const words = trimmed === '' ? 0 : trimmed.split(/\s+/).length;
```

with

```ts
  const words = countWords(entry.description);
```

The helper (place above `assessEntrySplit`):

```ts
/** Whitespace-token word count, empty-safe. Shared by E1 and S1 so the two cannot drift. */
function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}
```

3e. Append at the end of the file:

```ts
const SPEC_ACCEPTANCE_HEADING_RE = /^##\s+Acceptance/i;
const SECTION_HEADING_RE = /^## /;
const TOP_LEVEL_BULLET_RE = /^- /;

/**
 * Top-level `- ` bullets inside the acceptance section: from the first line
 * matching `## Acceptance*` (case-insensitive — covers `## Acceptance
 * criteria` and bare `## Acceptance`) up to the next `## ` heading or EOF.
 * Nested (indented) bullets are not counted. No matching heading → 0.
 */
function countSpecCriteria(specMd: string): number {
  const lines = specMd.split('\n');
  const start = lines.findIndex((l) => SPEC_ACCEPTANCE_HEADING_RE.test(l));
  if (start === -1) return 0;
  let count = 0;
  for (let i = start + 1; i < lines.length; i++) {
    if (SECTION_HEADING_RE.test(lines[i])) break;
    if (TOP_LEVEL_BULLET_RE.test(lines[i])) count += 1;
  }
  return count;
}

/**
 * S1/S2 heuristics over a design-spec markdown body. A spec with no
 * `## Acceptance*` heading is S2-silent by design — with no criteria section
 * there is no criteria bloat to measure, and S1 still covers raw bulk.
 */
export function assessSpecSplit(specMd: string): SplitSignal[] {
  const signals: SplitSignal[] = [];
  const words = countWords(specMd);
  if (words > SPEC_WORD_THRESHOLD) {
    signals.push({
      rule: 'S1',
      value: words,
      threshold: SPEC_WORD_THRESHOLD,
      message:
        `spec is ${words} words (threshold ${SPEC_WORD_THRESHOLD}) — split the design into ` +
        `sibling attach enhancements, one per concern, before implementation.`,
    });
  }
  const criteria = countSpecCriteria(specMd);
  if (criteria > SPEC_CRITERIA_THRESHOLD) {
    signals.push({
      rule: 'S2',
      value: criteria,
      threshold: SPEC_CRITERIA_THRESHOLD,
      message:
        `spec has ${criteria} acceptance criteria (threshold ${SPEC_CRITERIA_THRESHOLD}; ` +
        `budget ~12) — collapse per-detail criteria into behavior-level ones or split the scope.`,
    });
  }
  return signals;
}
```

- [ ] **Step 4: Run to verify PASS.**

```bash
pnpm vitest run src/core/__tests__/split-suggestion.test.ts
```

Expected output: all tests pass (existing E/F/P blocks + new `assessSpecSplit` block), `Test Files  1 passed`.

- [ ] **Step 5: Commit.**

```bash
git add src/core/split-suggestion.ts src/core/__tests__/split-suggestion.test.ts
git commit -m "feat(split-check): add assessSpecSplit S1/S2 spec size signals" -m "Noldor-FD: framework-auto-split-suggestion-for-big-features-and-plans"
```

---

## Task 2: `--spec` mode in split-check-cli.ts + manifest desc

**Files:**
- Modify: `src/core/split-check-cli.ts`
- Modify: `src/cli/manifest.ts`
- Test: `src/core/__tests__/split-check-cli.test.ts`

- [ ] **Step 1: Write the failing tests.** In `src/core/__tests__/split-check-cli.test.ts`, append inside the `describe('runSplitCheck', …)` block (after the `'no mode / conflicting modes / dangling flag'` test):

```ts
  it('--spec: clean spec → exit 0; >20 criteria → exit 2 with an S2 line', () => {
    const dir = makeFixtureRepo();
    const clean = ['# Spec', '', '## Acceptance criteria', '', '- one criterion', ''].join('\n');
    writeFileSync(join(dir, 'clean-spec.md'), clean);
    expect(runSplitCheck(['--spec', 'clean-spec.md'], dir)).toEqual({ exitCode: 0, lines: [] });
    const bloated = [
      '# Spec',
      '',
      '## Acceptance criteria',
      '',
      ...Array.from({ length: 21 }, (_, i) => `- criterion ${i}`),
      '',
    ].join('\n');
    writeFileSync(join(dir, 'bloated-spec.md'), bloated);
    const res = runSplitCheck(['--spec', 'bloated-spec.md'], dir);
    expect(res.exitCode).toBe(2);
    expect(res.lines).toHaveLength(1);
    expect(res.lines[0]).toContain('[S2]');
  });

  it('--spec: >6000-word spec → exit 2 with an S1 line', () => {
    const dir = makeFixtureRepo();
    const big = Array.from({ length: 6001 }, (_, i) => `w${i}`).join(' ');
    writeFileSync(join(dir, 'big-spec.md'), big);
    const res = runSplitCheck(['--spec', 'big-spec.md'], dir);
    expect(res.exitCode).toBe(2);
    expect(res.lines[0]).toContain('[S1]');
  });

  it('--spec: unreadable path → exit 1 naming the path', () => {
    const dir = makeFixtureRepo();
    const res = runSplitCheck(['--spec', 'missing-spec.md'], dir);
    expect(res.exitCode).toBe(1);
    expect(res.lines.join('\n')).toContain('cannot read spec');
  });

  it('--spec conflicts with --plan → exit 1 usage', () => {
    const dir = makeFixtureRepo();
    expect(runSplitCheck(['--spec', 'a.md', '--plan', 'b.md'], dir).exitCode).toBe(1);
  });
```

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/core/__tests__/split-check-cli.test.ts
```

Expected output: the four new tests fail — `--spec` is rejected as `unknown argument --spec` (exit 1 where 0/2 expected; the conflict test passes only by accident of both being exit 1, the other three genuinely red).

- [ ] **Step 3: Implement.** In `src/core/split-check-cli.ts`:

3a. Module JSDoc (line 16): `suggest a split when an entry/FD/plan exceeds` → `suggest a split when an entry/FD/plan/spec exceeds`.

3b. USAGE (line 30):

```ts
const USAGE =
  'usage: split-check --entry <slug> | --plan <path> | --spec <path> | --fd <slug> [--add <path>...]';
```

3c. In `runSplitCheck`: declare `let spec: string | undefined;` beside the other mode vars; widen the flag guard and assignment chain:

```ts
    if (
      flag !== '--entry' &&
      flag !== '--plan' &&
      flag !== '--spec' &&
      flag !== '--fd' &&
      flag !== '--add'
    ) {
      return usageError(`unknown argument ${flag}`);
    }
    const value = args[i + 1];
    if (value === undefined) return usageError(`missing value after ${flag}`);
    if (flag === '--entry') entry = value;
    else if (flag === '--plan') plan = value;
    else if (flag === '--spec') spec = value;
    else if (flag === '--fd') fd = value;
    else add.push(value);
```

3d. Widen the mode check: `const modes = [entry, plan, spec, fd].filter((m) => m !== undefined);`

3e. Add the branch after the `--plan` branch:

```ts
  if (spec !== undefined) {
    const path = isAbsolute(spec) ? spec : join(cwd, spec);
    const md = readFileOrNull(path);
    if (md === null) return usageError(`cannot read spec at ${path}`);
    return toResult(assessSpecSplit(md));
  }
```

3f. Extend the import from `./split-suggestion.js` with `assessSpecSplit` (alphabetical: after `assessPlanSplit`).

3g. In `src/cli/manifest.ts` (line ~389), the `split-check` entry:

```ts
      'split-check': {
        src: 'core/split-check-cli.ts',
        desc: 'Suggest a split when an entry/FD/plan/spec exceeds size thresholds',
      },
```

- [ ] **Step 4: Run to verify PASS.**

```bash
pnpm vitest run src/core/__tests__/split-check-cli.test.ts && pnpm typecheck
```

Expected output: `Test Files  1 passed` (all existing + 4 new tests), typecheck exits 0.

- [ ] **Step 5: Commit.**

```bash
git add src/core/split-check-cli.ts src/cli/manifest.ts src/core/__tests__/split-check-cli.test.ts
git commit -m "feat(split-check): add --spec mode routing to assessSpecSplit" -m "Noldor-FD: framework-auto-split-suggestion-for-big-features-and-plans"
```

---

## Task 3: doc twins — complexity-gating + script-catalog

**Files:**
- Modify: `templates/docs/noldor/complexity-gating.md`
- Modify: `docs/noldor/complexity-gating.md`
- Modify: `templates/docs/noldor/script-catalog.md`
- Modify: `docs/noldor/script-catalog.md`

Twin discipline: each edit lands byte-identically in the template AND the `docs/noldor/` copy — `pnpm noldor checks template-sync` reds at pre-commit otherwise.

- [ ] **Step 1: Add S1/S2 rows to the rule table.** In BOTH `templates/docs/noldor/complexity-gating.md` and `docs/noldor/complexity-gating.md`, after the `P1` row of the rule table, add:

```markdown
| `S1` | spec word count                                 | > 6000 words | `/noldor-gate` Step 2.5 `spec`                           |
| `S2` | spec acceptance-criteria bullets (top-level)    | > 20 bullets | `/noldor-gate` Step 2.5 `spec`                           |
```

- [ ] **Step 2: Extend the Modes sentence.** In BOTH copies, in the paragraph beginning `The CLI's exit contract mirrors`, change

```
Modes: `split-check --entry <slug>` (roadmap-then-backlog body heuristics), `split-check --fd <slug> --add <path>...` (attach breadth), `split-check --plan <path>` (row count; the P1 message names the suggested part count, one part ≈ 1000 rows).
```

to

```
Modes: `split-check --entry <slug>` (roadmap-then-backlog body heuristics), `split-check --fd <slug> --add <path>...` (attach breadth), `split-check --plan <path>` (row count; the P1 message names the suggested part count, one part ≈ 1000 rows), `split-check --spec <path>` (word bulk + acceptance-criteria bullets; the S2 message states the ~12-criteria budget).
```

- [ ] **Step 3: Update the script-catalog line.** In BOTH `templates/docs/noldor/script-catalog.md` and `docs/noldor/script-catalog.md`, the `split-check` row: change the description cell from

```
Suggest a split when an entry/FD/plan exceeds size thresholds (`--entry\|--fd\|--plan`).
```

to

```
Suggest a split when an entry/FD/plan/spec exceeds size thresholds (`--entry\|--fd\|--plan\|--spec`).
```

- [ ] **Step 4: Verify twin parity.**

```bash
pnpm noldor checks template-sync
```

Expected output: exit 0 (no desync lines).

- [ ] **Step 5: Commit.**

```bash
git add templates/docs/noldor/complexity-gating.md docs/noldor/complexity-gating.md templates/docs/noldor/script-catalog.md docs/noldor/script-catalog.md
git commit -m "docs(noldor): document split-check --spec S1/S2 in complexity-gating + script-catalog" -m "Noldor-FD: framework-auto-split-suggestion-for-big-features-and-plans"
```

---

## Task 4: skill twins — gate Step 2.5 wiring + noldor-spec authoring rules

**Files:**
- Modify: `.claude/skills/noldor-gate/SKILL.md`
- Modify: `templates/.claude/skills/noldor-gate/SKILL.md`
- Modify: `.claude/skills/noldor-spec/SKILL.md`
- Modify: `templates/.claude/skills/noldor-spec/SKILL.md`

- [ ] **Step 1: Gate Step 2.5 sentence.** In BOTH gate SKILL.md copies, in the `**Lint pass first.**` paragraph, change

```
When the artifact kind is `plan`, also run `pnpm noldor noldor split-check --plan <artifact-path>` (same 0/2/1 exit contract) and append its stdout to the captured lint output.
```

to

```
When the artifact kind is `plan`, also run `pnpm noldor noldor split-check --plan <artifact-path>` (same 0/2/1 exit contract) and append its stdout to the captured lint output; when the kind is `spec`, do the same with `pnpm noldor noldor split-check --spec <artifact-path>` (S1 word bulk / S2 criteria bloat — informational, never blocks).
```

- [ ] **Step 2: noldor-spec rules.** In BOTH noldor-spec SKILL.md copies, in `## Rules`, insert these three bullets immediately after the `- One question per message — never a wall of questions.` bullet:

```markdown
- Acceptance criteria pin behavior, not phrasing — state observable outcomes (exit code, file written, signal emitted), never exact wording of messages or prose structure, which turns every reword into a drift finding.
- Budget ~12 acceptance criteria. More usually means the spec bundles concerns or pins details; collapse per-detail criteria into behavior-level ones or split the scope (the gate's `split-check --spec` flags >20).
- Never write review-history meta-narrative into the artifact — no "as flagged in round N", no reviewer-dialogue recaps, no self-references to the spec's own revision process. Pure liability surface that later rounds re-flag.
```

- [ ] **Step 3: Verify twin parity.**

```bash
pnpm noldor checks template-sync
```

Expected output: exit 0.

- [ ] **Step 4: Commit.**

```bash
git add .claude/skills/noldor-gate/SKILL.md templates/.claude/skills/noldor-gate/SKILL.md .claude/skills/noldor-spec/SKILL.md templates/.claude/skills/noldor-spec/SKILL.md
git commit -m "docs(skills): wire split-check --spec into gate Step 2.5 + spec authoring rules" -m "Noldor-FD: framework-auto-split-suggestion-for-big-features-and-plans"
```

---

## Task 5: parent FD Usage fence + smoke run

**Files:**
- Modify: `docs/features/framework-auto-split-suggestion-for-big-features-and-plans.md`

- [ ] **Step 1: Extend the Usage fence.** In the FD's `## Usage` → **Ad-hoc CLI** fence, add after the `--plan` line:

```
pnpm noldor noldor split-check --spec docs/design/specs/2026-07-03-foo-design.md  # spec bulk + criteria (S1/S2)
```

And change in-flow item 3 from

```
3. `/noldor-gate` Step 2.5 `--kind plan` — split findings appear alongside lint findings in the continue-dialog, informational.
```

to

```
3. `/noldor-gate` Step 2.5 `--kind plan` / `--kind spec` — split findings appear alongside lint findings in the continue-dialog, informational.
```

- [ ] **Step 2: Full-suite smoke.**

```bash
pnpm vitest run src/core/__tests__/split-suggestion.test.ts src/core/__tests__/split-check-cli.test.ts && pnpm noldor validate features && node bin/noldor.mjs noldor split-check --spec docs/design/specs/2026-08-16-framework-auto-split-suggestion-for-big-features-and-plans-spec-size-governor-design.md; echo "exit:$?"
```

Expected output: both test files pass; `Validated 77 feature MD(s) — all OK.`; the live `--spec` run prints nothing and `exit:0` (this session's spec is ~1.8k words / 12 criteria — under both thresholds).

- [ ] **Step 3: Commit.**

```bash
git add docs/features/framework-auto-split-suggestion-for-big-features-and-plans.md
git commit -m "docs(features:framework-auto-split-suggestion-for-big-features-and-plans): add --spec mode to Usage" -m "Noldor-FD: framework-auto-split-suggestion-for-big-features-and-plans"
```
