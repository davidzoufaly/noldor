// noldor design support-check — refuse a spec whose design ledger records no
// prior art (Q-0067). `design log --support` captures anchors, but nothing made
// a dialogue use it: a ledger rendering `Existing support (0)` passed silently,
// which means the reuse question was never asked. This is the check; an
// explicit `--support "none: <reason>"` is the only way past it without an
// anchor, so "nothing to reuse" is a claim the CR `reuse` dimension can test.
//
// Exit contract: 0 = anchored or waived, 2 = no prior art recorded, 1 = the
// check could not run (bad argv, a spec name that yields no dialogue key, an
// unparseable `Existing support` section).

import { basename } from 'node:path';

import { runIfDirect } from '../core/cli-entry.js';
import { specSlugFromFilename } from '../core/design-artifact-names.js';
import { parseSlug, type Slug } from '../core/slug.js';
import { ledgerPath, readLedger, supportVerdict, validateSlug } from './ledger.js';

const USAGE = 'usage: noldor design support-check (--slug <dialogue-slug> | --spec <path>)';

/**
 * The dialogue key a check targets: `--slug` verbatim, or the key a spec's
 * filename carries (`<date>-<key>-design.md`) — the same key `design log` was
 * seeded under on both `*-new` and `*-attach` paths, so the gate can pass the
 * artifact path it already holds.
 */
export function parseSupportCheckArgs(argv: readonly string[]): { slug: Slug } | { error: string } {
  let slug: string | undefined;
  let spec: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    if (flag !== '--slug' && flag !== '--spec') return { error: `unknown flag: ${flag}` };
    const value = argv[i + 1];
    if (value === undefined || value.trim().length === 0)
      return { error: `${flag}: missing value` };
    i += 1;
    if (flag === '--slug') slug = value;
    else spec = value;
  }
  if ((slug === undefined) === (spec === undefined)) {
    return { error: 'exactly one of --slug / --spec is required' };
  }
  const key = slug ?? specSlugFromFilename(basename(spec!));
  if (key === null) {
    return { error: `--spec: '${basename(spec!)}' does not match <date>-<slug>-design.md` };
  }
  // The key becomes a path component under `.noldor/design/`, so it is checked
  // here whichever flag supplied it; `validateSlug` adds the corrected spelling.
  const parsedSlug = parseSlug(key);
  if (!parsedSlug.ok)
    return {
      error:
        validateSlug(key, slug !== undefined ? '--slug' : '--spec') ?? parsedSlug.error.message,
    };
  return { slug: parsedSlug.slug };
}

/** What one check decided: the exit code plus the one line (or block) it prints. */
export interface SupportCheckResult {
  code: 0 | 1 | 2;
  /** `stdout` for a verdict (0 / 2), `stderr` for a check that could not run (1). */
  stream: 'stdout' | 'stderr';
  text: string;
}

/** Decide the verdict for argv against the ledger under `cwd`. No printing. */
export function runSupportCheck(argv: readonly string[], cwd: string): SupportCheckResult {
  const parsed = parseSupportCheckArgs(argv);
  if ('error' in parsed) {
    return { code: 1, stream: 'stderr', text: `design support-check: ${parsed.error}\n${USAGE}\n` };
  }
  const state = readLedger(cwd, parsed.slug);
  // Only this section decides the verdict. An unparsed `Existing support` is
  // dropped to `[]` by the parser, which would read as `missing` and send the
  // operator to record anchors the file may already hold — say so instead.
  if (state.unparsed.includes('Existing support')) {
    return {
      code: 1,
      stream: 'stderr',
      text:
        `design support-check: cannot parse 'Existing support' in ${ledgerPath(cwd, parsed.slug)} — ` +
        'fix or delete the ledger, then re-run.\n',
    };
  }

  const verdict = supportVerdict(state.support);
  const report = (code: 0 | 2, text: string): SupportCheckResult => ({
    code,
    stream: 'stdout',
    text,
  });
  if (verdict.kind === 'anchored') {
    return report(0, `support: ${verdict.anchors} anchor(s) recorded for '${parsed.slug}'\n`);
  }
  if (verdict.kind === 'waived')
    return report(0, `support: none — ${verdict.reasons.join('; ')}\n`);
  return report(
    2,
    `support: no prior art recorded for '${parsed.slug}' — the reuse question was never asked.\n` +
      `  record what already exists:  pnpm noldor design log --slug ${parsed.slug} --support "<path:line — what it already does>"\n` +
      `  or say why nothing does:     pnpm noldor design log --slug ${parsed.slug} --support "none: <reason>"\n`,
  );
}

runIfDirect('support-check-cli', 'design support-check', async () => {
  const result = runSupportCheck(process.argv.slice(2), process.cwd());
  (result.stream === 'stdout' ? process.stdout : process.stderr).write(result.text);
  return result.code;
});
