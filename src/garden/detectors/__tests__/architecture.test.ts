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
      page: 'docs/architecture/modules.md',
      module: 'src/unnamed',
      message: 'docs/architecture/modules.md does not name src/unnamed',
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
    expect(toAdvisoryGaps(report())).toStrictEqual([
      {
        category: 'architecture',
        itemId: 'docs/architecture/modules.md#src/unnamed',
        message: 'docs/architecture/modules.md does not name src/unnamed',
      },
    ]);
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
