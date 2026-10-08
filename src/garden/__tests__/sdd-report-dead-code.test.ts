// @tests: dead-code-detection-with-knip, release-script-sddreport-skip-if-only-count-line-changed
import { describe, expect, it } from 'vitest';

import { renderDeadCodeSection } from '../sdd-report-format.js';

describe('renderDeadCodeSection', () => {
  it('lists the total, the count outside the baseline, and a line per type', () => {
    const lines = renderDeadCodeSection({
      total: 5,
      byType: new Map([
        ['exports', 3],
        ['files', 2],
      ]),
      outsideBaseline: 1,
    });
    expect(lines).toEqual([
      '## Dead code',
      '',
      '- 5 finding(s) from knip',
      '- 1 outside the baseline',
      '- exports: 3',
      '- files: 2',
      '',
    ]);
  });

  it('leaves out the baseline line when no baseline reads', () => {
    const lines = renderDeadCodeSection({ total: 0, byType: new Map(), outsideBaseline: null });
    expect(lines).toEqual(['## Dead code', '', '- 0 finding(s) from knip', '']);
  });

  it('renders nothing when the check is off or knip could not run', () => {
    expect(renderDeadCodeSection(null)).toEqual([]);
  });
});
