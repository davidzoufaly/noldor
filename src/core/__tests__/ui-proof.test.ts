// @tests: ui-proof-screenshots-on-the-pr, pendev-ui-design-phase
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCapture } from '../run-capture.js';
import {
  UI_PROOF_BRANCH,
  NO_FEATURE_PROOF,
  collectUiProof,
  hostUiProof,
  missingFeatureSpecs,
  proofSlug,
  uiProofSkipReason,
  uiProofSurfaces,
  uiProofStep,
  type UiProofItem,
} from '../ui-proof.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const WRITE_PNG = (name: string): string => `printf '\\211PNG\\r\\n\\032\\nxx' > {out}/${name}`;

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

let root: string;
let repo: string;
let remote: string;

function initRepo(): void {
  remote = join(root, 'remote.git');
  repo = join(root, 'repo');
  git(root, 'init', '--quiet', '--bare', remote);
  git(root, 'init', '--quiet', '-b', 'feat/x', repo);
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 't');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '--quiet', '-m', 'init');
  git(repo, 'remote', 'add', 'origin', remote);
}

function writeShot(surface: string, tree: string | null, body: Buffer = PNG): void {
  const dir = join(repo, '.noldor', 'cr', 'render-compare', 'feat-slug');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${surface}.shot.png`), body);
  if (tree !== null) writeFileSync(join(dir, `${surface}.shot.json`), JSON.stringify({ tree }));
}

const collect = (
  recipes: Record<string, { command: string; timeoutMs: number; featureSpec?: string }>,
  surfaces: string[] = ['app'],
  branchFiles: string[] = [],
): Promise<UiProofItem[]> =>
  collectUiProof({
    cwd: repo,
    slug: 'feat-slug',
    proofSlug: 'x',
    branchFiles,
    surfaces,
    recipes,
    headTree: git(repo, 'rev-parse', 'HEAD^{tree}'),
    capture: runCapture,
  });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ui-proof-test-'));
  initRepo();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('uiProofSurfaces', () => {
  const config = {
    uiPaths: ['apps/web/**', 'apps/site/**'],
    uiSurfaces: { app: ['apps/web/**'], site: ['apps/site/**'] },
  };

  it('returns no surface for a branch that touches no UI path', () => {
    expect(uiProofSurfaces(['src/core/x.ts', 'README.md'], config)).toEqual([]);
  });

  it('returns each surface the branch touched, sorted', () => {
    expect(uiProofSurfaces(['apps/site/a.tsx', 'apps/web/b.tsx', 'src/x.ts'], config)).toEqual([
      'app',
      'site',
    ]);
  });

  it('uses the implicit app surface when only uiPaths is set', () => {
    expect(uiProofSurfaces(['apps/web/b.tsx'], { uiPaths: ['apps/web/**'] })).toEqual(['app']);
  });

  it('never lets a test file pull a surface in', () => {
    expect(
      uiProofSurfaces(
        [
          'apps/web/__tests__/b.tsx',
          'apps/web/src/b.test.tsx',
          'apps/site/a.spec.ts',
          'apps/site/e2e/home.spec.tsx',
        ],
        config,
      ),
    ).toEqual([]);
    expect(uiProofSurfaces(['apps/web/src/b.test.tsx', 'apps/web/src/b.tsx'], config)).toEqual([
      'app',
    ]);
  });

  it('returns nothing when the repo declares no uiPaths', () => {
    expect(uiProofSurfaces(['apps/web/b.tsx'], {})).toEqual([]);
  });
});

describe('collectUiProof', () => {
  it('uses the PNGs the proof command wrote, sorted by name and capped at 3', async () => {
    const command = ['d.png', 'c.png', 'b.png', 'a.png'].map(WRITE_PNG).join(' && ');
    const [item] = await collect({ app: { command, timeoutMs: 10_000 } });
    expect(item?.source).toBe('e2e');
    expect(item?.files.map((f) => f.split('/').at(-1))).toEqual(['a.png', 'b.png', 'c.png']);
    expect(item?.notes).toEqual([]);
  });

  it('hands the output folder to the command through NOLDOR_PROOF_OUT too', async () => {
    const command = `printf '\\211PNG\\r\\n\\032\\nxx' > "$NOLDOR_PROOF_OUT/env.png"`;
    const [item] = await collect({ app: { command, timeoutMs: 10_000 } });
    expect(item?.files.map((f) => f.split('/').at(-1))).toEqual(['env.png']);
  });

  it('empties the output folder before every run, so an earlier image never reappears', async () => {
    await collect({ app: { command: WRITE_PNG('old.png'), timeoutMs: 10_000 } });
    const [item] = await collect({ app: { command: WRITE_PNG('new.png'), timeoutMs: 10_000 } });
    expect(item?.files.map((f) => f.split('/').at(-1))).toEqual(['new.png']);
  });

  it('skips a .png file that lacks the PNG signature and says so', async () => {
    const command = `echo nope > {out}/fake.png && ${WRITE_PNG('real.png')}`;
    const [item] = await collect({ app: { command, timeoutMs: 10_000 } });
    expect(item?.files.map((f) => f.split('/').at(-1))).toEqual(['real.png']);
    expect(item?.notes.join('\n')).toContain('fake.png');
  });

  it('falls back to a fresh render-compare shot and keeps the proof failure note', async () => {
    writeShot('app', git(repo, 'rev-parse', 'HEAD^{tree}'));
    const [item] = await collect({ app: { command: 'exit 3', timeoutMs: 10_000 } });
    expect(item?.source).toBe('render-compare');
    expect(item?.files).toHaveLength(1);
    expect(item?.notes.join('\n')).toContain('exited 3');
  });

  it('uses the render-compare shot when no proof command is configured', async () => {
    writeShot('app', git(repo, 'rev-parse', 'HEAD^{tree}'));
    const [item] = await collect({});
    expect(item?.source).toBe('render-compare');
    expect(item?.files).toHaveLength(1);
  });

  it.each([
    ['taken from another tree', (): void => writeShot('app', 'f'.repeat(40))],
    ['with no tree record', (): void => writeShot('app', null)],
    [
      'that is not a PNG',
      (): void => writeShot('app', git(repo, 'rev-parse', 'HEAD^{tree}'), Buffer.from('text')),
    ],
  ])('does not use a render-compare shot %s', async (_label, setup) => {
    setup();
    const [item] = await collect({});
    expect(item?.source).toBeNull();
    expect(item?.files).toEqual([]);
  });

  it('runs a command that reads NOLDOR_PROOF_OUT even when the path holds a quote', async () => {
    const quoted = join(root, "it's");
    mkdirSync(quoted);
    const [item] = await collectUiProof({
      cwd: quoted,
      slug: 'feat-slug',
      surfaces: ['app'],
      recipes: {
        app: {
          command: `printf '\\211PNG\\r\\n\\032\\nxx' > "$NOLDOR_PROOF_OUT/env.png"`,
          timeoutMs: 10_000,
        },
      },
      headTree: null,
      capture: runCapture,
    });
    expect(item?.files.map((f) => f.split('/').at(-1))).toEqual(['env.png']);
  });

  it('refuses to substitute {out} when the path holds a quote', async () => {
    const quoted = join(root, "it's");
    mkdirSync(quoted);
    const [item] = await collectUiProof({
      cwd: quoted,
      slug: 'feat-slug',
      surfaces: ['app'],
      recipes: { app: { command: WRITE_PNG('a.png'), timeoutMs: 10_000 } },
      headTree: null,
      capture: runCapture,
    });
    expect(item?.files).toEqual([]);
    expect(item?.notes.join('\n')).toContain('single quote');
  });

  it('does not use a render-compare shot when the shipped tree is unknown', async () => {
    writeShot('app', git(repo, 'rev-parse', 'HEAD^{tree}'));
    const [item] = await collectUiProof({
      cwd: repo,
      slug: 'feat-slug',
      surfaces: ['app'],
      recipes: {},
      headTree: null,
      capture: runCapture,
    });
    expect(item?.files).toEqual([]);
    expect(item?.notes.join('\n')).toContain('could not be read');
  });

  it('reports a timed-out proof command', async () => {
    const [item] = await collect({ app: { command: 'sleep 5', timeoutMs: 200 } });
    expect(item?.files).toEqual([]);
    expect(item?.notes.join('\n')).toContain('timed out');
  });
});

describe('proofSlug', () => {
  it('is the branch name after its last slash, sanitized', () => {
    expect(proofSlug('feat/ui-proof-delivered-feature-proof')).toBe(
      'ui-proof-delivered-feature-proof',
    );
    expect(proofSlug('fast/Fix_Bar')).toBe('fix-bar');
    expect(proofSlug('main')).toBe('main');
  });
});

describe('feature proof', () => {
  const SPEC = 'e2e/proof/{slug}.spec.ts';

  function commitSpec(path = 'e2e/proof/x.spec.ts'): void {
    mkdirSync(join(repo, 'e2e', 'proof'), { recursive: true });
    writeFileSync(join(repo, path), 'test\n');
    git(repo, 'add', path);
    git(repo, 'commit', '--quiet', '-m', 'proof');
  }

  it('runs the command with {slug}/{spec} and both env vars when the branch added the spec', async () => {
    commitSpec();
    const command = `printf '%s|%s|%s|%s' {slug} {spec} "$NOLDOR_PROOF_SLUG" "$NOLDOR_PROOF_SPEC" > {out}/args.txt && ${WRITE_PNG('a.png')}`;
    const [item] = await collect(
      { app: { command, timeoutMs: 10_000, featureSpec: SPEC } },
      ['app'],
      ['e2e/proof/x.spec.ts'],
    );
    expect(item?.source).toBe('e2e');
    const out = join(repo, '.noldor', 'cr', 'ui-proof', 'feat-slug', 'app');
    expect(readFileSync(join(out, 'args.txt'), 'utf8')).toBe(
      'x|e2e/proof/x.spec.ts|x|e2e/proof/x.spec.ts',
    );
  });

  it('does not run the command and notes the missing proof when the spec is absent', async () => {
    writeShot('app', git(repo, 'rev-parse', 'HEAD^{tree}'));
    const [item] = await collect(
      { app: { command: `touch ${join(root, 'ran')}`, timeoutMs: 10_000, featureSpec: SPEC } },
      ['app'],
      ['apps/web/a.tsx'],
    );
    expect(existsSync(join(root, 'ran'))).toBe(false);
    expect(item?.source).toBe('render-compare');
    expect(item?.notes.some((n) => n.startsWith(NO_FEATURE_PROOF))).toBe(true);
    expect(item?.notes.join('\n')).toContain('e2e/proof/x.spec.ts');
  });

  it('does not count a spec in the tree that this branch did not change', async () => {
    commitSpec();
    const [item] = await collect(
      { app: { command: `touch ${join(root, 'ran')}`, timeoutMs: 10_000, featureSpec: SPEC } },
      ['app'],
      ['apps/web/a.tsx'],
    );
    expect(existsSync(join(root, 'ran'))).toBe(false);
    expect(item?.notes.some((n) => n.startsWith(NO_FEATURE_PROOF))).toBe(true);
  });

  it('does not count a spec the branch touched but no longer holds', async () => {
    const [item] = await collect(
      { app: { command: `touch ${join(root, 'ran')}`, timeoutMs: 10_000, featureSpec: SPEC } },
      ['app'],
      ['e2e/proof/x.spec.ts'],
    );
    expect(existsSync(join(root, 'ran'))).toBe(false);
    expect(item?.notes.some((n) => n.startsWith(NO_FEATURE_PROOF))).toBe(true);
  });

  it('missingFeatureSpecs names each touched feature-proof surface without its spec', async () => {
    const config = {
      uiPaths: ['apps/**'],
      uiSurfaces: { app: ['apps/web/**'], site: ['apps/site/**'] },
      uiProof: {
        app: { command: 'x', timeoutMs: 1, featureSpec: SPEC },
        site: { command: 'x', timeoutMs: 1 },
      },
    };
    const files = ['apps/web/a.tsx', 'apps/site/b.tsx'];
    expect(
      await missingFeatureSpecs({ cwd: repo, branch: 'feat/x', branchFiles: files, config }),
    ).toEqual([{ surface: 'app', spec: 'e2e/proof/x.spec.ts' }]);
    commitSpec();
    expect(
      await missingFeatureSpecs({
        cwd: repo,
        branch: 'feat/x',
        branchFiles: [...files, 'e2e/proof/x.spec.ts'],
        config,
      }),
    ).toEqual([]);
  });
});

describe('hostUiProof', () => {
  const item = (files: string[]): UiProofItem => ({
    surface: 'app',
    source: 'e2e',
    files,
    notes: [],
  });

  function localPng(name: string): string {
    const p = join(root, name);
    writeFileSync(p, PNG);
    return p;
  }

  it('pushes images to the proof branch and links them by proof commit', async () => {
    const headBefore = git(repo, 'rev-parse', 'HEAD');
    const statusBefore = git(repo, 'status', '--porcelain');
    const [link] = await hostUiProof({
      cwd: repo,
      repoUrl: 'https://github.com/o/r',
      branch: 'feat/x',
      headSha: headBefore,
      items: [item([localPng('one.png')])],
    });
    const proofTip = git(remote, 'rev-parse', `refs/heads/${UI_PROOF_BRANCH}`);
    expect(link?.imageUrls).toEqual([
      `https://github.com/o/r/blob/${proofTip}/feat/x/${headBefore}/app-1.png?raw=true`,
    ]);
    expect(
      git(remote, 'show', `${proofTip}:feat/x/${headBefore}/app-1.png`).length,
    ).toBeGreaterThan(0);
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(headBefore);
    expect(git(repo, 'status', '--porcelain')).toBe(statusBefore);
    expect(git(repo, 'ls-files')).toBe('a.txt');
  });

  it('adds to the existing proof branch instead of replacing it', async () => {
    const opts = { cwd: repo, repoUrl: 'https://github.com/o/r', branch: 'feat/x' };
    await hostUiProof({ ...opts, headSha: 'aaa', items: [item([localPng('one.png')])] });
    const first = git(remote, 'rev-parse', `refs/heads/${UI_PROOF_BRANCH}`);
    await hostUiProof({ ...opts, headSha: 'bbb', items: [item([localPng('two.png')])] });
    const second = git(remote, 'rev-parse', `refs/heads/${UI_PROOF_BRANCH}`);
    expect(git(remote, 'rev-parse', `${second}^`)).toBe(first);
    expect(git(remote, 'ls-tree', '-r', '--name-only', second).split('\n')).toEqual([
      'feat/x/aaa/app-1.png',
      'feat/x/bbb/app-1.png',
    ]);
  });

  it('turns a failed push into a note and returns no image link', async () => {
    git(repo, 'remote', 'set-url', 'origin', join(root, 'missing.git'));
    const [link] = await hostUiProof({
      cwd: repo,
      repoUrl: 'https://github.com/o/r',
      branch: 'feat/x',
      headSha: 'abc',
      items: [item([localPng('one.png')])],
    });
    expect(link?.imageUrls).toEqual([]);
    expect(link?.notes.join('\n')).toContain(UI_PROOF_BRANCH);
  });

  it('pushes nothing when no item has an image', async () => {
    const [link] = await hostUiProof({
      cwd: repo,
      repoUrl: 'https://github.com/o/r',
      branch: 'feat/x',
      headSha: 'abc',
      items: [{ surface: 'app', source: null, files: [], notes: ['proof command wrote no PNG'] }],
    });
    expect(link?.notes).toEqual(['proof command wrote no PNG']);
    expect(git(remote, 'for-each-ref')).toBe('');
  });
});

