import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// @ts-expect-error — plain .mjs siblings in bin/, no type declarations by design
import { auditImportGraph } from '../../bin/import-graph.mjs';
// @ts-expect-error — same
import { expectedOutputs } from '../../bin/build-manifest.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname, isAbsolute } from 'node:path';

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * The ambient environment minus every runtime override, so what the contract
 * proves cannot depend on the operator's shell.
 *
 * @returns A copy of `process.env` with `NOLDOR_RUNTIME*` removed.
 */
function scrubbedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('NOLDOR_RUNTIME')) delete env[key];
  }
  return env;
}

/** Repo root: src/testing/ -> src/ -> root. */
function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

/**
 * Run the framework CLI against a fixture dir, in-tree (no tarball) for speed.
 * The contract job's tarball install is exercised by {@link installFrameworkTarball};
 * unit tests use the in-tree bin to keep the suite fast.
 */
export function runConsumerCli(cwd: string, args: string[]): CliResult {
  const bin = join(repoRoot(), 'bin', 'noldor.mjs');
  const r = spawnSync('node', [bin, ...args], { cwd, encoding: 'utf8', env: scrubbedEnv() });
  return { exitCode: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/**
 * Run the INSTALLED framework CLI (the fixture's `node_modules/.bin/noldor`,
 * placed by {@link installFrameworkTarball}). This is what locks the
 * `package.json` `files` whitelist: the packaged bin resolves templates and
 * src from the tarball, not the working tree.
 */
export function runInstalledCli(cwd: string, args: string[]): CliResult {
  const bin = join(cwd, 'node_modules', '.bin', 'noldor');
  const r = spawnSync(bin, args, { cwd, encoding: 'utf8', env: scrubbedEnv() });
  return { exitCode: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Build a tarball of the working tree and install it into the fixture (contract fidelity). */
export function installFrameworkTarball(fixtureDir: string): void {
  const root = repoRoot();
  const out = execFileSync('pnpm', ['pack', '--pack-destination', fixtureDir], {
    cwd: root,
    encoding: 'utf8',
  });
  const tgz = out.trim().split('\n').pop() as string;
  // `pnpm pack --pack-destination` prints an absolute path; only join when relative.
  const tgzPath = isAbsolute(tgz) ? tgz : join(fixtureDir, tgz);
  execFileSync('pnpm', ['add', tgzPath], { cwd: fixtureDir, stdio: 'pipe' });
}

/** Drive the four read-only contract commands; return per-step exit codes. */
export function runContractChecks(fixtureDir: string): Record<string, number> {
  const out: Record<string, number> = {};
  // init runs from the INSTALLED bin so it scaffolds from the packaged
  // templates — the in-tree doctor below then diffs the consumer against the
  // full in-tree template list, so a template missing from the tarball
  // surfaces as doctor drift instead of passing silently.
  out['init'] = runInstalledCli(fixtureDir, ['init']).exitCode;
  const steps: [string, string[]][] = [
    ['doctor', ['doctor']],
    ['validate-features', ['validate', 'features']],
    ['garden-detect', ['garden', 'detect']],
  ];
  for (const [name, args] of steps) out[name] = runConsumerCli(fixtureDir, args).exitCode;
  return out;
}

/** The installed package root inside a fixture. */
function installedPackage(fixtureDir: string): string {
  return join(fixtureDir, 'node_modules', '@david.zoufaly', 'noldor');
}

/**
 * What the packaged runtime must satisfy: one runtime tree, its assets, no
 * transpiler, and a CLI that executes from `dist`.
 *
 * Asset and output expectations come from `bin/build-manifest.mjs`, the declared
 * single owner — a local copy of the list is exactly the silent drift its
 * docstring warns about.
 *
 * @param fixtureDir - Fixture with the tarball installed.
 * @returns Named violations; empty when the packaged runtime is sound.
 */
export function checkPackagedRuntime(fixtureDir: string): string[] {
  const pkg = installedPackage(fixtureDir);
  const problems: string[] = [];

  if (existsSync(join(pkg, 'src'))) problems.push('tarball still carries src/');
  if (!existsSync(join(pkg, 'dist/cli/index.js')))
    problems.push('tarball has no dist/cli/index.js');
  if (existsSync(join(fixtureDir, 'node_modules', 'tsx'))) {
    problems.push('tsx installed in a consumer (it must be a devDependency)');
  }

  // Every compiled module and runtime asset the current sources require, per the
  // manifest that owns that list — never a copy of it.
  for (const rel of expectedOutputs(repoRoot())) {
    if (!existsSync(join(pkg, 'dist', rel))) problems.push(`packaged dist is missing ${rel}`);
  }

  // Name the offenders: a count alone leaves CI red with nothing to act on.
  const graph = auditImportGraph(join(pkg, 'dist'));
  for (const entry of graph.unresolved.slice(0, 10)) {
    problems.push(`unresolvable specifier in packaged dist: ${entry}`);
  }
  for (const entry of graph.extensionless.slice(0, 10)) {
    problems.push(`extensionless specifier in packaged dist: ${entry}`);
  }

  const doctor = runInstalledCli(fixtureDir, ['doctor']);
  if (!doctor.stdout.includes('runtime: dist (no-source-tree)')) {
    problems.push(
      `installed doctor did not report the dist runtime: ${doctor.stdout.slice(0, 200)}`,
    );
  }

  return problems;
}

/**
 * `--help` through the installed CLI for every subcommand the manifest declares.
 *
 * This proves the packaged ROUTER loads and knows every command — not that each
 * entrypoint loads, because the router returns on a help flag before
 * dispatching. Module loadability is covered by the import-graph audit inside
 * {@link checkPackagedRuntime}.
 *
 * @param fixtureDir - Fixture with the tarball installed.
 * @param subcommands - `[group, sub]` pairs from `flattenManifest()`.
 * @returns Subcommands whose help did not exit 0.
 */
export function checkInstalledSubcommands(
  fixtureDir: string,
  subcommands: readonly (readonly [string, string])[],
): string[] {
  const failed: string[] = [];
  for (const [group, sub] of subcommands) {
    const args = sub === '' ? [group, '--help'] : [group, sub, '--help'];
    if (runInstalledCli(fixtureDir, args).exitCode !== 0) failed.push(`${group} ${sub}`.trim());
  }
  return failed;
}

/**
 * Exercise the two module-relative resolutions that MOVE with the runtime, in
 * the packaged tree. Presence of every asset is already covered by
 * {@link checkPackagedRuntime}'s `expectedOutputs` loop; these probe the code
 * paths that compute a path from their own module URL, which is what breaks when
 * a module changes directory depth.
 *
 * @param fixtureDir - Fixture with the tarball installed.
 * @returns Named failures; empty when both probes passed.
 */
export function checkPackagedAssetBehaviour(fixtureDir: string): string[] {
  const pkg = installedPackage(fixtureDir);
  const problems: string[] = [];

  // codex-adapter.ts computes CR_RECORD_SCHEMA_PATH from its own module URL —
  // pure string math, so importing it proves nothing on its own. Read the export
  // back and check the path it produced actually exists in the package: that is
  // the resolution which moves if a module changes directory depth.
  const adapter = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const { existsSync } = await import('node:fs');
       const m = await import(process.argv[1]);
       const p = m.CR_RECORD_SCHEMA_PATH;
       if (typeof p !== 'string') throw new Error('CR_RECORD_SCHEMA_PATH is not exported');
       if (!existsSync(p)) throw new Error('schema path does not resolve: ' + p);`,
      pathToFileURL(join(pkg, 'dist/cr/codex-adapter.js')).href,
    ],
    { encoding: 'utf8', env: scrubbedEnv() },
  );
  if (adapter.status !== 0) {
    problems.push(`packaged cr-record schema does not resolve: ${adapter.stderr.slice(0, 300)}`);
  }

  // The stub-gate entry is the one that used to import tsx statically. This
  // proves its module graph loads from the package; it stops at the entry's own
  // argument parsing rather than running applyStubGate, which would write to and
  // commit in the fixture.
  const stub = spawnSync(process.execPath, [join(pkg, 'bin/noldor-stub-gate.mjs')], {
    cwd: fixtureDir,
    encoding: 'utf8',
    env: scrubbedEnv(),
  });
  const stubOutput = `${stub.stderr}${stub.stdout}`;
  const loadFailure =
    /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find (?:module|package)|SyntaxError|ERR_UNSUPPORTED|ENOENT/;
  if (stub.status === null || loadFailure.test(stubOutput)) {
    problems.push(`packaged stub-gate entry failed to load: ${stubOutput.slice(0, 300)}`);
  }

  return problems;
}
