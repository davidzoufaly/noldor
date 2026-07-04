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
