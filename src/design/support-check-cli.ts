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
import { isSlug, slugErrorMessage } from '../core/slug.js';
import { ledgerPath, readLedger, supportVerdict, validateSlugs } from './ledger.js';

const USAGE = 'usage: noldor design support-check (--slug <dialogue-slug> | --spec <path>)';

/**
 * The dialogue key a check targets: `--slug` verbatim, or the key a spec's
 * filename carries (`<date>-<key>-design.md`) — the same key `design log` was
 * seeded under on both `*-new` and `*-attach` paths, so the gate can pass the
 * artifact path it already holds.
 */
export function parseSupportCheckArgs(
  argv: readonly string[],
): { slug: string } | { error: string } {
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
  if (slug !== undefined) return { slug };
  const key = specSlugFromFilename(basename(spec!));
  if (key === null) {
    return { error: `--spec: '${basename(spec!)}' does not match <date>-<slug>-design.md` };
  }
  return { slug: key };
}

export function runSupportCheck(
  argv: readonly string[],
  cwd: string,
  out: (s: string) => void = (s) => process.stdout.write(s),
  err: (s: string) => void = (s) => process.stderr.write(s),
): number {
  const parsed = parseSupportCheckArgs(argv);
  if ('error' in parsed) {
    err(`design support-check: ${parsed.error}\n${USAGE}\n`);
    return 1;
  }
  const badSlug = validateSlugs([['--slug', parsed.slug]]);
  if (badSlug) {
    err(`design support-check: ${badSlug}\n`);
    return 1;
  }
  if (!isSlug(parsed.slug)) {
    err(`design support-check: ${slugErrorMessage(parsed.slug)}\n`);
    return 1;
  }

  const state = readLedger(cwd, parsed.slug);
  // Only this section decides the verdict. An unparsed `Existing support` is
  // dropped to `[]` by the parser, which would read as `missing` and send the
  // operator to record anchors the file may already hold — say so instead.
  if (state.unparsed.includes('Existing support')) {
    err(
      `design support-check: cannot parse 'Existing support' in ${ledgerPath(cwd, parsed.slug)} — ` +
        'fix or delete the ledger, then re-run.\n',
    );
    return 1;
  }

  const verdict = supportVerdict(state.support);
  if (verdict.kind === 'anchored') {
    out(`support: ${verdict.anchors} anchor(s) recorded for '${parsed.slug}'\n`);
    return 0;
  }
  if (verdict.kind === 'waived') {
    out(`support: none — ${verdict.reasons.join('; ')}\n`);
    return 0;
  }
  out(
    `support: no prior art recorded for '${parsed.slug}' — the reuse question was never asked.\n` +
      `  record what already exists:  pnpm noldor design log --slug ${parsed.slug} --support "<path:line — what it already does>"\n` +
      `  or say why nothing does:     pnpm noldor design log --slug ${parsed.slug} --support "none: <reason>"\n`,
  );
  return 2;
}

runIfDirect('support-check-cli', 'design support-check', async () =>
  runSupportCheck(process.argv.slice(2), process.cwd()),
);
