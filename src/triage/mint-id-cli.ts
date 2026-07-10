// @fd: stable-entry-ids-for-roadmap-backlog

import { fileURLToPath } from 'node:url';

import { COUNTER_PATH_DEFAULT, mintEntryIds } from './entry-id.js';

const USAGE = 'usage: noldor triage mint-id [--count N]\n';

/**
 * CLI entrypoint for `noldor triage mint-id`. Prints one minted ID per line and
 * bumps `.noldor/id-counter.json`. `--count` defaults to 1. Called by `/noldor-triage`
 * (one batch call for all accepted new-entry rows) and `/noldor-new-feature`.
 */
export function main(argv: readonly string[]): number {
  let count = 1;
  for (const arg of argv.slice(2)) {
    const m = /^--count=(.*)$/.exec(arg);
    if (m) {
      const n = Number(m[1]);
      if (!Number.isInteger(n) || n < 1) {
        process.stderr.write(USAGE);
        return 2;
      }
      count = n;
    }
  }
  // Support the space-separated form `--count N` too.
  const idx = argv.indexOf('--count');
  if (idx !== -1 && argv[idx + 1] !== undefined && !argv[idx + 1]!.startsWith('--')) {
    const n = Number(argv[idx + 1]);
    if (!Number.isInteger(n) || n < 1) {
      process.stderr.write(USAGE);
      return 2;
    }
    count = n;
  }

  for (const id of mintEntryIds(count, COUNTER_PATH_DEFAULT)) {
    process.stdout.write(`${id}\n`);
  }
  return 0;
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  process.exit(main(process.argv));
}
