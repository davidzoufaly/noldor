// noldor design context — print the running design-context block for a dialogue.
// The reader half of the inline-design-context loop; `design log` (log-cli.ts)
// is the writer. Skills paste this stdout, inside a fenced code block,
// immediately above every design question.

import { runIfDirect } from '../core/cli-entry.js';
import { locateArtifact, readArtifact, type ArtifactKind } from './artifact-locate.js';
import { loadScope, normalize, readLedger, validateSlug } from './ledger.js';
import { renderContext, type RenderHeading } from './render.js';

export interface ContextArgs {
  slug: string;
  kind: ArtifactKind;
  fd?: string;
  /** The heading under discussion. */
  section?: string;
  /** Explicit artifact path, when the slug does not resolve to one file. */
  spec?: string;
  /** Expand every value instead of collapsing to first sentences. */
  full: boolean;
}

const USAGE =
  'usage: noldor design context --slug <slug> [--kind spec|plan] [--fd <fd-slug>] ' +
  '[--section <heading>] [--spec <path>] [--full]';

/** Flags that take no value. Checked before the value lookup below. */
const BOOLEAN_FLAGS = new Set(['--full']);

/** Every flag this parser knows, so a known flag in a value slot reads as a missing value. */
const VALUE_FLAGS = new Set(['--slug', '--kind', '--fd', '--section', '--spec']);

/**
 * Flags whose value is taken literally, even when it looks like a flag.
 *
 * These carry a heading name or a path, and `design log` accepts `--full` as a
 * heading value because `--full` is not one of *its* flags. Applying this
 * parser's own flag set to the value slot would make `## --full` confirmable but
 * unfocusable, so the two halves of one loop would disagree about which headings
 * exist. Consuming the next token unconditionally keeps the heading universe
 * identical on both sides.
 */
const LITERAL_VALUE_FLAGS = new Set(['--section', '--spec']);

export function parseContextArgs(argv: readonly string[]): ContextArgs | { error: string } {
  const args: ContextArgs = { slug: '', kind: 'spec', full: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    // A valueless flag must be recognized before the value slot is inspected, or
    // `--full` at the end of argv reads as a missing value.
    if (BOOLEAN_FLAGS.has(flag)) {
      args.full = true;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) return { error: `unknown flag: ${flag}` };
    const value = argv[i + 1];
    // A known flag in the value slot normally means the value is missing — the
    // same rule `parseLogArgs` uses. The exception is a flag whose value is a
    // heading name or path: there, only the end of argv is a missing value.
    const literal = LITERAL_VALUE_FLAGS.has(flag);
    if (value === undefined || (!literal && (BOOLEAN_FLAGS.has(value) || VALUE_FLAGS.has(value)))) {
      return { error: `${flag}: missing value` };
    }
    if (value.trim().length === 0) return { error: `${flag}: value must not be blank` };
    i += 1;
    switch (flag) {
      case '--slug':
        args.slug = value;
        break;
      case '--kind':
        if (value !== 'spec' && value !== 'plan') return { error: `--kind: expected spec|plan` };
        args.kind = value;
        break;
      case '--fd':
        args.fd = value;
        break;
      case '--section':
        args.section = value;
        break;
      case '--spec':
        args.spec = value;
        break;
      // Unreachable while VALUE_FLAGS and this switch agree; kept so a flag added
      // to one and not the other fails loudly instead of being silently ignored.
      default:
        return { error: `unknown flag: ${flag}` };
    }
  }
  if (args.slug === '') return { error: '--slug is required' };
  // Same normalize-stability rule as `design log`: a `--section` the writer would
  // rewrite could never match what the writer stored.
  if (args.section !== undefined && normalize(args.section) !== args.section) {
    return {
      error:
        `--section: heading names must contain no line break and no '~~' run ` +
        `(got '${args.section}')`,
    };
  }
  return args;
}

/**
 * Print the block. Exits 0 for every state a dialogue can legitimately be in —
 * including a missing ledger (prints the auto-derived Scope plus the
 * no-decisions placeholder), a hand-mangled one (renders what parses, plus a
 * `⚠ ledger section unparsed` line), and an artifact that is not written yet
 * (renders the buckets and says the draft is absent). A design dialogue must
 * never be blocked by its own context helper.
 *
 * Two inputs do fail: an invalid slug-shaped value, rejected before any file is
 * read, and a `--spec` override that is not a readable `.md` file inside the doc
 * roots — a silent fallback there would print a mistyped path's absence as "no
 * draft yet" and suppress the whole checklist.
 */
export function runContext(
  argv: readonly string[],
  cwd: string,
  out: (s: string) => void = (s) => process.stdout.write(s),
  err: (s: string) => void = (s) => process.stderr.write(s),
): number {
  const parsed = parseContextArgs(argv);
  if ('error' in parsed) {
    err(`${parsed.error}\n${USAGE}\n`);
    return 1;
  }

  for (const [flag, value] of [
    ['--slug', parsed.slug],
    ['--fd', parsed.fd],
  ] as const) {
    if (value === undefined) continue;
    const problem = validateSlug(value, flag);
    if (problem) {
      err(`${problem}\n`);
      return 1;
    }
  }

  const located = locateArtifact(cwd, {
    slug: parsed.slug,
    kind: parsed.kind,
    ...(parsed.spec === undefined ? {} : { override: parsed.spec }),
  });
  if (located.status === 'rejected') {
    err(`design context: ${located.reason}\n`);
    return 1;
  }

  let view = null;
  if (located.status === 'found') {
    const read = readArtifact(located.paths);
    if (read.status === 'rejected') {
      err(`design context: ${read.reason}\n`);
      return 1;
    }
    view = read.view;
  }
  const headings: RenderHeading[] = view === null ? [] : view.headings;
  const prose = view !== null && parsed.section !== undefined ? view.section(parsed.section) : null;

  const state = readLedger(cwd, parsed.slug);
  const scope = loadScope(cwd, {
    slug: parsed.slug,
    state,
    ...(parsed.fd === undefined ? {} : { fdSlug: parsed.fd }),
  });

  out(
    renderContext(state, {
      slug: parsed.slug,
      kind: parsed.kind,
      scope,
      full: parsed.full,
      headings,
      ...(parsed.section === undefined ? {} : { section: parsed.section }),
      ...(prose === null ? {} : { sectionProse: prose }),
      ...(view === null
        ? { artifactNote: `(no ${parsed.kind} on disk yet — draft one before the next question)` }
        : {}),
    }),
  );
  return 0;
}

// `runIfDirect` rather than comparing `import.meta.url` to `process.argv[1]`: the
// CLI router hands the module a raw path while `import.meta.url` is
// percent-encoded, so any path containing a space made that comparison false —
// the command imported the module, ran nothing, and exited 0.
runIfDirect('context-cli', 'design context', async () =>
  runContext(process.argv.slice(2), process.cwd()),
);
