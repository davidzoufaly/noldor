# Architecture Page Form Contract (Part 3: Prose Budgets) Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** `noldor docs architecture --check` flags a page whose prose has become an essay — per paragraph as the primary rule, per page as a backstop — still advisory, `status` still untouched.
**Architecture:** `countWords` moves from `core/split-suggestion.ts` to `src/utils/`; `architecture-form.ts` gains prose extraction and the two budgets; the advisory union gains `long-paragraph` and `page-bloat` variants with their own garden discriminators.
**Tech Stack:** TypeScript, vitest.

**Depends on:** parts 1 and 2 — `assessPageForm`, the advisory union, the gating rule and `advisoryDiscriminator` must exist.

---

## File Structure

- `src/utils/word-count.ts` — CREATE: `countWords`, moved out of `core/split-suggestion.ts` so `src/docs` need not depend on the roadmap split heuristics.
- `src/core/split-suggestion.ts` — MODIFY: import `countWords` from `utils` instead of defining it.
- `src/docs/architecture-form.ts` — MODIFY: prose extraction, paragraph splitting, the two thresholds.
- `src/docs/docs-architecture.ts` — MODIFY: `long-paragraph` and `page-bloat` variants and their emission.
- `src/garden/detectors/architecture.ts` — MODIFY: discriminators for the two new variants.
- `src/utils/__tests__/word-count.test.ts` — CREATE: the moved helper's own tests.
- `src/docs/__tests__/architecture-form.test.ts` — MODIFY: prose extraction and budget cases.
- `src/docs/__tests__/docs-architecture.test.ts` — MODIFY: budget advisory emission.
- `src/garden/detectors/__tests__/architecture.test.ts` — MODIFY: ids for the two new variants.

---

## Task 1: Move countWords to utils

**Files:**
- Create: `src/utils/word-count.ts`, `src/utils/__tests__/word-count.test.ts`
- Modify: `src/core/split-suggestion.ts`

- [ ] **Step 1: Write the failing test.** Create `src/utils/__tests__/word-count.test.ts`:

```ts
// @tests: consumer-architecture-doc-surface
import { describe, expect, it } from 'vitest';

import { countWords } from '../word-count.js';

describe(countWords, () => {
  it('counts whitespace-separated tokens', () => {
    expect(countWords('one two three')).toBe(3);
  });

  it('is empty-safe', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n  ')).toBe(0);
  });

  it('collapses runs of whitespace, including newlines', () => {
    expect(countWords('one   two\n\nthree\t four')).toBe(4);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/utils/__tests__/word-count.test.ts
```

Expected output: the suite fails to collect — `Cannot find module '../word-count.js'`.

- [ ] **Step 3: Create the module.** Create `src/utils/word-count.ts`:

```ts
/**
 * Whitespace-token word count, empty-safe.
 *
 * Lives in `utils` rather than beside its first caller for the reason
 * `markdown-sections.ts` gives one file over: generic text measurement is not a
 * split-heuristics concern. An architecture-page prose budget and a
 * roadmap-entry size heuristic are unrelated measures with no reason to move
 * together, so `src/docs` borrowing this from `core/split-suggestion.ts` would
 * be the wrong dependency rather than shared ownership.
 *
 * @param text - Any text
 * @returns Number of whitespace-separated tokens
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}
```

- [ ] **Step 4: Repoint `split-suggestion.ts`.** In `src/core/split-suggestion.ts`, delete the private `countWords` function and its docstring, and add to the imports:

```ts
import { countWords } from '../utils/word-count.js';
```

- [ ] **Step 5: Run to verify PASS and that nothing regressed.**

```bash
pnpm vitest run src/utils/__tests__/word-count.test.ts src/core && pnpm typecheck
```

Expected output: `3 passed` for the new file, every `src/core` test still passing, typecheck clean. The `E1` and `S1` heuristics are the callers that must not change behaviour — a failure there means the move altered the function, which it must not.

- [ ] **Step 6: Commit.**

