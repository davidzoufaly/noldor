// @tests: root-readme-content-validator
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { enumerateDocSurfaces, unreachableSurfaces } from '../readme-content.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'readme-'));
  roots.push(root);
  return root;
}

async function write(root: string, rel: string, body: string): Promise<void> {
  const abs = join(root, rel);
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, body, 'utf8');
}

describe('enumerateDocSurfaces', () => {
  it('returns depth-1 docs dirs holding markdown, sorted', async () => {
    const root = await makeRepo();
    await write(root, 'docs/adr/0001-x.md', '# x');
    await write(root, 'docs/architecture/context.md', '# c');
    expect(await enumerateDocSurfaces(root)).toEqual(['docs/adr', 'docs/architecture']);
  });

  it('finds markdown nested any depth down', async () => {
    const root = await makeRepo();
    await write(root, 'docs/user/how-to/index.md', '# h');
    expect(await enumerateDocSurfaces(root)).toEqual(['docs/user']);
  });

  it('excludes the artifact dirs and dirs with no markdown', async () => {
    const root = await makeRepo();
    await write(root, 'docs/features/a.md', '# a');
    await write(root, 'docs/design/specs/b.md', '# b');
    await write(root, 'docs/assets/logo.png', 'binary');
    await write(root, 'docs/noldor/README.md', '# n');
    expect(await enumerateDocSurfaces(root)).toEqual(['docs/noldor']);
  });

  it('excludes the pre-1.0.0 superpowers artifact dir', async () => {
    const root = await makeRepo();
    await write(root, 'docs/superpowers/specs/b.md', '# b');
    await write(root, 'docs/noldor/README.md', '# n');
    expect(await enumerateDocSurfaces(root)).toEqual(['docs/noldor']);
  });

  it('ignores a markdown file sitting directly in docs/', async () => {
    const root = await makeRepo();
    await write(root, 'docs/vision.md', '# v');
    expect(await enumerateDocSurfaces(root)).toEqual([]);
  });

  it('returns empty when docs/ is absent', async () => {
    expect(await enumerateDocSurfaces(await makeRepo())).toEqual([]);
  });
});

describe('unreachableSurfaces', () => {
  const empty = {
    files: new Set<string>(),
    dirs: new Set<string>(),
    notes: [],
    readme: 'ok' as const,
    body: '',
  };

  it('reports a surface nothing reaches', () => {
    expect(unreachableSurfaces(['docs/adr'], empty)).toEqual(['docs/adr']);
  });

  it('a directory-target link satisfies the surface', () => {
    const reached = { ...empty, dirs: new Set(['docs/adr']) };
    expect(unreachableSurfaces(['docs/adr'], reached)).toEqual([]);
  });

  it('a markdown file at any depth beneath satisfies the surface', () => {
    const reached = { ...empty, files: new Set(['docs/user/how-to/index.md']) };
    expect(unreachableSurfaces(['docs/user'], reached)).toEqual([]);
  });

  it('a sibling prefix match does not satisfy the surface', () => {
    const reached = { ...empty, files: new Set(['docs/adr-notes/x.md']) };
    expect(unreachableSurfaces(['docs/adr'], reached)).toEqual(['docs/adr']);
  });
});
