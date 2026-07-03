// @tests: framework-doc-extraction
import { describe, expect, it } from 'vitest';
import { loadDocRoots } from '../doc-roots.js';

describe('loadDocRoots', () => {
  it('returns docs/* paths anchored at given cwd', () => {
    const r = loadDocRoots('/tmp/example');
    expect(r.features).toBe('/tmp/example/docs/features');
    expect(r.roadmap).toBe('/tmp/example/docs/roadmap.md');
    expect(r.backlog).toBe('/tmp/example/docs/backlog.md');
    expect(r.vision).toBe('/tmp/example/docs/vision.md');
    expect(r.ideas).toBe('/tmp/example/docs/ideas.md');
    expect(r.milestones).toBe('/tmp/example/docs/milestones');
    expect(r.plans).toBe('/tmp/example/docs/superpowers/plans');
    expect(r.specs).toBe('/tmp/example/docs/superpowers/specs');
  });

  it('defaults to process.cwd() when omitted', () => {
    const r = loadDocRoots();
    expect(r.features.endsWith('/docs/features')).toBe(true);
    expect(r.roadmap.endsWith('/docs/roadmap.md')).toBe(true);
  });
});
