// @tests: noldor
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureGraphFresh, GRAPH_IRRELEVANT_EXCLUDES } from '../graph-freshness.js';

const exec = (cmd: string, args: string[], cwd: string, env?: Record<string, string>) =>
  new Promise<string>((resolve, reject) => {
    execFile(cmd, args, { cwd, env: { ...process.env, ...env } }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.toString());
    });
  });

describe('ensureGraphFresh', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'graph-fresh-'));
    await exec('git', ['init', '-q'], cwd);
    await exec('git', ['config', 'user.email', 't@e'], cwd);
    await exec('git', ['config', 'user.name', 't'], cwd);
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  /** Commit `path` with `content` at a deterministic epoch (seconds). */
  async function commit(path: string, content: string, epoch: number): Promise<void> {
    const abs = join(cwd, path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
    await exec('git', ['add', '-A'], cwd);
    await exec('git', ['commit', '-q', '-m', `add ${path}`], cwd, {
      GIT_AUTHOR_DATE: `@${epoch} +0000`,
      GIT_COMMITTER_DATE: `@${epoch} +0000`,
    });
  }

  it('skips (no throw) when no graphify-out/graph.json is tracked', async () => {
    await commit('src/app.ts', 'export const a = 1;\n', 1000);
    await expect(ensureGraphFresh(['src'], cwd)).resolves.toBeUndefined();
  });

  it('skips (no throw) when scanPaths is empty even if a graph exists', async () => {
    await commit('graphify-out/graph.json', '{}\n', 1000);
    await commit('src/app.ts', 'export const a = 2;\n', 2000);
    await expect(ensureGraphFresh([], cwd)).resolves.toBeUndefined();
  });

  it('throws when a graph-relevant source file was committed after the graph', async () => {
    await commit('src/app.ts', 'export const a = 1;\n', 1000);
    await commit('graphify-out/graph.json', '{}\n', 2000);
    await commit('src/app.ts', 'export const a = 3;\n', 3000);
    await expect(ensureGraphFresh(['src'], cwd)).rejects.toThrow(/stale/i);
  });

  it('does NOT throw when only a colocated *.test.ts was committed after the graph', async () => {
    await commit('src/app.ts', 'export const a = 1;\n', 1000);
    await commit('graphify-out/graph.json', '{}\n', 2000);
    await commit('src/app.test.ts', 'test.skip("x", () => {});\n', 3000);
    await expect(ensureGraphFresh(['src'], cwd)).resolves.toBeUndefined();
  });

  it('does NOT throw when only a __tests__/ file was committed after the graph', async () => {
    await commit('src/app.ts', 'export const a = 1;\n', 1000);
    await commit('graphify-out/graph.json', '{}\n', 2000);
    await commit('src/feature/__tests__/app.test.ts', 'test.skip("y", () => {});\n', 3000);
    await expect(ensureGraphFresh(['src'], cwd)).resolves.toBeUndefined();
  });

  it('does NOT throw when only a *.md doc was committed after the graph', async () => {
    await commit('src/app.ts', 'export const a = 1;\n', 1000);
    await commit('graphify-out/graph.json', '{}\n', 2000);
    await commit('src/README.md', '# notes\n', 3000);
    await expect(ensureGraphFresh(['src'], cwd)).resolves.toBeUndefined();
  });

  it('throws when a commit touches both real source AND a test file', async () => {
    await commit('src/app.ts', 'export const a = 1;\n', 1000);
    await commit('graphify-out/graph.json', '{}\n', 2000);
    // single commit, mixed paths — the real-source edit must still stale the graph
    const absSrc = join(cwd, 'src/app.ts');
    const absTest = join(cwd, 'src/app.test.ts');
    await mkdir(dirname(absSrc), { recursive: true });
    await writeFile(absSrc, 'export const a = 4;\n', 'utf8');
    await writeFile(absTest, 'test.skip("z", () => {});\n', 'utf8');
    await exec('git', ['add', '-A'], cwd);
    await exec('git', ['commit', '-q', '-m', 'mixed'], cwd, {
      GIT_AUTHOR_DATE: '@3000 +0000',
      GIT_COMMITTER_DATE: '@3000 +0000',
    });
    await expect(ensureGraphFresh(['src'], cwd)).rejects.toThrow(/stale/i);
  });

  it('exposes test- and doc-file exclusion pathspecs', () => {
    expect(GRAPH_IRRELEVANT_EXCLUDES).toEqual(
      expect.arrayContaining([
        ':(exclude,glob)**/__tests__/**',
        ':(exclude,glob)**/*.test.ts',
        ':(exclude,glob)**/*.md',
      ]),
    );
    // every entry must be a git exclude pathspec
    for (const spec of GRAPH_IRRELEVANT_EXCLUDES) {
      expect(spec.startsWith(':(exclude')).toBe(true);
    }
  });
});
