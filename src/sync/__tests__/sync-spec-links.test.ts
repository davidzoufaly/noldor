// @tests: feature-md-links-overhaul
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import matter from 'gray-matter';

import { collectTaggedSpecs, updateFeatureMd } from '../sync-spec-links.js';

describe(collectTaggedSpecs, () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spec-links-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('extracts the feature slug from each spec filename', async () => {
    await writeFile(join(dir, '2026-04-15-editor-shell-design.md'), '');
    await writeFile(join(dir, '2026-04-14-engine-design.md'), '');
    const specs = await collectTaggedSpecs(dir);
    expect(specs.map((s) => s.slug).toSorted()).toStrictEqual(['editor-shell', 'engine']);
  });

  it('returns an empty array when the directory is missing', async () => {
    const specs = await collectTaggedSpecs(join(dir, 'missing'));
    expect(specs).toStrictEqual([]);
  });

  it('skips non-markdown files', async () => {
    await writeFile(join(dir, '2026-04-15-editor-shell-design.md'), '');
    await writeFile(join(dir, 'README.txt'), '');
    const specs = await collectTaggedSpecs(dir);
    expect(specs).toHaveLength(1);
  });

  it('returns paths joined with the input directory', async () => {
    await writeFile(join(dir, '2026-04-14-engine-design.md'), '');
    const specs = await collectTaggedSpecs(dir);
    expect(specs[0]?.path).toBe(join(dir, '2026-04-14-engine-design.md'));
  });
});

describe(updateFeatureMd, () => {
  let dir: string;
  let mdPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spec-links-md-'));
    await mkdir(join(dir, 'docs', 'features'), { recursive: true });
    mdPath = join(dir, 'docs', 'features', 'foo.md');
    const fm = `---
name: Foo
phase: done
area: tooling
category: Tooling
packages:
  - scripts
deps: []
links:
  commits: []
  code: []
  tests: []
---

## Summary

Body.
`;
    await writeFile(mdPath, fm);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes links.spec when the field is missing', async () => {
    const changed = await updateFeatureMd(mdPath, 'docs/superpowers/specs/foo.md');
    expect(changed).toBe(true);
    const after = matter(await readFile(mdPath, 'utf8')).data as { links: { spec: string } };
    expect(after.links.spec).toBe('docs/superpowers/specs/foo.md');
  });

  it('returns false when links.spec already matches', async () => {
    await updateFeatureMd(mdPath, 'docs/superpowers/specs/foo.md');
    const changed = await updateFeatureMd(mdPath, 'docs/superpowers/specs/foo.md');
    expect(changed).toBe(false);
  });

  it('overwrites a stale links.spec value', async () => {
    await updateFeatureMd(mdPath, 'docs/superpowers/specs/old.md');
    const changed = await updateFeatureMd(mdPath, 'docs/superpowers/specs/new.md');
    expect(changed).toBe(true);
    const after = matter(await readFile(mdPath, 'utf8')).data as { links: { spec: string } };
    expect(after.links.spec).toBe('docs/superpowers/specs/new.md');
  });
});
