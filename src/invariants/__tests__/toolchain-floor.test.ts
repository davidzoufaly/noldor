// @tests: architecture-invariants
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  collectFloorViolations,
  disposableLibChecks,
  findPackageManifests,
  isDenied,
  makeToolchainFloorInvariant,
  reactFloorChecks,
  tsconfigFloorChecks,
} from '../toolchain-floor.js';

/** A tsconfig meeting every requirement the floor asserts. */
const COMPLIANT_TSCONFIG = {
  compilerOptions: {
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    lib: ['ES2023', 'DOM', 'ESNext.Disposable'],
  },
};

/** An oxlintrc meeting the React floor. */
const COMPLIANT_OXLINTRC = {
  plugins: ['typescript', 'react'],
  rules: {
    'react/rules-of-hooks': 'error',
    'react/exhaustive-deps': 'error',
  },
};

const ids = (vs: ReadonlyArray<{ id: string }>): string[] => vs.map((v) => v.id).toSorted();

describe('isDenied', () => {
  it('treats the error and deny levels as denying', () => {
    expect(isDenied('error')).toBe(true);
    expect(isDenied('deny')).toBe(true);
  });

  it('treats warn, off and allow as not denying', () => {
    expect(isDenied('warn')).toBe(false);
    expect(isDenied('off')).toBe(false);
    expect(isDenied('allow')).toBe(false);
  });

  it('reads the level out of the [level, options] array form', () => {
    expect(isDenied(['error', { allow: [] }])).toBe(true);
    expect(isDenied(['off', {}])).toBe(false);
  });

  it('treats an undeclared rule as not denying', () => {
    expect(isDenied(undefined)).toBe(false);
  });
});

describe('tsconfigFloorChecks', () => {
  it('passes a fully compliant tsconfig', () => {
    expect(tsconfigFloorChecks('tsconfig.json', COMPLIANT_TSCONFIG)).toEqual([]);
  });

  it('warns rather than errors on the two migration flags', () => {
    const out = tsconfigFloorChecks('tsconfig.json', {
      compilerOptions: { lib: ['ESNext.Disposable'] },
    });
    expect(ids(out)).toEqual(['exact-optional-property-types', 'no-unchecked-indexed-access']);
    expect(out.every((v) => v.severity === 'warn')).toBeTruthy();
  });

  it('leaves the lib requirement to disposableLibChecks', () => {
    const out = tsconfigFloorChecks('tsconfig.json', {
      compilerOptions: {
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
        lib: ['ES2023', 'DOM'],
      },
    });
    expect(out).toEqual([]);
  });

  it('reports the file it was given so a monorepo base config is named', () => {
    const out = tsconfigFloorChecks('tsconfig.base.json', { compilerOptions: {} });
    expect(out.every((v) => v.file === 'tsconfig.base.json')).toBeTruthy();
  });
});

