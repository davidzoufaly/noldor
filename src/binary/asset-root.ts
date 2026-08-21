import { isAbsolute, join } from 'node:path';

/**
 * Channel marker: exactly the value '1' activates binary behavior (spec
 * Unit 2). Anything else — unset, '0', 'true' — is the npm channel, so a
 * stray value can never flip spawn semantics.
 */
export function isBinaryChannel(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NOLDOR_BINARY === '1';
}

/**
 * Operator-provided package root. Absolute-or-throw on BOTH channels — the
 * npm channel reaches this same validation, so misuse fails identically
 * everywhere (spec Unit 1 path equations). Env is a trust boundary: the
 * throw is caught once at the process entry, which exits 1 naming the
 * variable.
 */
export function assetRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.NOLDOR_ASSET_ROOT;
  if (raw === undefined) return null;
  if (raw === '' || !isAbsolute(raw)) {
    throw new Error(`NOLDOR_ASSET_ROOT must be an absolute path (got '${raw}')`);
  }
  return raw;
}

/**
 * Version-keyed extraction destination. The version key is appended even
 * under the NOLDOR_CACHE_DIR override so an upgrade never serves a stale
 * tree (spec Unit 1).
 */
export function resolveAssetCachePath(
  version: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const base = env.NOLDOR_CACHE_DIR;
  if (base !== undefined) {
    if (base === '' || !isAbsolute(base)) {
      throw new Error(`NOLDOR_CACHE_DIR must be an absolute path (got '${base}')`);
    }
    return join(base, version, 'pkg');
  }
  if (platform === 'darwin') {
    const home = env.HOME;
    if (!home || !isAbsolute(home)) {
      throw new Error(
        `cannot resolve cache dir: HOME must be an absolute path (got '${home ?? ''}')`,
      );
    }
    return join(home, 'Library', 'Caches', 'noldor', version, 'pkg');
  }
  const xdg = env.XDG_CACHE_HOME;
  if (xdg) {
    if (!isAbsolute(xdg)) {
      throw new Error(`cannot resolve cache dir: XDG_CACHE_HOME must be absolute (got '${xdg}')`);
    }
    return join(xdg, 'noldor', version, 'pkg');
  }
  const home = env.HOME;
  if (!home || !isAbsolute(home)) {
    throw new Error('cannot resolve cache dir: HOME and XDG_CACHE_HOME are unset or relative');
  }
  return join(home, '.cache', 'noldor', version, 'pkg');
}
