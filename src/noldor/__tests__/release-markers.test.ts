// @tests: noldor
import { describe, it, expect } from 'vitest';

import { fillNoldorMarker } from '../release-markers.js';

describe('fillNoldorMarker', () => {
  it('fills introduced when missing', () => {
    const md = `---
noldor-page: workflow
---

# Workflow
`;
    const result = fillNoldorMarker(md, '0.4.0');
    expect(result).toContain('introduced: 0.4.0');
  });

  it('does not touch introduced when already set', () => {
    const md = `---
noldor-page: workflow
introduced: 0.3.0
---
`;
    const result = fillNoldorMarker(md, '0.4.0');
    expect(result).toContain('introduced: 0.3.0');
    expect(result).not.toContain('introduced: 0.4.0');
  });

  it('returns input unchanged when introduced already set', () => {
    const md = `---
noldor-page: workflow
introduced: 0.3.0
---

content
`;
    expect(fillNoldorMarker(md, '0.4.0')).toBe(md);
  });

  it('does NOT add updated field on subsequent releases', () => {
    const md = `---
noldor-page: workflow
introduced: 0.3.0
---
`;
    const result = fillNoldorMarker(md, '0.4.0');
    expect(result).not.toContain('updated:');
  });
});
