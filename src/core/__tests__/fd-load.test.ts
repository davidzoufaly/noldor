import { describe, expect, it } from 'vitest';

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractSummary, loadSddFeatures } from '../fd-load.js';

// @tests: sdd-detector-5-idea-merge-semantic-similarity
describe(extractSummary, () => {
  it('returns the trimmed Summary body', () => {
    const md = `---\nname: X\n---\n\n## Summary\n\nHello world.\n\n## Usage\n\nsteps`;
    expect(extractSummary(md)).toBe('Hello world.');
  });

  it('returns empty string when no Summary section exists', () => {
    expect(extractSummary(`## Usage\n\nx`)).toBe('');
  });

  it('captures a multi-paragraph Summary up to the next H2', () => {
    const md = `## Summary\n\nPara one.\n\nPara two.\n\n## Usage\n\nx`;
    expect(extractSummary(md)).toBe('Para one.\n\nPara two.');
  });

  it('captures a Summary at end-of-file (no trailing H2)', () => {
    expect(extractSummary(`## Summary\n\nOnly section.`)).toBe('Only section.');
  });
});

describe(loadSddFeatures, () => {
  const VALID = `---
name: Valid
phase: in-progress
area: tooling
category: Tooling
packages: ['@acme/web']
'noldor-tier': specs-only
links:
  code: []
  tests: []
  docs: []
---

body
`;

  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fd-load-'));
    await mkdir(dir, { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it('returns one record per parseable feature MD', async () => {
    await writeFile(join(dir, 'valid.md'), VALID);

    const records = await loadSddFeatures(dir);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ frontmatter: { name: 'Valid' }, slug: 'valid' });
  });

  it('skips a malformed FD instead of aborting the whole corpus pass', async () => {
    // One bad file used to throw out of every caller — sdd-report, the
    // dashboard loader and `garden detect` through it. `features validate` and
    // garden's malformed-fd gap are what report the bad file.
    await writeFile(join(dir, 'valid.md'), VALID);
    await writeFile(join(dir, 'bad-phase.md'), VALID.replace('in-progress', 'not-a-phase'));
    await writeFile(join(dir, 'broken-yaml.md'), '---\nname: [unclosed\n---\n');

    const records = await loadSddFeatures(dir);
    expect(records.map((r) => r.slug)).toEqual(['valid']);
  });

  it('returns an empty array when the directory is absent', async () => {
    await rm(dir, { force: true, recursive: true });

    expect(await loadSddFeatures(dir)).toEqual([]);
  });
});
