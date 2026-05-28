// @tests: noldor
import { describe, it, expect } from 'vitest';
import { renamePlanOnlyTier } from '../rename-plan-only-tier.js';

describe('renamePlanOnlyTier', () => {
  it('rewrites `noldor-tier: plan-only` to `noldor-tier: specs-only` in frontmatter', () => {
    const input = '---\nname: foo\nnoldor-tier: plan-only\n---\n\n## Summary\nhi\n';
    expect(renamePlanOnlyTier(input)).toBe(
      '---\nname: foo\nnoldor-tier: specs-only\n---\n\n## Summary\nhi\n',
    );
  });

  it('rewrites code-fenced `plan-only` literal strings', () => {
    const input = "tier === 'plan-only' ? 'medium' : 'heavy'";
    expect(renamePlanOnlyTier(input)).toBe("tier === 'specs-only' ? 'medium' : 'heavy'");
  });

  it('rewrites compound session paths plan-only-new and plan-only-attach', () => {
    const input = 'paths: plan-only-new, plan-only-attach';
    expect(renamePlanOnlyTier(input)).toBe('paths: specs-only-new, specs-only-attach');
  });

  it('rewrites backtick-wrapped `plan-only` in markdown prose', () => {
    const input = 'The `plan-only` tier means medium depth.';
    expect(renamePlanOnlyTier(input)).toBe('The `specs-only` tier means medium depth.');
  });

  it('rewrites camelCase `planOnly` identifier (used in sdd-report.ts)', () => {
    const input = 'let planOnly = 0; planOnly++;';
    expect(renamePlanOnlyTier(input)).toBe('let specsOnly = 0; specsOnly++;');
  });

  it('rewrites both hyphenated and camelCase in the same input', () => {
    const input = "tier === 'plan-only' && planOnly > 0";
    expect(renamePlanOnlyTier(input)).toBe("tier === 'specs-only' && specsOnly > 0");
  });

  it('rewrites inside fenced markdown code blocks (substitution is pure-text)', () => {
    const input = ['```yaml', 'noldor-tier: plan-only', '```'].join('\n');
    expect(renamePlanOnlyTier(input)).toBe(
      ['```yaml', 'noldor-tier: specs-only', '```'].join('\n'),
    );
  });

  it('leaves the space-separated English phrase `plan only` untouched', () => {
    const input = '- (plan only): 26';
    expect(renamePlanOnlyTier(input)).toBe(input);
  });

  it('is idempotent — running twice yields the same output as once', () => {
    const input = 'tier: plan-only and let planOnly = 0;';
    const once = renamePlanOnlyTier(input);
    const twice = renamePlanOnlyTier(once);
    expect(twice).toBe(once);
  });

  it('leaves text without `plan-only` or `planOnly` unchanged', () => {
    const input = 'tier: full\nname: foo\n';
    expect(renamePlanOnlyTier(input)).toBe(input);
  });

  it('protects the FD slug `rename-plan-only-tier-to-specs-only` from mangling', () => {
    const input =
      '<!-- @prs-since-last-release: rename-plan-only-tier-to-specs-only -->\nnoldor-tier: plan-only\n';
    expect(renamePlanOnlyTier(input)).toBe(
      '<!-- @prs-since-last-release: rename-plan-only-tier-to-specs-only -->\nnoldor-tier: specs-only\n',
    );
  });

  it('protects the slug even when surrounded by other plan-only text', () => {
    const input =
      'See docs/features/rename-plan-only-tier-to-specs-only.md for the plan-only -> specs-only rename.';
    expect(renamePlanOnlyTier(input)).toBe(
      'See docs/features/rename-plan-only-tier-to-specs-only.md for the specs-only -> specs-only rename.',
    );
  });
});
