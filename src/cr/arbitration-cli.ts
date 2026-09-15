// CLI for `noldor cr arbitration <dispose|digest>` — the two writes an operator
// needs to close a round series whose cap is spent.
//
// `cr orchestrate` writes the arbitration skeleton and prints the trailer to
// commit, but `<digest>` came only from `recordDigest`, which had no CLI surface,
// and `dispositions` had no writer at all. So the framework's one exit past a
// capped round was also the one surface it asked an operator to hand-edit a
// schema-validated file for — against a closed vocabulary the prose never listed.
import { isEntrypoint, readValueFlags } from '../core/cli-entry.js';
import { isSlug } from '../core/slug.js';
import { readFileNoFollowAsync } from '../core/slug-paths.js';
import {
  DISPOSITIONS,
  arbitrationPath,
  arbitrationRecordSchema,
  dispositionSchema,
  recordDigest,
  undisposed,
  withDisposition,
} from './arbitration.js';
import type { ArbitrationRecord } from './arbitration.js';
import { writeJsonAtomic } from './atomic-write.js';
import { artifactKindSchema } from './findings-schema.js';
import { treeOf } from './git-tree.js';

/**
 * Exit 1 is NOT-READY, distinct from error: the record parsed and its digest
 * printed, but a push naming that digest would be refused (a blocker with no
 * disposition, or a tree the record is not bound to). Exit 2 is the usual usage
 * or infra failure, so a caller can tell "you have more to do" from "this did
 * not run".
 */
const EXIT = { ok: 0, notReady: 1, error: 2 } as const;

const FLAGS = ['--slug', '--kind', '--blocker', '--disposition', '--note'] as const;

const LABEL = 'cr arbitration';

function usage(msg: string): number {
  console.error(`${LABEL}: ${msg}
usage:
  noldor cr arbitration dispose --slug <slug> --kind <spec|plan|code> --blocker <id> --disposition <${DISPOSITIONS.join('|')}> [--note <text>]
  noldor cr arbitration digest  --slug <slug> --kind <spec|plan|code>

dispositions — what you are saying about a blocker you are not fixing:
  accepted  the finding is right and the debt is taken on deliberately
  rejected  the finding is wrong; it is not being carried forward
  deferred  the finding is right and is carried to follow-up work`);
  return EXIT.error;
}

/** The ids the record actually carries, for a message about one it does not. */
function knownIds(rec: ArbitrationRecord): string {
  return rec.blockers.length === 0
    ? 'no blockers at all'
    : rec.blockers.map((b) => b.id).join(', ');
}

async function dispose(
  path: string,
  rec: ArbitrationRecord,
  values: Map<string, string>,
): Promise<number> {
  const blockerId = values.get('--blocker');
  if (blockerId === undefined)
    return usage(`--blocker is required; this record holds ${knownIds(rec)}`);
  const raw = values.get('--disposition');
  const disposition = dispositionSchema.safeParse(raw);
  if (!disposition.success)
    return usage(
      `--disposition must be one of ${DISPOSITIONS.join('|')} (got ${raw ?? '<unset>'})`,
    );

  const next = withDisposition(rec, blockerId, disposition.data, values.get('--note'));
  if (next === null)
    return usage(
      `--blocker ${blockerId} names no blocker in this record; it holds ${knownIds(rec)}`,
    );

  await writeJsonAtomic(path, next);
  console.log(`disposed ${blockerId}: ${disposition.data}`);
  const left = undisposed(next);
  console.log(
    left.length === 0
      ? `all ${next.blockers.length} blockers disposed — next: noldor cr arbitration digest --slug ${next.slug} --kind ${next.kind}`
      : `${left.length} still undisposed: ${left.join(', ')}`,
  );
  return EXIT.ok;
}

