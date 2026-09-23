// CLI for `noldor cr arbitration <dispose|digest>` — the operator's rulings on CR
// blockers, and the digest that closes a round series whose cap is spent.
//
// `cr orchestrate` writes the arbitration skeleton and prints the trailer to
// commit, but `<digest>` came only from `recordDigest`, which had no CLI surface,
// and `dispositions` had no writer at all. So the framework's one exit past a
// capped round was also the one surface it asked an operator to hand-edit a
// schema-validated file for — against a closed vocabulary the prose never listed.
//
// `dispose` works at any round (Q-0261, docs/adr/0004). Before the cap it records
// the ruling in the series' decision store, which every later round honors; at
// the cap it fills the arbitration record as before and records the same ruling.
import { isEntrypoint, readValueFlags } from '../core/cli-entry.js';
import { isSlug } from '../core/slug.js';
import type { Slug } from '../core/slug.js';
import { readFileNoFollowAsync } from '../core/slug-paths.js';
import {
  DISPOSITIONS,
  INTEGRITY_ONLY_DIAGNOSIS,
  arbitrationPath,
  arbitrationRecordSchema,
  dispositionSchema,
  integrityOnlyRemedy,
  isIntegrityOnly,
  priorRecordStands,
  recordDigest,
  undisposed,
  withDisposition,
} from './arbitration.js';
import type { ArbitrationRecord } from './arbitration.js';
import { writeJsonAtomic } from './atomic-write.js';
import { readLedger, sessionKey } from './autofix-ledger.js';
import {
  captureCitations,
  gitTreeReader,
  readCommit,
  readDecisions,
  updateDecisions,
  upsertDecision,
} from './decisions.js';
import type { Decision } from './decisions.js';
import { readExpectedLanes } from './expected-lanes.js';
import { laneSinkPath } from './filename.js';
import { fingerprintBlocker } from './fingerprint.js';
import { artifactKindSchema, laneFindingsSchema } from './findings-schema.js';
import type { ArtifactKind, Finding, Lane } from './findings-schema.js';
import { treeOf } from './git-tree.js';
import { isLaneFailureBlocker, PRIOR_AWARE_LANES } from './re-round.js';

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

dispose works at any round. Before the round cap it records a ruling on a standing
reviewer or codex blocker (--note required): later rounds stop carrying it while the
content it cites is unchanged, and every prior-aware lane is shown it. At the cap it
also fills the arbitration record. Run it without --blocker to list the ids.

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
 *
 * `--kind spec` / `--kind plan` are always not-ready for that same reason: the
 * record is real and worth filling, but no reader validates its digest.
 */