describe('disposableLibChecks', () => {
  it('errors when a declared lib omits the disposable types', () => {
    const out = disposableLibChecks('tsconfig.json', {
      compilerOptions: { lib: ['ES2023', 'DOM'] },
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('disposable-lib');
    expect(out[0]?.severity).toBe('error');
  });

  it('accepts the entry case-insensitively', () => {
    expect(
      disposableLibChecks('tsconfig.json', { compilerOptions: { lib: ['esnext.disposable'] } }),
    ).toEqual([]);
  });

  it('stays silent when the config declares no lib array (it inherits one)', () => {
    expect(
      disposableLibChecks('tsconfig.json', { compilerOptions: { strict: true } as never }),
    ).toEqual([]);
    expect(disposableLibChecks('tsconfig.json', {})).toEqual([]);
  });
});

describe('reactFloorChecks', () => {
  it('passes a config that names both hook rules as errors', () => {
    expect(reactFloorChecks(COMPLIANT_OXLINTRC)).toEqual([]);
  });

  it('reports only the missing plugin when the react plugin is absent', () => {
    const out = reactFloorChecks({ plugins: ['typescript'], rules: {} });
    expect(ids(out)).toEqual(['react-plugin']);
    expect(out[0]?.severity).toBe('error');
  });

  it('flags hook rules left to the categories even when the plugin is on', () => {
    // The regression this floor exists for: enabling the react plugin and
    // relying on `correctness` does NOT run rules-of-hooks.
    const out = reactFloorChecks({ plugins: ['react'], rules: {} });
    expect(out).toHaveLength(2);
    expect(out.every((v) => v.id === 'react-hooks-rules')).toBeTruthy();
    expect(out.every((v) => v.severity === 'error')).toBeTruthy();
  });

  it('rejects a hook rule downgraded to warn', () => {
    const out = reactFloorChecks({
      plugins: ['react'],
      rules: { 'react/rules-of-hooks': 'warn', 'react/exhaustive-deps': 'error' },
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('react/rules-of-hooks');
  });

  it('accepts a hook rule declared in the [level, options] array form', () => {
    const out = reactFloorChecks({
      plugins: ['react'],
      rules: { 'react/rules-of-hooks': ['error'], 'react/exhaustive-deps': ['error', {}] },
    });
    expect(out).toEqual([]);
  });
});

describe('collectFloorViolations', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'toolchain-floor-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const write = (rel: string, value: unknown): void => {
    writeFileSync(join(root, rel), `${JSON.stringify(value, null, 2)}\n`);
  };

  it('passes a compliant non-React repo', async () => {
    write('tsconfig.json', COMPLIANT_TSCONFIG);
    write('package.json', { name: 'x', devDependencies: { typescript: '^7.0.0' } });
    expect(await collectFloorViolations(root)).toEqual([]);
  });

  it('prefers tsconfig.base.json as the strictness anchor', async () => {
    write('tsconfig.base.json', { compilerOptions: {} });
    write('tsconfig.json', COMPLIANT_TSCONFIG);
    write('package.json', { name: 'x' });
    const out = await collectFloorViolations(root);
    // Strictness reported against the base; the compliant root lib adds nothing.
    expect(ids(out)).toEqual(['exact-optional-property-types', 'no-unchecked-indexed-access']);
    expect(out.every((v) => v.file === 'tsconfig.base.json')).toBeTruthy();
  });

  it('checks lib in the non-anchor config too (monorepo split: strictness in base, lib in root)', async () => {
    write('tsconfig.base.json', {
      compilerOptions: { noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true },
    });
    write('tsconfig.json', { compilerOptions: { lib: ['ES2023', 'DOM'] } });
    write('package.json', { name: 'x' });
    const out = await collectFloorViolations(root);
    expect(ids(out)).toEqual(['disposable-lib']);
    expect(out[0]?.file).toBe('tsconfig.json');
  });

  it('passes the monorepo split once the root config carries the disposable lib', async () => {
    write('tsconfig.base.json', {
      compilerOptions: { noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true },
    });
    write('tsconfig.json', { compilerOptions: { lib: ['ES2023', 'DOM', 'ESNext.Disposable'] } });
    write('package.json', { name: 'x' });
    expect(await collectFloorViolations(root)).toEqual([]);
  });

  it('finds react in a workspace package, not just the root manifest', async () => {
    // Charuy's shape: the root manifest has no react; apps/web/package.json does.
    write('tsconfig.json', COMPLIANT_TSCONFIG);
    write('package.json', { name: 'root', devDependencies: { turbo: '^2.0.0' } });
    mkdirSync(join(root, 'apps', 'web'), { recursive: true });
    write(join('apps', 'web', 'package.json'), { name: 'web', dependencies: { react: '^19.0.0' } });
    write('.oxlintrc.json', { plugins: ['react'], rules: {} });
    expect(ids(await collectFloorViolations(root))).toEqual([
      'react-hooks-rules',
      'react-hooks-rules',
    ]);
  });

  it('does not read node_modules manifests as workspace packages', async () => {
    write('tsconfig.json', COMPLIANT_TSCONFIG);
    write('package.json', { name: 'root' });
    mkdirSync(join(root, 'node_modules', 'react'), { recursive: true });
    write(join('node_modules', 'react', 'package.json'), {
      name: 'react',
      dependencies: { react: '^19.0.0' },
    });
    write('.oxlintrc.json', { plugins: [], rules: {} });
    expect(await collectFloorViolations(root)).toEqual([]);
  });

  it('skips the React floor entirely when react is not a dependency', async () => {
    write('tsconfig.json', COMPLIANT_TSCONFIG);
    write('package.json', { name: 'x' });
    write('.oxlintrc.json', { plugins: [], rules: {} });
    expect(await collectFloorViolations(root)).toEqual([]);
  });

  it('applies the React floor when react is a devDependency', async () => {
    write('tsconfig.json', COMPLIANT_TSCONFIG);
    write('package.json', { name: 'x', devDependencies: { react: '^19.0.0' } });
    write('.oxlintrc.json', { plugins: ['react'], rules: {} });
    expect(ids(await collectFloorViolations(root))).toEqual([
      'react-hooks-rules',
      'react-hooks-rules',
    ]);
  });

  it('warns that the floor went unchecked when no tsconfig parses', async () => {
    write('package.json', { name: 'x' });
    const out = await collectFloorViolations(root);
    expect(ids(out)).toEqual(['tsconfig-unreadable']);
    expect(out[0]?.severity).toBe('warn');
  });

  it('warns that the React floor went unchecked when the oxlintrc has comments', async () => {
    write('tsconfig.json', COMPLIANT_TSCONFIG);
    write('package.json', { name: 'x', dependencies: { react: '^19.0.0' } });
    writeFileSync(join(root, '.oxlintrc.json'), '{ // a comment\n "plugins": [] }\n');
    const out = await collectFloorViolations(root);
    expect(ids(out)).toEqual(['oxlintrc-unreadable']);
    expect(out[0]?.severity).toBe('warn');
  });
});

describe('findPackageManifests', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'toolchain-floor-manifests-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const manifest = (...segments: string[]): void => {
    mkdirSync(join(root, ...segments), { recursive: true });
    writeFileSync(join(root, ...segments, 'package.json'), '{"name":"x"}\n');
  };

  it('collects the root manifest and workspace manifests', async () => {
    writeFileSync(join(root, 'package.json'), '{"name":"root"}\n');
    manifest('apps', 'web');
    manifest('packages', 'engine');
    // Lexical order: 'package.json' sorts before 'packages/...' ('.' < 's').
    expect(await findPackageManifests(root)).toEqual([
      join('apps', 'web', 'package.json'),
      'package.json',
      join('packages', 'engine', 'package.json'),
    ]);
  });

  it('skips node_modules, dist and worktree copies', async () => {
    writeFileSync(join(root, 'package.json'), '{"name":"root"}\n');
    manifest('node_modules', 'dep');
    manifest('dist');
    manifest('.worktrees', 'task');
    expect(await findPackageManifests(root)).toEqual(['package.json']);
  });

  it('returns an empty list for a root with no manifest', async () => {
    expect(await findPackageManifests(root)).toEqual([]);
  });
});

