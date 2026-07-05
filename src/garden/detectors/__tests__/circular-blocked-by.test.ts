import { findBlockedByCycles } from '../circular-blocked-by.js';

/** Minimal roadmap block builder for the pure cycle finder. */
function entry(name: string, opts: { id?: string; blockedBy?: string[] } = {}): string {
  const lines = [`#### ${name}`, '', '- area: tooling', '- type: feat', '- since: 2026-05-11'];
  if (opts.id) lines.push(`- id: ${opts.id}`);
  if (opts.blockedBy) lines.push(`- blocked-by: ${opts.blockedBy.join(', ')}`);
  lines.push('', 'Body.', '');
  return lines.join('\n');
}

function roadmap(...blocks: string[]): string {
  return `### Cat\n\n${blocks.join('\n')}`;
}

describe(findBlockedByCycles, () => {
  it('returns no cycles for an acyclic chain', () => {
    const raw = roadmap(
      entry('A', { blockedBy: ['b'] }),
      entry('B', { blockedBy: ['c'] }),
      entry('C'),
    );
    expect(findBlockedByCycles(raw, '')).toEqual([]);
  });

  it('detects a self-loop', () => {
    const raw = roadmap(entry('A', { blockedBy: ['a'] }));
    expect(findBlockedByCycles(raw, '')).toEqual([['a']]);
  });

  it('detects a two-node cycle', () => {
    const raw = roadmap(entry('A', { blockedBy: ['b'] }), entry('B', { blockedBy: ['a'] }));
    const cycles = findBlockedByCycles(raw, '');
    expect(cycles).toHaveLength(1);
    expect(new Set(cycles[0])).toEqual(new Set(['a', 'b']));
  });

  it('resolves Q-id refs to slugs when detecting a cycle', () => {
    // A (Q-0001) blocked-by slug b; B blocked-by Q-0001 → cycle a↔b.
    const raw = roadmap(
      entry('A', { id: 'Q-0001', blockedBy: ['b'] }),
      entry('B', { id: 'Q-0002', blockedBy: ['Q-0001'] }),
    );
    const cycles = findBlockedByCycles(raw, '');
    expect(cycles).toHaveLength(1);
    expect(new Set(cycles[0])).toEqual(new Set(['a', 'b']));
  });

  it('ignores dangling refs (no target entry)', () => {
    const raw = roadmap(entry('A', { blockedBy: ['nonexistent'] }));
    expect(findBlockedByCycles(raw, '')).toEqual([]);
  });

  it('reports a shared cycle once, not once per member', () => {
    const raw = roadmap(
      entry('A', { blockedBy: ['b'] }),
      entry('B', { blockedBy: ['c'] }),
      entry('C', { blockedBy: ['a'] }),
    );
    const cycles = findBlockedByCycles(raw, '');
    expect(cycles).toHaveLength(1);
    expect(new Set(cycles[0])).toEqual(new Set(['a', 'b', 'c']));
  });

  it('detects a cycle spanning roadmap and backlog', () => {
    const rm = roadmap(entry('A', { blockedBy: ['b'] }));
    const bl = `# Backlog\n\n### B\n\n- area: tooling\n- type: feat\n- since: 2026-05-11\n- blocked-by: a\n\nBody.\n`;
    const cycles = findBlockedByCycles(rm, bl);
    expect(cycles).toHaveLength(1);
    expect(new Set(cycles[0])).toEqual(new Set(['a', 'b']));
  });
});
