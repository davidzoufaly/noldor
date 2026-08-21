// Decides whether an invocation runs compiled `dist` or transpiles `src`
// through tsx. PURE: it never prints, never exits, and never writes to the
// filesystem — `bin/boot.mjs` owns every effect. That split is what lets the
// whole reason enum be unit-tested without spawning a process, and it is why a
// read-only CLI invocation can never delete a concurrent builder's lock.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { digestInputs, expectedOutputs, readInput } from './build-manifest.mjs';

export const STAMP_VERSION = 1;
export const STAMP_FILE = 'dist/.build-stamp';
export const LOCK_FILE = 'dist/.build-lock';

const verdict = (runtime, reason, stale = false) => ({ reason, runtime, stale });

/**
 * SHA-256 over every digest input's path and content.
 *
 * @param root - Package root.
 * @returns Hex digest.
 */
export function computeDigest(root) {
  const inputs = digestInputs(root);
  const hash = createHash('sha256');
  // The path list is hashed first, so adding or deleting an input changes the
  // digest even when every surviving file is byte-identical.
  hash.update(inputs.join('\n'));
  for (const rel of inputs) {
    hash.update(rel);
    hash.update(readInput(root, rel));
  }
  return hash.digest('hex');
}

/**
 * {@link computeDigest}, but a file disappearing between the enumeration and the
 * read degrades to "not current" instead of throwing out of the CLI. A rebase or
 * a formatter pass deleting a source file mid-scan must not crash an unrelated
 * invocation.
 *
 * @param root - Package root.
 * @returns The digest, or null when the tree moved under us.
 */
export function tryComputeDigest(root) {
  try {
    return computeDigest(root);
  } catch {
    return null;
  }
}

/**
 * Whether `pid` is a live process. A fresh probe, never a timeout — a slow
 * build is not an abandoned one.
 *
 * @param pid - Process id from the lock file.
 * @returns True when the process exists.
 */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/**
 * Lock state, read without ever throwing.
 *
 * An unparseable lock reads as held: the pid is written just after the
 * exclusive create, so a reader landing in that window sees an empty file, and
 * treating that as "no build" would hand it a half-written tree.
 *
 * @param root - Package root.
 * @returns `'held'`, `'stale'` (dead pid) or `'absent'`.
 */
function readLock(root) {
  let raw;
  try {
    raw = readFileSync(join(root, LOCK_FILE), 'utf8');
  } catch {
    return 'absent';
  }
  const pid = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(pid)) return 'held';
  return pidAlive(pid) ? 'held' : 'stale';
}

function readStamp(root) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(root, STAMP_FILE), 'utf8'));
  } catch (error) {
    return { error: error.code === 'ENOENT' ? 'no-stamp' : 'bad-stamp' };
  }
  if (parsed?.version !== STAMP_VERSION || typeof parsed.digest !== 'string') {
    return { error: 'bad-stamp' };
  }
  if (!Array.isArray(parsed.outputs) || parsed.outputs.some((o) => typeof o !== 'string')) {
    return { error: 'bad-stamp' };
  }
  // An entry escaping dist/ would let a malformed stamp point the presence
  // check anywhere on disk. Backslashes are rejected too: a '..\\' segment is a
  // traversal on Windows that a '/'-only split would not see.
  const escapes = (o) =>
    o.startsWith('/') || /^[a-zA-Z]:/.test(o) || o.split(/[/\\]/).includes('..');
  if (parsed.outputs.some(escapes)) return { error: 'bad-stamp' };
  return { stamp: parsed };
}

/**
 * Pick the runtime for this invocation.
 *
 * @param root - Package root.
 * @param env - Environment to read `NOLDOR_RUNTIME` from.
 * @returns `{ runtime, reason, stale }`; `runtime: 'error'` is the caller's cue
 *   to exit, per the table in bin/boot.mjs.
 */
export function selectRuntime(root, env = process.env) {
  const hasDist = existsSync(join(root, 'dist/cli/index.js'));
  const hasSource = existsSync(join(root, 'src/cli/index.ts'));
  const override = env.NOLDOR_RUNTIME ?? '';

  if (override === 'dist') {
    if (!hasDist) return verdict('error', 'forced-dist-absent');
    const state = currentState(root, hasSource);
    return state === 'digest-match' || state === 'no-source-tree'
      ? verdict('dist', 'forced-dist')
      : verdict('dist', 'forced-dist-stale', true);
  }

  if (override === 'source') {
    if (!hasSource) return verdict('error', 'forced-source-no-src');
    if (!tsxInstalled(root)) return verdict('error', 'forced-source-no-tsx');
    return verdict('source', 'forced-source');
  }

  if (override !== '') return verdict('error', 'bad-override');

  if (!hasSource) return verdict('dist', 'no-source-tree');
  if (!hasDist) {
    return tsxInstalled(root) ? verdict('source', 'no-dist', true) : verdict('error', 'no-runtime');
  }

  const state = currentState(root, hasSource);
  if (state === 'digest-match') return verdict('dist', 'digest-match');
  // Stale, but the fallback needs a transpiler. A prod-only install has none, so
  // serve the stale build with a notice instead of crashing on a missing tsx.
  if (!tsxInstalled(root)) return verdict('dist', 'stale-dist-no-tsx', true);
  return verdict('source', state, true);
}

function tsxInstalled(root) {
  return existsSync(join(root, 'node_modules/tsx'));
}

/**
 * Why the compiled tree is or is not current.
 *
 * @param root - Package root.
 * @param hasSource - Whether a source tree exists to compare against.
 * @returns A reason string; `digest-match` means current.
 */
export function currentState(root, hasSource = existsSync(join(root, 'src/cli/index.ts'))) {
  if (!hasSource) return 'no-source-tree';
  // Read-only: a lock means a build is mid-flight, so the tree may be half
  // rewritten. Reclaiming a dead-pid lock belongs to `pnpm build` alone.
  const lockState = readLock(root);
  if (lockState === 'held') return 'build-in-progress';
  const { error, stamp } = readStamp(root);
  if (error) return error;

  // The recorded output list must BE the set the current sources require. A
  // stamp whose digest matches but whose outputs are a subset would otherwise
  // bless a tree missing compiled modules.
  const expected = expectedOutputs(root);
  const recorded = new Set(stamp.outputs);
  if (recorded.size !== expected.length || expected.some((out) => !recorded.has(out))) {
    return 'bad-stamp';
  }

  const digest = tryComputeDigest(root);
  if (digest === null) return 'digest-mismatch';
  if (stamp.digest !== digest) return 'digest-mismatch';
  for (const out of expected) {
    if (!existsSync(join(root, 'dist', out))) return 'missing-output';
  }
  return 'digest-match';
}
