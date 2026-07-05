// @tests: noldor, scope-sibling-trailer-for-doc-sync-commits
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

describe('validateScope — Noldor-Sibling-Scope trailer', () => {
  it('passes a mixed diff when the trailer covers every staged page', () => {
    const result = validateScope({
      message:
        'feat(prep): add dispatch runner\n\nNoldor-Sibling-Scope: noldor:workflow\nNoldor-Path: fast-track\n',
      stagedFiles: ['src/prep/dispatch.ts', 'docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(true);
  });

  it('passes a mixed diff on the no-scope branch too', () => {
    const result = validateScope({
      message: 'feat: add dispatch runner\n\nNoldor-Sibling-Scope: noldor:workflow\n',
      stagedFiles: ['src/prep/dispatch.ts', 'docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(true);
  });

  it('passes a multi-page mixed diff with a comma-separated token list', () => {
    const result = validateScope({
      message:
        'feat(core): rework markers\n\nNoldor-Sibling-Scope: noldor:workflow, noldor:lifecycle\n',
      stagedFiles: ['src/core/session.ts', 'docs/noldor/workflow.md', 'docs/noldor/lifecycle.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(true);
  });

  it('bare noldor token accepts any staged page set (subject-scope parity)', () => {
    const result = validateScope({
      message: 'feat(core): rework markers\n\nNoldor-Sibling-Scope: noldor\n',
      stagedFiles: ['src/core/session.ts', 'docs/noldor/workflow.md', 'docs/noldor/lifecycle.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(true);
  });

  it('fails when the trailer leaves a staged page uncovered', () => {
    const result = validateScope({
      message: 'feat(core): rework markers\n\nNoldor-Sibling-Scope: noldor:workflow\n',
      stagedFiles: ['src/core/session.ts', 'docs/noldor/workflow.md', 'docs/noldor/lifecycle.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/docs\/noldor\/lifecycle\.md/);
    expect(result.error).toMatch(/noldor:lifecycle/);
  });

  it('fails on an unknown slug in the trailer, listing valid slugs', () => {
    const result = validateScope({
      message: 'feat(core): rework markers\n\nNoldor-Sibling-Scope: noldor:nonexistent\n',
      stagedFiles: ['src/core/session.ts', 'docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unknown noldor slug "nonexistent"/);
    expect(result.error).toMatch(/valid slugs: complexity-gating/);
  });

  it('fails on a token that is not noldor-shaped', () => {
    const result = validateScope({
      message: 'feat(core): rework markers\n\nNoldor-Sibling-Scope: engine\n',
      stagedFiles: ['src/core/session.ts', 'docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/"engine"/);
  });

  it('rejects the trailer on a doc-only diff with the dedicated guard message', () => {
    const result = validateScope({
      message: 'docs: tidy\n\nNoldor-Sibling-Scope: noldor:workflow\n',
      stagedFiles: ['docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/doc-only/);
    expect(result.error).toMatch(/subject/);
  });

  it('ignores a sibling trailer stranded mid-body (not in the trailer block)', () => {
    const result = validateScope({
      message:
        'feat: add dispatch\n\nNoldor-Sibling-Scope: noldor:workflow\n\nUnrelated body line.\n\nCo-Authored-By: Bot <bot@example.com>\n',
      stagedFiles: ['src/prep/dispatch.ts', 'docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no scope/);
  });
});

describe('validateScope — sibling-trailer teaching in the failure message', () => {
  it('names the exact trailer line for a single-page mixed diff', () => {
    const result = validateScope({
      message: 'feat(sdd): mixed change',
      stagedFiles: ['src/garden/sdd-report.ts', 'docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/keep "feat\(sdd\)"/);
    expect(result.error).toMatch(/Noldor-Sibling-Scope: noldor:workflow/);
  });

  it('suggests the precise comma-joined slug list on a multi-page mixed diff, never bare noldor', () => {
    const result = validateScope({
      message: 'feat(sdd): multi-page edit',
      stagedFiles: [
        'src/garden/sdd-report.ts',
        'docs/noldor/workflow.md',
        'docs/noldor/lifecycle.md',
      ],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Noldor-Sibling-Scope: noldor:lifecycle, noldor:workflow/);
    expect(result.error).not.toMatch(/Noldor-Sibling-Scope: noldor(?!:)/);
  });

  it('does not suggest the trailer on a doc-only diff (it would bounce off the doc-only guard)', () => {
    const result = validateScope({
      message: 'docs(engine): tidy',
      stagedFiles: ['docs/noldor/workflow.md'],
      knownSlugs: KNOWN_SLUGS,
    });
    expect(result.success).toBe(false);
    expect(result.error).not.toMatch(/Noldor-Sibling-Scope/);
  });
});
