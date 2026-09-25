// @tests: self-refreshing-compact-knowledge-graph
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { type BuildDeps, main, OUTPUTS, spawnRunner } from '../build.js';

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function fixtureRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'graphify-build-e2e-'));
  scratch.push(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 'T');
  mkdirSync(join(repo, 'src'));
  writeFileSync(
    join(repo, 'src/greet.ts'),
    'export function greet(name: string): string {\n  return `hello ${name}`;\n}\n',
  );
  writeFileSync(
    join(repo, 'src/main.ts'),
    "import { greet } from './greet.js';\n\nexport function run(): string {\n  return greet('world');\n}\n",
  );
  writeFileSync(
    join(repo, 'src/tool.py'),
    'def shout(text):\n    return text.upper()\n\n\ndef main():\n    return shout("hi")\n',
  );
  writeFileSync(
    join(repo, 'README.md'),
    '# Notes\n\n## Usage\n\nProse a markdown extractor would turn into nodes.\n',
  );
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'fixture');
  return repo;
}

function realDeps(repo: string, errors: string[]): BuildDeps {
  return {
    run: spawnRunner,
    env: process.env,
    cwd: repo,
    log: () => {},
    warn: (l) => errors.push(l),
  };
}

function outputs(repo: string): string[] {
  return OUTPUTS.map((name) => readFileSync(join(repo, 'graphify-out', name), 'utf8'));
}

function sourceFiles(repo: string): string[] {
  const graph = readFileSync(join(repo, 'graphify-out', 'graph.json'), 'utf8');
  const { nodes } = JSON.parse(graph) as { nodes: { source_file: string }[] };
  return [...new Set(nodes.map((n) => n.source_file))].toSorted();
}

// Real Python: the first run downloads the pinned packages (about 240 MB once
// installed), so this runs only when NOLDOR_GRAPHIFY_E2E=1 and `pnpm test`
// leaves it out.
describe.skipIf(process.env.NOLDOR_GRAPHIFY_E2E !== '1')('graphify build, end to end', () => {
  it(
    'builds the same commit twice with --force into the same bytes',
    () => {
      const repo = fixtureRepo();
      const errors: string[] = [];

      expect(main(['--force'], realDeps(repo, errors))).toBe(0);
      const first = outputs(repo);
      expect(main(['--force'], realDeps(repo, errors))).toBe(0);

      expect(errors).toEqual([]);
      expect(outputs(repo)).toEqual(first);
      const graph = JSON.parse(first[OUTPUTS.indexOf('graph.json')]!);
      expect(graph.built_at_commit).toBe(git(repo, 'rev-parse', 'HEAD'));
      expect(graph.nodes.map((n: { label: string }) => n.label)).toEqual(
        expect.arrayContaining(['greet()', 'run()', 'shout()']),
      );
      expect(first[OUTPUTS.indexOf('GRAPH_REPORT.md')]).toContain('Community 0');
    },
    20 * 60_000,
  );

  it(
    'graphs code alone, and forgets a file once a commit deletes it',
    () => {
      const repo = fixtureRepo();
      const errors: string[] = [];

      expect(main([], realDeps(repo, errors))).toBe(0);
      // graphify records paths relative to the directory every code file shares.
      expect(sourceFiles(repo)).toEqual(['greet.ts', 'main.ts', 'tool.py']);

      // The first graph.json is still on disk, so a pass that merged into it
      // would carry tool.py's nodes forward.
      git(repo, 'rm', '-q', 'src/tool.py');
      git(repo, 'commit', '-qm', 'drop the tool');
      expect(main([], realDeps(repo, errors))).toBe(0);

      expect(errors).toEqual([]);
      expect(sourceFiles(repo)).toEqual(['greet.ts', 'main.ts']);
    },
    20 * 60_000,
  );
});
