import { describe, expect, it, vi } from 'vitest';

import { checkBranchProtection, type GhApiFn } from '../branch-protection.js';

describe('checkBranchProtection', () => {
  it('returns OK when settings match expected shape', async () => {
    const ghApi: GhApiFn = vi.fn(async () => ({
      stdout: JSON.stringify({
        required_pull_request_reviews: { required_approving_review_count: 0 },
        enforce_admins: { enabled: true },
        required_status_checks: null,
        restrictions: null,
      }),
      exitCode: 0,
    }));
    const result = await checkBranchProtection({ owner: 'x', repo: 'y', ghApi });
    expect(result.severity).toBe('OK');
  });

  it('returns WARN when branch protection is unset (404)', async () => {
    const ghApi: GhApiFn = vi.fn(async () => ({ stdout: '', exitCode: 1 }));
    const result = await checkBranchProtection({ owner: 'x', repo: 'y', ghApi });
    expect(result.severity).toBe('WARN');
    expect(result.message).toMatch(/not configured/i);
  });

  it('returns WARN when enforce_admins is false (admin bypass allowed)', async () => {
    const ghApi: GhApiFn = vi.fn(async () => ({
      stdout: JSON.stringify({
        required_pull_request_reviews: { required_approving_review_count: 0 },
        enforce_admins: { enabled: false },
        required_status_checks: null,
        restrictions: null,
      }),
      exitCode: 0,
    }));
    const result = await checkBranchProtection({ owner: 'x', repo: 'y', ghApi });
    expect(result.severity).toBe('WARN');
    expect(result.message).toMatch(/admin bypass/i);
  });

  it('returns WARN when required_pull_request_reviews is null (PR not required)', async () => {
    const ghApi: GhApiFn = vi.fn(async () => ({
      stdout: JSON.stringify({
        required_pull_request_reviews: null,
        enforce_admins: { enabled: true },
        required_status_checks: null,
        restrictions: null,
      }),
      exitCode: 0,
    }));
    const result = await checkBranchProtection({ owner: 'x', repo: 'y', ghApi });
    expect(result.severity).toBe('WARN');
    expect(result.message).toMatch(/PR required/i);
  });
});
