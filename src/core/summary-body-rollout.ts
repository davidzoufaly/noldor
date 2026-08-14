import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { atomicWriteFileSync } from './atomic-write.js';
import type { EnsureMarkerStatus } from './rollout-marker.js';

/**
 * Activation snapshot for the summary-body gate.
 *
 * Deliberately NOT `.noldor/rollout-marker`: that marker may predate this
 * validator by months, and a single SHA cannot say which commits on *side*
 * branches existed when this gate armed. This file records one tip per
 * activation-time commit ref, and `rev-list` turns each into its whole ancestor
 * closure — so exactly the history present at activation is grandfathered, on
 * every branch, and a commit added to an old side branch afterwards still
 * enforces even once that branch merges the upgraded mainline.
 */
export const FILE = '.noldor/summary-body-rollout.json';

/** The command an operator runs to create the snapshot; named in every notice. */
export const CREATE_COMMAND = 'pnpm noldor init --update';

export interface SummaryBodyRolloutSnapshot {
  version: 1;
  grandfatherTips: string[];
}

/**
 * Result of reading the snapshot.
 *
 * A discriminated union rather than `SummaryBodyRolloutSnapshot | null` because
 * the two failures must not collapse: `absent` means the repo never armed this
 * gate (advisory-only, exit 0), while `invalid` means it armed and the file is
 * now corrupt (fail closed, exit 2). Nullable would make them the same value and
 * put "a corrupt snapshot blocks rather than disables" out of reach — the same
 * null-collapse {@link ../core/rollout-marker.rolloutMarkerExists} was added to
 * escape, expressed in the type instead of in a second function.
 */
export type SummaryBodyRolloutRead =
  | { kind: 'absent' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'ok'; snapshot: SummaryBodyRolloutSnapshot };

/** A syntactically well-formed object ID: hex, SHA-1 (40) or SHA-256 (64). */
const SHA_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/**
 * Is this a syntactically valid object ID?
 *
 * Shared with the pre-push ref-line parser, which must reject anything else
 * before it reaches `git rev-list --stdin` — that command accepts pseudo-options
 * such as `--no-walk` and `--not` on stdin, so an unvalidated field there can
 * shrink the candidate set instead of failing.
 */
export function isObjectId(value: string): boolean {
  return SHA_RE.test(value);
}

export function snapshotPath(cwd: string = process.cwd()): string {
  return join(cwd, FILE);
}

/**
 * Read and validate the activation snapshot.
 *
 * Every corruption shape fails closed as `invalid`: malformed JSON, a version
 * this build does not understand, a non-array or empty tip list, a duplicate
 * tip, or a tip that is not a syntactically valid object ID. Corrupt data can
 * never *broaden* the grandfathered set — the one direction that would silently
 * disable enforcement.
 *
 * Note that "syntactically valid" is all this checks. Whether a tip resolves in
 * *this* clone is a runtime question the caller answers, because a snapshot is
 * tracked and shared while unpublished tips are machine-local.
 */
export function readSummaryBodyRolloutSnapshot(
  cwd: string = process.cwd(),
): SummaryBodyRolloutRead {
  const p = snapshotPath(cwd);
  if (!existsSync(p)) return { kind: 'absent' };

  let raw: string;
  try {
    raw = readFileSync(p, 'utf8');
  } catch (err) {
    return { kind: 'invalid', reason: `unreadable: ${(err as Error).message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // A zero-byte file lands here too — the torn-write shape `atomicWriteFileSync`
    // exists to prevent, and which must block rather than read as "no snapshot".
    return { kind: 'invalid', reason: `malformed JSON: ${(err as Error).message}` };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'invalid', reason: 'expected a JSON object' };
  }
  const obj = parsed as Record<string, unknown>;

  if (obj['version'] !== 1) {
    return { kind: 'invalid', reason: `unsupported version: ${JSON.stringify(obj['version'])}` };
  }

  const tips = obj['grandfatherTips'];
  if (!Array.isArray(tips)) return { kind: 'invalid', reason: 'grandfatherTips must be an array' };
  if (tips.length === 0) {
    // An empty on-disk tip set is reserved for corruption. A repo with no commits
    // writes no snapshot at all (`skipped-no-git`), so emptiness here means the
    // file lost its contents — which must not read as "grandfather nothing" by
    // accident when it could equally mean a truncated write.
    return { kind: 'invalid', reason: 'grandfatherTips is empty' };
  }

  const seen = new Set<string>();
  for (const tip of tips) {
    if (typeof tip !== 'string' || !SHA_RE.test(tip)) {
      return { kind: 'invalid', reason: `not a valid object ID: ${JSON.stringify(tip)}` };
    }
    if (seen.has(tip)) return { kind: 'invalid', reason: `duplicate tip: ${tip}` };
    seen.add(tip);
  }

  return { kind: 'ok', snapshot: { version: 1, grandfatherTips: tips as string[] } };
}

/** Run git, returning stdout on success and null on any failure. */
function git(args: string[], cwd: string): string | null {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

/**
 * Every commit OID currently at the tip of a ref, deduplicated.
 *
 * `%(objectname)` on a `refs/tags/**` row is the tag object for an annotated
 * tag, so `for-each-ref` is asked to peel: `%(*objectname)` is non-empty exactly
 * when the ref points at a tag object, and then it holds the commit that tag
 * targets. `%(objecttype)` filters out refs that do not resolve to a commit at
 * all (a blob or tree tag contributes nothing).
 */
function collectRefTips(cwd: string): string[] {
  const tips: string[] = [];

  const head = git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], cwd);
  if (head !== null && head.trim().length > 0) tips.push(head.trim());

  const out = git(
    [
      'for-each-ref',
      '--format=%(objecttype) %(objectname) %(*objecttype) %(*objectname)',
      'refs/heads/',
      'refs/remotes/',
      'refs/tags/',
    ],
    cwd,
  );
  for (const line of (out ?? '').split('\n')) {
    const [type, name, peeledType, peeledName] = line.trim().split(/\s+/);
    if (peeledType === 'commit' && peeledName !== undefined) tips.push(peeledName);
    else if (type === 'commit' && name !== undefined) tips.push(name);
  }

  return [...new Set(tips)];
}

/**
 * Create the activation snapshot, recording every commit-ref tip as it stands
 * now. Called by `noldor init` / `init --update` / `noldor upgrade`.
 *
 * **Never rewrites an existing snapshot.** Moving the tips forward would
 * silently grandfather every commit made since activation — turning a re-run of
 * `init --update` into a way to launder unexplained history past the gate.
 *
 * Returns `skipped-no-git` on a repo with no commit-bearing ref yet (a fresh
 * `git init`), writing nothing: an empty on-disk snapshot is reserved for
 * corruption, so it must not also mean "bootstrapped too early". The caller
 * tells the operator to rerun after the first commit.
 */
export function ensureSummaryBodyRolloutSnapshot(cwd: string = process.cwd()): EnsureMarkerStatus {
  if (existsSync(snapshotPath(cwd))) return 'exists';

  const tips = collectRefTips(cwd);
  if (tips.length === 0) return 'skipped-no-git';

  mkdirSync(join(cwd, '.noldor'), { recursive: true });
  const snapshot: SummaryBodyRolloutSnapshot = { version: 1, grandfatherTips: tips };
  atomicWriteFileSync(snapshotPath(cwd), `${JSON.stringify(snapshot, null, 2)}\n`);
  return 'created';
}
