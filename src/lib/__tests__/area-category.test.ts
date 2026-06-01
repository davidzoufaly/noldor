// @tests: dashboard-roadmap-backlog-polish

import { describe, expect, it } from 'vitest';

import { areaToCategory } from '../area-category.js';

describe('areaToCategory', () => {
  // The area→category map is consumer-owned (`.noldor/config.json` →
  // areaCategories). Tests pass an explicit map so they don't depend on the
  // repo's live config, and pin the `Other` fallback contract.
  it('maps an area to its configured category', () => {
    const map = { tooling: 'Tooling', core: 'Core', docs: 'Tooling' };
    expect(areaToCategory('tooling', map)).toBe('Tooling');
    expect(areaToCategory('core', map)).toBe('Core');
    expect(areaToCategory('docs', map)).toBe('Tooling');
  });

  it('falls back to Other for unmapped areas', () => {
    const map = { tooling: 'Tooling' };
    expect(areaToCategory('quux', map)).toBe('Other');
    expect(areaToCategory('', map)).toBe('Other');
  });

  it('falls back to Other when the map is empty', () => {
    expect(areaToCategory('anything', {})).toBe('Other');
  });
});
