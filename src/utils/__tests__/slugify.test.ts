// @tests: dashboard-roadmap-drag-drop
import { slugify } from '../slugify.js';

describe(slugify, () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('replaces slashes with hyphens', () => {
    expect(slugify('Undo/Redo')).toBe('undo-redo');
  });

  it('strips backticks, colons, apostrophes', () => {
    expect(slugify('Path 2: Explicit `- priority:` Field')).toBe('path-2-explicit-priority-field');
  });

  it('collapses multi-hyphen runs and strips leading/trailing hyphens', () => {
    expect(slugify('  ---weird---name---  ')).toBe('weird-name');
  });

  it('returns empty string when input has no slug-safe characters', () => {
    expect(slugify('!!!')).toBe('');
  });
});
