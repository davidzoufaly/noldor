// noldor design log — append to a dialogue's design ledger with code-assigned
// IDs. The writer half of the inline-design-context loop; `design context`
// (context-cli.ts) is the reader.

import {
  normalize,
  nextId,
  readLedger,
  validateSlug,
  writeLedger,
  WRITE_CRITICAL_SECTIONS,
  ledgerPath,
  type LedgerState,
} from './ledger.js';

export interface LogArgs {
  slug: string;
  entry?: string;
  scope?: string;
  decide: string[];
  open: string[];
  resolve: string[];
  support: string[];
}

const USAGE =
  'usage: noldor design log --slug <slug> [--entry <roadmap-slug>] [--scope <text>] ' +
  '[--decide <text>]... [--open <text>]... [--resolve <id>]... [--support <text>]...';

/** Parse argv into {@link LogArgs}. Repeatable flags accumulate in argv order. */
export function parseLogArgs(argv: readonly string[]): LogArgs | { error: string } {
  const args: LogArgs = { slug: '', decide: [], open: [], resolve: [], support: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) return { error: `${flag}: missing value` };
    i += 1;
    switch (flag) {
      case '--slug':
        args.slug = value;
        break;
      case '--entry':
        args.entry = value;
        break;
      case '--scope':
        args.scope = value;
        break;
      case '--decide':
        args.decide.push(value);
        break;
      case '--open':
        args.open.push(value);
        break;
      case '--resolve':
        args.resolve.push(value);
        break;
      case '--support':
        args.support.push(value);
        break;
      default:
        return { error: `unknown flag: ${flag}` };
    }
  }
  if (args.slug === '') return { error: '--slug is required' };
  return args;
}

/**
 * Apply one invocation's flags to a ledger state. Pure — the caller owns I/O.
 *
 * `--resolve` links to the first decision minted in the *same* invocation (the
 * common shape: "this answer resolves O2 and becomes D5"). A resolve with no
 * accompanying `--decide` is marked `(resolved)`.
 *
 * @returns The new state, or an error message (unknown `--resolve` target).
 */
export function applyLog(state: LedgerState, args: LogArgs): LedgerState | { error: string } {
  const next: LedgerState = {
    entry: args.entry === undefined ? state.entry : normalize(args.entry),
    scope: args.scope === undefined ? state.scope : normalize(args.scope),
    decided: [...state.decided],
    open: [...state.open],
    support: [...state.support, ...args.support.map(normalize)],
    unparsed: [],
  };

  const mintedDecisions: string[] = [];
  for (const text of args.decide) {
    const id = nextId('D', next.decided);
    next.decided.push({ id, text: normalize(text) });
    mintedDecisions.push(id);
  }
  for (const text of args.open) {
    next.open.push({ id: nextId('O', next.open), text: normalize(text), resolvedBy: null });
  }

  const target = mintedDecisions[0] ?? '(resolved)';
  for (const id of args.resolve) {
    const idx = next.open.findIndex((o) => o.id === id);
    if (idx === -1) {
      const known = next.open.map((o) => o.id).join(', ') || '(none)';
      return { error: `--resolve: unknown open-thread id '${id}'. Known ids: ${known}` };
    }
    // Already resolved → no-op (re-running a turn's log must be safe).
    if (next.open[idx].resolvedBy === null) {
      next.open[idx] = { ...next.open[idx], resolvedBy: target };
    }
  }

  return next;
}

export function runLog(
  argv: readonly string[],
  cwd: string,
  err: (s: string) => void = (s) => process.stderr.write(s),
): number {
  const parsed = parseLogArgs(argv);
  if ('error' in parsed) {
    err(`${parsed.error}\n${USAGE}\n`);
    return 1;
  }

  for (const [flag, value] of [
    ['--slug', parsed.slug],
    ['--entry', parsed.entry],
  ] as const) {
    if (value === undefined) continue;
    const problem = validateSlug(value, flag);
    if (problem) {
      err(`${problem}\n`);
      return 1;
    }
  }

  const state = readLedger(cwd, parsed.slug);
  // Fail closed: minting the next ID requires reading every existing one, and
  // guessing from a half-parsed section would re-issue an ID. Rendering still
  // works on the same file, so the dialogue is never blocked by this.
  const blocking = state.unparsed.filter((s) =>
    (WRITE_CRITICAL_SECTIONS as readonly string[]).includes(s),
  );
  if (blocking.length > 0) {
    err(
      `design log: cannot parse section '${blocking[0]}' in ${ledgerPath(cwd, parsed.slug)} — ` +
        `nothing written. Fix or delete the ledger.\n`,
    );
    return 1;
  }

  const applied = applyLog(state, parsed);
  if ('error' in applied) {
    err(`${applied.error}\n`);
    return 1;
  }

  writeLedger(cwd, parsed.slug, applied);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(runLog(process.argv.slice(2), process.cwd()));
}
