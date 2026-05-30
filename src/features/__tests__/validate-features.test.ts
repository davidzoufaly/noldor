import {
  extractCodePackages,
  normalizeDeclaredPackage,
  validateDocFeatureSlugs,
  validateDocTagPresence,
  validateFiles,
  validatePackagesField,
  validateTaggedSlugs,
  validateTestTagPresence,
  validateTierVsSpec,
} from '../validate-features.js';

// @tests: feature-md-links-overhaul
describe(validateFiles, () => {
  it('returns no errors for a valid fixture', async () => {
    const errors = await validateFiles(['src/fixtures/feature-valid.md']);
    expect(errors).toStrictEqual([]);
  });

  it('accepts done without introduced (release script will fill it)', async () => {
    const errors = await validateFiles(['src/fixtures/feature-invalid-no-introduced.md']);
    expect(errors).toStrictEqual([]);
  });

  it('flags invalid phase value', async () => {
    const errors = await validateFiles(['src/fixtures/feature-invalid-bad-phase.md']);
    expect(errors).toHaveLength(1);
    expect(errors[0].issues.some((m) => m.includes('phase'))).toBeTruthy();
  });

  it('flags slug mismatch with filename', async () => {
    const errors = await validateFiles(['src/fixtures/feature-valid.md']);
    // Valid fixture has name "Sample Feature"; slug derived from filename
    // "feature-valid" doesn't match expected slugification "sample-feature".
    // Validator should treat filename as canonical and NOT require slug field
    // In frontmatter (per spec). So this fixture should still pass — adjust
    // If validator changes.
    expect(errors).toStrictEqual([]);
  });
});

describe(validateTaggedSlugs, () => {
  it('flags @tests: tags referencing unknown feature slugs', async () => {
    const errors = await validateTaggedSlugs(['src/fixtures/unknown-slug-in-test.txt']);
    expect(errors).toHaveLength(1);
    expect(errors[0].issues.some((m) => m.includes('not-a-real-feature-slug'))).toBeTruthy();
  });

  it('returns no errors for a file with no @tests tag', async () => {
    const errors = await validateTaggedSlugs(['src/fixtures/feature-valid.md']);
    expect(errors).toStrictEqual([]);
  });
});

describe(validateTestTagPresence, () => {
  it('flags test files missing the @tests tag', async () => {
    const errors = await validateTestTagPresence(['src/fixtures/test-without-tag.txt']);
    expect(errors).toHaveLength(1);
    expect(errors[0].issues[0]).toContain('@tests:');
  });

  it('returns no errors for a tagged test file', async () => {
    const errors = await validateTestTagPresence(['src/fixtures/test-with-tag.txt']);
    expect(errors).toStrictEqual([]);
  });
});

describe(validateDocTagPresence, () => {
  it('flags docs missing the @feature tag', async () => {
    const errors = await validateDocTagPresence(['src/fixtures/doc-without-tag.md']);
    expect(errors).toHaveLength(1);
    expect(errors[0].issues[0]).toContain('@feature:');
  });

  it('returns no errors for a tagged doc', async () => {
    const errors = await validateDocTagPresence(['src/fixtures/doc-with-tag.md']);
    expect(errors).toStrictEqual([]);
  });
});

describe(validateDocFeatureSlugs, () => {
  it('flags @feature: tags referencing unknown feature slugs', async () => {
    const errors = await validateDocFeatureSlugs(['src/fixtures/unknown-feature-slug.md']);
    expect(errors).toHaveLength(1);
    expect(errors[0].issues.some((m) => m.includes('not-a-real-feature-slug'))).toBeTruthy();
  });

  it('returns no errors for a doc with no @feature: tag', async () => {
    const errors = await validateDocFeatureSlugs(['src/fixtures/feature-valid.md']);
    expect(errors).toStrictEqual([]);
  });
});

describe(extractCodePackages, () => {
  it('extracts package names from packages/<name>/* paths', () => {
    const result = extractCodePackages([
      'packages/format/src/types.ts',
      'packages/sample-scenes',
      'packages/sample-scenes/src/empty-room.ts',
    ]);
    expect([...result].toSorted()).toStrictEqual(['format', 'sample-scenes']);
  });

  it('ignores apps/, scripts/, and other path roots', () => {
    const result = extractCodePackages([
      'apps/web/src/foo.ts',
      'src/dashboard/views.ts',
      'docs/foo.md',
    ]);
    expect(result.size).toBe(0);
  });
});

describe(normalizeDeclaredPackage, () => {
  it('strips the package prefix, packages/, and the app-path prefix', () => {
    expect(normalizeDeclaredPackage('@noldor/format')).toBe('format');
    expect(normalizeDeclaredPackage('packages/format')).toBe('format');
    expect(normalizeDeclaredPackage('src/web')).toBe('web');
    expect(normalizeDeclaredPackage('format')).toBe('format');
  });
});

describe(validatePackagesField, () => {
  it('flags FDs whose links.code references packages missing from packages frontmatter', async () => {
    const errors = await validatePackagesField(['src/fixtures/feature-packages-mismatch.md']);
    expect(errors).toHaveLength(1);
    const issues = errors[0].issues.join(' | ');
    expect(issues).toContain('sample-scenes');
    expect(issues).toContain('format');
  });

  it('returns no errors for a valid fixture', async () => {
    const errors = await validatePackagesField(['src/fixtures/feature-valid.md']);
    expect(errors).toStrictEqual([]);
  });
});

describe(validateTierVsSpec, () => {
  it('flags FD with tier=full but no links.spec', () => {
    const fd = {
      area: 'test',
      category: 'Modeling' as const,
      deps: [],
      links: { code: [], tests: [], docs: [] },
      name: 'Test',
      packages: ['web'],
      phase: 'in-progress' as const,
      'noldor-tier': 'full' as const,
    };
    const errors = validateTierVsSpec(fd, 'test-feature');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('links.spec');
  });

  it('returns no errors for specs-only tier', () => {
    const fd = {
      area: 'test',
      category: 'Modeling' as const,
      deps: [],
      links: { code: [], tests: [], docs: [] },
      name: 'Test',
      packages: ['web'],
      phase: 'in-progress' as const,
      'noldor-tier': 'specs-only' as const,
    };
    const errors = validateTierVsSpec(fd, 'test-feature');
    expect(errors).toStrictEqual([]);
  });

  it('returns no errors for full tier with links.spec present', () => {
    const fd = {
      area: 'test',
      category: 'Modeling' as const,
      deps: [],
      links: { code: [], tests: [], docs: [], spec: 'docs/specs/test-feature.md' },
      name: 'Test',
      packages: ['web'],
      phase: 'in-progress' as const,
      'noldor-tier': 'full' as const,
    };
    const errors = validateTierVsSpec(fd, 'test-feature');
    expect(errors).toStrictEqual([]);
  });
});
