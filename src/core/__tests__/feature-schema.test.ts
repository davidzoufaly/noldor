import { FeatureFrontmatterSchema } from '../feature-schema.js';

const base = {
  area: 'history',
  category: 'Core' as const,
  introduced: '0.1.0',
  links: {
    code: ['packages/web/src/history/'],
    tests: ['packages/web/src/__tests__/history.test.ts'],
  },
  name: 'Undo/Redo',
  packages: ['web'],
  phase: 'done' as const,
  'noldor-tier': 'full' as const,
};

// @tests: bootstrap-immunity-for-self-gating-features, feature-md-links-overhaul, framework-milestones-support-poc-mvp-100
describe('FeatureFrontmatterSchema', () => {
  it('accepts a valid done feature', () => {
    expect(FeatureFrontmatterSchema.safeParse(base).success).toBeTruthy();
  });

  it('accepts in-progress without introduced', () => {
    const inProgress = { ...base, phase: 'in-progress' as const };
    delete (inProgress as Record<string, unknown>).introduced;
    expect(FeatureFrontmatterSchema.safeParse(inProgress).success).toBeTruthy();
  });

  it('accepts done without introduced (release script fills it)', () => {
    const pending: Record<string, unknown> = { ...base };
    delete pending.introduced;
    const result = FeatureFrontmatterSchema.safeParse(pending);
    expect(result.success).toBeTruthy();
  });

  it('rejects invalid phase value', () => {
    const bad = { ...base, phase: 'unknown' as unknown as 'done' };
    expect(FeatureFrontmatterSchema.safeParse(bad).success).toBeFalsy();
  });

  it('rejects empty packages array', () => {
    const bad = { ...base, packages: [] };
    expect(FeatureFrontmatterSchema.safeParse(bad).success).toBeFalsy();
  });

  it('accepts optional updated + deps + spec + docs', () => {
    const extended = {
      ...base,
      deps: ['state-management'],
      links: {
        ...base.links,
        docs: [
          'docs/user/tutorials/your-first-shape.md',
          'docs/user/explanation/agent-first-design.md',
        ],
        spec: 'docs/design/specs/x.md',
      },
      updated: '0.1.2',
    };
    expect(FeatureFrontmatterSchema.safeParse(extended).success).toBeTruthy();
  });

  it('rejects links.docs as a single string (must be array)', () => {
    const bad = {
      ...base,
      links: {
        ...base.links,
        docs: 'docs/user/tutorials/x.md',
      },
    };
    expect(FeatureFrontmatterSchema.safeParse(bad).success).toBeFalsy();
  });

  it('rejects unknown top-level fields (strict mode)', () => {
    const bad = { ...base, unknownField: 'x' };
    expect(FeatureFrontmatterSchema.safeParse(bad).success).toBeFalsy();
  });

  it('rejects non-semver introduced', () => {
    const bad = { ...base, introduced: 'version-1' };
    expect(FeatureFrontmatterSchema.safeParse(bad).success).toBeFalsy();
  });

  it('rejects missing category', () => {
    const bad: Record<string, unknown> = { ...base };
    delete bad.category;
    expect(FeatureFrontmatterSchema.safeParse(bad).success).toBeFalsy();
  });

  it('accepts any non-empty category string (membership enforced by validate-features, not the schema)', () => {
    expect(
      FeatureFrontmatterSchema.safeParse({ ...base, category: 'Frontend' }).success,
    ).toBeTruthy();
  });

  it('rejects an empty category', () => {
    const bad = { ...base, category: '' };
    expect(FeatureFrontmatterSchema.safeParse(bad).success).toBeFalsy();
  });

  it('accepts phase=in-progress + introduced (attach-revert lifecycle)', () => {
    const parsed = FeatureFrontmatterSchema.safeParse({
      area: 'tooling',
      category: 'Tooling',
      deps: [],
      introduced: '0.3.0',
      links: { code: [], docs: [], tests: [] },
      name: 'Example',
      packages: ['scripts'],
      phase: 'in-progress',
      'noldor-tier': 'specs-only',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects updated set without introduced', () => {
    const bad: Record<string, unknown> = { ...base, updated: '0.2.0' };
    delete bad.introduced;
    const result = FeatureFrontmatterSchema.safeParse(bad);
    expect(result.success).toBeFalsy();
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'updated')).toBeTruthy();
    }
  });
});

describe('noldor-tier field', () => {
  it('accepts specs-only', () => {
    const ok = FeatureFrontmatterSchema.parse({
      ...base,
      'noldor-tier': 'specs-only',
    });
    expect(ok['noldor-tier']).toBe('specs-only');
  });
  it('accepts full', () => {
    const ok = FeatureFrontmatterSchema.parse({
      ...base,
      'noldor-tier': 'full',
    });
    expect(ok['noldor-tier']).toBe('full');
  });
  it('rejects other values', () => {
    expect(FeatureFrontmatterSchema.safeParse({ ...base, 'noldor-tier': 'bogus' }).success).toBe(
      false,
    );
  });
  it('rejects FD missing noldor-tier', () => {
    const noTier: Record<string, unknown> = { ...base };
    delete noTier['noldor-tier'];
    expect(FeatureFrontmatterSchema.safeParse(noTier).success).toBe(false);
  });
  it('accepts links.plan as a single string', () => {
    const parsed = FeatureFrontmatterSchema.parse({
      ...base,
      links: { code: [], tests: [], plan: 'docs/design/plans/x.md' },
    });
    expect(parsed.links.plan).toBe('docs/design/plans/x.md');
  });
  it('accepts links.plan as an array of strings', () => {
    const parsed = FeatureFrontmatterSchema.parse({
      ...base,
      links: { code: [], tests: [], plan: ['a.md', 'b.md'] },
    });
    expect(parsed.links.plan).toEqual(['a.md', 'b.md']);
  });
  it('treats links.plan as optional', () => {
    const parsed = FeatureFrontmatterSchema.parse({
      ...base,
      links: { code: [], tests: [] },
    });
    expect(parsed.links.plan).toBeUndefined();
  });
});
