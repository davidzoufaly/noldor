// packages/noldor/src/release/__tests__/sdd-report-diff.test.ts
// @tests: release-script-sddreport-skip-if-only-count-line-changed

import { describe, expect, it } from 'vitest';

import { onlyReviewSkipCountChanged } from '../sdd-report-diff.js';

const report = (count: number, gaps: string[] = ['- `x` — missing tests']): string =>
  [
    '# SDD report',
    '',
    '### Review-skip count (last 30 days)',
    '',
    `Gated commits missing \`Noldor-Reviewed\` trailer: ${count}`,
    '',
    '## Gap details',
    '',
    ...gaps,
    '',
  ].join('\n');

describe('onlyReviewSkipCountChanged', () => {
  it('returns true for identical content', () => {
    expect(onlyReviewSkipCountChanged(report(8), report(8))).toBe(true);
  });

  it('returns true when only the count number differs', () => {
    expect(onlyReviewSkipCountChanged(report(8), report(9))).toBe(true);
  });

  it('returns false when a gap line is added', () => {
    const head = report(8, ['- `x` — missing tests']);
    const working = report(8, ['- `x` — missing tests', '- `y` — missing spec']);
    expect(onlyReviewSkipCountChanged(head, working)).toBe(false);
  });

  it('returns false when both the count and a gap change', () => {
    const head = report(8, ['- `x` — missing tests']);
    const working = report(9, ['- `x` — missing tests', '- `y` — missing spec']);
    expect(onlyReviewSkipCountChanged(head, working)).toBe(false);
  });

  it('returns false when the count line is absent / format-shifted on one side', () => {
    const head = report(8);
    const working = head.replace(
      /^Gated commits missing `Noldor-Reviewed` trailer: \d+$/m,
      'Gated commits without review: 8',
    );
    expect(onlyReviewSkipCountChanged(head, working)).toBe(false);
  });
});
