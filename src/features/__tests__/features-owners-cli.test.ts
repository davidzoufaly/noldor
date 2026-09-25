// @tests: fast-track-changes-can-obsolete-an-unattached-fd

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const TSX = join(process.cwd(), 'node_modules/.bin/tsx');
const CLI = join(process.cwd(), 'src/features/features-owners-cli.ts');

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function run(cwd: string, args: string[]) {
  const r = spawnSync(TSX, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function fd(code: string, phase: 'done' | 'in-progress'): string {
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
    'Run it.',
    '',
  ].join('\n');
}

/** A repo whose `main` holds two FDs owning `src/a.ts`, with a branch that changes it. */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'features-owners-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 'T']);
  mkdirSync(join(dir, 'docs/features'), { recursive: true });
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'docs/features/alpha.md'), fd('src/a.ts', 'done'));
  writeFileSync(join(dir, 'docs/features/beta.md'), fd('src/a.ts', 'in-progress'));
  writeFileSync(join(dir, 'src/a.ts'), 'export const a = 1;\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  git(dir, ['checkout', '-qb', 'fast/x']);
  writeFileSync(join(dir, 'src/a.ts'), 'export const a = 2;\n');
  writeFileSync(join(dir, 'src/new.ts'), 'export const n = 1;\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'change']);
  return dir;
}

interface OwnersJson {
  paths: string[];
  owners: { slug: string; phase: string; skip: string | null; files: string[] }[];
}

describe('features owners', () => {
  it("lists the FDs owning the branch's changed files, defaulting the base to origin/main", () => {
    const r = run(repo(), ['--json']);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as OwnersJson;
    expect(out.paths).toEqual(['src/a.ts', 'src/new.ts']);
    expect(out.owners).toEqual([
      { slug: 'alpha', phase: 'done', skip: null, files: ['src/a.ts'] },
      { slug: 'beta', phase: 'in-progress', skip: 'not-done', files: ['src/a.ts'] },
    ]);
  });

  it('diffs against an explicit --base', () => {
    const dir = repo();
    git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    const r = run(dir, ['--base', 'main', '--json']);
    expect(r.status).toBe(0);
    expect((JSON.parse(r.stdout) as OwnersJson).owners.map((o) => o.slug)).toEqual([
      'alpha',
      'beta',
    ]);
  });

  it('answers for explicit --path values without reading git', () => {
    const r = run(repo(), ['--path', 'src/new.ts', '--path', 'src/a.ts', '--json']);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as OwnersJson;
    expect(out.paths).toEqual(['src/new.ts', 'src/a.ts']);
    expect(out.owners.map((o) => o.slug)).toEqual(['alpha', 'beta']);
  });

  it('prints each owner with its standing and files in text mode', () => {
    const r = run(repo(), []);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/alpha[^\n]*candidate/);
    expect(r.stdout).toMatch(/beta[^\n]*not-done/);
    expect(r.stdout).toContain('src/a.ts');
  });

  it('exits 0 with no owners when nothing changed is owned', () => {
    const r = run(repo(), ['--path', 'README.md', '--json']);
    expect(r.status).toBe(0);
    expect((JSON.parse(r.stdout) as OwnersJson).owners).toEqual([]);
  });

  it.each([
    ['an unknown flag', ['--bogus']],
    ['a flag missing its value', ['--base']],
    ['--base together with --path', ['--base', 'main', '--path', 'src/a.ts']],
    ['a base ref git cannot resolve', ['--base', 'no-such-ref']],
  ])('exits 2 on %s', (_label, args) => {
    const r = run(repo(), args);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toBe('');
  });

  it('exits 2 naming a feature MD whose frontmatter does not parse', () => {
    const dir = repo();
    writeFileSync(join(dir, 'docs/features/broken.md'), '---\nname: [unclosed\n---\n');
    const r = run(dir, ['--json']);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('broken.md');
  });
});
