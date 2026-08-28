// @tests: consumer-architecture-doc-surface
import { describe, expect, it } from 'vitest';

import { toAdvisoryGaps, toFindingGaps } from '../architecture.js';

import type { ArchitectureReport } from '../../../docs/docs-architecture.js';

const report = (over: Partial<ArchitectureReport> = {}): ArchitectureReport => ({
  status: 'incomplete',
  findings: [
    {
      page: 'docs/architecture/context.md',
      rule: 'no-fence',
      message: 'docs/architecture/context.md carries no mermaid fence',
    },
  ],
  advisories: [
    {
      kind: 'module',
      pageId: 'modules',
      page: 'docs/architecture/modules.md',
      module: 'src/unnamed',
      message: 'docs/architecture/modules.md does not name src/unnamed',
    },
    {
      kind: 'section',
      pageId: 'context',
      page: 'docs/architecture/context.md',
      section: 'Boundary',
      message: 'docs/architecture/context.md does not name section "Boundary"',
    },
    {
      // Deliberately a SECOND row on the same page: before the fix both render
      // `context.md#undefined`, which is the collision the discriminator exists
      // to prevent. Two rows on different pages would not collide, so a fixture
      // without this one would let `gives every variant a distinct id` pass
      // against the very bug it is meant to catch.
      kind: 'section',
      pageId: 'context',
      page: 'docs/architecture/context.md',
      section: 'Externals',
      message: 'docs/architecture/context.md does not name section "Externals"',
    },
    {
      kind: 'flow-headings',
      pageId: 'flows',
      page: 'docs/architecture/flows.md',
      count: 0,
      message: 'docs/architecture/flows.md names no flow as a heading',
    },
  ],
  ...over,
});

describe(toFindingGaps, () => {
  it('keys a gap on page and rule', () => {
    expect(toFindingGaps(report())).toStrictEqual([
      {
        category: 'architecture',
        itemId: 'docs/architecture/context.md#no-fence',
        message: 'docs/architecture/context.md carries no mermaid fence',
      },
    ]);
  });

  it('carries no advisory into the blocking channel', () => {
    // The split is what keeps a renamed directory from blocking a release:
    // this channel feeds sddGaps, which gates the garden auto-restamp.
    const ids = toFindingGaps(report()).map((g) => g.itemId);
    expect(ids.some((id) => id.includes('src/unnamed'))).toBeFalsy();
  });

  it('is empty for a surface nobody opted into', () => {
    expect(toFindingGaps(report({ status: 'absent', findings: [], advisories: [] }))).toStrictEqual(
      [],
    );
  });
});

describe(toAdvisoryGaps, () => {
  it('keys a gap on the modules page and the module', () => {
    // `toContainEqual` rather than a whole-result `toStrictEqual`: the factory is
    // shared by every case in this file, so a whole-result match would make each
    // new advisory variant break an unrelated test.
    expect(toAdvisoryGaps(report())).toContainEqual({
      category: 'architecture',
      itemId: 'docs/architecture/modules.md#module:src/unnamed',
      message: 'docs/architecture/modules.md does not name src/unnamed',
    });
  });

  it('cannot collide with a finding on the same page', () => {
    const both = report({
      findings: [
        {
          page: 'docs/architecture/modules.md',
          rule: 'placeholder',
          message: 'still a placeholder',
        },
      ],
    });
    const ids = [...toFindingGaps(both), ...toAdvisoryGaps(both)].map((g) => g.itemId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is empty for a surface nobody opted into', () => {
    expect(
      toAdvisoryGaps(report({ status: 'absent', findings: [], advisories: [] })),
    ).toStrictEqual([]);
  });
});

describe('advisory item ids', () => {
  it('gives every variant a distinct id', () => {
    const ids = toAdvisoryGaps(report()).map((g) => g.itemId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never renders an undefined discriminator', () => {
    for (const gap of toAdvisoryGaps(report())) {
      expect(gap.itemId, gap.message).not.toContain('undefined');
    }
  });

  it('keeps the module row id stable', () => {
    const ids = toAdvisoryGaps(report()).map((g) => g.itemId);
    expect(ids).toContain('docs/architecture/modules.md#module:src/unnamed');
  });
});
