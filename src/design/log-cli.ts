// noldor design log — append to a dialogue's design ledger with code-assigned
// IDs. The writer half of the inline-design-context loop; `design context`
// (context-cli.ts) is the reader.

import { runIfDirect } from '../core/cli-entry.js';
import { isSlug, slugErrorMessage } from '../core/slug.js';
import {
  digestBody,
  locateForDialogue,
  readArtifact,
  type ArtifactKind,
} from './artifact-locate.js';
import {
  normalize,
  nextId,
  readLedger,
  validateHeadingName,
  validateSlugs,
  writeLedger,
  ledgerPath,
  type Decision,
  type LedgerState,
  type OpenThread,
} from './ledger.js';

export interface LogArgs {
  slug: string;
  entry?: string;
  scope?: string;
  decide: string[];
  open: string[];
  resolve: string[];
  support: string[];
  /** Rationale for the single decision this invocation mints. */
  because?: string;
  /** Rejected alternative for that same decision. */
  insteadOf?: string;
  /** Artifact heading every record minted here belongs to. */
  section?: string;
  confirmSection?: string;
  unconfirmSection?: string;
  /** Artifact kind + override, needed only to hash a `--confirm-section` body. */
  kind: ArtifactKind;
  spec?: string;
}

const USAGE =
  'usage: noldor design log --slug <slug> [--entry <roadmap-slug>] [--scope <text>] ' +
  '[--decide <text>]... [--open <text>]... [--resolve <id>]... [--support <text>]... ' +
  '[--because <text>] [--instead-of <text>] [--section <heading>] ' +
  '[--confirm-section <heading>] [--unconfirm-section <heading>] [--kind spec|plan] [--spec <path>]';

const LOG_FLAGS = new Set([
  '--slug',
  '--entry',
  '--scope',
  '--decide',
  '--open',
  '--resolve',
  '--support',
  '--because',
  '--instead-of',
  '--section',
  '--confirm-section',
  '--unconfirm-section',
  '--kind',
  '--spec',
]);

/** Parse argv into {@link LogArgs}. Repeatable flags accumulate in argv order. */
export function parseLogArgs(argv: readonly string[]): LogArgs | { error: string } {
  const args: LogArgs = { slug: '', decide: [], open: [], resolve: [], support: [], kind: 'spec' };
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
      case '--because':
        args.because = value;
        break;
      case '--instead-of':
        args.insteadOf = value;
        break;
      case '--section':
        args.section = value;
        break;
      case '--confirm-section':
        args.confirmSection = value;
        break;
      case '--unconfirm-section':
        args.unconfirmSection = value;
        break;
      case '--kind':
        if (value !== 'spec' && value !== 'plan') return { error: '--kind: expected spec|plan' };
        args.kind = value;
        break;
      case '--spec':
        args.spec = value;
        break;
      // Unreachable while LOG_FLAGS and this switch agree; kept so a future flag
      // added to one and not the other fails loudly instead of being ignored.
      default:
        return { error: `unknown flag: ${flag}` };
    }
  }
  if (args.slug === '') return { error: '--slug is required' };
  for (const [flag, value] of [
    ['--section', args.section],
    ['--confirm-section', args.confirmSection],
    ['--unconfirm-section', args.unconfirmSection],
  ] as const) {
    if (value === undefined) continue;
    const problem = validateHeadingName(value, flag);
    if (problem) return { error: problem };
  }
  // `--decide` is repeatable, so a rationale in the same invocation has no
  // unambiguous owner unless there is exactly one decision to own it. Guessing
  // (first? all?) would silently attach a reason to the wrong answer, and
  // dropping it would lose the value the operator just typed.
  for (const [flag, value] of [
    ['--because', args.because],
    ['--instead-of', args.insteadOf],
  ] as const) {
    if (value === undefined) continue;
    if (args.decide.length !== 1) {
      return {
        error: `${flag} needs exactly one --decide in the same invocation (got ${args.decide.length})`,
      };
    }
  }
  if (args.confirmSection !== undefined && args.confirmSection === args.unconfirmSection) {
    return { error: `--confirm-section and --unconfirm-section name the same heading` };
  }
  return args;
}

/**
 * Apply one invocation's flags to a ledger state. Pure — the caller owns I/O.
 *
 * `--resolve` links to the first decision minted in the *same* invocation (the
 * common shape: "this answer resolves O2 and becomes D5"). A resolve with no
 * accompanying `--decide` is marked `(resolved)`.
 *
 * `--section` attaches to *every* record minted here, decisions and threads
 * alike, so a mixed invocation needs no disambiguation rule. `--because` and
 * `--instead-of` attach to the one decision the parser already guaranteed.
 *
 * Read-modify-write is not atomic and is not locked: `runLog` reads, applies and
 * writes. One dialogue is a single writer by construction — the skills run this
 * once per answer, in sequence — so the assumption holds for the intended use,
 * but two concurrent invocations would have the second clobber the first and
 * re-mint the same `D`/`O` id. Batching independent `design log` calls in one
 * turn is therefore unsafe; keep them sequential.
 *
 * @param confirmDigest - Body digest for `--confirm-section`, hashed by the
 *   caller. Required whenever `args.confirmSection` is set: this function does no
 *   I/O, so it cannot read the heading itself.
 * @returns The new state, or an error message (unknown `--resolve` target).
 */