describe('uiProofSkipReason', () => {
  it('runs the proof when nothing declares a skip', () => {
    expect(uiProofSkipReason(undefined, [])).toBeNull();
    expect(uiProofSkipReason('required', ['run'])).toBeNull();
  });

  it('names the trailer or the FD field that declared it', () => {
    expect(uiProofSkipReason(undefined, [' skip '])).toBe('`Noldor-UI-Proof: skip`');
    expect(uiProofSkipReason('skip', [])).toBe('FD `design: skip`');
  });
});

describe('uiProofStep', () => {
  it('is absent for a branch that touches no UI path, so nothing runs', () => {
    expect(
      uiProofStep({
        cwd: repo,
        slug: 'feat-slug',
        branch: 'feat/x',
        headSha: 'abc',
        repoUrl: 'https://github.com/o/r',
        branchFiles: ['src/core/x.ts'],
        fdDesign: undefined,
        trailerValues: [],
        config: {
          uiPaths: ['apps/web/**'],
          uiProof: { app: { command: 'exit 1', timeoutMs: 1000 } },
        },
        capture: runCapture,
      }),
    ).toBeUndefined();
  });

  it('runs and pushes nothing on a declared skip, but names each touched surface', async () => {
    const step = uiProofStep({
      cwd: repo,
      slug: 'feat-slug',
      branch: 'feat/x',
      headSha: 'abc',
      repoUrl: 'https://github.com/o/r',
      branchFiles: ['apps/web/App.tsx'],
      fdDesign: undefined,
      trailerValues: ['skip'],
      config: {
        uiPaths: ['apps/web/**'],
        uiProof: { app: { command: WRITE_PNG('home.png'), timeoutMs: 10_000 } },
      },
      capture: runCapture,
    });
    expect(await step?.()).toEqual([
      {
        surface: 'app',
        source: null,
        imageUrls: [],
        notes: [],
        skipped: '`Noldor-UI-Proof: skip`',
      },
    ]);
    expect(existsSync(join(repo, '.noldor', 'cr', 'ui-proof'))).toBe(false);
    expect(git(remote, 'for-each-ref')).toBe('');
  });

  it('captures, hosts and links the proof for a UI-bearing branch', async () => {
    const step = uiProofStep({
      cwd: repo,
      slug: 'feat-slug',
      branch: 'feat/x',
      headSha: 'abc',
      repoUrl: 'https://github.com/o/r',
      branchFiles: ['apps/web/App.tsx'],
      fdDesign: undefined,
      trailerValues: [],
      config: {
        uiPaths: ['apps/web/**'],
        uiProof: { app: { command: WRITE_PNG('home.png'), timeoutMs: 10_000 } },
      },
      capture: runCapture,
    });
    const links = await step?.();
    expect(links?.[0]?.source).toBe('e2e');
    expect(links?.[0]?.imageUrls).toHaveLength(1);
    const proofTip = git(remote, 'rev-parse', `refs/heads/${UI_PROOF_BRANCH}`);
    expect(
      readFileSync(
        join(repo, '.noldor', 'cr', 'ui-proof', 'feat-slug', 'app', 'home.png'),
      ).subarray(0, 4),
    ).toEqual(PNG.subarray(0, 4));
    expect(git(remote, 'ls-tree', '-r', '--name-only', proofTip)).toBe('feat/x/abc/app-1.png');
  });

  it('warns on stderr about a missing feature proof even when a fallback image fills the gap', async () => {
    writeShot('app', git(repo, 'rev-parse', 'HEAD^{tree}'));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const step = uiProofStep({
        cwd: repo,
        slug: 'feat-slug',
        branch: 'feat/x',
        headSha: 'abc',
        repoUrl: 'https://github.com/o/r',
        branchFiles: ['apps/web/App.tsx'],
        fdDesign: undefined,
        trailerValues: [],
        config: {
          uiPaths: ['apps/web/**'],
          uiProof: {
            app: { command: 'true', timeoutMs: 10_000, featureSpec: 'e2e/proof/{slug}.spec.ts' },
          },
        },
        capture: runCapture,
      });
      const links = await step?.();
      expect(links?.[0]?.source).toBe('render-compare');
      const written = stderr.mock.calls.map((c) => String(c[0])).join('');
      expect(written).toContain(NO_FEATURE_PROOF);
      expect(written).toContain('e2e/proof/x.spec.ts');
    } finally {
      stderr.mockRestore();
    }
  });
});