```bash
cat > /tmp/arch-form-p3t1.msg <<'EOF'
refactor(utils): move countWords out of the split heuristics

Why — the architecture prose budgets need a word count, and the only one in the
repo is private to `core/split-suggestion.ts`. Exporting it from there would
point `src/docs` at the roadmap-entry split heuristics to borrow three lines of
text measurement, which is a dependency on the wrong thing.

How — the function moves to `src/utils/word-count.ts` unchanged, following the
precedent `markdown-sections.ts` set one file over: generic text handling lives
in `utils`, not beside its first caller. `split-suggestion.ts` imports it.

What — the new module and its tests, the private copy deleted, and the `E1`/`S1`
heuristics left byte-identical in behaviour.

Noldor-FD: consumer-architecture-doc-surface
EOF
git add src/utils/word-count.ts src/utils/__tests__/word-count.test.ts src/core/split-suggestion.ts
git commit -F /tmp/arch-form-p3t1.msg
```

---

## Task 2: Prose extraction

**Files:**
- Modify: `src/docs/architecture-form.ts`
- Test: `src/docs/__tests__/architecture-form.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `src/docs/__tests__/architecture-form.test.ts`, extending the import with `proseParagraphs`:

```ts
describe(proseParagraphs, () => {
  it('splits on blank lines', () => {
    expect(proseParagraphs('one two\n\nthree four five')).toStrictEqual([
      'one two',
      'three four five',
    ]);
  });

  it('drops headings', () => {
    expect(proseParagraphs('## Actors\n\nreal prose')).toStrictEqual(['real prose']);
  });

  it('drops fenced blocks and does not merge the prose around them', () => {
    const body = 'before\n\n```mermaid\nflowchart LR\n  a --> b\n```\n\nafter';
    expect(proseParagraphs(body)).toStrictEqual(['before', 'after']);
  });

  it('drops tilde fences too', () => {
    expect(proseParagraphs('before\n\n~~~js\nconst a = 1;\n~~~\n\nafter')).toStrictEqual([
      'before',
      'after',
    ]);
  });

  it('drops table rows', () => {
    const body = 'before\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nafter';
    expect(proseParagraphs(body)).toStrictEqual(['before', 'after']);
  });

  it('drops HTML comments', () => {
    const body = 'before\n\n<!-- what belongs here: a prompt nobody reads -->\n\nafter';
    expect(proseParagraphs(body)).toStrictEqual(['before', 'after']);
  });

  it('drops a multi-line HTML comment', () => {
    const body = 'before\n\n<!-- one\ntwo\nthree -->\n\nafter';
    expect(proseParagraphs(body)).toStrictEqual(['before', 'after']);
  });

  it('keeps a paragraph that merely contains inline code', () => {
    expect(proseParagraphs('the `src/core` module owns it')).toStrictEqual([
      'the `src/core` module owns it',
    ]);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/docs/__tests__/architecture-form.test.ts -t proseParagraphs
```

Expected output: the file fails to collect — `No "proseParagraphs" export is defined on the module`.

- [ ] **Step 3: Implement.** Add to `src/docs/architecture-form.ts`:

```ts
/** Line inside a fence, opened by three or more backticks or tildes at up to three spaces of indent. */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Prose paragraphs of a page body: what a reader actually reads.
 *
 * Mermaid fences, code fences, table rows, headings and HTML comments are
 * blanked — a page may be long in diagram and table and still be terse in
 * prose, which is the form the contract exists to produce, and template prompts
 * and cut markers are comments a reader never sees.
 *
 * Blanking replaces each removed line with an empty one rather than deleting it,
 * so prose on either side of a diagram stays two paragraphs instead of merging
 * into one and reading as a single oversized block.
 *
 * @param body - Raw markdown
 * @returns Non-empty paragraphs, in document order
 */
export function proseParagraphs(body: string): string[] {
  const withoutComments = body.replace(/<!--[\s\S]*?-->/g, (m) =>
    m.replace(/[^\n]/g, ' '),
  );
  const out: string[] = [];
  let inFence = false;
  for (const line of withoutComments.split(/\r\n|\r|\n/)) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      out.push('');
      continue;
    }
    const trimmed = line.trim();
    if (inFence || trimmed.startsWith('|') || trimmed.startsWith('#')) {
      out.push('');
      continue;
    }
    out.push(line);
  }
  return out
    .join('\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
}
```

The fence toggle is a simple open/close pair rather than the marker-and-length matching `listHeadings` does. That is enough here: a mismatched fence run inside a page body blanks more prose than it should, which under-reports a budget rather than over-reporting it, and an advisory that stays quiet is the safe direction.

- [ ] **Step 4: Run to verify PASS.**

```bash
pnpm vitest run src/docs/__tests__/architecture-form.test.ts -t proseParagraphs
```

Expected output: `8 passed`.

- [ ] **Step 5: Commit.**

```bash
cat > /tmp/arch-form-p3t2.msg <<'EOF'
feat(docs:consumer-architecture-doc-surface): extract prose paragraphs from a page

The budgets measure what a reader reads, so fences, table rows, headings and
HTML comments are blanked first — a page may be long in diagram and table and
still be terse in prose, and template prompts are comments nobody sees.

Blanking replaces each removed line rather than deleting it, so prose on either
side of a diagram stays two paragraphs instead of merging into one and reading
as a single oversized block.

Noldor-FD: consumer-architecture-doc-surface
EOF
git add src/docs/architecture-form.ts src/docs/__tests__/architecture-form.test.ts
git commit -F /tmp/arch-form-p3t2.msg
```

---

## Task 3: The two budgets

**Files:**
- Modify: `src/docs/architecture-form.ts`
- Test: `src/docs/__tests__/architecture-form.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `src/docs/__tests__/architecture-form.test.ts`, extending the import with `ARCH_PAGE_PROSE_WORD_THRESHOLD`, `ARCH_PARAGRAPH_WORD_THRESHOLD` and `assessPageBloat`:

```ts
const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

describe(assessPageBloat, () => {
  it('reports nothing at the thresholds', () => {
    const body = `${words(ARCH_PARAGRAPH_WORD_THRESHOLD)}\n`;
    expect(assessPageBloat(body)).toStrictEqual({ longParagraphs: [], pageWords: null });
  });

  it('reports a paragraph one word over', () => {
    const body = `${words(ARCH_PARAGRAPH_WORD_THRESHOLD + 1)}\n`;
    expect(assessPageBloat(body).longParagraphs).toStrictEqual([
      { index: 0, words: ARCH_PARAGRAPH_WORD_THRESHOLD + 1 },
    ]);
  });

  it('indexes paragraphs by position among prose paragraphs', () => {
    const body = `short\n\n${words(ARCH_PARAGRAPH_WORD_THRESHOLD + 5)}\n`;
    expect(assessPageBloat(body).longParagraphs).toStrictEqual([
      { index: 1, words: ARCH_PARAGRAPH_WORD_THRESHOLD + 5 },
    ]);
  });

  it('reports the page total only when it is over', () => {
    const under = Array.from({ length: 6 }, () => words(50)).join('\n\n');
    expect(assessPageBloat(under).pageWords).toBeNull();

    const over = Array.from({ length: 7 }, () => words(90)).join('\n\n');
    expect(assessPageBloat(over).pageWords).toBe(630);
  });

  it('does not count fenced or tabular content toward either budget', () => {
    const fence = ['```mermaid', ...Array.from({ length: 400 }, (_, i) => `  n${i} --> m${i}`), '```'];
    const body = `short prose\n\n${fence.join('\n')}\n`;
    expect(assessPageBloat(body)).toStrictEqual({ longParagraphs: [], pageWords: null });
  });

  it('has thresholds set above this repo’s real pages', () => {
    expect(ARCH_PARAGRAPH_WORD_THRESHOLD).toBe(100);
    expect(ARCH_PAGE_PROSE_WORD_THRESHOLD).toBe(600);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/docs/__tests__/architecture-form.test.ts -t assessPageBloat
```

Expected output: the file fails to collect — `No "assessPageBloat" export is defined on the module`.

- [ ] **Step 3: Implement.** Add to `src/docs/architecture-form.ts`, and extend its imports with `import { countWords } from '../utils/word-count.js';`:

```ts
/**
 * Longest prose paragraph a page may carry.
 *
 * The paragraph is the primary unit because it is what the surface's own
 * deletion test claims: a reader answers "how is this system shaped" without
 * reading a single full paragraph. A page total alone misjudges that in both
 * directions — a long page of labelled facts passes the test, and a short page
 * that is one block fails it.
 *
 * Measured rather than guessed: every prose paragraph across this repo's four
 * architecture pages runs 22-59 words, so 100 leaves roughly 1.7x headroom over
 * the worst honest paragraph.
 */
export const ARCH_PARAGRAPH_WORD_THRESHOLD = 100;

/**
 * Total prose a page may carry, as a backstop rather than a rival to the
 * paragraph rule.
 *
 * On its own the paragraph rule cannot see a page that has become an essay in
 * aggregate: an arbitrarily long page built of 99-word paragraphs never trips
 * it. 600 sits well above any honest page — this repo's four run 172/217/87/126
 * prose words — so it fires only on a page that has roughly tripled its worst
 * current sibling.
 */
export const ARCH_PAGE_PROSE_WORD_THRESHOLD = 600;

/** One prose paragraph over the per-paragraph budget. */
export interface LongParagraph {
  /** 0-based position among the page's prose paragraphs. */
  readonly index: number;
  readonly words: number;
}

/** What one page body exceeds. Both comparisons are strictly greater-than. */
export interface PageBloat {
  readonly longParagraphs: readonly LongParagraph[];
  /** Total prose words, only when over the page budget. `null` otherwise. */
  readonly pageWords: number | null;
}

/**
 * Measure a page body against both prose budgets.
 *
 * @param body - Raw markdown
 */
export function assessPageBloat(body: string): PageBloat {
  const paragraphs = proseParagraphs(body);
  const counts = paragraphs.map(countWords);
  const longParagraphs = counts
    .map((w, index) => ({ index, words: w }))
    .filter((p) => p.words > ARCH_PARAGRAPH_WORD_THRESHOLD);
  const total = counts.reduce((sum, w) => sum + w, 0);
  return {
    longParagraphs,
    pageWords: total > ARCH_PAGE_PROSE_WORD_THRESHOLD ? total : null,
  };
}
```

- [ ] **Step 4: Run to verify PASS.**

```bash
pnpm vitest run src/docs/__tests__/architecture-form.test.ts
```

Expected output: every case in the file passes — part 1's 8, part 2's 16, Task 2's 8, and the 6 here.

- [ ] **Step 5: Commit.**

```bash
cat > /tmp/arch-form-p3t3.msg <<'EOF'
feat(docs:consumer-architecture-doc-surface): measure the two prose budgets

`assessPageBloat` reports every prose paragraph over 100 words, and the page
total when it exceeds 600.

The paragraph is the primary unit because it is what the surface's deletion test
claims — a reader answering the shape question without reading a full paragraph
— and a page total alone misjudges that in both directions. The page budget is a
backstop for the case the paragraph rule cannot see: an arbitrarily long page
built of 99-word paragraphs.

Both thresholds are set against measurement, not guess: this repo's worst honest
paragraph is 59 words and its longest page 217.

Noldor-FD: consumer-architecture-doc-surface
EOF
git add src/docs/architecture-form.ts src/docs/__tests__/architecture-form.test.ts
git commit -F /tmp/arch-form-p3t3.msg
```

---

## Task 4: Emit the bloat advisories

**Files:**
- Modify: `src/docs/docs-architecture.ts`, `src/garden/detectors/architecture.ts`
- Test: `src/docs/__tests__/docs-architecture.test.ts`, `src/garden/detectors/__tests__/architecture.test.ts`

- [ ] **Step 1: Write the failing tests.** Append to `src/docs/__tests__/docs-architecture.test.ts`:

```ts
describe('bloat advisories', () => {
  it('reports a long paragraph without touching status', async () => {
    const root = await makeRepo();
    const essay = Array.from({ length: 140 }, (_, i) => `w${i}`).join(' ');
    await writeArchitecture(root, {
      context: `${fullPage('context')}\n${essay}\n`,
      containers: fullPage('containers'),
      modules: fullPage('modules'),
      flows: fullPage('flows'),
    });
    const report = await checkArchitecture(root);
    expect(report.advisories.filter((a) => a.kind === 'long-paragraph')).toMatchObject([
      { pageId: 'context', words: 140 },
    ]);
    expect(report.status).toBe('ok');
    expect(report.findings).toStrictEqual([]);
  });

  it('stays silent on a page carrying a blocking finding', async () => {
    const root = await makeRepo();
    const essay = Array.from({ length: 140 }, (_, i) => `w${i}`).join(' ');
    await writeArchitecture(root, {
      context: `# Context\n\n${essay}\n`,
      containers: fullPage('containers'),
      modules: fullPage('modules'),
      flows: fullPage('flows'),
    });
    const report = await checkArchitecture(root);
    expect(report.findings.map((f) => f.rule)).toStrictEqual(['no-fence']);
    expect(report.advisories.filter((a) => a.page.endsWith('context.md'))).toStrictEqual([]);
  });
});
```

and to `src/garden/detectors/__tests__/architecture.test.ts`, two more rows in the `report` factory:

```ts
    {
      kind: 'long-paragraph',
      pageId: 'context',
      page: 'docs/architecture/context.md',
      index: 0,
      words: 140,
      message: 'docs/architecture/context.md has a 140-word paragraph',
    },
    {
      kind: 'long-paragraph',
      pageId: 'context',
      page: 'docs/architecture/context.md',
      index: 3,
      words: 120,
      message: 'docs/architecture/context.md has a 120-word paragraph',
    },
