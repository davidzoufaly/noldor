import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

/**
 * What the packaged runtime must satisfy: one runtime tree, its assets, no
 * transpiler, and a CLI that actually executes from `dist`.
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

  const stray = walk(join(pkg, 'dist')).filter((f) => f.endsWith('.d.ts') || f.endsWith('.map'));
  if (stray.length > 0) problems.push(`${stray.length} declaration/sourcemap file(s) shipped`);

  // Module-adjacent assets tsc never emits: the dashboard bundle it serves and
  // the schema, prompts and canned fixture the CR lanes read.
  for (const asset of [
    'dist/cr/cr-record.schema.json',
    'dist/cr/lanes/escalate-prompt.md',
    'dist/cr/standalone-prompt.md',
    'dist/dashboard/static/dist/agents.js',
    'dist/dashboard/static/dist/drag.js',
    'dist/testing/fixtures/canned/add-greeting-helper.json',
  ]) {
    if (!existsSync(join(pkg, asset))) problems.push(`runtime asset missing: ${asset}`);
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
 * dispatching. Module loadability is covered by {@link checkPackagedImportGraph},
 * which resolves the compiled import graph statically rather than executing 112
 * entrypoints.
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
 * Every relative specifier in the packaged `dist` must resolve inside the
 * tarball. Catches the class tsx hides in a checkout: an extensionless relative
 * import that plain Node ESM refuses.
 *
 * @param fixtureDir - Fixture with the tarball installed.
 * @returns Unresolvable `file -> specifier` pairs; empty when the graph is whole.
 */
export function checkPackagedImportGraph(fixtureDir: string): string[] {
  const dist = join(installedPackage(fixtureDir), 'dist');
  const broken: string[] = [];
  for (const file of walk(dist).filter((f) => f.endsWith('.js'))) {
    const text = readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      const specs = [
        ...line.matchAll(/(?:^|;)\s*(?:import|export)[^'"]*from\s*['"](\.[^'"]*)['"]/g),
        ...line.matchAll(/\bimport\(\s*['"](\.[^'"]*)['"]\s*\)/g),
      ].map((m) => m[1] as string);
      for (const spec of specs) {
        const target = join(dirname(file), spec);
        if (!existsSync(target) && !existsSync(join(target, 'index.js'))) {
          broken.push(`${file.slice(dist.length + 1)} -> ${spec}`);
        }
      }
    }
  }
  return broken;
}
