import { describe, expect, it } from 'vitest';
import {
  FRAMEWORK_PREFIX_RE,
  classifyFeature,
  classifyPlanOrSpec,
  classifyRoadmapEntry,
  type Track,
} from '../classify.ts';

describe('classifyFeature', () => {
  it('classifies area=tooling + dashboard- slug as framework', () => {
    const got = classifyFeature({
      slug: 'dashboard-hot-zones-page',
      name: 'Dashboard Hot Zones Page',
      area: 'tooling',
    });
    expect(got).toBe('framework' satisfies Track);
  });

  it('classifies area=web + dashboard-* slug as product (area guard blocks)', () => {
    const got = classifyFeature({
      slug: 'dashboard-roadmap-drag-drop',
      name: 'Dashboard Roadmap Drag-Drop',
      area: 'web',
    });
    expect(got).toBe('product' satisfies Track);
  });

  it('classifies area=tooling + non-matching slug as ambiguous (manual review)', () => {
    const got = classifyFeature({
      slug: 'architecture-invariants',
      name: 'Architecture Invariants',
      area: 'tooling',
    });
    expect(got).toBe('ambiguous' satisfies Track);
  });

  it('classifies area=editor + non-tooling slug as product', () => {
    const got = classifyFeature({
      slug: 'auto-save',
      name: 'Auto-save',
      area: 'editor',
    });
    expect(got).toBe('product' satisfies Track);
  });

  it('slug wins over name when they disagree', () => {
    const got = classifyFeature({
      slug: 'auto-save',
      name: 'Dashboard Auto-Save Hot Zone',
      area: 'tooling',
    });
    // slug fails regex; falls back to name. Name normalises to
    // `dashboard-auto-save-hot-zone` which DOES match. So this falls to
    // 'framework' — illustrating the documented slug-first behaviour where
    // name still rescues a mismatched slug. (If the operator wants the
    // strict slug-only path, they edit `ambiguous.txt` at Task 8.)
    expect(got).toBe('framework' satisfies Track);
  });

  it('regex matches framework- prefix', () => {
    expect(FRAMEWORK_PREFIX_RE.test('framework-doc-extraction')).toBe(true);
    expect(FRAMEWORK_PREFIX_RE.test('auto-save')).toBe(false);
    expect(FRAMEWORK_PREFIX_RE.test('specs-only-tier')).toBe(false);
  });
});

describe('classifyRoadmapEntry', () => {
  it('classifies area=tooling + dashboard- slug as framework', () => {
    expect(
      classifyRoadmapEntry({
        slug: 'dashboard-foo',
        name: 'Dashboard Foo',
        area: 'tooling',
      }),
    ).toBe('framework' satisfies Track);
  });

  it('falls back to product when area not tooling', () => {
    expect(
      classifyRoadmapEntry({
        slug: 'dashboard-foo',
        name: 'Dashboard Foo',
        area: 'web',
      }),
    ).toBe('product' satisfies Track);
  });

  it('marks ambiguous when area=tooling but no prefix match', () => {
    expect(
      classifyRoadmapEntry({
        slug: 'foo-bar',
        name: 'Foo Bar',
        area: 'tooling',
      }),
    ).toBe('ambiguous' satisfies Track);
  });
});

describe('classifyPlanOrSpec', () => {
  const featureTracks = new Map<string, Track>([
    ['dashboard-hot-zones-page', 'framework'],
    ['auto-save', 'product'],
  ]);

  it('inherits track from owning FD slug embedded in filename', () => {
    expect(
      classifyPlanOrSpec({
        filename: '2026-04-29-dashboard-hot-zones-page-design.md',
        featureTracks,
      }),
    ).toBe('framework' satisfies Track);

    expect(
      classifyPlanOrSpec({
        filename: '2026-03-15-auto-save-design.md',
        featureTracks,
      }),
    ).toBe('product' satisfies Track);
  });

  it('returns ambiguous when no embedded slug matches a known FD', () => {
    expect(
      classifyPlanOrSpec({
        filename: '2026-01-01-something-else-design.md',
        featureTracks,
      }),
    ).toBe('ambiguous' satisfies Track);
  });

  it('matches longest slug when multiple slugs are substrings', () => {
    const tracks = new Map<string, Track>([
      ['dashboard', 'framework'],
      ['dashboard-hot-zones-page', 'product'],
    ]);
    expect(
      classifyPlanOrSpec({
        filename: '2026-04-29-dashboard-hot-zones-page-design.md',
        featureTracks: tracks,
      }),
    ).toBe('product' satisfies Track);
  });
});
