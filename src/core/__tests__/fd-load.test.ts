import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  extractSummary,
  listDirIfExists,
  loadSddFeatures,
  parseFdFrontmatter,
  readFileIfExists,
  readFrontmatter,
} from '../fd-load.js';

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

describe(readFrontmatter, () => {
  it('returns the parsed data and content for well-formed frontmatter', () => {
    const parsed = readFrontmatter('---\nname: Foo\n---\n\nbody\n');
    expect(parsed).toMatchObject({ data: { name: 'Foo' }, ok: true });
  });

  it('reports broken YAML instead of throwing', () => {
    const parsed = readFrontmatter('---\nname: [unclosed\n---\n\nbody\n');
    expect(parsed.ok).toBe(false);
  });

  it('reports the same broken YAML on every call', () => {
    // gray-matter caches the file object BEFORE parsing, so an unguarded second
    // matter() call on the same broken string returns empty data instead of
    // throwing — this function must not inherit that.
    const raw = '---\nname: {still: broken\n---\n\nbody\n';
    expect(readFrontmatter(raw).ok).toBe(false);
    expect(readFrontmatter(raw).ok).toBe(false);
  });
});

describe(parseFdFrontmatter, () => {
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

  it('returns the validated frontmatter for a well-formed FD', () => {
    expect(parseFdFrontmatter(VALID)).toMatchObject({ name: 'Valid', phase: 'in-progress' });
  });

  it('returns null for broken YAML and for a schema mismatch alike', () => {
    expect(parseFdFrontmatter('---\nname: [unclosed\n---\n')).toBeNull();
    expect(parseFdFrontmatter(VALID.replace('in-progress', 'not-a-phase'))).toBeNull();
  });
});

describe('ENOENT-tolerant IO helpers', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fd-io-'));
  });
  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it('readFileIfExists returns contents, or null for a missing file', async () => {
    await writeFile(join(dir, 'there.md'), 'hi\n');

    expect(await readFileIfExists(join(dir, 'there.md'))).toBe('hi\n');
    expect(await readFileIfExists(join(dir, 'gone.md'))).toBeNull();
  });

  it('readFileIfExists propagates a non-ENOENT failure instead of masking it', async () => {
    // A directory read as a file is EISDIR — the class that must never look
    // like "nothing to process".
    await expect(readFileIfExists(dir)).rejects.toThrow();
  });

  it('listDirIfExists lists entries, or returns [] for a missing directory', async () => {
    await writeFile(join(dir, 'a.md'), 'a\n');

    expect(await listDirIfExists(dir)).toEqual(['a.md']);
    expect(await listDirIfExists(join(dir, 'nope'))).toEqual([]);
  });
});
