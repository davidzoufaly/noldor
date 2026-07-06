import { describe, expect, it } from 'vitest';

import { extractSummary } from '../fd-load.js';

// @tests: sdd-detector-5-idea-merge-semantic-similarity
describe(extractSummary, () => {
  it('returns the trimmed Summary body', () => {
    const md = `---\nname: X\n---\n\n## Summary\n\nHello world.\n\n## Usage\n\nsteps`;
    expect(extractSummary(md)).toBe('Hello world.');
  });

  it('returns empty string when no Summary section exists', () => {
    expect(extractSummary(`## Usage\n\nx`)).toBe('');
  });

  it('captures a multi-paragraph Summary up to the next H2', () => {
    const md = `## Summary\n\nPara one.\n\nPara two.\n\n## Usage\n\nx`;
    expect(extractSummary(md)).toBe('Para one.\n\nPara two.');
  });

  it('captures a Summary at end-of-file (no trailing H2)', () => {
    expect(extractSummary(`## Summary\n\nOnly section.`)).toBe('Only section.');
  });
});
