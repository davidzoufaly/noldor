// pre-push stage: refuses a bare free-text `Noldor-Path-Override` on a series
// whose round cap is spent and still red.
//
// `enforceReviewReceipt` returns `{ ok: true }` the moment it sees any
// `Noldor-Path-Override`. That early return is the escape hatch this guard
// closes — and only for the one case where a machine-readable answer exists to
// demand.
import {
  AUTOFIX_ROUND_CAP,
  autofixLedgerSchema,
  ledgerPath,
  roundVerdict,
} from '../cr/autofix-ledger.js';
import {
  arbitrationPath,
  arbitrationRecordSchema,
  isFilled,
  parseArbitrationTrailer,
  recordDigest,
} from '../cr/arbitration.js';
import { readFileNoFollow } from '../core/slug-paths.js';
import type { Slug } from '../core/slug.js';
import { parseTrailers } from '../core/trailers.js';
import { readStdinWithTimeout } from './noldor-pre-push.js';
import { createGitRunner, isObjectId, parseRefLines } from './pre-push-range.js';
import type { GitRunner } from './pre-push-range.js';

/** What the guard needs to know about the round ledger. `null` = none on disk. */
export interface LedgerFacts {
  readonly rounds: readonly { readonly round: number; readonly verdict: 'green' | 'red' }[];
}

/** What the guard needs to know about the record. `null` = none on disk. */
export interface RecordFacts {
  readonly digest: string;
  readonly filled: boolean;
  readonly boundTree: string;
  readonly currentTree: string;
}

export interface ArbitrationDecision {
  readonly ok: boolean;
  readonly reason?: string;
  readonly warning?: string;
}

/**
 * Pure decision. Every I/O question — which commits, which slug, which ledger —
 * is answered by the caller, so the policy itself is testable from literals.
 *
 * The predicate is CAP REACHED AND LAST ROUND RED, not "any red round". A loop
 * that went red and then converged green has red rounds in its ledger but never
 * triggered a cap refusal, so no skeleton was ever written; refusing there would
 * trap an operator overriding for an unrelated reason (verify-lane infra red,
 * the Q-0185 case) with no record to fill and no way through.
 */
export function decideArbitration(input: {
  override: string | null;
  ledger: LedgerFacts | null;
  record: RecordFacts | null;
}): ArbitrationDecision {
  if (input.override === null) return { ok: true };

  // Fail OPEN, loudly. No ledger means no proof any red round happened, and a
  // deleted ledger is indistinguishable from a session that never ran
  // orchestrate at all — which is most overrides in this repo (micro-chore,
  // fast-track, a doc fix). The printed line is what keeps the hole visible.
  if (input.ledger === null)
    return { ok: true, warning: 'pre-push: could not verify arbitration — no round ledger found' };

  const red = input.ledger.rounds.filter((r) => r.verdict === 'red').length;
  const lastRed = input.ledger.rounds.at(-1)?.verdict === 'red';
  if (red <= AUTOFIX_ROUND_CAP || !lastRed) return { ok: true };

  const claimed = parseArbitrationTrailer(input.override);
  if (claimed === null)
    return {
      ok: false,
      reason:
        'pre-push: the round cap is spent and the last round is red, so a bare override is not ' +
        'enough. Fill the arbitration record and name it: ' +
        'Noldor-Path-Override: cr-arbitration <digest> — <why>',
    };
  if (input.record === null)
    return { ok: false, reason: `pre-push: no arbitration record on disk for digest ${claimed}` };
  if (input.record.boundTree !== input.record.currentTree)
    return {
      ok: false,
      reason:
        `pre-push: the arbitration record is stale — it is bound to tree ` +
        `${input.record.boundTree}, but HEAD's tree is ${input.record.currentTree}`,
    };
  if (input.record.digest !== claimed)
    return {
      ok: false,
      reason: `pre-push: trailer names digest ${claimed} but the record on disk digests to ${input.record.digest}`,
    };
  if (!input.record.filled)
    return {
      ok: false,
      reason: 'pre-push: the arbitration record has a blocker with no disposition',
    };
  return { ok: true };
}

/**
 * Apply {@link decideArbitration} to every commit in the push range.
 *
 * Every commit, not just the tip. A push commonly carries several new commits,
 * and a capped override can sit on any of them while the tip names a different
 * FD or none at all — so a tip-only guard is bypassable by adding one commit on
 * top. The pre-push hook already receives the range on stdin, which is what
 * makes this free.
 *
 * The readers are injected for the same reason `decideArbitration` takes facts:
 * the traversal is policy, and policy should not need a fixture repo.
 */
