// @tests: pendev-ui-design-phase
import { describe, expect, it } from 'vitest';

import { expandCandidateValue, isUiBearing, sessionUiVerdict } from '../ui-predicate.js';

const FILES = [
  'src/dashboard/app/page.tsx',
  'src/dashboard/app/nested/chart.tsx',
  'src/core/session.ts',
  'docs/roadmap.md',
];

describe('isUiBearing', () => {
  it('true when any path matches any glob', () => {
    expect(isUiBearing(['src/dashboard/app/page.tsx'], ['src/dashboard/app/**'])).toBe(true);
  });
  it('false on no match', () => {
    expect(isUiBearing(['src/core/session.ts'], ['src/dashboard/app/**'])).toBe(false);
  });
  it('false on empty inputs', () => {
    expect(isUiBearing([], ['src/dashboard/app/**'])).toBe(false);
    expect(isUiBearing(['src/a.ts'], [])).toBe(false);
  });
  it('matches dotfiles ({ dot: true } semantics)', () => {
    expect(isUiBearing(['src/dashboard/app/.env.tsx'], ['src/dashboard/app/**'])).toBe(true);
  });
});

describe('expandCandidateValue', () => {
  it('passes a concrete path through', () => {
    expect(expandCandidateValue('src/core/session.ts', FILES, () => false)).toEqual([
      'src/core/session.ts',
    ]);
  });
  it('expands a glob value against the file list via minimatch', () => {
    expect(expandCandidateValue('src/dashboard/**', FILES, () => false)).toEqual([
      'src/dashboard/app/page.tsx',
      'src/dashboard/app/nested/chart.tsx',
    ]);
  });
  it('expands brace patterns with minimatch semantics', () => {
    expect(expandCandidateValue('src/{core,dashboard}/**', FILES, () => false)).toHaveLength(3);
  });
  it('treats an existing directory as <dir>/**', () => {
    expect(expandCandidateValue('src/dashboard', FILES, (p) => p === 'src/dashboard')).toEqual([
      'src/dashboard/app/page.tsx',
      'src/dashboard/app/nested/chart.tsx',
    ]);
  });
  it('a value expanding to nothing contributes nothing', () => {
    expect(expandCandidateValue('src/nothing/**', FILES, () => false)).toEqual([]);
  });
});

describe('sessionUiVerdict truth table', () => {
  const ui = ['src/dashboard/app/**'];
  const surfaces = { dashboard: ['src/dashboard/app/**'] };
  const hit = ['src/dashboard/app/page.tsx'];

  it('row 1: FD design: skip wins over everything', () => {
    const v = sessionUiVerdict({ design: 'skip' }, hit, { uiPaths: ui, uiSurfaces: surfaces });
    expect(v.verdict).toBe('skip');
  });
  it('row 2: FD design: required is absolute — even without uiPaths', () => {
    const v = sessionUiVerdict({ design: 'required' }, [], {});
    expect(v.verdict).toBe('required');
    expect(v.affectedSurfaces).toEqual([]);
  });
  it('row 3: no override, uiPaths absent → skip', () => {
    expect(sessionUiVerdict({}, hit, {}).verdict).toBe('skip');
    expect(sessionUiVerdict({}, hit, { uiPaths: [] }).verdict).toBe('skip');
  });
  it('row 4: no override, intersection non-empty → required with surfaces', () => {
    const v = sessionUiVerdict({}, hit, { uiPaths: ui, uiSurfaces: surfaces });
    expect(v.verdict).toBe('required');
    expect(v.affectedSurfaces).toEqual(['dashboard']);
    expect(v.unmappedPaths).toEqual([]);
  });
  it('row 5: no override, empty intersection or empty candidates → skip', () => {
    expect(sessionUiVerdict({}, ['src/core/session.ts'], { uiPaths: ui }).verdict).toBe('skip');
    expect(sessionUiVerdict({}, [], { uiPaths: ui }).verdict).toBe('skip');
  });
  it('implicit app surface when uiSurfaces absent', () => {
    const v = sessionUiVerdict({}, hit, { uiPaths: ui });
    expect(v.affectedSurfaces).toEqual(['app']);
  });
  it('config gap: matching path with no surface entry → unmappedPaths, still required', () => {
    const v = sessionUiVerdict({}, hit, {
      uiPaths: ['src/dashboard/app/**'],
      uiSurfaces: { other: ['src/other/**'] },
    });
    expect(v.verdict).toBe('required');
    expect(v.affectedSurfaces).toEqual([]);
    expect(v.unmappedPaths).toEqual(hit);
  });
  it('multi-surface: paths spanning two surfaces affect both, sorted', () => {
    const v = sessionUiVerdict({}, ['src/a/x.tsx', 'src/b/y.tsx'], {
      uiPaths: ['src/a/**', 'src/b/**'],
      uiSurfaces: { beta: ['src/b/**'], alpha: ['src/a/**'] },
    });
    expect(v.affectedSurfaces).toEqual(['alpha', 'beta']);
  });
});
