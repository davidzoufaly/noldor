// @tests: noldor

import { describe, expect, it } from 'vitest';

import matter from 'gray-matter';

import { flipPhaseToDone } from '../phase-flip-done.js';

function fm(input: Record<string, unknown>, body = '') {
  const lines = Object.entries(input)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}

describe('flipPhaseToDone', () => {
  it('flips phase: in-progress → done', () => {
    const md = fm({ phase: 'in-progress', name: 'flip-in-progress' });
    const out = flipPhaseToDone(md);
    expect(matter(out).data.phase).toBe('done');
  });

  it('flips phase: in-progress → done when introduced is set (attach-revert restore)', () => {
    const md = fm({ phase: 'in-progress', name: 'attach-restore', introduced: '0.1.0' });
    const out = flipPhaseToDone(md);
    const data = matter(out).data;
    expect(data.phase).toBe('done');
    expect(data.introduced).toBe('0.1.0');
  });

  it('no-op on phase: done (returns input unchanged)', () => {
    const md = fm({ phase: 'done', name: 'no-op-done', introduced: '0.1.0' });
    const out = flipPhaseToDone(md);
    expect(out).toBe(md);
  });

  it('no-op on phase: proposed (returns input unchanged)', () => {
    const md = fm({ phase: 'proposed', name: 'no-op-proposed' });
    const out = flipPhaseToDone(md);
    expect(out).toBe(md);
  });

  it('preserves other frontmatter fields', () => {
    const md = fm({
      phase: 'in-progress',
      name: 'preserve-fields',
      category: 'Tooling',
      area: 'tooling',
    });
    const out = flipPhaseToDone(md);
    const data = matter(out).data;
    expect(data.name).toBe('preserve-fields');
    expect(data.category).toBe('Tooling');
    expect(data.area).toBe('tooling');
  });

  it('preserves body content', () => {
    const body = '## Summary\n\nFeature does X.\n';
    const md = fm({ phase: 'in-progress', name: 'preserve-body' }, body);
    const out = flipPhaseToDone(md);
    expect(out).toContain('Feature does X.');
  });
});
