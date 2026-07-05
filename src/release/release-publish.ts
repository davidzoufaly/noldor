import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

// `./index.js` ↔ this module is a deliberate ESM cycle — both sides export
// hoisted function declarations referenced only at call time, and index.ts's
// own entry guard keys on `process.argv[1]`, so importing it here never fires
// a release run.
import { loadConfigSync } from '../core/config.js';
import { appendOverrideLog } from '../core/overrides-log.js';
import { buildConsumerFixture } from '../testing/consumer-fixture.js';
import { installFrameworkTarball, runContractChecks } from '../testing/contract-harness.js';
import { ensureCleanTreeOnMain } from './index.js';

const execFileP = promisify(execFile);

/** Default poll target; overridable per-consumer via `release.publish.registry`. */
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_POLL_MS = 10_000;

/** Exec seam so unit tests can stub the `npm view` probe without PATH games. */
export type ExecFn = (
  cmd: string,
  args: string[],
  env?: Record<string, string>,
) => Promise<{ stdout: string }>;

const realExec: ExecFn = (cmd, args, env) =>
  execFileP(cmd, args, { env: env ? { ...process.env, ...env } : process.env });

export interface RegistryProbe {
  pkgName: string;
  version: string;
  /** Poll target (default {@link DEFAULT_REGISTRY}). */
  registry?: string;
  /** Extra env for the spawned `npm` (resume tests prepend a fake-npm PATH). */
  env?: Record<string, string>;
  /** Test seam; defaults to a real execFile. */
  exec?: ExecFn;
}

/** One registry probe: does `<pkg>@<version>` resolve? npm non-zero = not yet. */
export async function isVersionOnRegistry(probe: RegistryProbe): Promise<boolean> {
  const exec = probe.exec ?? realExec;
  const registry = probe.registry ?? DEFAULT_REGISTRY;
  try {
    await exec(
      'npm',
      ['view', `${probe.pkgName}@${probe.version}`, 'version', '--json', '--registry', registry],
      probe.env,
    );
    return true;
  } catch {
    return false;
  }
}

export interface AwaitPublishOptions extends RegistryProbe {
  /** Give-up horizon (default 5 min; env `NOLDOR_PUBLISH_TIMEOUT_MS`). */
  timeoutMs?: number;
  /** Probe interval (default 10 s; env `NOLDOR_PUBLISH_POLL_MS`). */
  pollMs?: number;
}

export interface AwaitPublishResult {
  ok: true;
  elapsedMs: number;
}

