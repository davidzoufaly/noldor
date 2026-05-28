// @tests: framework-pr-flow-agent-auto-merge

import { describe, expect, it } from 'vitest';

import matter from 'gray-matter';

import { revertPhaseForAttach } from '../phase-revert.js';

function fm(input: Record<string, unknown>, body = '') {
  const lines = Object.entries(input)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}

describe('revertPhaseForAttach', () => {
  it('flips phase: done → in-progress', () => {
    const md = fm({ phase: 'done', name: 'flip-done', introduced: '0.1.0' });
    const out = revertPhaseForAttach(md);
    expect(matter(out).data.phase).toBe('in-progress');
  });

  it('no-op on phase: in-progress (returns input unchanged)', () => {
    const md = fm({ phase: 'in-progress', name: 'no-op-in-progress' });
    const out = revertPhaseForAttach(md);
    expect(out).toBe(md);
  });

  it('no-op on phase: proposed (returns input unchanged)', () => {
    const md = fm({ phase: 'proposed', name: 'no-op-proposed' });
    const out = revertPhaseForAttach(md);
    expect(out).toBe(md);
  });

  it('preserves other frontmatter fields', () => {
    const md = fm({
      phase: 'done',
      name: 'preserve-fields',
      introduced: '0.1.0',
      category: 'Tooling',
    });
    const out = revertPhaseForAttach(md);
    const data = matter(out).data;
    expect(data.name).toBe('preserve-fields');
    expect(data.introduced).toBe('0.1.0');
    expect(data.category).toBe('Tooling');
  });

  it('preserves body content', () => {
    const body = '## Summary\n\nFeature does X.\n';
    const md = fm({ phase: 'done', name: 'preserve-body' }, body);
    const out = revertPhaseForAttach(md);
    expect(out).toContain('Feature does X.');
  });
});
