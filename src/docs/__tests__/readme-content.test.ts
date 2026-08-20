// @tests: root-readme-content-validator
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  checkReadme,
  enumerateDocSurfaces,
  parseReadmeCommands,
  reachableTargets,
  resolveCommands,
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

  it('carries the seed body so no caller re-reads it', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', '# seed body');
    const reached = await reachableTargets(root);
    expect(reached.body).toBe('# seed body');
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
    expect(reached.body).toBe('');
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
    // A readable package.json isolates the walk's note from the script-source one.
    await write(root, 'package.json', '{"scripts":{}}');
    const report = await checkReadme(root);
    expect(report.notes).toHaveLength(1);
    expect(report.notes[0]).toContain('malformed percent-escape');
    expect(report.status).toBe('ok');
  });
});

describe('parseReadmeCommands', () => {
  it('reads fenced and inline commands, keeping only pnpm', () => {
    const cmds = parseReadmeCommands(
      ['```bash', 'pnpm noldor doctor', 'node bin/x.mjs', '```', 'run `pnpm test` now'].join('\n'),
    );
    expect(cmds.map((c) => c.argv.join(' '))).toEqual(['pnpm noldor doctor', 'pnpm test']);
    expect(cmds[0]?.line).toBe(2);
    expect(cmds[1]?.line).toBe(5);
  });

  it('strips a prompt prefix and a trailing comment', () => {
    const cmds = parseReadmeCommands(
      ['```bash', '$ pnpm noldor init  # scaffold', '```'].join('\n'),
    );
    expect(cmds).toHaveLength(1);
    expect(cmds[0]?.argv).toEqual(['pnpm', 'noldor', 'init']);
  });

  it('splits on shell operators', () => {
    const cmds = parseReadmeCommands(['```bash', 'pnpm build && pnpm test', '```'].join('\n'));
    expect(cmds.map((c) => c.argv.join(' '))).toEqual(['pnpm build', 'pnpm test']);
  });

  it('joins a backslash continuation and attributes the first line', () => {
    const cmds = parseReadmeCommands(['```bash', 'pnpm noldor \\', '  doctor', '```'].join('\n'));
    expect(cmds).toHaveLength(1);
    expect(cmds[0]?.argv).toEqual(['pnpm', 'noldor', 'doctor']);
    expect(cmds[0]?.line).toBe(2);
  });

  it('drops a command carrying a placeholder token', () => {
    const cmds = parseReadmeCommands(
      ['```bash', 'pnpm noldor cr orchestrate --slug <slug>', '```'].join('\n'),
    );
    expect(cmds).toEqual([]);
  });
});

describe('resolveCommands', () => {
  const manifest = new Set(['doctor', 'init', 'docs architecture', 'validate features']);
  const scripts = new Set(['test', 'build']);
  const parse = (body: string) => parseReadmeCommands(['```bash', body, '```'].join('\n'));

  it('accepts a leaf group, a group with a sub, and a known script', () => {
    expect(resolveCommands(parse('pnpm noldor doctor'), manifest, scripts)).toEqual([]);
    expect(resolveCommands(parse('pnpm noldor docs architecture'), manifest, scripts)).toEqual([]);
    expect(resolveCommands(parse('pnpm test'), manifest, scripts)).toEqual([]);
  });

  it('skips flag tokens wherever they sit', () => {
    expect(
      resolveCommands(parse('pnpm noldor docs architecture --check'), manifest, scripts),
    ).toEqual([]);
    expect(resolveCommands(parse('pnpm noldor --help'), manifest, scripts)).toEqual([]);
  });

  it('reports a bad subcommand but treats a leaf group extra token as positional', () => {
    const bad = resolveCommands(parse('pnpm noldor docs typo'), manifest, scripts);
    expect(bad).toHaveLength(1);
    expect(bad[0]?.message).toContain('docs typo');
    expect(resolveCommands(parse('pnpm noldor doctor extra'), manifest, scripts)).toEqual([]);
  });

  it('validates pnpm run and ignores package-manager passthrough verbs', () => {
    const bad = resolveCommands(parse('pnpm run nope'), manifest, scripts);
    expect(bad).toHaveLength(1);
    expect(bad[0]?.message).toContain('nope');
    expect(resolveCommands(parse('pnpm add -D @scope/pkg'), manifest, scripts)).toEqual([]);
    expect(resolveCommands(parse('pnpm install'), manifest, scripts)).toEqual([]);
  });

  it('reports every quoted script when scripts is empty but skips when it is null', () => {
    expect(resolveCommands(parse('pnpm test'), manifest, new Set())).toHaveLength(1);
    expect(resolveCommands(parse('pnpm test'), manifest, null)).toEqual([]);
  });

  it('deduplicates a command quoted more than once, citing the first line', () => {
    const body = ['```bash', 'pnpm noldor docs typo', 'pnpm noldor docs typo', '```'].join('\n');
    const found = resolveCommands(parseReadmeCommands(body), manifest, scripts);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('README.md:2');
  });
});

describe('checkReadme command half', () => {
  it('reports a quoted command that does not resolve', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', '`pnpm noldor nosuchgroup`');
    await write(root, 'package.json', '{}');
    const report = await checkReadme(root);
    expect(report.status).toBe('findings');
    expect(report.findings[0]?.message).toContain('nosuchgroup');
  });

  it('notes an unreadable package.json and still checks surfaces', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', '`pnpm test`');
    await write(root, 'package.json', 'not json');
    const report = await checkReadme(root);
    expect(report.notes.some((n) => n.includes('package.json'))).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.status).toBe('ok');
  });

  it('reports a quoted script when package.json declares none', async () => {
    const root = await makeRepo();
    await write(root, 'README.md', '`pnpm test`');
    await write(root, 'package.json', '{}');
    const report = await checkReadme(root);
    expect(report.status).toBe('findings');
    expect(report.findings[0]?.message).toContain('pnpm test');
  });
});
