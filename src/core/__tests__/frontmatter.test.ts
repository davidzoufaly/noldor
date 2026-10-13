// @tests: noldor
import { describe, expect, it } from 'vitest';
import matter from 'gray-matter';

import { stringifyWithFrontmatter } from '../frontmatter.js';
import { flipPhaseToDone } from '../phase-flip-done.js';

const FD = '---\nslug: x\nphase: in-progress\n---\n\n## Summary\n\nFeature does X.\n';

describe('stringifyWithFrontmatter', () => {
  it('round-trips a parsed file byte for byte', () => {
    const parsed = matter(FD);
    expect(stringifyWithFrontmatter(parsed.content, parsed.data)).toBe(FD);
  });

  it('adds the blank line when the body starts right under the frontmatter', () => {
    expect(stringifyWithFrontmatter('## Summary\n', { slug: 'x' })).toBe(
      '---\nslug: x\n---\n\n## Summary\n',
    );
  });

  it('collapses several leading blank lines to one', () => {
    expect(stringifyWithFrontmatter('\n\n\n## Summary\n', { slug: 'x' })).toBe(
      '---\nslug: x\n---\n\n## Summary\n',
    );
  });
});

describe('frontmatter writers keep the blank line', () => {
  it('flipPhaseToDone leaves one blank line after the frontmatter', () => {
    expect(flipPhaseToDone(FD)).toBe(FD.replace('in-progress', 'done'));
  });
});