describe('makeToolchainFloorInvariant', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'toolchain-floor-inv-'));
    mkdirSync(join(root, '.noldor'));
    writeFileSync(
      join(root, 'package.json'),
      `${JSON.stringify({ name: 'x', dependencies: { react: '^19.0.0' } })}\n`,
    );
    writeFileSync(
      join(root, 'tsconfig.json'),
      `${JSON.stringify({ compilerOptions: { lib: ['ES2023'] } })}\n`,
    );
    writeFileSync(join(root, '.oxlintrc.json'), `${JSON.stringify({ plugins: ['react'] })}\n`);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const writeConfig = (consumer: Record<string, unknown>): void => {
    writeFileSync(
      join(root, '.noldor', 'config.json'),
      `${JSON.stringify({ consumer }, null, 2)}\n`,
    );
  };

  const baseConsumer = {
    name: 'x',
    repoUrl: 'https://example.com/x',
    lockstepPackages: ['package.json'],
    e2ePrefix: 'e2e/',
    samplesPath: 'samples',
    packagePrefix: '@x/',
    appPathPrefix: 'src',
  };

  it('reports the unmet floor with no consumer config present', async () => {
    const result = await makeToolchainFloorInvariant(root).run();
    expect(result.invariant).toBe('toolchain-floor');
    const blocking = result.violations.filter((v) => v.severity !== 'warn');
    expect(blocking).not.toEqual([]);
  });

  it('downgrades a waived id to a warn that quotes the reason', async () => {
    writeConfig({
      ...baseConsumer,
      toolchainFloor: {
        waivers: [
          { id: 'disposable-lib', reason: 'no runtime with Symbol.dispose on our deploy target' },
        ],
      },
    });
    const result = await makeToolchainFloorInvariant(root).run();
    const disposable = result.violations.filter((v) => v.message.includes('disposable-lib'));
    expect(disposable).toHaveLength(1);
    expect(disposable[0]?.severity).toBe('warn');
    expect(disposable[0]?.message).toContain('no runtime with Symbol.dispose');
  });

  it('keeps unwaived ids blocking while another id is waived', async () => {
    writeConfig({
      ...baseConsumer,
      toolchainFloor: {
        waivers: [
          { id: 'disposable-lib', reason: 'no runtime with Symbol.dispose on our deploy target' },
        ],
      },
    });
    const result = await makeToolchainFloorInvariant(root).run();
    const blocking = result.violations.filter((v) => v.severity !== 'warn');
    expect(blocking).not.toEqual([]);
    expect(
      blocking.every(
        (v) => v.message.includes('rules-of-hooks') || v.message.includes('exhaustive-deps'),
      ),
    ).toBeTruthy();
  });
});
