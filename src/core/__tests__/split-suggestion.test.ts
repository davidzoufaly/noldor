// @tests: framework-auto-split-suggestion-for-big-features-and-plans
import { describe, expect, it } from 'vitest';

import {
  ENTRY_BULLET_THRESHOLD,
  ENTRY_TOUCHES_THRESHOLD,
  ENTRY_WORD_THRESHOLD,
  FD_LINKS_CODE_THRESHOLD,
  PLAN_ROW_THRESHOLD,
  SPEC_CRITERIA_THRESHOLD,
  SPEC_WORD_THRESHOLD,
  assessEntrySplit,
  assessFdBreadth,
  assessPlanSplit,
  assessSpecSplit,
} from '../split-suggestion.js';

import { parseRoadmap } from '../../utils/parse-blocks.js';

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

  it('S2: ordered-list criteria count too — 21 × "N. " fires, mixed forms sum', () => {
    const ordered = Array.from({ length: 21 }, (_, i) => `${i + 1}. criterion ${i}`).join('\n');
    expect(
      assessSpecSplit(`# Spec\n\n## Acceptance criteria\n\n${ordered}\n`).map((s) => s.rule),
    ).toEqual(['S2']);
    const mixed = [
      ...Array.from({ length: 11 }, (_, i) => `- dash ${i}`),
      ...Array.from({ length: 10 }, (_, i) => `${i + 1}. ordered ${i}`),
    ].join('\n');
    const signals = assessSpecSplit(`# Spec\n\n## Acceptance\n\n${mixed}\n`);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ rule: 'S2', value: 21 });
  });

  it('S2: nested ordered items are not counted', () => {
    const nested = Array.from({ length: 25 }, (_, i) => `   ${i + 1}. nested ${i}`).join('\n');
    expect(assessSpecSplit(`# Spec\n\n## Acceptance criteria\n\n- top one\n${nested}\n`)).toEqual(
      [],
    );
  });

  it('fires S1 then S2 in rule order when both trip', () => {
    const md = specWith(SPEC_CRITERIA_THRESHOLD + 1, `\n${words(SPEC_WORD_THRESHOLD + 1)}\n`);
    expect(assessSpecSplit(md).map((s) => s.rule)).toEqual(['S1', 'S2']);
  });
});

describe('provenance bullets and the E2 scope-bullet count', () => {
  // A split sibling carries `- split-from:` and `- recovered:` to record where
  // it came from. Before those became parsed fields they stayed in the entry
  // body, so every sibling was charged two scope bullets for its own
  // provenance — inflating the heuristic that produced the split.
  it('does not charge a sibling for its own provenance bullets', () => {
    const scopeBullets = Array.from(
      { length: ENTRY_BULLET_THRESHOLD },
      (_, i) => `- scope concern ${i + 1}`,
    ).join('\n');
    const raw = `### Slice A

- id: Q-9001
- area: tooling
- type: feat
- since: 2026-08-17
- size: S
- impact: med
- split-from: Q-0108
- recovered: 2026-08-17

${scopeBullets}
`;
    const entry = parseRoadmap(raw)[0];
    expect(entry).toBeDefined();
    // Exactly at the threshold, and comparisons are strictly greater-than.
    expect(assessEntrySplit(entry!)).toEqual([]);
  });
});
