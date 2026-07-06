import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildMergeCandidates } from '../merge-candidates.js';

// @tests: sdd-detector-5-idea-merge-semantic-similarity

const FD_FOO = `---
area: tooling
category: Tooling
deps: []
links:
  code: []
  tests: []
name: Foo Feature
packages:
  - scripts
phase: done
noldor-tier: specs-only
---

## Summary

Foo does things.

## Usage

Run foo.
`;

const FD_BAR = `---
area: tooling
category: Tooling
deps: []
links:
  code: []
  tests: []
name: Bar Feature
packages:
  - scripts
phase: in-progress
noldor-tier: specs-only
---

## Usage

Run bar.
`;

const ROADMAP = `# Roadmap

### Some Roadmap Thing

- id: Q-9001
- area: tooling
- type: feat
- size: M
- impact: med

A roadmap thing that does stuff.

### !!!

- area: tooling

Punctuation-only heading — slugifies to empty, must be filtered out.
`;

const BACKLOG = `# Backlog

### Some Backlog Item

- id: Q-9002
- area: tooling
- type: feat

A parked idea.
`;

let root: string;

async function write(rel: string, body: string): Promise<void> {
  const p = join(root, rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, body, 'utf8');
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'merge-cand-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe(buildMergeCandidates, () => {
  it('enumerates FDs + roadmap + backlog with correct kinds and dispositions', async () => {
    await write('docs/features/foo.md', FD_FOO);
    await write('docs/features/bar.md', FD_BAR);
    await write('docs/roadmap.md', ROADMAP);
    await write('docs/backlog.md', BACKLOG);

    const out = await buildMergeCandidates(root);
    const bySlug = Object.fromEntries(out.map((c) => [c.slug, c]));

    // 2 features + 1 roadmap + 1 backlog = 4 (empty-slug '!!!' excluded)
    expect(out).toHaveLength(4);
    expect(bySlug['foo']).toMatchObject({
      kind: 'feature',
      disposition: 'parent',
      summary: 'Foo does things.',
      phase: 'done',
    });
    expect(bySlug['bar']).toMatchObject({ kind: 'feature', disposition: 'parent', summary: '' });
    expect(bySlug['some-roadmap-thing']).toMatchObject({
      kind: 'roadmap',
      disposition: 'merge',
      id: 'Q-9001',
      summary: 'A roadmap thing that does stuff.',
    });
    expect(bySlug['some-backlog-item']).toMatchObject({
      kind: 'backlog',
      disposition: 'merge',
      id: 'Q-9002',
    });
  });

  it('excludes empty-slug entries (all-punctuation headings)', async () => {
    await write('docs/roadmap.md', ROADMAP);
    const out = await buildMergeCandidates(root);
    expect(out.every((c) => c.slug.length > 0)).toBe(true);
  });

  it('treats a missing roadmap/backlog file as empty (no throw)', async () => {
    await write('docs/features/foo.md', FD_FOO);
    // no roadmap.md, no backlog.md written
    const out = await buildMergeCandidates(root);
    expect(out.map((c) => c.kind)).toStrictEqual(['feature']);
  });
});
