import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Absolute path to the noldor CLI entrypoint (`bin/noldor.mjs`), resolved
 * relative to this module so it works whether noldor runs from its own repo
 * (self-host) or as an installed dependency in a consumer repo.
 *
 * `src/core/` → package root is two levels up; `bin/noldor.mjs` is the
 * `files`-published shebang entry that boots `src/cli/index.ts` via tsx.
 */
export const NOLDOR_BIN = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'bin',
  'noldor.mjs',
);

/**
 * Argv tuple for spawning a noldor CLI subcommand as a child process:
 * `[process.execPath, NOLDOR_BIN, ...args]`. Internal callers use this instead
 * of shelling out to consumer-defined `pnpm <alias>` scripts (e.g.
 * `pnpm sdd:report`), which only exist if the consumer happens to declare them.
 * The framework only guarantees the `noldor` CLI itself, so internal
 * subprocess calls must go through it to stay consumer-agnostic.
 */
export function noldorCliCommand(args: string[]): [string, string[]] {
  return [process.execPath, [NOLDOR_BIN, ...args]];
}
