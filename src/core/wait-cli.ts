/**
 * `noldor wait <state-file> --until <cond> [--fail-if <cond>] [--emit <dotpath>]
 *  [--interval-ms N] [--timeout-ms N] [--quiet]`
 *
 * Thin CLI wrapper around the pure {@link waitUntil} core. Polls a JSON state
 * file until a predicate matches. Exit codes: 0 matched · 1 fail-if matched ·
 * 2 timeout · 3 usage/parse error. Progress → stderr; `--emit` value → stdout.
 */
import { readFileSync } from 'node:fs';

import {
  DOTPATH_RE,
  getPath,
  parsePredicate,
  PredicateParseError,
  waitUntil,
  type Predicate,
} from './wait.js';

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 600_000;

class UsageError extends Error {}

export interface WaitArgs {
  stateFile: string;
  until: string;
  failIf?: string;
  emit?: string;
  intervalMs: number;
  timeoutMs: number;
  quiet: boolean;
}

export function parseWaitArgs(argv: string[]): WaitArgs {
  let stateFile: string | undefined;
  let until: string | undefined;
  let failIf: string | undefined;
  let emit: string | undefined;
  let intervalMs = DEFAULT_INTERVAL_MS;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let quiet = false;

  const value = (flag: string, v: string | undefined): string => {
    if (v === undefined) throw new UsageError(`${flag} requires a value`);
    return v;
  };
  const numeric = (
    flag: string,
    v: string | undefined,
    min: number,
    inclusive: boolean,
  ): number => {
    const raw = value(flag, v);
    const n = Number(raw);
    if (!Number.isFinite(n) || (inclusive ? n < min : n <= min)) {
      throw new UsageError(
        `${flag} must be a finite number ${inclusive ? '>=' : '>'} ${min} (got '${raw}')`,
      );
    }
    return n;
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--until') until = value('--until', argv[++i]);
    else if (a === '--fail-if') failIf = value('--fail-if', argv[++i]);
    else if (a === '--emit') emit = value('--emit', argv[++i]);
    else if (a === '--interval-ms') intervalMs = numeric('--interval-ms', argv[++i], 0, false);
    else if (a === '--timeout-ms') timeoutMs = numeric('--timeout-ms', argv[++i], 0, true);
    else if (a === '--quiet') quiet = true;
    else if (a.startsWith('--')) throw new UsageError(`unknown flag: ${a}`);
    else if (stateFile === undefined) stateFile = a;
    else throw new UsageError(`unexpected argument: ${a}`);
  }

  if (stateFile === undefined) throw new UsageError('missing <state-file> argument');
  if (until === undefined) throw new UsageError('missing required --until <predicate>');
  return { stateFile, until, failIf, emit, intervalMs, timeoutMs, quiet };
}

function formatEmit(v: unknown): string | null {
  if (v == null) return null;
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

export async function main(argv: string[]): Promise<number> {
  let args: WaitArgs;
  try {
    args = parseWaitArgs(argv);
  } catch (e) {
    process.stderr.write(`wait: ${(e as Error).message}\n`);
    return 3;
  }

  let until: Predicate;
  let failIf: Predicate | undefined;
  try {
    until = parsePredicate(args.until);
    failIf = args.failIf !== undefined ? parsePredicate(args.failIf) : undefined;
  } catch (e) {
    if (e instanceof PredicateParseError) {
      process.stderr.write(`wait: ${e.message}\n`);
      return 3;
    }
    throw e;
  }
  if (args.emit !== undefined && !DOTPATH_RE.test(args.emit)) {
    process.stderr.write(`wait: invalid --emit dotpath '${args.emit}'\n`);
    return 3;
  }

  const read = (): unknown => {
    try {
      return JSON.parse(readFileSync(args.stateFile, 'utf8'));
    } catch {
      return null;
    }
  };

  let lastUntilVal: string | undefined;
  let first = true;
  const onPoll = args.quiet
    ? undefined
    : (snapshot: unknown, elapsedMs: number): void => {
        const cur = JSON.stringify(getPath(snapshot, until.path));
        if (first || cur !== lastUntilVal) {
          process.stderr.write(
            `wait: ${until.path}=${cur ?? '<absent>'} (${elapsedMs}ms elapsed)\n`,
          );
          lastUntilVal = cur;
          first = false;
        }
      };

  const startedAt = Date.now();
  const outcome = await waitUntil({
    read,
    until,
    failIf,
    intervalMs: args.intervalMs,
    timeoutMs: args.timeoutMs,
    onPoll,
  });
  const elapsedMs = Date.now() - startedAt;

  if (!args.quiet) process.stderr.write(`wait: ${outcome.outcome} after ${elapsedMs}ms\n`);

  if (outcome.outcome === 'matched' || outcome.outcome === 'failed') {
    if (args.emit !== undefined) {
      const s = formatEmit(getPath(outcome.snapshot, args.emit));
      if (s !== null) process.stdout.write(`${s}\n`);
    }
    return outcome.outcome === 'matched' ? 0 : 1;
  }

  if (!args.quiet) {
    const detail = outcome.everReadable
      ? 'file readable but predicate never matched'
      : 'state file never became readable';
    process.stderr.write(`wait: timed out (${detail})\n`);
  }
  return 2;
}

const invokedDirect = /[\\/]wait-cli\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      process.stderr.write(`wait: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
      process.exit(1);
    });
}