export function enforceArbitration(input: {
  commits: readonly string[];
  readCommit: (sha: string) => { override: string | null; slug: string | null };
  readLedger: (slug: string) => LedgerFacts | null;
  readRecord: (slug: string, claimed: string | null) => RecordFacts | null;
}): ArbitrationDecision {
  const warnings: string[] = [];
  for (const sha of input.commits) {
    const { override, slug } = input.readCommit(sha);
    // No override to scrutinise, or no pair to resolve (fast-track,
    // micro-chore): nothing to guard on this commit.
    if (override === null || slug === null) continue;
    const claimed = parseArbitrationTrailer(override);
    const d = decideArbitration({
      override,
      ledger: input.readLedger(slug),
      record: input.readRecord(slug, claimed),
    });
    if (!d.ok) return { ok: false, reason: `${sha.slice(0, 10)}: ${d.reason}` };
    if (d.warning) warnings.push(`${sha.slice(0, 10)}: ${d.warning}`);
  }
  return warnings.length > 0 ? { ok: true, warning: warnings.join('\n') } : { ok: true };
}

/**
 * Every commit the push would publish, oldest first.
 *
 * `parseRefLines` first, because it is the module that already knows a stdin
 * sha must be validated before it reaches `rev-list --stdin` — that command
 * accepts pseudo-options there, so an unvalidated field could shrink the
 * candidate set instead of failing.
 */
function resolveRangeCommits(git: GitRunner, refLines: readonly string[]): string[] {
  const parsed = parseRefLines(refLines);
  if ('error' in parsed) return [];
  const out: string[] = [];
  for (const update of parsed) {
    // A branch deletion pushes a zero local sha: nothing to scan.
    if (/^0+$/.test(update.localSha)) continue;
    // Remote tip when it exists, else merge-base with origin/main — the same
    // ladder `validate-pushed-adrs.ts` walks, for the same reason.
    let base = update.remoteSha;
    if (/^0+$/.test(base)) {
      const mb = git.text(['merge-base', 'origin/main', update.localSha]);
      if (mb.status !== 0) continue;
      base = mb.stdout.trim();
    }
    const r = git.text(['rev-list', '--reverse', `${base}..${update.localSha}`]);
    if (r.status !== 0) continue;
    out.push(
      ...r.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => isObjectId(l)),
    );
  }
  return [...new Set(out)];
}

/**
 * The round ledger as facts, read WITHOUT `autofix-ledger.ts`'s `readLedger`.
 *
 * That reader returns `null` for a different `sessionStartedAt`, and a push
 * legitimately happens in a later session than the rounds it arbitrates —
 * session-scoped reading here would make the guard fail open on every session
 * rotation while its warning claimed to be loud.
 */
function readLedgerFacts(cwd: string, slug: string): LedgerFacts | null {
  try {
    const path = ledgerPath(cwd, slug as Slug, 'code');
    const raw = JSON.parse(readFileNoFollow(path)) as unknown;
    const parsed = autofixLedgerSchema.safeParse(raw);
    if (!parsed.success) return null;
    return {
      rounds: parsed.data.rounds.map((r) => ({ round: r.round, verdict: roundVerdict(r) })),
    };
  } catch {
    return null;
  }
}

/** The arbitration record as facts, or `null` when absent or unparseable. */
function readRecordFacts(cwd: string, git: GitRunner, slug: string): RecordFacts | null {
  try {
    const raw = JSON.parse(readFileNoFollow(arbitrationPath(cwd, slug as Slug, 'code'))) as unknown;
    const rec = arbitrationRecordSchema.parse(raw);
    const tree = git.text(['rev-parse', 'HEAD^{tree}']);
    return {
      digest: recordDigest(rec),
      filled: isFilled(rec),
      boundTree: rec.boundTree,
      currentTree: tree.status === 0 ? tree.stdout.trim() : '',
    };
  } catch {
    return null;
  }
}

async function main(): Promise<number> {
  const cwd = process.cwd();
  const git = createGitRunner(cwd);
  const stdinResult = await readStdinWithTimeout(process.stdin, 5_000);
  if (!stdinResult.ok) {
    // Fail OPEN on an unreadable range, matching the decision's posture on a
    // missing ledger: this guard closes one escape hatch and must never be the
    // reason an honest push cannot happen.
    console.error('noldor-enforce-arbitration: could not read the push range from stdin — skipped');
    return 0;
  }
  const refLines = stdinResult.data.split('\n').filter((l) => l.trim().length > 0);
  const r = enforceArbitration({
    commits: resolveRangeCommits(git, refLines),
    readCommit: (sha) => {
      const msg = git.text(['log', '-1', '--pretty=%B', sha]);
      if (msg.status !== 0) return { override: null, slug: null };
      const t = parseTrailers(msg.stdout);
      return { override: t['Noldor-Path-Override'] ?? null, slug: t['Noldor-FD'] ?? null };
    },
    readLedger: (slug) => readLedgerFacts(cwd, slug),
    readRecord: (slug) => readRecordFacts(cwd, git, slug),
  });
  if (r.warning) console.error(r.warning);
  if (!r.ok) {
    console.error(`Noldor gate: ${r.reason}`);
    return 1;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