```

The existing `gives every variant a distinct id` and `never renders an undefined discriminator` cases cover these — two long-paragraph rows on one page are exactly the collision the ordinal-style discriminator exists to prevent.

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/docs/__tests__/docs-architecture.test.ts src/garden/detectors/__tests__/architecture.test.ts
```

Expected output: `expected [] to match object [ { pageId: 'context', words: 140 } ]` in the docs file, and a typecheck failure in the garden file — the union has no `long-paragraph` member yet.

- [ ] **Step 3: Add the union variants.** In `src/docs/docs-architecture.ts`, append to `ArchitectureAdvisory`:

```ts
  | (AdvisoryBase & {
      readonly kind: 'long-paragraph';
      readonly index: number;
      readonly words: number;
    })
  | (AdvisoryBase & { readonly kind: 'page-bloat'; readonly words: number });
```

- [ ] **Step 4: Emit them.** In `collectFormAdvisories`, after the `form.unknownCuts` loop, insert:

```ts
    const bloat = assessPageBloat(read.body);
    for (const paragraph of bloat.longParagraphs) {
      out.push({
        kind: 'long-paragraph',
        pageId: page.id,
        page: label,
        index: paragraph.index,
        words: paragraph.words,
        message:
          `${label} has a ${paragraph.words}-word paragraph (threshold ` +
          `${ARCH_PARAGRAPH_WORD_THRESHOLD}) at prose paragraph ${paragraph.index + 1} — split ` +
          `it into labelled facts or a table.`,
      });
    }
    if (bloat.pageWords !== null) {
      out.push({
        kind: 'page-bloat',
        pageId: page.id,
        page: label,
        words: bloat.pageWords,
        message:
          `${label} carries ${bloat.pageWords} prose words (threshold ` +
          `${ARCH_PAGE_PROSE_WORD_THRESHOLD}) — the page has grown into an essay.`,
      });
    }
```

