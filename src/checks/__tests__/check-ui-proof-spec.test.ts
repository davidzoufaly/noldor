// @tests: ui-proof-screenshots-on-the-pr
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from '../check-ui-proof-spec.js';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const MINIMAL_CONSUMER = {
  name: 'acme',
  repoUrl: 'https://github.com/x/y',
  lockstepPackages: ['package.json'],
  scanPaths: [],
  boundaries: [],
  deprecatedPackages: [],
  e2ePrefix: '',
  samplesPath: '',
  packagePrefix: '',
  pnpmStderrPrefix: '',
  appPathPrefix: '',
};

let repo: string;
let base: string;
let out: string[];

function commit(path: string, message = `add ${path}`): void {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), 'x\n');
  git(repo, 'add', path);
  git(repo, 'commit', '--quiet', '-m', message);
}

function writeConfig(uiProof: unknown): void {
  mkdirSync(join(repo, '.noldor'), { recursive: true });
  writeFileSync(
    join(repo, '.noldor', 'config.json'),
    JSON.stringify({ consumer: { ...MINIMAL_CONSUMER, uiPaths: ['apps/web/**'], uiProof } }),
  );
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'check-ui-proof-spec-'));
  git(repo, 'init', '--quiet', '-b', 'main');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 't');
  commit('README.md');
  base = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '--quiet', '-b', 'feat/new-bar');
  out = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => void out.push(line));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(repo, { recursive: true, force: true });
});

const FEATURE = { app: { command: 'pnpm proof {spec}', featureSpec: 'e2e/proof/{slug}.spec.ts' } };

describe('checks ui-proof-spec', () => {
  it('exits 1 and names the path when a touched surface lacks its proof test', async () => {
    writeConfig(FEATURE);
    commit('apps/web/bar.tsx');
    expect(await main(['--base', base], repo)).toBe(1);
    expect(out.join('\n')).toContain('e2e/proof/new-bar.spec.ts');
  });

  it('exits 0 once the branch adds the proof test', async () => {
    writeConfig(FEATURE);
    commit('apps/web/bar.tsx');
    commit('e2e/proof/new-bar.spec.ts');
    expect(await main(['--base', base], repo)).toBe(0);
  });

  it('exits 0 when the touched surface does not opt in to feature proof', async () => {
    writeConfig({ app: { command: 'pnpm proof' } });
    commit('apps/web/bar.tsx');
    expect(await main(['--base', base], repo)).toBe(0);
  });

  it('exits 0 on a declared UI-proof skip', async () => {
    writeConfig(FEATURE);
    commit('apps/web/bar.tsx', 'tweak bar\n\nNoldor-UI-Proof: skip');
    expect(await main(['--base', base], repo)).toBe(0);
    expect(out.join('\n')).toContain('skipped');
  });

  it('exits 0 when the repo has no consumer config', async () => {
    commit('apps/web/bar.tsx');
    expect(await main(['--base', base], repo)).toBe(0);
  });
});
