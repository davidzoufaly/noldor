import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
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
  const r = spawnSync('node', [bin, ...args], { cwd, encoding: 'utf8' });
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
  execFileSync('pnpm', ['add', join(fixtureDir, tgz)], { cwd: fixtureDir, stdio: 'pipe' });
}

/** Drive the four read-only contract commands; return per-step exit codes. */
export function runContractChecks(fixtureDir: string): Record<string, number> {
  const steps: [string, string[]][] = [
    ['init', ['init']],
    ['doctor', ['doctor']],
    ['validate-features', ['validate', 'features']],
    ['garden-detect', ['garden', 'detect']],
  ];
  const out: Record<string, number> = {};
  for (const [name, args] of steps) out[name] = runConsumerCli(fixtureDir, args).exitCode;
  return out;
}