and extend the import to:

```ts
import {
  ARCH_PAGE_PROSE_WORD_THRESHOLD,
  ARCH_PARAGRAPH_WORD_THRESHOLD,
  SECTION_CUT_TOKEN,
  assessPageBloat,
  assessPageForm,
} from './architecture-form.js';
```

- [ ] **Step 5: Add the garden discriminators.** In `src/garden/detectors/architecture.ts`, add to `advisoryDiscriminator`'s switch:

```ts
    case 'long-paragraph':
      return `long-paragraph:${advisory.index}`;
    case 'page-bloat':
      return 'page-bloat';
```

- [ ] **Step 6: Run to verify PASS.**

```bash
pnpm typecheck && pnpm vitest run src/docs src/garden src/release
```

Expected output: typecheck clean; every test passing. `src/release` proves the `architecture` preflight row, which reads `status`, is still untouched by any advisory.

- [ ] **Step 7: Confirm this repo's own pages stay clean.**

```bash
pnpm noldor docs architecture --check
```

Expected output: exit 0 and no `advisory:` line of kind `long-paragraph` or `page-bloat`. The four pages measure 172/217/87/126 prose words with a worst paragraph of 59, all under both budgets — a row here means either the extraction is over-counting or a page drifted since part 1.

- [ ] **Step 8: Commit.**

