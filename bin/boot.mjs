// The one place runtime-selection side effects live: verdict -> exit code,
// stderr notice, NOLDOR_RUNTIME_ACTIVE/_REASON, optional trace, entry import.
// Both bin entrypoints are thin callers, so neither can drift in how it reports
// or fails.

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

import { selectRuntime } from './runtime-select.mjs';

/** Exit codes for the error verdicts, keyed by reason. */
const ERROR_EXITS = {
  'bad-override': 2,
  'forced-dist-absent': 1,
  'forced-source-no-src': 1,
  'forced-source-no-tsx': 1,
  'no-runtime': 1,
};

const ERROR_MESSAGES = {
  'bad-override': () =>
    `NOLDOR_RUNTIME must be 'dist', 'source', or empty (got '${process.env.NOLDOR_RUNTIME}')`,
  'forced-dist-absent': () =>
    'NOLDOR_RUNTIME=dist but dist/cli/index.js is absent — run `pnpm build`',
  'forced-source-no-src': () => 'NOLDOR_RUNTIME=source but this install carries no src/ tree',
  'forced-source-no-tsx': () =>
    'NOLDOR_RUNTIME=source but tsx is not installed (it is a devDependency)',
  'no-runtime': () =>
    'neither a compiled dist nor an installed tsx to run src with — run `pnpm build`',
};

function trace(runtime, reason) {
  const file = process.env.NOLDOR_RUNTIME_TRACE;
  if (!file) return;
  try {
    // One appendFileSync of a single short JSON line: concurrent hook jobs
    // interleave safely at this size. Argv is deliberately absent — arguments
    // can carry secrets, and a delimited tail would not survive spaces.
    appendFileSync(file, `${JSON.stringify({ pid: process.pid, reason, runtime })}\n`);
  } catch {
    // Tracing must never break the command it observes.
  }
}

/**
 * Select a runtime and import the matching entry.
 *
 * @param root - Package root.
 * @param entries - `{ dist, source }` entry paths relative to `root`.
 * @returns Nothing; exits the process on an error verdict.
 */
export async function boot(root, entries) {
  const { runtime, reason, stale } = selectRuntime(root);

  if (runtime === 'error') {
    const exit = ERROR_EXITS[reason];
    if (exit === undefined) {
      console.error(`noldor: unhandled runtime verdict '${reason}'`);
      process.exit(70);
    }
    console.error(`noldor: ${ERROR_MESSAGES[reason]()}`);
    process.exit(exit);
  }

  if (reason === 'forced-dist-stale') {
    console.error(
      'noldor: NOLDOR_RUNTIME=dist is serving a stale build (run `pnpm build` to refresh)',
    );
  }

  process.env.NOLDOR_RUNTIME_ACTIVE = runtime;
  process.env.NOLDOR_RUNTIME_REASON = reason;
  trace(runtime, reason);

  if (runtime === 'source') {
    const { register } = await import('tsx/esm/api');
    register();
    await import(pathToFileURL(join(root, entries.source)).href);
    return;
  }
  await import(pathToFileURL(join(root, entries.dist)).href);
  void stale;
}
