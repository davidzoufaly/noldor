// @tests: plan-runner
import { describe, expect, it } from 'vitest';

import { readApprovedSlugs } from '../staging.js';

describe('readApprovedSlugs', () => {
  it('returns slugs whose approve box is ticked', () => {
    const md = [
      '## alpha',
      '- [x] approve',
      '- [ ] edit',
      '',
      '## beta',
      '- [ ] approve',
      '',
      '## gamma',
      '- [x] approve',
      '',
    ].join('\n');
    expect(readApprovedSlugs(md)).toEqual(['alpha', 'gamma']);
  });

  it('ignores a ticked skip/edit', () => {
    const md = [
      '## alpha',
      '- [x] skip',
      '',
      '## beta',
      '- [x] edit',
      '',
      '## gamma',
      '- [x] approve',
    ].join('\n');
    expect(readApprovedSlugs(md)).toEqual(['gamma']);
  });

  it('handles backticked headings', () => {
    const md = ['## `foo-bar`', '- [x] approve'].join('\n');
    expect(readApprovedSlugs(md)).toEqual(['foo-bar']);
  });
});
