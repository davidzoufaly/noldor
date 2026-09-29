// @tests: noldor, framework-script-test-migration-cleanup
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fillAllNoldorMarkers, fillNoldorMarker } from '../release-markers.js';

const UNSTAMPED = `---
noldor-page: new-page
---

# New page
`;

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

describe('fillAllNoldorMarkers', () => {
  it('stamps a page and its templates twin to identical bytes', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'noldor-markers-'));
    for (const dir of ['docs/noldor', 'templates/docs/noldor']) {
      mkdirSync(join(cwd, dir), { recursive: true });
      writeFileSync(join(cwd, dir, 'new-page.md'), UNSTAMPED);
    }

    const touched = await fillAllNoldorMarkers('1.15.0', cwd);

    expect(touched).toEqual(['docs/noldor/new-page.md', 'templates/docs/noldor/new-page.md']);
    const page = readFileSync(join(cwd, 'docs/noldor/new-page.md'), 'utf8');
    expect(page).toContain('introduced: 1.15.0');
    expect(readFileSync(join(cwd, 'templates/docs/noldor/new-page.md'), 'utf8')).toBe(page);
  });

  it('stamps docs/noldor alone when the repo has no templates tree', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'noldor-markers-'));
    mkdirSync(join(cwd, 'docs/noldor'), { recursive: true });
    writeFileSync(join(cwd, 'docs/noldor/new-page.md'), UNSTAMPED);

    expect(await fillAllNoldorMarkers('1.15.0', cwd)).toEqual(['docs/noldor/new-page.md']);
  });
});
