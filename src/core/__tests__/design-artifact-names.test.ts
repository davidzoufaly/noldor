// @tests: pendev-ui-design-phase
import { describe, expect, it } from 'vitest';

import { penFileName, penSlugFromFilename } from '../design-artifact-names.js';

describe('pen artifact names', () => {
  it('parses the key from a feature pen filename', () => {
    expect(penSlugFromFilename('2026-08-19-pendev-ui-design-phase.pen')).toBe(
      'pendev-ui-design-phase',
    );
  });
  it('returns null for non-pen and undated names', () => {
    expect(penSlugFromFilename('baseline.pen')).toBeNull();
    expect(penSlugFromFilename('2026-08-19-foo.md')).toBeNull();
  });
  it('builds the canonical feature pen filename', () => {
    expect(penFileName('2026-08-19', 'parent-enh')).toBe('2026-08-19-parent-enh.pen');
  });
});
