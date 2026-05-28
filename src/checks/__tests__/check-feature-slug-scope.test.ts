// packages/noldor/src/checks/__tests__/check-feature-slug-scope.test.ts
// @tests: feature-md-links-overhaul

import { describe, expect, it } from 'vitest';

import { validateFeatureSlugScope } from '../check-feature-slug-scope.js';

const SLUGS = new Set(['boolean-operations', 'csg-primitives', 'auto-save']);

describe('validateFeatureSlugScope', () => {
  it('passes commits without a `:` in scope', () => {
    expect(
      validateFeatureSlugScope({
        message: 'feat(engine): refactor internal helper',
        knownSlugs: SLUGS,
      }),
    ).toEqual({ success: true });
  });

  it('passes commits whose slug matches an FD', () => {
    expect(
      validateFeatureSlugScope({
        message: 'feat(engine:boolean-operations): add subtract',
        knownSlugs: SLUGS,
      }),
    ).toEqual({ success: true });
  });

  it('passes noldor-namespaced commits (delegated to noldor-scope hook)', () => {
    expect(
      validateFeatureSlugScope({
        message: 'docs(noldor:workflow): tweak',
        knownSlugs: SLUGS,
      }),
    ).toEqual({ success: true });
  });

  it('rejects unknown slugs', () => {
    const out = validateFeatureSlugScope({
      message: 'feat(engine:does-not-exist): nope',
      knownSlugs: SLUGS,
    });
    expect(out.success).toBe(false);
    expect(out.error).toContain('does-not-exist');
  });

  it('rejects more than one `:` in scope', () => {
    const out = validateFeatureSlugScope({
      message: 'feat(engine:boolean-operations:extra): bad',
      knownSlugs: SLUGS,
    });
    expect(out.success).toBe(false);
    expect(out.error).toContain('one `:`');
  });

  it('passes commits without a scope at all', () => {
    expect(
      validateFeatureSlugScope({
        message: 'docs: tweak readme',
        knownSlugs: SLUGS,
      }),
    ).toEqual({ success: true });
  });
});
