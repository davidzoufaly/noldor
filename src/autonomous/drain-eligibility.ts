/**
 * True when a roadmap entry's block is safe to retire via the gate's blind
 * `removeBlock` in an unattended drain — i.e. it has no `Touches:` clause and at
 * most one top-level scope bullet. Multi-scope / Touches-bearing blocks need the
 * residue disposition a human does in `/promote` (spec D9); the drain skips them.
 *
 * @param description - The roadmap entry's body/description text (BacklogEntry.description).
 */
export function isDrainEligible(description: string | undefined): boolean {
  const body = (description ?? '').trim();
  if (body.length === 0) return true;
  if (/^\s*Touches:/im.test(body)) return false;
  const topLevelBullets = body.split('\n').filter((line) => /^\s*[-*]\s+/.test(line)).length;
  return topLevelBullets <= 1;
}
