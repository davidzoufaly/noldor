// @tests: architecture-invariants
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  collectFloorViolations,
  findPackageManifests,
  isDenied,
  libFloorChecks,
  makeToolchainFloorInvariant,
  reactFloorChecks,
  stripJsonc,
  tsconfigFloorChecks,
} from '../toolchain-floor.js';

/** A tsconfig meeting every requirement the floor asserts. */
const COMPLIANT_TSCONFIG = {
  compilerOptions: {
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    lib: ['ESNext', 'DOM'],
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
      compilerOptions: { lib: ['ESNext'] },
    });
    expect(ids(out)).toEqual(['exact-optional-property-types', 'no-unchecked-indexed-access']);
    expect(out.every((v) => v.severity === 'warn')).toBeTruthy();
  });

  it('leaves the lib requirements to libFloorChecks', () => {
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

describe('libFloorChecks', () => {
  it('errors on both halves when a declared lib stops at ES2023', () => {
    // The repo's own shipped lib before this floor existed: it carries neither
    // Explicit Resource Management nor the ES2024/2025 built-ins that
    // platform-over-dependency mandates by name.
    const out = libFloorChecks('tsconfig.json', { compilerOptions: { lib: ['ES2023', 'DOM'] } });
    expect(ids(out)).toEqual(['disposable-lib', 'lib-es-builtins']);
    expect(out.every((v) => v.severity === 'error')).toBeTruthy();
  });

  it('accepts the ESNext umbrella, which includes the disposable types', () => {
    // Probed against tsc directly: `lib: ["ESNext"]` compiles `using` cleanly,
    // so an exact-match check on esnext.disposable is a false positive.
    expect(
      libFloorChecks('tsconfig.json', { compilerOptions: { lib: ['ESNext', 'DOM'] } }),
    ).toEqual([]);
  });

  it('accepts the ESNext.Full umbrella too', () => {
    expect(libFloorChecks('tsconfig.json', { compilerOptions: { lib: ['ESNext.Full'] } })).toEqual(
      [],
    );
  });

  it('accepts the entry case-insensitively', () => {
    expect(
      libFloorChecks('tsconfig.json', { compilerOptions: { lib: ['esnext', 'dom'] } }),
    ).toEqual([]);
  });

  it('accepts es2025 plus an explicit disposable entry', () => {
    expect(
      libFloorChecks('tsconfig.json', {
        compilerOptions: { lib: ['ES2025', 'DOM', 'ESNext.Disposable'] },
      }),
    ).toEqual([]);
  });

  it('reports only the built-ins half when disposable is named but the year is short', () => {
    const out = libFloorChecks('tsconfig.json', {
      compilerOptions: { lib: ['ES2024', 'ESNext.Disposable'] },
    });
    expect(ids(out)).toEqual(['lib-es-builtins']);
    expect(out[0]?.message).toContain('es2024');
  });

  it('does not count a granular sub-library as the whole annual library', () => {
    // es2025.regexp carries RegExp.escape and nothing else — none of the Set
    // operations or iterator helpers the floor requires.
    const out = libFloorChecks('tsconfig.json', {
      compilerOptions: { lib: ['ES2025.RegExp', 'ESNext.Disposable'] },
    });
    expect(ids(out)).toEqual(['lib-es-builtins']);
  });

  it('does not count an invented year suffix either', () => {
    const out = libFloorChecks('tsconfig.json', {
      compilerOptions: { lib: ['ES9999.Foo', 'ESNext.Disposable'] },
    });
    expect(ids(out)).toEqual(['lib-es-builtins']);
  });

  it('blocks on a lib declared as a string rather than an array', () => {
    // A plausible typo that tsc rejects outright; reading it as "inherited"
    // skipped both checks on a config that does not compile at all.
    const out = libFloorChecks('tsconfig.json', {
      compilerOptions: { lib: 'ESNext' },
    });
    expect(ids(out)).toEqual(['lib-malformed']);
    expect(out[0]?.severity).toBe('error');
    expect(out[0]?.message).toContain('a string');
  });

  it('reads the year out of a .full-suffixed entry', () => {
    expect(
      libFloorChecks('tsconfig.json', {
        compilerOptions: { lib: ['ES2025.Full', 'ESNext.Disposable'] },
      }),
    ).toEqual([]);
  });

  it('says nothing per file about an undeclared lib — that is a repo-level call', () => {
    // A base config declares no lib on purpose; whether the floor went
    // unchecked depends on whether any root candidate declared one, which only
    // collectFloorViolations can see.
    for (const cfg of [{ compilerOptions: { strict: true } }, {}]) {
      expect(libFloorChecks('tsconfig.json', cfg)).toEqual([]);
    }
  });

  it('blocks on a non-string lib entry rather than grading what remains', () => {
    // tsc rejects the config outright, so filtering the junk out and passing the
    // remainder reports a config that does not compile as compliant.
    const out = libFloorChecks('tsconfig.json', {
      compilerOptions: { lib: [42, null, 'ESNext'] },
    });
    expect(ids(out)).toEqual(['lib-malformed']);
    expect(out[0]?.severity).toBe('error');
  });
});

/** Scan then parse, asserting the scan succeeded — the happy path in one step. */
const parseJsonc = (text: string): unknown => {
  const scan = stripJsonc(text);
  if (!scan.ok) throw new Error(`unexpected scan failure: ${scan.detail}`);
  return JSON.parse(scan.text);
};

describe('stripJsonc', () => {
  it('removes line and block comments', () => {
    const text = '{\n  // leading\n  "a": 1, /* inline */\n  "b": 2\n}';
    expect(parseJsonc(text)).toEqual({ a: 1, b: 2 });
  });

  it('removes trailing commas in objects and arrays', () => {
    expect(parseJsonc('{ "a": [1, 2, ], }')).toEqual({ a: [1, 2] });
  });

  it('leaves comment-like sequences inside strings alone', () => {
    // The repo's own .oxlintrc.json carries a $schema URL; a regex-based strip
    // eats everything after its `//`.
    const text = '{ "$schema": "https://example.com/s.json", "a": 1 }';
    expect(parseJsonc(text)).toEqual({
      $schema: 'https://example.com/s.json',
      a: 1,
    });
  });

  it('leaves an escaped quote inside a string from ending it', () => {
    expect(parseJsonc('{ "a": "sl\\"ash", "b": 1 }')).toEqual({ a: 'sl"ash', b: 1 });
  });

  it('leaves a comma inside a string alone', () => {
    expect(parseJsonc('{ "a": "x,", "b": [1] }')).toEqual({ a: 'x,', b: [1] });
  });

  it('rejects an unterminated block comment instead of swallowing it', () => {
    const scan = stripJsonc('{ "a": 1 }\n/* never closed');
    expect(scan.ok).toBe(false);
    expect(scan.ok === false && scan.detail).toContain('unterminated block comment');
  });

  it('rejects an unterminated string literal', () => {
    const scan = stripJsonc('{ "a": "open');
    expect(scan.ok).toBe(false);
    expect(scan.ok === false && scan.detail).toContain('unterminated string');
  });

  it('does not repair a comma that follows no value', () => {
    // `{,}` and `[,]` are invalid JSONC; dropping the comma would make them
    // parse, so a malformed config would read as a checked one.
    for (const broken of ['{,}', '[,]', '{ "a": [,] }']) {
      const scan = stripJsonc(broken);
      expect(scan.ok).toBe(true);
      expect(() => JSON.parse(scan.ok ? scan.text : '')).toThrow();
    }
  });

  it('does not join the tokens either side of an inline block comment', () => {
    // `1/*c*/2` must not become `12`: repairing malformed input into something
    // parseable is the same bypass from the other direction.
    for (const broken of ['{ "a": 1/*c*/2 }', '{ "a": tru/*c*/e }']) {
      const scan = stripJsonc(broken);
      expect(scan.ok).toBe(true);
      expect(() => JSON.parse(scan.ok ? scan.text : '')).toThrow();
    }
  });

  it('keeps a separator-comma between two strings in an array', () => {
    // The shape of every real `lib` / `plugins` array — the comma after a
    // closing quote is a separator, not a trailing comma.
    expect(parseJsonc('{ "lib": ["ES2025", "DOM"], "plugins": ["a", "b", "c"] }')).toEqual({
      lib: ['ES2025', 'DOM'],
      plugins: ['a', 'b', 'c'],
    });
  });

  it('still drops a trailing comma after each kind of value', () => {
    expect(parseJsonc('{ "a": 1, "b": [2, ], "c": { "d": null, }, }')).toEqual({
      a: 1,
      b: [2],
      c: { d: null },
    });
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
    // Strictness reported against the base; the compliant root lib adds nothing,
    // and the base declaring no lib is not an unchecked floor when the root does.
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
    expect(ids(out)).toEqual(['disposable-lib', 'lib-es-builtins']);
    expect(out.every((v) => v.file === 'tsconfig.json')).toBeTruthy();
  });

  it('passes the monorepo split once the root config carries the disposable lib', async () => {
    write('tsconfig.base.json', {
      compilerOptions: { noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true },
    });
    write('tsconfig.json', { compilerOptions: { lib: ['ESNext', 'DOM'] } });
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

  it('warns when there is no root tsconfig at all (a pure-JS repo may be intentional)', async () => {
    write('package.json', { name: 'x' });
    const out = await collectFloorViolations(root);
    expect(ids(out)).toEqual(['tsconfig-absent']);
    expect(out[0]?.severity).toBe('warn');
    expect(out[0]?.message).toContain('no root tsconfig found');
  });

  it('reads a tsconfig carrying comments and trailing commas rather than skipping it', async () => {
    // The bypass this closes: `tsc --init` emits a commented tsconfig, and
    // under bare JSON.parse the whole blocking floor degraded to one warning.
    writeFileSync(
      join(root, 'tsconfig.json'),
      '{\n  // strictness lives in the base config\n  "compilerOptions": {\n    "lib": ["ES2023", "DOM"],\n  },\n}\n',
    );
    write('package.json', { name: 'x' });
    const out = await collectFloorViolations(root);
    expect(ids(out)).toEqual([
      'disposable-lib',
      'exact-optional-property-types',
      'lib-es-builtins',
      'no-unchecked-indexed-access',
    ]);
  });

  it('blocks on a tsconfig that is present but genuinely unparseable', async () => {
    writeFileSync(join(root, 'tsconfig.json'), '{ "compilerOptions": \n');
    write('package.json', { name: 'x' });
    const out = await collectFloorViolations(root);
    expect(ids(out)).toEqual(['tsconfig-invalid']);
    expect(out[0]?.severity).toBe('error');
  });

  it('reports rather than throws on a tsconfig whose JSON is valid but not an object', async () => {
    // `null` parses fine, so the previous cast let the first property read throw
    // a TypeError out of the invariant instead of producing a finding.
    writeFileSync(join(root, 'tsconfig.json'), 'null\n');
    write('package.json', { name: 'x' });
    const out = await collectFloorViolations(root);
    expect(ids(out)).toEqual(['tsconfig-invalid']);
    expect(out[0]?.severity).toBe('error');
  });

  it('reads an oxlintrc carrying comments, so its React rules are really checked', async () => {
    write('tsconfig.json', COMPLIANT_TSCONFIG);
    write('package.json', { name: 'x', dependencies: { react: '^19.0.0' } });
    writeFileSync(
      join(root, '.oxlintrc.json'),
      '{ // the plugin set\n "plugins": ["react"], "rules": {} }\n',
    );
    const out = await collectFloorViolations(root);
    expect(ids(out)).toEqual(['react-hooks-rules', 'react-hooks-rules']);
  });

  it('blocks when react is a dependency and there is no oxlintrc at all', async () => {
    write('tsconfig.json', COMPLIANT_TSCONFIG);
    write('package.json', { name: 'x', dependencies: { react: '^19.0.0' } });
    const out = await collectFloorViolations(root);
    expect(ids(out)).toEqual(['oxlintrc-absent']);
    expect(out[0]?.severity).toBe('error');
    expect(out[0]?.message).toContain('no .oxlintrc.json');
  });

  it('blocks on an oxlintrc that is present but unparseable', async () => {
    write('tsconfig.json', COMPLIANT_TSCONFIG);
    write('package.json', { name: 'x', dependencies: { react: '^19.0.0' } });
    writeFileSync(join(root, '.oxlintrc.json'), '{ "plugins": [\n');
    const out = await collectFloorViolations(root);
    expect(ids(out)).toEqual(['oxlintrc-invalid']);
    expect(out[0]?.severity).toBe('error');
  });

  it('warns once when no root candidate declares a lib at all', async () => {
    // A standalone `target: ES2023` config with no lib provides neither half of
    // the floor and used to pass in silence.
    write('tsconfig.base.json', { compilerOptions: { noUncheckedIndexedAccess: true } });
    write('tsconfig.json', { compilerOptions: { target: 'ES2023' } });
    write('package.json', { name: 'x' });
    const out = await collectFloorViolations(root);
    expect(ids(out).filter((id) => id === 'lib-inherited')).toEqual(['lib-inherited']);
    const warn = out.find((v) => v.id === 'lib-inherited');
    expect(warn?.severity).toBe('warn');
    expect(warn?.file).toBe('tsconfig.base.json');
  });

  it('names a workspace manifest that failed to parse even when the root one read', async () => {
    // "Some manifest parsed" is not "every manifest parsed": react declared only
    // in the broken one would make the React floor silently not run.
    write('tsconfig.json', COMPLIANT_TSCONFIG);
    write('package.json', { name: 'root' });
    mkdirSync(join(root, 'apps', 'web'), { recursive: true });
    writeFileSync(join(root, 'apps', 'web', 'package.json'), '{ "dependencies": \n');
    const out = await collectFloorViolations(root);
    expect(ids(out)).toEqual(['manifests-unreadable']);
    expect(out[0]?.severity).toBe('warn');
    expect(out[0]?.message).toContain(join('apps', 'web', 'package.json'));
    expect(out[0]?.message).toContain('did not validate');
    // The reported path must be a real file, not a synthesised label.
    expect(out[0]?.file).toBe(join('apps', 'web', 'package.json'));
  });

  it('reports a directory it could not enter as a directory, not as a manifest', async () => {
    write('tsconfig.json', COMPLIANT_TSCONFIG);
    write('package.json', { name: 'root' });
    const blocked = join(root, 'apps');
    mkdirSync(blocked, { recursive: true });
    chmodSync(blocked, 0o000);
    try {
      const out = await collectFloorViolations(root);
      expect(ids(out)).toEqual(['manifests-unreadable']);
      expect(out[0]?.message).toContain('could not be read');
      expect(out[0]?.message).not.toContain('did not validate');
      expect(out[0]?.file).toBe('package.json');
    } finally {
      chmodSync(blocked, 0o755);
    }
  });

  it('warns that the React floor went unchecked when no manifest validates', async () => {
    // "no manifest readable" must not read as "react is not a dependency".
    write('tsconfig.json', COMPLIANT_TSCONFIG);
    writeFileSync(join(root, 'package.json'), '{ "name": \n');
    const out = await collectFloorViolations(root);
    expect(ids(out)).toEqual(['manifests-unreadable']);
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
    expect((await findPackageManifests(root)).manifests).toEqual([
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
    expect((await findPackageManifests(root)).manifests).toEqual(['package.json']);
  });

  it('returns an empty list for a root with no manifest', async () => {
    expect((await findPackageManifests(root)).manifests).toEqual([]);
  });

  it('reaches a scoped package directory', async () => {
    // `packages/@scope/ui/package.json` sits one level deeper than the flat
    // layouts; at the old depth a scoped monorepo read as having no React.
    writeFileSync(join(root, 'package.json'), '{"name":"root"}\n');
    manifest('packages', '@scope', 'ui');
    expect((await findPackageManifests(root)).manifests).toEqual([
      'package.json',
      join('packages', '@scope', 'ui', 'package.json'),
    ]);
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

  it('says nothing about waivers when there is simply no consumer config', async () => {
    // Most repos running this floor have no toolchainFloor block at all; a
    // "waivers could not be read" line in front of every one of them is noise
    // that trains the reader to skip the warning channel.
    const result = await makeToolchainFloorInvariant(root).run();
    expect(result.violations.some((v) => v.message.includes('waivers could not be read'))).toBe(
      false,
    );
  });

  it('keeps the original finding text alongside the waiver reason', async () => {
    // A waiver downgrades a finding; a downgraded finding the reader cannot see
    // is a silenced one.
    writeConfig({
      ...baseConsumer,
      toolchainFloor: {
        waivers: [{ id: 'disposable-lib', reason: 'deploy target lacks Symbol.dispose support' }],
      },
    });
    const result = await makeToolchainFloorInvariant(root).run();
    const waived = result.violations.filter((v) => v.message.includes('disposable-lib'));
    expect(waived).toHaveLength(1);
    expect(waived[0]?.message).toContain('deploy target lacks Symbol.dispose');
    expect(waived[0]?.message).toContain('Explicit Resource Management');
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

  it('warns, rather than silently dropping every waiver, when the block is rejected', async () => {
    // ToolchainFloorSchema is .strict(), so one stray key discards the whole
    // block — the operator must not be left staring at a floor they waived.
    writeConfig({
      ...baseConsumer,
      toolchainFloor: {
        waivers: [{ id: 'disposable-lib', reason: 'no Symbol.dispose on our deploy target' }],
        typo: true,
      },
    });
    const result = await makeToolchainFloorInvariant(root).run();
    const notice = result.violations.filter((v) => v.message.includes('waivers could not be read'));
    expect(notice).toHaveLength(1);
    expect(notice[0]?.severity).toBe('warn');
    // and the waiver really did not apply
    expect(
      result.violations.some((v) => v.severity === 'error' && v.message.includes('Disposable')),
    ).toBeTruthy();
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
    // The fixture's lib is ['ES2023'], so the built-ins half blocks too — it was
    // not waived, and only the id named in the waiver may be downgraded.
    expect(
      blocking.every(
        (v) =>
          v.message.includes('rules-of-hooks') ||
          v.message.includes('exhaustive-deps') ||
          v.message.includes('below es2025'),
      ),
    ).toBeTruthy();
    expect(blocking.some((v) => v.message.includes('below es2025'))).toBeTruthy();
    expect(blocking.some((v) => v.message.includes('rules-of-hooks'))).toBeTruthy();
  });
});

describe('nested tsconfig lib floor', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'toolchain-floor-nested-'));
    writeFileSync(join(root, 'package.json'), '{"name":"x"}\n');
    writeFileSync(join(root, 'tsconfig.json'), `${JSON.stringify(COMPLIANT_TSCONFIG)}\n`);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Write a tsconfig at a nested path, creating its directories. */
  const nested = (rel: readonly string[], value: unknown): string => {
    mkdirSync(join(root, ...rel.slice(0, -1)), { recursive: true });
    writeFileSync(join(root, ...rel), `${JSON.stringify(value, null, 2)}\n`);
    return join(...rel);
  };

  it('grades a nested config whose declared lib sits below the floor', async () => {
    // The live case: a compliant root, and a nested config that overrides it —
    // `lib` replaces rather than merges, so the root's compliance protects
    // nothing here.
    const path = nested(['packages', 'ui', 'tsconfig.json'], {
      compilerOptions: { lib: ['ES2023', 'DOM'] },
    });
    const out = await collectFloorViolations(root);
    expect(ids(out)).toEqual(['disposable-lib', 'lib-es-builtins']);
    expect(out.every((v) => v.file === path)).toBeTruthy();
    expect(out.every((v) => v.severity === 'error')).toBeTruthy();
  });

  it('stays silent for a nested config that declares no lib', async () => {
    nested(['packages', 'ui', 'tsconfig.json'], {
      extends: '../../tsconfig.json',
      compilerOptions: { outDir: 'dist' },
    });
    expect(await collectFloorViolations(root)).toEqual([]);
  });

  it('stays silent for a nested config declaring an umbrella lib', async () => {
    nested(['packages', 'ui', 'tsconfig.json'], { compilerOptions: { lib: ['ESNext'] } });
    expect(await collectFloorViolations(root)).toEqual([]);
  });

  it('reports a nested lib that is a string rather than an array', async () => {
    const path = nested(['packages', 'ui', 'tsconfig.json'], {
      compilerOptions: { lib: 'ESNext' },
    });
    const out = await collectFloorViolations(root);
    expect(out).toEqual([
      expect.objectContaining({ id: 'lib-malformed', file: path, severity: 'error' }),
    ]);
  });

  it('reports an unparseable nested tsconfig as an error', async () => {
    mkdirSync(join(root, 'packages', 'ui'), { recursive: true });
    const path = join('packages', 'ui', 'tsconfig.json');
    writeFileSync(join(root, path), '{ "compilerOptions": { "lib": [ \n');
    const out = await collectFloorViolations(root);
    expect(out).toEqual([
      expect.objectContaining({ id: 'tsconfig-invalid', file: path, severity: 'error' }),
    ]);
  });

  it('discovers a tsconfig whose name is not tsconfig.json', async () => {
    const path = nested(['apps', 'web', 'tsconfig.app.json'], {
      compilerOptions: { lib: ['ES2023'] },
    });
    const out = await collectFloorViolations(root);
    expect(out.every((v) => v.file === path)).toBeTruthy();
    expect(ids(out)).toEqual(['disposable-lib', 'lib-es-builtins']);
  });

  it('does not report a root candidate twice when the walk also finds it', async () => {
    // The root tsconfig is discovered by the walk as well as by the anchor loop.
    // A compliant one must still produce nothing.
    expect(await collectFloorViolations(root)).toEqual([]);
  });

  it('reports an unparseable root candidate once, not once per discovery path', async () => {
    // The anchor loop reports it but never grades it, so a skip keyed on
    // "already graded" would let the walk report it a second time.
    writeFileSync(join(root, 'tsconfig.json'), '{ "compilerOptions": { \n');
    const out = await collectFloorViolations(root);
    expect(out.filter((v) => v.id === 'tsconfig-invalid')).toHaveLength(1);
  });

  it('skips tsconfigs under every fixture directory name', async () => {
    // Each of these would otherwise red the repo's own pre-commit on a file
    // that exists precisely to be below the floor.
    for (const dir of ['__tests__', '__fixtures__', 'fixtures', 'test', 'tests', 'e2e']) {
      nested([dir, 'trees', 'tsconfig.json'], { compilerOptions: { lib: ['ES2023'] } });
    }
    expect(await collectFloorViolations(root)).toEqual([]);
  });

  it('skips a tsconfig nested below a fixture directory, not just inside it', async () => {
    nested(['__tests__', 'trees', 'tsconfig.json'], { compilerOptions: { lib: ['ES5'] } });
    expect(await collectFloorViolations(root)).toEqual([]);
  });

  it('still collects a package.json inside a fixture directory', async () => {
    // The exclusion suppresses the tsconfig harvest only; the manifest half
    // answers a different question and must be unchanged.
    mkdirSync(join(root, 'test', 'app'), { recursive: true });
    writeFileSync(join(root, 'test', 'app', 'package.json'), '{"name":"fixture"}\n');
    const scan = await findPackageManifests(root);
    expect(scan.manifests).toContain(join('test', 'app', 'package.json'));
  });

  it('skips tsconfigs under node_modules and other skipped dirs', async () => {
    nested(['node_modules', 'dep', 'tsconfig.json'], { compilerOptions: { lib: ['ES2023'] } });
    nested(['dist', 'tsconfig.json'], { compilerOptions: { lib: ['ES2023'] } });
    expect(await collectFloorViolations(root)).toEqual([]);
  });

  it('waives a nested finding by id, exactly as it does a root one', async () => {
    nested(['packages', 'ui', 'tsconfig.json'], { compilerOptions: { lib: ['ES2023', 'DOM'] } });
    mkdirSync(join(root, '.noldor'), { recursive: true });
    writeFileSync(
      join(root, '.noldor', 'config.json'),
      `${JSON.stringify({
        consumer: {
          name: 'x',
          repoUrl: 'https://example.com/x',
          lockstepPackages: ['package.json'],
          e2ePrefix: 'e2e/',
          samplesPath: 'samples',
          packagePrefix: '@x/',
          appPathPrefix: 'src',
          toolchainFloor: {
            waivers: [
              { id: 'lib-es-builtins', reason: 'deploy target predates es2025' },
              { id: 'disposable-lib', reason: 'deploy target predates Symbol.dispose' },
            ],
          },
        },
      })}\n`,
    );
    const result = await makeToolchainFloorInvariant(root).run();
    const libFindings = result.violations.filter((v) => v.message.includes('[waived:'));
    expect(libFindings).toHaveLength(2);
    expect(libFindings.every((v) => v.severity === 'warn')).toBeTruthy();
  });

  it('reports the nested finding, and lib-inherited, independently', async () => {
    // A root with no declared lib still earns lib-inherited; a nested config
    // declaring a compliant one must not suppress it.
    writeFileSync(join(root, 'tsconfig.json'), `${JSON.stringify({ compilerOptions: {} })}\n`);
    nested(['packages', 'ui', 'tsconfig.json'], { compilerOptions: { lib: ['ESNext'] } });
    expect(ids(await collectFloorViolations(root))).toContain('lib-inherited');
  });
});
