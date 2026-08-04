// noldor design context — print the running design-context block for a dialogue.
// The reader half of the inline-design-context loop; `design log` (log-cli.ts)
// is the writer. Skills paste this stdout, inside a fenced code block,
// immediately above every design question.

import { loadScope, readLedger, validateSlug } from './ledger.js';
import { renderContext } from './render.js';

export interface ContextArgs {
  slug: string;
  kind: 'spec' | 'plan';
  fd?: string;
}

const USAGE = 'usage: noldor design context --slug <slug> [--kind spec|plan] [--fd <fd-slug>]';

export function parseContextArgs(argv: readonly string[]): ContextArgs | { error: string } {
  const args: ContextArgs = { slug: '', kind: 'spec' };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
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
 * no-decisions placeholder) and a hand-mangled one (renders what parses, plus a
 * `⚠ ledger section unparsed` line). A design dialogue must never be blocked by
 * its own context helper. The one exception is an invalid slug-shaped input,
 * which is rejected before any file is read.
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

  const state = readLedger(cwd, parsed.slug);
  const scope = loadScope(cwd, {
    slug: parsed.slug,
    state,
    ...(parsed.fd === undefined ? {} : { fdSlug: parsed.fd }),
  });
  out(renderContext(state, { slug: parsed.slug, kind: parsed.kind, scope }));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(runContext(process.argv.slice(2), process.cwd()));
}
