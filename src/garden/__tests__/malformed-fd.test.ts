// @tests: doc-gardening-skill
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { detectMalformedFds } from '../detectors/malformed-fd.js';

const VALID_FD = `---
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

describe(detectMalformedFds, () => {
  let repo: string;
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'malformed-fd-'));
    await mkdir(join(repo, 'docs/features'), { recursive: true });
  });
  afterEach(async () => {
    await rm(repo, { force: true, recursive: true });
  });

  it('reports nothing when every FD parses', async () => {
    await writeFile(join(repo, 'docs/features/valid.md'), VALID_FD);

    expect(await detectMalformedFds(repo)).toEqual([]);
  });

  it('reports one gap per unparseable FD, naming the repo-relative path', async () => {
    await writeFile(join(repo, 'docs/features/valid.md'), VALID_FD);
    await writeFile(join(repo, 'docs/features/no-frontmatter.md'), 'just prose\n');
    await writeFile(
      join(repo, 'docs/features/bad-phase.md'),
      VALID_FD.replace('phase: in-progress', 'phase: not-a-real-phase'),
    );

    const gaps = await detectMalformedFds(repo);
    expect(gaps.map((g) => g.itemId)).toEqual([
      join('docs/features', 'bad-phase.md'),
      join('docs/features', 'no-frontmatter.md'),
    ]);
    expect(gaps[0].category).toBe('malformed-fd');
    expect(gaps[0].message).toContain('unknown phase');
  });

  it('ignores non-markdown files', async () => {
    await writeFile(join(repo, 'docs/features/notes.txt'), 'not an FD\n');

    expect(await detectMalformedFds(repo)).toEqual([]);
  });

  it('reports nothing when the features directory is absent', async () => {
    await rm(join(repo, 'docs/features'), { force: true, recursive: true });

    expect(await detectMalformedFds(repo)).toEqual([]);
  });
});
