// @tests: dynamic-fd-changelog, framework-pr-flow-agent-auto-merge

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderInitialReleaseBlock } from '../release-fd-changelog.js';

const exec = (cmd: string, args: string[], cwd: string) =>
  new Promise<string>((resolve, reject) => {
    execFile(cmd, args, { cwd }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.toString());
    });
  });

describe('renderInitialReleaseBlock', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'initial-release-'));
    await exec('git', ['init', '-q'], cwd);
    await exec('git', ['config', 'user.email', 't@e'], cwd);
    await exec('git', ['config', 'user.name', 't'], cwd);
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  async function commit(subject: string) {
    await exec('git', ['commit', '--allow-empty', '-m', subject], cwd);
  }

  it('renders `### Initial Release (vX)` heading with cumulative PRs', async () => {
    await commit('feat(pkg:foo): first (#1)');
    await commit('feat(pkg:foo): second (#5)');
    await commit('feat(pkg:foo): third (#12)');

    const block = await renderInitialReleaseBlock({
      cwd,
      slug: 'foo',
      version: '0.2.0',
      repoUrl: 'https://github.com/o/r',
      offline: true,
    });

    expect(block).toMatch(/^### Initial Release \(v0\.2\.0\)/m);
    expect(block).toMatch(/#12:/);
    expect(block).toMatch(/#5:/);
    expect(block).toMatch(/#1:/);
  });

  it('returns null when FD has zero slug-matching commits', async () => {
    await commit('chore: unrelated');
    const block = await renderInitialReleaseBlock({
      cwd,
      slug: 'foo',
      version: '0.2.0',
      repoUrl: 'https://github.com/o/r',
      offline: true,
    });
    expect(block).toBeNull();
  });

  it('omits #### PRs when no slug-matching commits have PR refs (pre-PR-flow FD)', async () => {
    await commit('feat(pkg:foo): pre-bootstrap one');
    await commit('feat(pkg:foo): pre-bootstrap two');
    const block = await renderInitialReleaseBlock({
      cwd,
      slug: 'foo',
      version: '0.2.0',
      repoUrl: 'https://github.com/o/r',
      offline: true,
    });
    expect(block).not.toBeNull();
    expect(block).not.toMatch(/#### PRs/);
    expect(block).toMatch(/#### Summary/);
  });

  it('excludes pre-PR-flow commits from Summary when newer commits DO have PR refs', async () => {
    // Older commit without PR ref, then commits with PR refs.
    await commit('feat(pkg:foo): pre-bootstrap-commit');
    await commit('feat(pkg:foo): first-PR (#10)');
    await commit('feat(pkg:foo): second-PR (#15)');

    const block = await renderInitialReleaseBlock({
      cwd,
      slug: 'foo',
      version: '0.2.0',
      repoUrl: 'https://github.com/o/r',
      offline: true,
    });
    expect(block).toMatch(/#10:/);
    expect(block).toMatch(/#15:/);
    // Summary should NOT include the pre-bootstrap commit subject text
    // (range starts at first-PR^, so the earlier commit is excluded).
    expect(block).not.toMatch(/pre-bootstrap-commit/);
  });
});
