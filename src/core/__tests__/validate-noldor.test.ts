// @tests: noldor
import { describe, it, expect } from 'vitest';

import { validateNoldorPage } from '../validate-noldor.js';

describe('validateNoldorPage', () => {
  it('passes when slug matches filename stem', () => {
    const md = `---
noldor-page: workflow
---

# Workflow
`;
    const result = validateNoldorPage('docs/noldor/workflow.md', md);
    expect(result.success).toBe(true);
  });

  it('passes README.md special case (slug = index)', () => {
    const md = `---
noldor-page: index
---

# Noldor
`;
    const result = validateNoldorPage('docs/noldor/README.md', md);
    expect(result.success).toBe(true);
  });

  it('fails when slug does not match filename', () => {
    const md = `---
noldor-page: workflow
---
`;
    const result = validateNoldorPage('docs/noldor/lifecycle.md', md);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes('does not match filename stem'))).toBe(true);
  });

  it('fails when frontmatter is missing', () => {
    const md = '# Noldor';
    const result = validateNoldorPage('docs/noldor/foo.md', md);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/missing frontmatter/);
  });

  it('fails when noldor-page field is absent', () => {
    const md = `---
some-other-field: value
---
`;
    const result = validateNoldorPage('docs/noldor/foo.md', md);
    expect(result.success).toBe(false);
  });

  it('rejects unknown frontmatter fields', () => {
    const md = `---
noldor-page: workflow
introduced: 0.4.0
phase: in-progress
---
`;
    const result = validateNoldorPage('docs/noldor/workflow.md', md);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown field'))).toBe(true);
  });

  it('accepts optional introduced field with valid semver', () => {
    const md = `---
noldor-page: workflow
introduced: 0.4.0
---
`;
    const result = validateNoldorPage('docs/noldor/workflow.md', md);
    expect(result.success).toBe(true);
  });

  it('rejects malformed semver in introduced', () => {
    const md = `---
noldor-page: workflow
introduced: not-a-version
---
`;
    const result = validateNoldorPage('docs/noldor/workflow.md', md);
    expect(result.success).toBe(false);
  });
});
