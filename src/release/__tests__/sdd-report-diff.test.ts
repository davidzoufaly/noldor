// src/release/__tests__/sdd-report-diff.test.ts
// @tests: outcome-telemetry-and-effectiveness-metrics, release-script-sddreport-skip-if-only-count-line-changed

import { describe, expect, it } from 'vitest';

import { reviewSkipCountLine } from '../../garden/sdd-report-format.js';
import { onlyReviewSkipCountChanged } from '../sdd-report-diff.js';

// Build the count line via the shared format helper the real report uses, so a
// wording change at the source desyncs this test too — catching the drift the
// guard would otherwise hide (it would fail safe to always-abort, killing the
// feature silently).
const report = (count: number, gaps: string[] = ['- `x` — missing tests']): string =>
  [
    '# SDD report',
    '',
    '### Review-skip count (last 30 days)',
    '',
    reviewSkipCountLine(count),
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
    const working = head.replace(reviewSkipCountLine(8), 'Gated commits without review: 8');
    expect(onlyReviewSkipCountChanged(head, working)).toBe(false);
  });

  it('stays coupled to the real emitted line via the shared format helper', () => {
    // Lines built straight from reviewSkipCountLine — if the prefix ever
    // changes, both the matcher (derived from the same constant) and these
    // fixtures move together, so this asserts the count-only delta is still
    // recognized regardless of the literal wording.
    const head = `# r\n\n${reviewSkipCountLine(8)}\n`;
    const working = `# r\n\n${reviewSkipCountLine(9)}\n`;
    expect(onlyReviewSkipCountChanged(head, working)).toBe(true);
  });
});
