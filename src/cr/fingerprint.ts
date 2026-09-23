import { createHash } from 'node:crypto';

import type { Finding } from './findings-schema.js';

/**
 * Stable id for a SINGLE blocker — what R1 compares, what a signal points at,
 * what an arbitration disposition keys on, and what a series decision is filed
 * under (Q-0261).
 *
 * Its own leaf module so the review lanes can match a finding against a
 * decision without importing the round ledger's closure (session marker, state
 * files). `autofix-ledger.ts` re-exports it for the callers that always had it
 * from there.
 *
 * Length-prefixed rather than `|`-joined: a message may itself contain `|`, so
 * a plain join lets two different findings encode identically. (The set-level
 * `fingerprintBlockers` in `autofix-ledger.ts` has the same latent ambiguity and
 * is left alone deliberately — changing it would invalidate every digest already
 * written to a ledger.)
 *
 * `line` is excluded for the same reason it is excluded there: an unrelated
 * edit elsewhere in the file shifts it, and an unfixed blocker must not
 * fingerprint as progress.
 *
 * The id identifies a LOGICAL finding, so the same blocker filed by two lanes
 * shares one. That is intended: the operator arbitrates the finding once, not
 * once per lane.
 */
export function fingerprintBlocker(b: Finding): string {
  const parts = [b.severity, b.file, b.message];
  const encoded = parts.map((p) => `${p.length}:${p}`).join('');
  return createHash('sha1').update(encoded).digest('hex');
}