```bash
cat > /tmp/arch-form-p3t4.msg <<'EOF'
feat(docs:consumer-architecture-doc-surface): report prose bloat as advisories

`checkArchitecture` now reports every prose paragraph over 100 words and a page
whose total prose exceeds 600, each message naming the count, the threshold and
the remedy.

Both ride the same advisory channel and the same gate as the section rows: they
never reach `status`, so the release probe and the garden auto-restamp are
untouched, and a page that already carries a blocking finding stays quiet.

This repo's four pages produce no row — 172/217/87/126 prose words with a worst
paragraph of 59.

Noldor-FD: consumer-architecture-doc-surface
EOF
git add src/docs/docs-architecture.ts src/garden/detectors/architecture.ts src/docs/__tests__/docs-architecture.test.ts src/garden/detectors/__tests__/architecture.test.ts
git commit -F /tmp/arch-form-p3t4.msg
```

---

## Task 5: Refresh the FD and close the surface out

**Files:**
- Modify: `docs/features/consumer-architecture-doc-surface.md`

- [ ] **Step 1: Sync the link projections, then revert every FD but this one.** `sync code-links` and `sync test-links` are repo-wide and take no scope flag — `parseRunOptions` (`src/sync/projection.ts`) parses only `--check`, `--force` and `--quiet`, and a scoped variant is roadmap entry Q-0182, unshipped. Running them unscoped rewrites every FD the tag scan touches, which has previously pulled foreign FD churn into a feature PR and had to be undone by hand. So run them, then keep only this FD's change:

