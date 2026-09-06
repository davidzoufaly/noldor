import { describe, expect, it } from 'vitest';

import { resolveAttachMilestone } from '../attach-milestone.js';

// @tests: decouple-milestones-from-semver

describe(resolveAttachMilestone, () => {
  it('adopts when the entry declares a milestone and the parent does not', () => {
    expect(resolveAttachMilestone('mvp', undefined)).toBe('adopt');
  });

  it('is a noop when both name the same milestone', () => {
    expect(resolveAttachMilestone('mvp', 'mvp')).toBe('noop');
  });

  it('conflicts when the two differ', () => {
    expect(resolveAttachMilestone('mvp', 'public-beta')).toBe('conflict');
  });

  // An entry with nothing to say can never conflict, whatever the parent holds
  // — the parent's own assignment is none of the attach's business.
  it('is a noop whenever the entry declares nothing', () => {
    expect(resolveAttachMilestone(undefined, undefined)).toBe('noop');
    expect(resolveAttachMilestone(undefined, 'mvp')).toBe('noop');
  });
});
