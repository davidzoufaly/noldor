// @tests: root-readme-content-validator
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  checkReadme,
  enumerateDocSurfaces,
  reachableTargets,
  unreachableSurfaces,
} from '../readme-content.js';

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
    expect((await enumerateDocSurfaces(root)).surfaces).toEqual(['docs/adr', 'docs/architecture']);
  });

  it('finds markdown nested any depth down', async () => {
    const root = await makeRepo();
    await write(root, 'docs/user/how-to/index.md', '# h');
    expect((await enumerateDocSurfaces(root)).surfaces).toEqual(['docs/user']);
  });

  it('excludes the artifact dirs and dirs with no markdown', async () => {
    const root = await makeRepo();
    await write(root, 'docs/features/a.md', '# a');
    await write(root, 'docs/design/specs/b.md', '# b');
    await write(root, 'docs/assets/logo.png', 'binary');
    await write(root, 'docs/noldor/README.md', '# n');
    expect((await enumerateDocSurfaces(root)).surfaces).toEqual(['docs/noldor']);
  });

  it('excludes the pre-1.0.0 superpowers artifact dir', async () => {
    const root = await makeRepo();
    await write(root, 'docs/superpowers/specs/b.md', '# b');
    await write(root, 'docs/noldor/README.md', '# n');
    expect((await enumerateDocSurfaces(root)).surfaces).toEqual(['docs/noldor']);
  });

  it('ignores a markdown file sitting directly in docs/', async () => {
    const root = await makeRepo();
    await write(root, 'docs/vision.md', '# v');
    expect((await enumerateDocSurfaces(root)).surfaces).toEqual([]);
  });

  it('returns empty when docs/ is absent', async () => {
    expect((await enumerateDocSurfaces(await makeRepo())).surfaces).toEqual([]);
  });
});

describe('unreachableSurfaces', () => {
  const empty = {
    files: new Set<string>(),
    dirs: new Set<string>(),
    notes: [],
    readme: 'ok' as const,
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

describe('reachableTargets', () => {
  it('follows a multi-hop route and terminates on a cycle', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', '[hub](docs/noldor/README.md)');
    await write(root, 'docs/noldor/README.md', '[t](triage.md) [back](../../README.md)');
    await write(root, 'docs/noldor/triage.md', '[h](../user/how-to/index.md)');
    await write(root, 'docs/user/how-to/index.md', '# how-to');
    const reached = await reachableTargets(root);
    expect(reached.files.has('docs/user/how-to/index.md')).toBe(true);
    expect(reached.notes).toEqual([]);
    expect(reached.readme).toBe('ok');
  });

  it('records a directory target in dirs and does not descend', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', '[adrs](docs/adr/)');
    await write(root, 'docs/adr/0001-x.md', '# x');
    const reached = await reachableTargets(root);
    expect([...reached.dirs]).toEqual(['docs/adr']);
    expect(reached.files.has('docs/adr/0001-x.md')).toBe(false);
  });

  it('ignores prose backticks, and strips fragments and queries', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', 'see `docs/adr/` then [a](docs/architecture/context.md#top)');
    await write(root, 'docs/architecture/context.md', '# c');
    const reached = await reachableTargets(root);
    expect(reached.dirs.size).toBe(0);
    expect(reached.files.has('docs/architecture/context.md')).toBe(true);
  });

  it('does not record a non-markdown target', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', '![logo](docs/assets/logo.png)');
    await write(root, 'docs/assets/logo.png', 'binary');
    const reached = await reachableTargets(root);
    expect(reached.files.size).toBe(0);
    expect(reached.dirs.size).toBe(0);
  });

  it('notes a malformed percent-escape instead of throwing', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', '[bad](docs/a%zz.md)');
    const reached = await reachableTargets(root);
    expect(reached.notes).toHaveLength(1);
    expect(reached.notes[0]).toContain('malformed percent-escape');
  });

  it('is silent on a broken link and drops a repo-escaping target', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', '[gone](docs/nope.md) [out](../escape.md)');
    const reached = await reachableTargets(root);
    expect(reached.files.size).toBe(0);
    expect(reached.notes).toEqual([]);
  });

  it('reports a missing README once, with no note', async () => {
    const reached = await reachableTargets(await makeRepo());
    expect(reached.readme).toBe('missing');
    expect(reached.files.size).toBe(0);
    expect(reached.notes).toEqual([]);
  });
});

describe('checkReadme', () => {
  it('is absent when there is no README', async () => {
    const report = await checkReadme(await makeRepo());
    expect(report.status).toBe('absent');
    expect(report.findings).toEqual([]);
  });

  it('is ok when every surface is reached', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', '[a](docs/adr/)');
    await write(root, 'docs/adr/0001-x.md', '# x');
    const report = await checkReadme(root);
    expect(report.status).toBe('ok');
    expect(report.findings).toEqual([]);
  });

  it('reports an unreached surface', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', 'nothing linked');
    await write(root, 'docs/architecture/context.md', '# c');
    const report = await checkReadme(root);
    expect(report.status).toBe('findings');
    expect(report.findings[0]?.message).toContain('docs/architecture');
  });

  it('surfaces walk notes without changing status', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', '[bad](docs/a%zz.md)');
    const report = await checkReadme(root);
    expect(report.notes).toHaveLength(1);
    expect(report.notes[0]).toContain('malformed percent-escape');
    expect(report.status).toBe('ok');
  });
});

describe('carved-out and repaired behaviours', () => {
  it('excludes docs/milestones, which holds one file per milestone', async () => {
    const root = await makeRepo();
    await write(root, 'docs/milestones/mvp.md', '# mvp');
    await write(root, 'docs/noldor/README.md', '# n');
    expect((await enumerateDocSurfaces(root)).surfaces).toEqual(['docs/noldor']);
  });

  it('a directory link INTO a surface satisfies that surface', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', '[diagrams](docs/architecture/diagrams/)');
    await write(root, 'docs/architecture/diagrams/c4.md', '# c4');
    const report = await checkReadme(root);
    expect(report.status).toBe('ok');
    expect(report.findings).toEqual([]);
  });

  it('an absent docs/ is silent, not a note', async () => {
    const scan = await enumerateDocSurfaces(await makeRepo());
    expect(scan.surfaces).toEqual([]);
    expect(scan.notes).toEqual([]);
  });

  it('a docs path that is a file, not a directory, becomes a note', async () => {
    const root = await makeRepo();
    await write(root, 'docs', 'not a directory');
    const scan = await enumerateDocSurfaces(root);
    expect(scan.surfaces).toEqual([]);
    expect(scan.notes).toHaveLength(1);
    expect(scan.notes[0]).toContain('cannot walk docs/');
  });
});
