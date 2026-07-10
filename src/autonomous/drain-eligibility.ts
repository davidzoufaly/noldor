/**
 * True when a roadmap entry's block is safe to retire via the gate's blind
 * `removeBlock` in an unattended drain — i.e. it has no `Touches:` clause and at
 * most one top-level scope bullet. Multi-scope / Touches-bearing blocks need the
 * residue disposition a human does in `/noldor-promote` (spec D9); the drain skips them.
 *
 * @param description - The roadmap entry's body/description text (BacklogEntry.description).
 */
export function isDrainEligible(description: string | undefined): boolean {
  const body = (description ?? '').trim();
  if (body.length === 0) return true;
  // Match the `Touches:` scope clause anywhere in the body, not only at line-start:
  // real entries bury it mid-paragraph (e.g. "...upfront. Touches: a.ts, b.ts"),
  // which a line-anchored regex missed — letting a multi-scope block slip through.
  // Case-sensitive on purpose: the scope marker is always capitalized `Touches:`,
  // so this won't trip on lowercase prose (e.g. "barely touches: nothing").
  if (/\bTouches:/.test(body)) return false;
  const topLevelBullets = body.split('\n').filter((line) => /^\s*[-*]\s+/.test(line)).length;
  return topLevelBullets <= 1;
}
