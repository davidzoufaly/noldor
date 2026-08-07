// noldor design log — append to a dialogue's design ledger with code-assigned
// IDs. The writer half of the inline-design-context loop; `design context`
// (context-cli.ts) is the reader.

import {
  normalize,
  nextId,
  readLedger,
  validateSlug,
  writeLedger,
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

const LOG_FLAGS = new Set([
  '--slug',
  '--entry',
  '--scope',
  '--decide',
  '--open',
  '--resolve',
  '--support',
]);

/** Parse argv into {@link LogArgs}. Repeatable flags accumulate in argv order. */
export function parseLogArgs(argv: readonly string[]): LogArgs | { error: string } {
  const args: LogArgs = { slug: '', decide: [], open: [], resolve: [], support: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    // Report an unknown flag as such even when it sits last, before the
    // missing-value check — `--typo` with no value is a typo, not a missing value.
    if (!LOG_FLAGS.has(flag)) return { error: `unknown flag: ${flag}` };
    // Only a *known flag* in the value slot means the value is missing. Rejecting
    // every `--`-leading value would make decision text like
    // `--decide "--fd is now validated too"` unrecordable.
    if (value === undefined || LOG_FLAGS.has(value)) {
      return { error: `${flag}: missing value` };
    }
    if (value.trim().length === 0) return { error: `${flag}: value must not be blank` };
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
      // Unreachable while LOG_FLAGS and this switch agree; kept so a future flag
      // added to one and not the other fails loudly instead of being ignored.
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
    // Already resolved → no-op, so re-issuing the same `--resolve` is safe.
    // Note this is the only idempotent flag: a re-run carrying `--decide` mints a
    // second decision, by design (an append is an append).
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
  // Fail closed on ANY unparseable section: minting the next ID needs every
  // existing one (guessing would re-issue), and a write reserializes the whole
  // ledger from parsed state — so an unparsed section would be erased, not just
  // ignored. Reading and rendering still degrade gracefully, so the dialogue is
  // never blocked by this.
  if (state.unparsed.length > 0) {
    err(
      `design log: cannot parse section '${state.unparsed.join("', '")}' in ` +
        `${ledgerPath(cwd, parsed.slug)} — nothing written (a write would erase it). ` +
        `Fix or delete the ledger.\n`,
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
