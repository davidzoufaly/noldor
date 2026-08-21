// noldor design context — print the running design-context block for a dialogue.
// The reader half of the inline-design-context loop; `design log` (log-cli.ts)
// is the writer. Skills paste this stdout, inside a fenced code block,
// immediately above every design question.

import { locateArtifact, readArtifact, type ArtifactKind } from './artifact-locate.js';
import { loadScope, readLedger, validateSlug } from './ledger.js';
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
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) return { error: `${flag}: missing value` };
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
      default:
        return { error: `unknown flag: ${flag}` };
    }
  }
  if (args.slug === '') return { error: '--slug is required' };
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

  const view = located.status === 'found' ? readArtifact(located.paths) : null;
  const headings: RenderHeading[] = view?.headings ?? [];
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

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(runContext(process.argv.slice(2), process.cwd()));
}
