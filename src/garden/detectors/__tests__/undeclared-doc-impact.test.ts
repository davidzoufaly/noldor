// @tests: fast-track-changes-can-obsolete-an-unattached-fd

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { detectUndeclaredDocImpact } from '../undeclared-doc-impact.js';

function fd(code: string, phase: 'done' | 'in-progress', usage: string): string {
  return [
    '---',
    'area: tooling',
    'category: Tooling',
    'links:',
    `  code:\n    - ${code}`,
    '  tests: []',
    'name: Seeded',
    'packages:',
    '  - scripts',
    `phase: ${phase}`,
    'noldor-tier: specs-only',
    '---',
    '',
    '## Usage',
    '',
    usage,
    '',
  ].join('\n');
}

/**
 * A repo whose first commit holds three FDs owning `src/a.ts`: `alpha` is a
 * candidate, `beta` is in progress and `gamma` has a stub Usage.
 */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'undeclared-doc-impact-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir });
  mkdirSync(join(dir, 'docs/features'), { recursive: true });
  writeFileSync(join(dir, 'docs/features/alpha.md'), fd('src/a.ts', 'done', 'Run `alpha`.'));
  writeFileSync(join(dir, 'docs/features/beta.md'), fd('src/a.ts', 'in-progress', 'Run `beta`.'));
  writeFileSync(
    join(dir, 'docs/features/gamma.md'),
    fd('src/a.ts', 'done', '<!-- TODO: steps -->'),
  );
  commit(dir, 'chore: base', ['src/a.ts']);
  return dir;
}

let edits = 0;

/**
 * Commit a change to each of `files`, returning the new commit's full sha. The
 * change is an appended line, so a feature MD keeps its frontmatter.
 */
function commit(dir: string, message: string, files: string[]): string {
  for (const file of files) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    edits += 1;
    appendFileSync(join(dir, file), `edit ${String(edits)}\n`);
  }
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-F', '-'], { cwd: dir, input: message });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
}

const fastTrack = (subject: string, declaration?: string): string =>
  `${subject}\n\nWhy — x.\n\n${declaration === undefined ? '' : `Noldor-Doc-Impact: ${declaration}\n`}Noldor-Path: fast-track\n`;

/** The first declaration in a repo's history: the floor the detector counts from. */
const floor = (dir: string): string =>
  commit(dir, fastTrack('fix(tooling): unrelated', 'none'), ['src/other.ts']);

async function flagged(dir: string): Promise<[string, string[]][]> {
  const findings = await detectUndeclaredDocImpact(dir);
  return findings.map((f) =>
    f.kind === 'undeclared' ? [f.fd, f.commits.map((c) => c.sha)] : ['unavailable', []],
  );
}

describe('detectUndeclaredDocImpact', () => {
  it('is silent in a repo that never carried a declaration', async () => {
    const dir = repo();
    commit(dir, fastTrack('fix(tooling): touch a'), ['src/a.ts']);
    expect(await detectUndeclaredDocImpact(dir)).toEqual([]);
  });

  it('flags a candidate FD owning a file an undeclared fast-track changed after the floor', async () => {
    const dir = repo();
    floor(dir);
    const sha = commit(dir, fastTrack('fix(tooling): touch a'), ['src/a.ts', 'src/unowned.ts']);
    const findings = await detectUndeclaredDocImpact(dir);
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding?.kind).toBe('undeclared');
    if (finding?.kind !== 'undeclared') return;
    expect(finding.fd).toBe('alpha');
    expect(finding.commits).toEqual([
      { sha, subject: 'fix(tooling): touch a', files: ['src/a.ts'] },
    ]);
    expect(finding.message).toContain('docs/features/alpha.md');
  });

  it.each([
    ['a declared fast-track', fastTrack('fix(tooling): touch a', 'none')],
    ['a commit from an FD-carrying path', 'feat(core): x\n\nNoldor-Path: specs-only-new\n'],
    ['a commit with no Noldor-Path', 'fix: hand-made\n'],
  ])('does not flag %s', async (_label, message) => {
    const dir = repo();
    floor(dir);
    commit(dir, message, ['src/a.ts']);
    expect(await detectUndeclaredDocImpact(dir)).toEqual([]);
  });

  it('does not flag an undeclared fast-track older than the floor', async () => {
    const dir = repo();
    commit(dir, fastTrack('fix(tooling): touch a'), ['src/a.ts']);
    floor(dir);
    expect(await detectUndeclaredDocImpact(dir)).toEqual([]);
  });

  it('reads a declaration inside a squash-merge body', async () => {
    const dir = repo();
    floor(dir);
    commit(
      dir,
      [
        'fix(tooling): touch a (#12)',
        '',
        '* fix(tooling): touch a',
        '',
        'Noldor-Doc-Impact: none',
        'Noldor-Path: fast-track',
        '',
        '---------',
        '',
        'Co-authored-by: t <t@t.io>',
        '',
      ].join('\n'),
      ['src/a.ts'],
    );
    expect(await detectUndeclaredDocImpact(dir)).toEqual([]);
  });

  describe('clearing', () => {
    it.each([
      [
        'a usage-checked commit scoped to the FD',
        'docs(features:alpha): Usage checked against abc (#13)\n\nNoldor-Path: micro-chore\n',
      ],
      [
        'a squashed fast-track whose Noldor-Doc-Impact names the FD',
        '* docs(features:alpha): refresh Usage\n\nNoldor-Doc-Impact: alpha\nNoldor-Path: fast-track\n',
      ],
    ])('clears on %s', async (_label, message) => {
      const dir = repo();
      floor(dir);
      commit(dir, fastTrack('fix(tooling): touch a'), ['src/a.ts']);
      const body = message.startsWith('*') ? `fix(tooling): later (#14)\n\n${message}` : message;
      commit(dir, body, ['docs/features/alpha.md']);
      expect(await flagged(dir)).toEqual([]);
    });

    it.each([
      ['a scope naming another FD', 'docs(features:delta): x\n\nNoldor-Path: micro-chore\n'],
      ['a Noldor-Doc-Impact naming another FD', fastTrack('fix(tooling): other', 'delta')],
    ])('keeps the finding after %s', async (_label, message) => {
      const dir = repo();
      mkdirSync(join(dir, 'docs/features'), { recursive: true });
      writeFileSync(join(dir, 'docs/features/delta.md'), fd('src/d.ts', 'done', 'Run `delta`.'));
      floor(dir);
      const sha = commit(dir, fastTrack('fix(tooling): touch a'), ['src/a.ts']);
      commit(dir, message, ['src/d.ts']);
      expect(await flagged(dir)).toEqual([['alpha', [sha]]]);
    });

    it('keeps only the commits newer than the latest record', async () => {
      const dir = repo();
      floor(dir);
      commit(dir, fastTrack('fix(tooling): old touch'), ['src/a.ts']);
      commit(dir, 'docs(features:alpha): Usage checked against x\n\nNoldor-Path: micro-chore\n', [
        'docs/features/alpha.md',
      ]);
      const newer = commit(dir, fastTrack('fix(tooling): new touch'), ['src/a.ts']);
      expect(await flagged(dir)).toEqual([['alpha', [newer]]]);
    });
  });

  it('reports a git failure as a finding rather than a clean result', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'undeclared-doc-impact-nogit-'));
    const findings = await detectUndeclaredDocImpact(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('unavailable');
    expect(findings[0]?.message).not.toBe('');
  });
});
