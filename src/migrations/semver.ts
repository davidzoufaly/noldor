/** Parse a semver string into [major, minor, patch]; prerelease/build ignored. */
export function parseSemver(v: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) throw new Error(`not a semver: ${JSON.stringify(v)}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** -1 if a<b, 0 if equal, 1 if a>b (numeric major/minor/patch compare). */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}