/**
 * Print the digest, the trailer that names it, and every reason a push carrying
 * that trailer would still be refused.
 *
 * The digest prints even when the record is not ready. Withholding it would make
 * this command useless for the question an operator most often has — "what does
 * this record digest to right now" — and the `not ready:` lines plus exit 1 are
 * what keep the printed trailer from reading as a promise.
 */
function digest(cwd: string, rec: ArbitrationRecord): number {
  const d = recordDigest(rec);
  console.log(`digest: ${d}`);
  console.log('git commit --amend --no-edit \\');
  console.log(`  --trailer "Noldor-Path-Override: cr-arbitration ${d} — <why>"`);

  const problems: string[] = [];
  if (rec.blockers.length === 0) {
    // `buildSkeleton` drops every integrity blocker, so an aggregate that went
    // red on those alone yields this. The pre-push guard reads it as unfilled
    // and there is nothing an operator can dispose of to change that.
    problems.push(
      'the record carries no arbitrable blockers, so pre-push cannot read it as a filled arbitration',
    );
  } else {
    const left = undisposed(rec);
    if (left.length > 0)
      problems.push(`${left.length} blocker(s) carry no disposition: ${left.join(', ')}`);
  }
  const tree = treeOf(cwd, 'HEAD');
  if (tree === null) {
    // The guard compares against an empty string when it cannot read the tree,
    // which never matches `boundTree` — so an unreadable tree is a refusal, not
    // merely an unknown.
    problems.push("could not read HEAD^{tree}, so the record's tree binding cannot be confirmed");
  } else if (tree !== rec.boundTree) {
    problems.push(
      `the record is bound to tree ${rec.boundTree.slice(0, 7)} but HEAD's tree is now ${tree.slice(0, 7)} — ` +
        'commit first and re-run `cr orchestrate` to rebind it, since a stale record is refused',
    );
  }

  if (problems.length === 0) return EXIT.ok;
  for (const p of problems) console.error(`not ready: ${p}`);
  return EXIT.notReady;
}

async function main(argv: string[]): Promise<number> {
  const read = readValueFlags(argv, [...FLAGS], LABEL);
  if (!read.ok) return usage(read.error.slice(`${LABEL}: `.length));

  const verb = read.positional[0] ?? '';
  if (verb !== 'dispose' && verb !== 'digest')
    return usage(`unknown verb '${verb || '<none>'}' — expected dispose or digest`);

  // `slug` is checked, not merely required: it is `join`ed into the record path,
  // which `dispose` WRITES — so `--slug ../../../foo` would escape
  // `.noldor/cr/arbitration` and clobber an arbitrary `.json`. The branded type
  // is what lets `arbitrationPath` demand proof rather than trust.
  const slug = read.values.get('--slug');
  if (slug === undefined) return usage('--slug is required');
  if (!isSlug(slug)) return usage(`--slug must be kebab-case ([a-z0-9-]), got ${slug}`);
  const kind = artifactKindSchema.safeParse(read.values.get('--kind'));
  if (!kind.success)
    return usage(
      `--kind must be one of spec|plan|code (got ${read.values.get('--kind') ?? '<unset>'})`,
    );

  const cwd = process.cwd();
  const path = arbitrationPath(cwd, slug, kind.data);
  let rec: ArbitrationRecord;
  try {
    rec = arbitrationRecordSchema.parse(JSON.parse(await readFileNoFollowAsync(path)));
  } catch (err) {
    console.error(`${LABEL}: no usable arbitration record at ${path}: ${(err as Error).message}`);
    console.error(
      '  The skeleton is written by `cr orchestrate` when the round cap refuses a dispatch (exit 3).',
    );
    return EXIT.error;
  }

  return verb === 'dispose' ? dispose(path, rec, read.values) : digest(cwd, rec);
}

if (isEntrypoint(import.meta.url)) {
  process.exit(
    await main(process.argv.slice(2)).catch((err: unknown) => {
      console.error(`${LABEL}: ${err instanceof Error ? err.message : String(err)}`);
      return EXIT.error;
    }),
  );
}