function digest(cwd: string, rec: ArbitrationRecord): number {
  const d = recordDigest(rec);
  console.log(`digest: ${d}`);
  console.log('git commit --amend --no-edit \\');
  console.log(`  --trailer "Noldor-Path-Override: cr-arbitration ${d} — <why>"`);

  const problems: string[] = [];
  // The trailer is validated by ONE reader, and it is code-only:
  // `noldor-enforce-arbitration.ts` builds its record path with a hardcoded
  // `'code'`. So naming a spec or plan digest is never the verified close it
  // looks like — it is refused outright when a code record for the same slug
  // exists (the guard compares this digest against THAT record), and merely
  // unchecked when none does, since the guard then fails open with a warning.
  // Reported rather than silently allowed: a command whose exit code answers
  // "will the push take this" must not answer yes on a digest nothing reads.
  if (rec.kind !== 'code') {
    problems.push(
      `pre-push validates the code record only, so a trailer naming this ${rec.kind} digest is not ` +
        'what it checks — refused outright where a code record for this slug exists, unverified where ' +
        'none does. The close happens at `--kind code`, on the record the code-stage round writes; ' +
        `this ${rec.kind} record stays a readable account of how the round was settled, which no gate reads`,
    );
  }
  if (isIntegrityOnly(rec)) {
    // Naming the remedy, not only the symptom: an operator told the record
    // "cannot be read as filled" reaches for a disposition, and there is none to
    // write. The skeleton banner and the pre-push guard report this same state
    // from the same constant.
    problems.push(`${INTEGRITY_ONLY_DIAGNOSIS} — ${integrityOnlyRemedy(rec.slug, rec.kind)}`);
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
  const record = await readRecord(path);
  // A record that cannot be read is an error for both verbs: `dispose` must not take the
  // before-the-cap path over a corrupt record the operator meant to fill.
  if (record.kind === 'unusable' || (verb === 'digest' && record.kind === 'absent')) {
    const detail = record.kind === 'unusable' ? record.detail : 'no such file';
    console.error(`${LABEL}: no usable arbitration record at ${path}: ${detail}`);
    console.error(
      '  The skeleton is written by `cr orchestrate` when the round cap refuses a dispatch (exit 3).',
    );
    return EXIT.error;
  }
  if (verb === 'digest' && record.kind === 'found') return digest(cwd, record.rec);

  // Only a record that stands for the current tree takes the disposition; anything else is a
  // ruling made before the cap — including over a record left from an earlier round series.
  const tree = treeOf(cwd, 'HEAD');
  if (record.kind === 'found' && tree !== null && priorRecordStands(record.rec, tree)) {
    const code = await dispose(path, record.rec, read.values);
    if (code === EXIT.ok) {
      const noted = await recordRuling(cwd, slug, kind.data, read.values);
      if (!noted.ok) console.error(`${LABEL}: ruling not kept for later rounds: ${noted.reason}`);
    }
    return code;
  }
  return disposeBeforeCap(cwd, slug, kind.data, read.values);
}

type RecordRead =
  | { kind: 'absent' }
  | { kind: 'unusable'; detail: string }
  | { kind: 'found'; rec: ArbitrationRecord };

async function readRecord(path: string): Promise<RecordRead> {
  let raw: string;
  try {
    raw = await readFileNoFollowAsync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' };
    return { kind: 'unusable', detail: (err as Error).message };
  }
  try {
    return { kind: 'found', rec: arbitrationRecordSchema.parse(JSON.parse(raw)) };
  } catch (err) {
    return { kind: 'unusable', detail: (err as Error).message };
  }
}

/** A standing blocker a ruling can be made on, with every prior-aware lane that filed it. */
interface Standing {
  readonly finding: Finding;
  readonly lanes: Lane[];
}

/**
 * The standing reviewer and codex blockers of the latest round, by `fingerprintBlocker` id,
 * read from their sinks. A lane's own failure blocker is left out — no ruling settles a review
 * that did not happen — and so are the other lanes, which re-check every round. A sink that
 * cannot be read is named in `unread` rather than guessed at.
 */
async function standingBlockers(
  cwd: string,
  slug: Slug,
  kind: ArtifactKind,
): Promise<{ byId: Map<string, Standing>; unread: string[] }> {
  const byId = new Map<string, Standing>();
  const unread: string[] = [];
  for (const lane of PRIOR_AWARE_LANES) {
    const path = laneSinkPath(cwd, slug, kind, lane);
    if (!path.ok) continue;
    let raw: string;
    try {
      raw = await readFileNoFollowAsync(path.path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') unread.push(path.path);
      continue;
    }
    let sink;
    try {
      sink = laneFindingsSchema.parse(JSON.parse(raw));
    } catch {
      unread.push(path.path);
      continue;
    }
    for (const b of sink.blockers) {
      if (isLaneFailureBlocker(b)) continue;
      const id = fingerprintBlocker(b);
      const hit = byId.get(id);
      if (hit === undefined) byId.set(id, { finding: b, lanes: [lane] });
      else if (!hit.lanes.includes(lane)) hit.lanes.push(lane);
    }
  }
  return { byId, unread };
}

/**
 * Record `--blocker`'s ruling in the series' decision store. It can be a standing reviewer or
 * codex blocker, whose citations are read at the head its round reviewed, or an existing ruling
 * being changed, which keeps its citations. Records nothing under a drain child or with no session,
 * and nothing when git cannot read the reviewed head — the refusal fails toward carrying.
 */
async function recordRuling(
  cwd: string,
  slug: Slug,
  kind: ArtifactKind,
  values: Map<string, string>,
): Promise<{ ok: true; decision: Decision } | { ok: false; reason: string }> {
  if (process.env.NOLDOR_DRAIN === '1')
    return {
      ok: false,
      reason: "a disposition is an operator's ruling, and this is a drain child (NOLDOR_DRAIN=1)",
    };
  const key = sessionKey(cwd);
  if (key === '')
    return {
      ok: false,
      reason:
        'no session marker — rulings are kept per gate session, and a run outside one keeps none',
    };
  const blockerId = values.get('--blocker') ?? '';
  const disposition = dispositionSchema.parse(values.get('--disposition'));
  const current = await readDecisions(cwd, slug, kind, key);
  if (!current.ok)
    return {
      ok: false,
      reason: `decision store unreadable (${current.path}): ${current.detail} — remove it to start this series' decisions over`,
    };
  const earlier = current.decisions.find((d) => d.id === blockerId && d.disposition !== 'fixed');
  const standing = (await standingBlockers(cwd, slug, kind)).byId.get(blockerId);
  if (standing === undefined && earlier === undefined)
    return { ok: false, reason: `${blockerId} is not a standing reviewer or codex blocker` };

  let decision: Decision;
  if (standing === undefined) {
    decision = { ...(earlier as Decision), disposition, reason: values.get('--note') ?? '' };
  } else {
    const head = (await readExpectedLanes(cwd, slug, kind)).heads.find((h) => h.kind === kind);
    if (head === undefined)
      return {
        ok: false,
        reason: 'the round recorded no reviewed head, so what the finding cites cannot be read',
      };
    const commit = await readCommit(cwd, head.headSha);
    if (!commit.ok)
      return {
        ok: false,
        reason: `git cannot read the reviewed head ${head.headSha}: ${commit.detail}`,
      };
    const cited = await captureCitations(standing.finding, head.headSha, gitTreeReader(cwd));
    if (!cited.ok)
      return { ok: false, reason: `what the finding cites could not be read: ${cited.detail}` };
    decision = {
      id: blockerId,
      finding: standing.finding,
      lanes: standing.lanes,
      disposition,
      reason: values.get('--note') ?? '',
      round: await latestRound(cwd, slug, kind, key),
      ...(cited.cites.length > 0 ? { cites: cited.cites } : {}),
    };
  }
  const w = await updateDecisions(cwd, slug, kind, key, (cur) => upsertDecision(cur, decision));
  return w.ok ? { ok: true, decision } : { ok: false, reason: w.reason };
}

/** The series' latest round number, for the record; 0 when the ledger cannot say. */
async function latestRound(
  cwd: string,
  slug: Slug,
  kind: ArtifactKind,
  key: string,
): Promise<number> {
  try {
    return (await readLedger(cwd, slug, kind, key))?.rounds.length ?? 0;
  } catch (err) {
    // The ledger is the round budget's; a ruling's round number is only a label.
    console.error(
      `${LABEL}: round ledger unreadable, so the ruling is labelled round 0: ${(err as Error).message}`,
    );
    return 0;
  }
}

/** Before the cap: validate the ruling, then record it for the rest of the series. */
async function disposeBeforeCap(
  cwd: string,
  slug: Slug,
  kind: ArtifactKind,
  values: Map<string, string>,
): Promise<number> {
  if (process.env.NOLDOR_DRAIN === '1') {
    console.error(
      `${LABEL}: nothing recorded — a disposition is an operator's ruling, and this is a drain child (NOLDOR_DRAIN=1)`,
    );
    return EXIT.error;
  }
  const blockerId = values.get('--blocker');
  const { byId, unread } = await standingBlockers(cwd, slug, kind);
  const key = sessionKey(cwd);
  const rulings = await readDecisions(cwd, slug, kind, key);
  const ruled = rulings.ok ? rulings.decisions.filter((d) => d.disposition !== 'fixed') : [];
  if (blockerId === undefined || (!byId.has(blockerId) && !ruled.some((d) => d.id === blockerId))) {
    const lines = [
      ...[...byId].map(
        ([id, s]) =>
          `  ${id}  [${s.lanes.join(',')}][${s.finding.severity}] ${s.finding.message.replace(/\r\n|\r|\n/g, ' ⏎ ')}`,
      ),
      ...ruled.map(
        (d) =>
          `  ${d.id}  (ruled ${d.disposition}) ${d.finding.message.replace(/\r\n|\r|\n/g, ' ⏎ ')}`,
      ),
      ...unread.map((p) => `  (could not read ${p})`),
    ];
    return usage(
      `${blockerId === undefined ? '--blocker is required' : `--blocker ${blockerId} names no standing reviewer or codex blocker and no earlier ruling`}; ` +
        (lines.length === 0
          ? 'there is nothing to rule on'
          : `the ids it can take:\n${lines.join('\n')}`),
    );
  }
  const raw = values.get('--disposition');
  if (!dispositionSchema.safeParse(raw).success)
    return usage(
      `--disposition must be one of ${DISPOSITIONS.join('|')} (got ${raw ?? '<unset>'})`,
    );
  if ((values.get('--note') ?? '').trim() === '')
    return usage('--note is required before the cap: it is the reason every later lane is shown');

  const noted = await recordRuling(cwd, slug, kind, values);
  if (!noted.ok) {
    console.error(`${LABEL}: nothing recorded — ${noted.reason}`);
    return EXIT.error;
  }
  console.log(`recorded ${blockerId}: ${noted.decision.disposition}`);
  console.log(
    noted.decision.cites === undefined
      ? `later rounds of this ${kind} series will not carry it, and every prior-aware lane is shown it; it cites no readable lines, so the ruling holds for the rest of the series`
      : `later rounds of this ${kind} series will not carry it, and every prior-aware lane is shown it, while the ${noted.decision.cites.length} span(s) it cites are unchanged`,
  );
  return EXIT.ok;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(
    await main(process.argv.slice(2)).catch((err: unknown) => {
      console.error(`${LABEL}: ${err instanceof Error ? err.message : String(err)}`);
      return EXIT.error;
    }),
  );
}