/** Positive-number env override for poll tuning; anything else → fallback. */
function envTuning(env: Record<string, string> | undefined, key: string, fallback: number): number {
  const raw = env?.[key] ?? process.env[key];
  const n = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Poll the registry until `<pkg>@<version>` is visible. The publish itself is
 * executed by the tag-triggered publish.yml workflow (npm Trusted Publishing
 * via CI OIDC; `--provenance` only when `release.publish.provenance` is on —
 * attestation needs a public repo) — the release pipeline only WAITS here.
 * Timeout throws with the two recovery moves; the caller keeps
 * `.noldor/release-state.json` behind so `pnpm release --resume` can finish.
 */
export async function awaitPublish(opts: AwaitPublishOptions): Promise<AwaitPublishResult> {
  const timeoutMs =
    opts.timeoutMs ?? envTuning(opts.env, 'NOLDOR_PUBLISH_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const pollMs = opts.pollMs ?? envTuning(opts.env, 'NOLDOR_PUBLISH_POLL_MS', DEFAULT_POLL_MS);
  const registry = opts.registry ?? DEFAULT_REGISTRY;
  const started = Date.now();
  for (;;) {
    if (await isVersionOnRegistry(opts)) {
      return { ok: true, elapsedMs: Date.now() - started };
    }
    const elapsed = Date.now() - started;
    if (elapsed + pollMs > timeoutMs) {
      throw new Error(
        `Timed out after ${Math.round(elapsed / 1000)}s waiting for ` +
          `${opts.pkgName}@${opts.version} on ${registry}. Check the workflow with ` +
          '`gh run list --workflow publish.yml`, then finish with `pnpm release --resume` ' +
          '(or `pnpm noldor release publish --wait <version>`).',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

export interface PkgIdentity {
  name: string;
  version: string;
}

/** `name` + `version` from `<cwd>/package.json`; both are publish-load-bearing. */
export function readPkgIdentity(cwd: string): PkgIdentity {
  const raw = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as Partial<PkgIdentity>;
  if (!raw.name || !raw.version) {
    throw new Error('package.json must declare both name and version.');
  }
  return { name: raw.name, version: raw.version };
}

const USAGE = 'usage: noldor release publish [--verify-tarball | --wait <version> | --local]\n';

/**
 * `--verify-tarball` (default mode): pack the working tree, install the
 * tarball into a scratch consumer fixture, and run the contract checks — the
 * same fidelity loop as `pnpm test:contract`, exposed as the operator
 * pre-flight before tagging a release.
 */
async function verifyTarball(): Promise<void> {
  const fx = buildConsumerFixture();
  try {
    installFrameworkTarball(fx.dir);
    const results = runContractChecks(fx.dir);
    const failed = Object.entries(results).filter(([, code]) => code !== 0);
    if (failed.length > 0) {
      console.error('verify-tarball: contract checks FAILED:', failed);
      process.exitCode = 1;
      return;
    }
    console.log('verify-tarball: pack + scratch install + contract checks passed:', results);
  } finally {
    fx.cleanup();
  }
}

/**
 * `--local`: CI-down emergency executor. Provenance is impossible outside CI
 * OIDC, so this is loud + logged (`.noldor/overrides.log`, surfaced by the
 * garden override-audit) and guarded by the release pipeline's own preflight
 * (main branch, clean tree, synced origin) plus a HEAD-tag check.
 */
async function publishLocal(cwd: string): Promise<void> {
  await ensureCleanTreeOnMain();
  const { name, version } = readPkgIdentity(cwd);
  const { stdout } = await execFileP('git', ['tag', '--points-at', 'HEAD'], { cwd });
  const headTags = stdout.split('\n').map((t) => t.trim());
  if (!headTags.includes(`v${version}`)) {
    throw new Error(
      `HEAD is not tagged v${version} — run pnpm release first; --local only ` +
        're-executes the publish of an already-tagged release.',
    );
  }
  console.warn(
    'WARNING: --local publishes WITHOUT provenance (emergency hatch for CI-down). ' +
      'Prefer re-running the publish.yml workflow.',
  );
  appendOverrideLog(cwd, 'release publish --local', 'release');
  await execFileP('npm', ['publish', '--access', 'public'], { cwd });
  console.log(`Published ${name}@${version} to the registry (no provenance).`);
}

/** `--wait <version>`: bare awaitPublish, for a release whose state file is gone. */
async function waitForVersion(cwd: string, version: string): Promise<void> {
  const publishCfg = loadConfigSync(join(cwd, '.noldor/config.json'))?.release?.publish;
  const { name } = readPkgIdentity(cwd);
  const { elapsedMs } = await awaitPublish({
    pkgName: name,
    version,
    registry: publishCfg?.registry,
  });
  console.log(`${name}@${version} visible after ${Math.round(elapsedMs / 1000)}s.`);
}

async function cliMain(): Promise<void> {
  const args = process.argv.slice(2);
  const cwd = process.cwd();
  if (args.includes('--local')) {
    await publishLocal(cwd);
    return;
  }
  const waitIdx = args.indexOf('--wait');
  if (waitIdx !== -1) {
    const version = args[waitIdx + 1];
    if (!version || version.startsWith('--')) {
      process.stderr.write(USAGE);
      process.exitCode = 1;
      return;
    }
    await waitForVersion(cwd, version);
    return;
  }
  await verifyTarball(); // default mode; also the explicit --verify-tarball
}

// Execute only when dispatched as the CLI entrypoint (`noldor release publish`
// reshapes argv so argv[1] is this module's path). Importing this module —
// including from ./index.ts — must NOT fire the CLI.
const invokedDirect = /[\\/]release-publish\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) {
  cliMain().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`release publish failed: ${message}`);
    process.exitCode = 1;
  });
}
