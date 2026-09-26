// @tests: ui-design-review-lane
// The uiBoot recipe fields the geometry-compare lane reads (spec D2/AC3). The
// test lives beside the geometry core, not in src/core, because it pins the
// recipe's family keys to GEOMETRY_FAMILIES — core may not import lane code,
// so the schema restates the four keys and this file keeps them in step.
import { describe, expect, it } from 'vitest';

import { UiBootRecipeSchema } from '../../../core/consumer-config.js';
import { DEFAULT_BUDGET, GEOMETRY_FAMILIES } from '../../geometry/geometry-compare-core.js';

const base = { verifyCommand: 'dev', route: '/dashboard' };
const shot = 'pnpm shot {url} {out} {width} {height}';
const geo = 'node scripts/geometry-capture.mjs {url} {out} {width} {height}';

const messages = (input: unknown): string => {
  const r = UiBootRecipeSchema.safeParse(input);
  return r.success ? '' : r.error.issues.map((i) => i.message).join(' | ');
};

describe('UiBootRecipeSchema capture commands', () => {
  it('accepts a screenshot-only recipe (unchanged behaviour)', () => {
    expect(UiBootRecipeSchema.safeParse({ ...base, screenshotCommand: shot }).success).toBe(true);
  });

  it('accepts a geometry-only recipe', () => {
    expect(UiBootRecipeSchema.safeParse({ ...base, geometryCommand: geo }).success).toBe(true);
  });

  it('rejects a recipe with neither capture command', () => {
    expect(messages(base)).toContain('at least one of screenshotCommand');
  });

  it('rejects a mis-templated geometryCommand, naming geometryCommand', () => {
    expect(messages({ ...base, geometryCommand: 'cap {url} {out}' })).toContain(
      'geometryCommand is missing {width}',
    );
    expect(messages({ ...base, geometryCommand: "cap '{url}' {out} {width} {height}" })).toContain(
      'geometryCommand may not contain single quotes',
    );
  });
});

describe('UiBootRecipeSchema per-family knobs', () => {
  it('accepts every shipped family key in both records', () => {
    const all = Object.fromEntries(GEOMETRY_FAMILIES.map((f) => [f, 3]));
    const r = UiBootRecipeSchema.parse({
      ...base,
      geometryCommand: geo,
      geometryTolerance: all,
      geometryBudget: all,
    });
    expect(r.geometryTolerance).toEqual(all);
    expect(r.geometryBudget).toEqual(all);
  });

  it('leaves omitted families absent for the lane to fill from the defaults', () => {
    const r = UiBootRecipeSchema.parse({
      ...base,
      geometryCommand: geo,
      geometryBudget: { edgesX: 2 },
    });
    expect(r.geometryTolerance).toBeUndefined();
    expect(r.geometryBudget).toEqual({ edgesX: 2 });
    expect({ ...DEFAULT_BUDGET, ...r.geometryBudget }).toEqual({
      edgesX: 2,
      edgesY: 0,
      fontSize: 0,
      spacing: 0,
    });
  });

  it('rejects a key outside the four families, including the retired edges', () => {
    for (const key of ['edges', 'lineHeight']) {
      expect(
        UiBootRecipeSchema.safeParse({
          ...base,
          geometryCommand: geo,
          geometryBudget: { [key]: 1 },
        }).success,
      ).toBe(false);
      expect(
        UiBootRecipeSchema.safeParse({
          ...base,
          geometryCommand: geo,
          geometryTolerance: { [key]: 1 },
        }).success,
      ).toBe(false);
    }
  });

  it('rejects a negative tolerance and a non-integer or negative budget', () => {
    const parses = (extra: Record<string, unknown>): boolean =>
      UiBootRecipeSchema.safeParse({ ...base, geometryCommand: geo, ...extra }).success;
    expect(parses({ geometryTolerance: { edgesY: -1 } })).toBe(false);
    expect(parses({ geometryBudget: { edgesX: 1.5 } })).toBe(false);
    expect(parses({ geometryBudget: { spacing: -1 } })).toBe(false);
    expect(parses({ geometryTolerance: { fontSize: 0.5 } })).toBe(true);
  });
});
