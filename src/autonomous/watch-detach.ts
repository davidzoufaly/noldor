import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { liveLockPid } from './drain-lock.js';

/** Pidfile written by the `--detach` launcher so operators can `kill $(cat …)`. */
export const WATCH_PID_REL = '.noldor/watch.pid';
/** Append-only log the detached child's stdout + stderr are redirected into. */
export const WATCH_LOG_REL = '.noldor/watch.log';

/** Drop every `--detach` token so the detached child runs the normal foreground loop. */
export function stripDetach(args: readonly string[]): string[] {
  return args.filter((a) => a !== '--detach');
}

/**
 * Absolute path to the package's `bin/noldor.mjs` entrypoint, resolved relative
 * to this module (`src/autonomous/watch-detach.ts` → `../../bin/noldor.mjs`).
 * Stable across self-host and consumer installs — the package layout is fixed,
 * so the detached child re-enters through the same tsx-registering shim the
 * parent did rather than trying to run the bare `.ts` file under plain node.
 */
export function binPathFrom(moduleDir: string): string {
  return resolve(moduleDir, '../../bin/noldor.mjs');
}

/** argv for the detached child: re-invoke the same CLI subcommand sans `--detach`. */
export function detachChildArgv(moduleDir: string, args: readonly string[]): string[] {
  return [binPathFrom(moduleDir), 'autonomous', 'watch', ...stripDetach(args)];
}

export type DetachResult =
  | { ok: true; pid: number; logPath: string; pidPath: string }
  | { ok: false; reason: string; pid: number };

interface DetachDeps {
  spawn: typeof nodeSpawn;
}

/**
 * Launch `autonomous watch` as a detached, session-independent process — the
 * supported unattended path. Harness-managed background tasks SIGTERM-reap a
 * foreground watcher within minutes; a `detached: true` + `unref()` child
 * survives the launching session's exit (the same effect as `nohup … &`), with
 * stdout/stderr redirected to {@link WATCH_LOG_REL} and the pid recorded in
 * {@link WATCH_PID_REL} so the operator can stop it without hunting for the pid.
 *
 * Refuses (without spawning) when a live drain lock is already held — the
 * detached child would only lose the lock race and die, leaving a pidfile that
 * points at a dead process. Surfacing the live pid is the honest outcome.
 *
 * @param cwd - Repo root (the watcher's main workspace).
 * @param moduleDir - This module's directory (`import.meta.dirname`), used to
 *   resolve the package bin for the re-invocation.
 * @param args - The original `process.argv` tail (still carrying `--detach`).
 */
export function detachWatch(
  cwd: string,
  moduleDir: string,
  args: readonly string[],
  deps: DetachDeps = { spawn: nodeSpawn },
): DetachResult {
  const running = liveLockPid(cwd);
  if (running !== null) {
    return { ok: false, reason: `watcher already running (pid ${String(running)})`, pid: running };
  }

  const dir = join(cwd, '.noldor');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const logPath = join(cwd, WATCH_LOG_REL);
  const pidPath = join(cwd, WATCH_PID_REL);

  // Append (not truncate): preserve prior cycle logs across relaunches.
  const fd = openSync(logPath, 'a');
  const child = deps.spawn(process.execPath, detachChildArgv(moduleDir, args), {
    cwd,
    detached: true,
    stdio: ['ignore', fd, fd],
    env: process.env,
  });
  child.unref();

  const pid = child.pid;
  if (pid === undefined) throw new Error('detach: child failed to spawn (no pid)');
  writeFileSync(pidPath, `${String(pid)}\n`, 'utf8');
  return { ok: true, pid, logPath, pidPath };
}
