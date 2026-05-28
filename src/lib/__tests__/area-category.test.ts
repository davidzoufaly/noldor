// @tests: dashboard-roadmap-backlog-polish

import { describe, expect, it } from 'vitest';

import { areaToCategory } from '../area-category.js';

describe('areaToCategory', () => {
  // Source of truth for the area→category mapping lives in
  // packages/noldor/src/lib/area-category.ts; tests pin every documented area so a
  // future edit can't silently drift away from the promote skill prompt.
  it('maps engine and format to Modeling', () => {
    expect(areaToCategory('engine')).toBe('Modeling');
    expect(areaToCategory('format')).toBe('Modeling');
  });

  it('maps viewport, web, and ui to Editor', () => {
    expect(areaToCategory('viewport')).toBe('Editor');
    expect(areaToCategory('web')).toBe('Editor');
    expect(areaToCategory('ui')).toBe('Editor');
  });

  it('maps agent-api to Agents', () => {
    expect(areaToCategory('agent-api')).toBe('Agents');
  });

  it('maps branding, business, and release to Distribution', () => {
    expect(areaToCategory('branding')).toBe('Distribution');
    expect(areaToCategory('business')).toBe('Distribution');
    expect(areaToCategory('release')).toBe('Distribution');
  });

  it('maps docs to Docs', () => {
    expect(areaToCategory('docs')).toBe('Docs');
  });

  it('maps tooling, testing, and cross-cutting to Tooling', () => {
    expect(areaToCategory('tooling')).toBe('Tooling');
    expect(areaToCategory('testing')).toBe('Tooling');
    expect(areaToCategory('cross-cutting')).toBe('Tooling');
  });

  it('falls back to Other for unknown areas', () => {
    expect(areaToCategory('quux')).toBe('Other');
    expect(areaToCategory('')).toBe('Other');
  });
});