export function applyLog(
  state: LedgerState,
  args: LogArgs,
  confirmDigest?: string,
): LedgerState | { error: string } {
  const next: LedgerState = {
    entry: args.entry === undefined ? state.entry : normalize(args.entry),
    scope: args.scope === undefined ? state.scope : normalize(args.scope),
    decided: [...state.decided],
    open: [...state.open],
    support: [...state.support, ...args.support.map(normalize)],
    confirmed: [...state.confirmed],
    unparsed: [],
  };

  const section = args.section === undefined ? undefined : normalize(args.section);
  const mintedDecisions: string[] = [];
  for (const text of args.decide) {
    const id = nextId('D', next.decided);
    const d: Decision = { id, text: normalize(text) };
    if (section !== undefined) d.section = section;
    if (args.because !== undefined) d.why = normalize(args.because);
    if (args.insteadOf !== undefined) d.insteadOf = normalize(args.insteadOf);
    next.decided.push(d);
    mintedDecisions.push(id);
  }
  for (const text of args.open) {
    const o: OpenThread = { id: nextId('O', next.open), text: normalize(text), resolvedBy: null };
    if (section !== undefined) o.section = section;
    next.open.push(o);
  }

  if (args.unconfirmSection !== undefined) {
    const name = normalize(args.unconfirmSection);
    next.confirmed = next.confirmed.filter((c) => c.name !== name);
  }
  if (args.confirmSection !== undefined && confirmDigest === undefined) {
    // The caller promised a digest for every `--confirm-section`. Silently
    // dropping the approval would be the same silent-loss class this module
    // refuses everywhere else (the unparsed-section write refusal, the
    // no-such-heading hard error), so a broken caller gets told.
    return { error: '--confirm-section: no body digest supplied (internal contract violation)' };
  }
  if (args.confirmSection !== undefined && confirmDigest !== undefined) {
    const name = normalize(args.confirmSection);
    // Replace *in place*: re-confirming after an edit refreshes a stale approval,
    // and two records for one heading would make it read as both fresh and stale.
    // Filtering and appending would also reorder the section on every re-confirm,
    // and the on-disk order is the confirmation order.
    const at = next.confirmed.findIndex((c) => c.name === name);
    next.confirmed =
      at === -1
        ? [...next.confirmed, { name, digest: confirmDigest }]
        : next.confirmed.map((c, i) => (i === at ? { name, digest: confirmDigest } : c));
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

  const badSlug = validateSlugs([
    ['--slug', parsed.slug],
    ['--entry', parsed.entry],
  ]);
  if (badSlug) {
    err(`${badSlug}\n`);
    return 1;
  }

  // `validateSlugs` decides legality (it delegates to `parseSlug`); this
  // restates it as a narrowing so the ledger builders below receive the branded
  // type they require. Same rule, expressed to the type system.
  if (!isSlug(parsed.slug)) {
    err(`${slugErrorMessage(parsed.slug)}\n`);
    return 1;
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

  let confirmDigest: string | undefined;
  if (parsed.confirmSection !== undefined) {
    // The only write that reads the artifact. An approval needs the bytes it
    // approved, so a heading that cannot be found is a hard error rather than a
    // record with no digest — which the ledger grammar could not even serialize.
    const located = locateForDialogue(cwd, parsed);
    if (located.status === 'rejected') {
      err(`design log: ${located.reason}\n`);
      return 1;
    }
    if (located.status === 'none') {
      err(
        `design log: --confirm-section '${parsed.confirmSection}': no ${parsed.kind} on disk for ` +
          `slug '${parsed.slug}' — nothing to confirm.\n`,
      );
      return 1;
    }
    const read = readArtifact(located.paths);
    if (read.status === 'rejected') {
      err(`design log: ${read.reason}\n`);
      return 1;
    }
    const view = read.view;
    const body = view.section(parsed.confirmSection);
    if (body === null) {
      const legal = view.headings.map((h) => h.name).join(', ') || '(none)';
      err(
        `design log: --confirm-section '${parsed.confirmSection}' matches no heading — ` +
          `legal: ${legal}\n`,
      );
      return 1;
    }
    confirmDigest = digestBody(body);
  }

  const applied = applyLog(state, parsed, confirmDigest);
  if ('error' in applied) {
    err(`${applied.error}\n`);
    return 1;
  }

  writeLedger(cwd, parsed.slug, applied);
  return 0;
}

// See the same note in `context-cli.ts`: the raw-path vs percent-encoded-URL
// comparison silently no-opped on any path containing a space, which for this
// command meant the operator's decision was written nowhere and exit was 0.
runIfDirect('log-cli', 'design log', async () => runLog(process.argv.slice(2), process.cwd()));
