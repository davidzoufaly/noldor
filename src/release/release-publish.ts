import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

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
