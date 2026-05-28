// @tests: noldor
import { describe, it, expect } from 'vitest';

import { validateScope } from '../validate-noldor-scope.js';

const KNOWN_SLUGS = new Set([
  'index',
  'lifecycle',
  'workflow',
  'complexity-gating',
  'feature-md-schema',
]);

describe('validateScope', () => {
  it('passes when no noldor files staged (regardless of scope)', () => {
    const result = validateScope({
      message: 'feat(engine): add cylinder',
      stagedFiles: ['packages/engine/src/cylinder.ts'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(true);
  });

  it('passes with noldor:<slug> scope when files in that page', () => {
    const result = validateScope({
      message: 'docs(noldor:workflow): add rule',
      stagedFiles: ['docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(true);
  });

  it('passes with framework-wide noldor scope on multi-page diff', () => {
    const result = validateScope({
      message: 'refactor(noldor): rename sections',
      stagedFiles: ['docs/noldor/workflow.md', 'docs/noldor/lifecycle.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(true);
  });

  it('passes with noldor:index for README.md', () => {
    const result = validateScope({
      message: 'docs(noldor:index): rewrite welcome',
      stagedFiles: ['docs/noldor/README.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(true);
  });

  it('fails when scope is missing on noldor file', () => {
    const result = validateScope({
      message: 'docs: tidy',
      stagedFiles: ['docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/scope.*noldor/i);
  });

  it('fails when scope is non-noldor on noldor file', () => {
    const result = validateScope({
      message: 'docs(engine): tidy',
      stagedFiles: ['docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(false);
  });

  it('suggests the specific page slug when exactly one noldor file is staged', () => {
    const result = validateScope({
      message: 'feat(sdd): mixed change',
      stagedFiles: ['packages/noldor/src/garden/sdd-report.ts', 'docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/feat\(noldor:workflow\)/);
    expect(result.error).toMatch(/docs\/noldor\/workflow\.md/);
  });

  it('suggests the generic noldor scope when multiple pages staged', () => {
    const result = validateScope({
      message: 'feat(sdd): multi-page edit',
      stagedFiles: ['docs/noldor/workflow.md', 'docs/noldor/lifecycle.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/feat\(noldor\)/);
    // Should NOT lock in a single slug when multiple pages touched
    expect(result.error).not.toMatch(/feat\(noldor:workflow\)/);
  });

  it('lists the affected noldor files in the error message', () => {
    const result = validateScope({
      message: 'docs(engine): tidy',
      stagedFiles: [
        'docs/noldor/workflow.md',
        'docs/noldor/lifecycle.md',
        'packages/engine/src/foo.ts',
      ],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/docs\/noldor\/workflow\.md/);
    expect(result.error).toMatch(/docs\/noldor\/lifecycle\.md/);
  });

  it('suggests slug when scope is missing entirely (no parens)', () => {
    const result = validateScope({
      message: 'docs: tidy',
      stagedFiles: ['docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/docs\(noldor:workflow\)/);
  });

  it('fails when slug does not match an existing page', () => {
    const result = validateScope({
      message: 'docs(noldor:nonexistent): foo',
      stagedFiles: ['docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unknown.*nonexistent/);
  });

  it('honors Noldor-Path-Override above Co-Authored-By in trailer block', () => {
    const result = validateScope({
      message:
        'fix: tweak workflow text\n\nDescription body.\n\nNoldor-Path-Override: bootstrap fix\nCo-Authored-By: Bot <bot@example.com>\n',
      stagedFiles: ['docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(true);
  });

  it('ignores Noldor-Path-Override outside the trailer block', () => {
    const result = validateScope({
      message:
        'fix: tweak workflow text\n\nNoldor-Path-Override: bootstrap fix\n\nUnrelated body line.\n\nCo-Authored-By: Bot <bot@example.com>\n',
      stagedFiles: ['docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/docs\/noldor.*no scope/);
  });

  it('honors Noldor-Path: release-automation in trailer block', () => {
    const result = validateScope({
      message: 'chore(release): v1.2.3\n\nNoldor-Path: release-automation\n',
      stagedFiles: ['docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(true);
  });
});
