#!/usr/bin/env node
// `pnpm build`. Ordered so that no failure path can leave a stale tree blessed
// by a valid stamp:
//
//   mkdir dist -> drop stamp -> lock -> digest(start) -> tsc -> copy assets
//   -> prune -> digest(end) -> stamp
//
// The stamp is removed first, so an interruption anywhere reads as stale. The
// start/end digest bracket refuses to bless output that cannot correspond to a
// single revision.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  statSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';

import { expectedOutputs } from './build-manifest.mjs';
import { copyRuntimeAssets } from './copy-runtime-assets.mjs';
import {
  LOCK_FILE,
  STAMP_FILE,
  STAMP_VERSION,
  computeDigest,
  pidAlive,
} from './runtime-select.mjs';

const root = process.cwd();
const toPosix = (p) => p.split(sep).join('/');

function acquireLock(attempt = 0) {
  const lock = join(root, LOCK_FILE);
  try {
    const fd = openSync(lock, 'wx');
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }

  // A second attempt means we already reclaimed a lock once and lost the race to
  // recreate it: another builder won, so fail closed rather than removing the
  // lock it is holding. This bound is also what keeps a persistent read error
  // (EACCES, EISDIR) from recursing until the stack blows.
  if (attempt > 0) {
    console.error(`noldor build: already in progress (${LOCK_FILE})`);
    process.exit(1);
  }

  let raw;
  try {
    raw = readFileSync(lock, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return acquireLock(attempt + 1); // released between the create and the read
  }

  const pid = Number.parseInt(raw.trim(), 10);
  if (Number.isInteger(pid) && pidAlive(pid)) {
    // Non-zero on purpose: exiting 0 would let a packaging or test step proceed
    // against a tree still being written, or one the first builder later fails
    // to finish.
    console.error(`noldor build: already in progress (pid ${pid}, ${LOCK_FILE})`);
    process.exit(1);
  }

  if (!Number.isInteger(pid)) {
    // No pid yet: the holder is between its exclusive create and its write, or
    // it was killed in that window. A young empty lock is respected; an old one
    // is debris, so the builder is never permanently jammed by a SIGKILL.
    const ageMs = Date.now() - statSync(lock).mtimeMs;
    if (ageMs < 5000) {
      console.error(`noldor build: already in progress (starting up, ${LOCK_FILE})`);
      process.exit(1);
    }
  }

  // A crashed build. Only the builder reclaims a lock — never the runtime
  // selector, which runs in every read-only invocation.
  rmSync(lock, { force: true });
  return acquireLock(attempt + 1);
}

function releaseLock() {
  rmSync(join(root, LOCK_FILE), { force: true });
}

function allDistFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      allDistFiles(abs, out);
      continue;
    }
    out.push(toPosix(relative(join(root, 'dist'), abs)));
  }
  return out;
}

function prune(expected) {
  const keep = new Set([...expected, '.build-stamp', '.build-lock']);
  let removed = 0;
  for (const rel of allDistFiles(join(root, 'dist'))) {
    if (keep.has(rel)) continue;
    rmSync(join(root, 'dist', rel));
    removed += 1;
  }
  return removed;
}

function runTsc() {
  const local = join(root, 'node_modules/.bin/tsc');
  const bin = existsSync(local) ? local : 'tsc';
  const result = spawnSync(bin, [], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`tsc exited ${result.status ?? 'null'}`);
  }
}

mkdirSync(join(root, 'dist'), { recursive: true });
// Lock first, THEN drop the stamp. Deleting it before acquiring would let a
// waiting builder erase the stamp a live builder is about to write, and a
// subsequent failure would leave that new stamp validating a tree this process
// had already started rewriting.
acquireLock();
rmSync(join(root, STAMP_FILE), { force: true });
process.on('SIGINT', () => {
  releaseLock();
  process.exit(130);
});
process.on('SIGTERM', () => {
  releaseLock();
  process.exit(143);
});

try {
  const digestStart = computeDigest(root);
  runTsc();
  copyRuntimeAssets(root);
  const expected = expectedOutputs(root);
  const pruned = prune(expected);
  const digestEnd = computeDigest(root);
  if (digestEnd !== digestStart) {
    throw new Error('sources changed while building — no stamp written, re-run `pnpm build`');
  }
  const missing = expected.filter((rel) => !existsSync(join(root, 'dist', rel)));
  if (missing.length > 0) {
    throw new Error(`build produced no output for: ${missing.slice(0, 5).join(', ')}`);
  }
  const tmp = join(root, `${STAMP_FILE}.tmp`);
  writeFileSync(
    tmp,
    `${JSON.stringify({ algo: 'sha256', digest: digestEnd, version: STAMP_VERSION })}\n`,
  );
  renameSync(tmp, join(root, STAMP_FILE));
  console.log(`noldor build: ${expected.length} outputs, ${pruned} pruned`);
} catch (error) {
  console.error(`noldor build: ${error.message}`);
  process.exitCode = 1;
} finally {
  releaseLock();
}
