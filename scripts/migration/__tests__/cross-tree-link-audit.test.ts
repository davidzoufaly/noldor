import { describe, expect, it } from 'vitest';
import { auditCrossTreeLinks, type CrossTreeFinding } from '../cross-tree-link-audit.ts';
import type { Track } from '../classify.ts';

const tracks = new Map<string, Track>([
  ['dashboard-hot-zones-page', 'framework'],
  ['auto-save', 'product'],
  ['noldor-package-lift', 'framework'],
]);

describe('auditCrossTreeLinks', () => {
  it('flags framework FD with deps: reference to product FD', () => {
    const findings = auditCrossTreeLinks({
      featureTracks: tracks,
      features: [
        {
          slug: 'dashboard-hot-zones-page',
          deps: ['auto-save'],
          links: { spec: '', code: [], tests: [] },
          body: '',
        },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      sourceSlug: 'dashboard-hot-zones-page',
      sourceTrack: 'framework',
      targetSlug: 'auto-save',
      targetTrack: 'product',
      field: 'deps',
    } satisfies Partial<CrossTreeFinding>);
  });

  it('flags body [[slug]] reference across trees', () => {
    const findings = auditCrossTreeLinks({
      featureTracks: tracks,
      features: [
        {
          slug: 'dashboard-hot-zones-page',
          deps: [],
          links: { spec: '', code: [], tests: [] },
          body: 'Related: [[auto-save]] and [[noldor-package-lift]].',
        },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].field).toBe('body');
    expect(findings[0].targetSlug).toBe('auto-save');
  });

  it('ignores same-tree references (framework → framework)', () => {
    const findings = auditCrossTreeLinks({
      featureTracks: tracks,
      features: [
        {
          slug: 'dashboard-hot-zones-page',
          deps: ['noldor-package-lift'],
          links: { spec: '', code: [], tests: [] },
          body: 'See [[noldor-package-lift]].',
        },
      ],
    });

    expect(findings).toHaveLength(0);
  });

  it('ignores unknown slugs (not in featureTracks)', () => {
    const findings = auditCrossTreeLinks({
      featureTracks: tracks,
      features: [
        {
          slug: 'dashboard-hot-zones-page',
          deps: ['something-unknown'],
          links: { spec: '', code: [], tests: [] },
          body: '',
        },
      ],
    });

    expect(findings).toHaveLength(0);
  });
});