```bash
pnpm noldor sync code-links
pnpm noldor sync test-links
git diff --name-only docs/features
```

Expected output: a list of FD paths. Exactly one of them should be
`docs/features/consumer-architecture-doc-surface.md`; every other path is
collateral. Revert those:

```bash
git diff --name-only docs/features \
  | grep -v '^docs/features/consumer-architecture-doc-surface\.md$' \
  | xargs -r git checkout --
git diff --name-only docs/features
```

Expected output of the second `git diff`: exactly one line,
`docs/features/consumer-architecture-doc-surface.md`, or no output at all if the
projections were already current.

- [ ] **Step 2: Verify the whole surface.**

```bash
pnpm typecheck && pnpm test && pnpm noldor validate features && pnpm noldor docs architecture --check
```

Expected output: typecheck clean, full suite green, features valid, and the architecture check exiting 0 with no section, cut, flow-heading, paragraph or page-bloat advisory against this repo.

- [ ] **Step 3: Commit.**

```bash
cat > /tmp/arch-form-p3t5.msg <<'EOF'
docs(features:consumer-architecture-doc-surface): refresh links after the form contract

`sync code-links` and `sync test-links`, scoped to this FD, pick up
`src/docs/architecture-form.ts`, `src/utils/word-count.ts` and their tests.

Noldor-FD: consumer-architecture-doc-surface
EOF
git add docs/features/consumer-architecture-doc-surface.md
git commit -F /tmp/arch-form-p3t5.msg
```
