// @tests: framework-pr-flow-agent-auto-merge

import { describe, expect, it } from 'vitest';

import matter from 'gray-matter';

import { fillMarkers } from '../release-markers.js';

function fm(input: Record<string, unknown>, body = '') {
  const lines = Object.entries(input)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}

// Each test uses a unique `name` value so gray-matter does not return a
// cached parsed-data object (which would leak `updated` mutations across
// tests since fillMarkers mutates the parsed.data object in place).

describe('fillMarkers — phase-aware branches', () => {
  it('first-done: phase=done + introduced=undefined → sets introduced', () => {
    const md = fm({ phase: 'done', name: 'first-done' });
    const out = fillMarkers(md, { newVersion: '0.2.0', hasChangelogBlock: true });
    const data = matter(out).data;
    expect(data.phase).toBe('done');
    expect(data.introduced).toBe('0.2.0');
    expect(data.updated).toBeUndefined();
  });

  it('enhancement-cycle: phase=in-progress + introduced set + hasChangelogBlock → auto-restore + updated', () => {
    const md = fm({ phase: 'in-progress', name: 'enhancement', introduced: '0.1.0' });
    const out = fillMarkers(md, { newVersion: '0.4.0', hasChangelogBlock: true });
    const data = matter(out).data;
    expect(data.phase).toBe('done');
    expect(data.introduced).toBe('0.1.0');
    expect(data.updated).toBe('0.4.0');
  });

  it('maintenance: phase=done + introduced set + hasChangelogBlock → sets updated only', () => {
    const md = fm({ phase: 'done', name: 'maintenance', introduced: '0.1.0' });
    const out = fillMarkers(md, { newVersion: '0.3.0', hasChangelogBlock: true });
    const data = matter(out).data;
    expect(data.phase).toBe('done');
    expect(data.updated).toBe('0.3.0');
  });

  it('fresh in-progress: phase=in-progress + introduced=undefined → no-op', () => {
    const md = fm({ phase: 'in-progress', name: 'fresh-in-progress' });
    const out = fillMarkers(md, { newVersion: '0.2.0', hasChangelogBlock: true });
    const data = matter(out).data;
    expect(data.phase).toBe('in-progress');
    expect(data.introduced).toBeUndefined();
    expect(data.updated).toBeUndefined();
  });

  it('done FD without block: phase=done + introduced set + !hasChangelogBlock → no-op', () => {
    const md = fm({ phase: 'done', name: 'no-block', introduced: '0.1.0' });
    const out = fillMarkers(md, { newVersion: '0.3.0', hasChangelogBlock: false });
    const data = matter(out).data;
    expect(data.phase).toBe('done');
    expect(data.introduced).toBe('0.1.0');
    expect(data.updated).toBeUndefined();
  });

  it('release replay: phase=done + introduced=newVersion + hasChangelogBlock → no-op (guard)', () => {
    // Without the introduced !== newVersion guard, updated would be erroneously
    // set to the same value as introduced when the release script re-runs for
    // the same version.
    const md = fm({ phase: 'done', name: 'replay', introduced: '0.3.0' });
    const out = fillMarkers(md, { newVersion: '0.3.0', hasChangelogBlock: true });
    const data = matter(out).data;
    expect(data.phase).toBe('done');
    expect(data.introduced).toBe('0.3.0');
    expect(data.updated).toBeUndefined();
  });
});
