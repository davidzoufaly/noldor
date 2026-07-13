import { tokenize } from './tokenize.js';
import type { Token } from './tokenize.js';

/** One clone occurrence: a contiguous source range in one file. */
export interface CloneInstance {
  readonly file: string;
  readonly startLine: number;
  readonly endLine: number;
}

/** One detected clone: the same normalized token run in two places. */
export interface CloneGroup {
  /** Length of the shared run in normalized tokens. */
  readonly tokens: number;
  /** Source lines spanned by the first instance (reporting convenience). */
  readonly lines: number;
  readonly instances: readonly CloneInstance[];
}

export interface CloneReport {
  /** Sorted by `tokens` desc, then first instance path/line (deterministic). */
  readonly groups: readonly CloneGroup[];
  readonly filesScanned: number;
  readonly totalTokens: number;
  /** Tokens covered by at least one clone instance (coverage-deduped). */
  readonly duplicatedTokens: number;
  /** duplicatedTokens / totalTokens * 100 (0 when the corpus is empty). */
  readonly duplicationPct: number;
}

export interface CloneOptions {
  readonly minTokens: number;
  readonly minLines: number;
  readonly gapTokens: number;
}

export const DEFAULT_CLONE_OPTIONS: CloneOptions = {
  minTokens: 50,
  minLines: 5,
  gapTokens: 10,
};

/** Internal: a clone pair as token-index ranges (inclusive) in two streams. */
interface Pair {
  fileA: string;
  fileB: string;
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
}

interface Stream {
  file: string;
  tokens: Token[];
}

const overlaps = (aS: number, aE: number, bS: number, bE: number): boolean => aS <= bE && bS <= aE;

/**
 * Detect Type-1/2 clones (Type-3 approximated via gap-merge) across `files`
 * (path → source). Pipeline per the design spec: window hash → verify →
 * seed-disjointness guard → greedy extension → post-extension disjointness
 * guard → same-pair gap-merge → size floors → containment dedup (injective
 * instance mapping) → coverage-deduped report math.
 */
export function detectClones(
  files: ReadonlyMap<string, string>,
  opts: CloneOptions = DEFAULT_CLONE_OPTIONS,
): CloneReport {
  const { minTokens, minLines, gapTokens } = opts;
  const streams: Stream[] = [...files.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, src]) => ({ file, tokens: tokenize(src) }));

  const totalTokens = streams.reduce((acc, s) => acc + s.tokens.length, 0);

  // 1. Window hashes → occurrence lists. Plain string keys (join of norms)
  // stand in for a rolling hash: identical windows collide exactly, no
  // verification false-positives, and corpus sizes here keep it fast.
  const occurrences = new Map<string, Array<{ stream: number; start: number }>>();
  streams.forEach((stream, sIdx) => {
    const norms = stream.tokens.map((t) => t.norm);
    for (let start = 0; start + minTokens <= norms.length; start++) {
      const key = norms.slice(start, start + minTokens).join('\u0000');
      const list = occurrences.get(key);
      if (list) list.push({ stream: sIdx, start });
      else occurrences.set(key, [{ stream: sIdx, start }]);
    }
  });

  // 2. Seed pairs from shared windows (first occurrence pairs with each later
  // one — extension makes maximal runs; containment dedup collapses the rest).
  const seen = new Set<string>();
  const pairs: Pair[] = [];
  for (const list of occurrences.values()) {
    if (list.length < 2) continue;
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const a = list[x]!;
        const b = list[y]!;
        // Seed disjointness guard: same-stream windows must not overlap.
        if (a.stream === b.stream && Math.abs(a.start - b.start) < minTokens) continue;

        const sa = streams[a.stream]!;
        const sb = streams[b.stream]!;
        const na = sa.tokens;
        const nb = sb.tokens;
        // Left-maximality pre-check: a seed whose predecessors also match is
        // an interior window of a run another seed already covers; skipping
        // it turns quadratic re-extension per maximal clone into linear.
        if (a.start > 0 && b.start > 0 && na[a.start - 1]!.norm === nb[b.start - 1]!.norm) {
          continue;
        }

        // 3. Greedy extension left/right over normalized tokens.
        let aS = a.start;
        let bS = b.start;
        while (aS > 0 && bS > 0 && na[aS - 1]!.norm === nb[bS - 1]!.norm) {
          aS--;
          bS--;
        }
        let aE = a.start + minTokens - 1;
        let bE = b.start + minTokens - 1;
        while (aE + 1 < na.length && bE + 1 < nb.length && na[aE + 1]!.norm === nb[bE + 1]!.norm) {
          aE++;
          bE++;
        }
        // Post-extension disjointness guard (periodic-run degenerate case).
        if (a.stream === b.stream && overlaps(aS, aE, bS, bE)) continue;

        const key = `${a.stream}:${aS}-${aE}|${b.stream}:${bS}-${bE}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ fileA: sa.file, fileB: sb.file, aStart: aS, aEnd: aE, bStart: bS, bEnd: bE });
      }
    }
  }

  // 4. Same-pair gap-merge (Type-3 approximation): fragments of the same
  // file pair whose BOTH sides are separated by ≤ gapTokens merge.
  const gapOk = (prevEnd: number, nextStart: number): boolean => {
    const gap = nextStart - prevEnd - 1;
    return gap >= 0 && gap <= gapTokens;
  };
  const byFilePair = new Map<string, Pair[]>();
  for (const p of pairs) {
    const key = `${p.fileA}\u0000${p.fileB}`;
    const list = byFilePair.get(key);
    if (list) list.push({ ...p });
    else byFilePair.set(key, [{ ...p }]);
  }
  const merged: Pair[] = [];
  for (const list of byFilePair.values()) {
    // Fixpoint merge: any two fragments whose BOTH sides sit gap-close in the
    // same order coalesce; repeat until stable (pairs interleave in seed
    // order, so a single adjacent-scan pass misses combinations).
    let changed = true;
    while (changed) {
      changed = false;
      outer: for (let x = 0; x < list.length; x++) {
        for (let y = 0; y < list.length; y++) {
          if (x === y) continue;
          const p = list[x]!;
          const q = list[y]!;
          if (gapOk(p.aEnd, q.aStart) && gapOk(p.bEnd, q.bStart)) {
            p.aEnd = q.aEnd;
            p.bEnd = q.bEnd;
            list.splice(y, 1);
            changed = true;
            break outer;
          }
        }
      }
    }
    // Gap-merge can mint a self-overlapping same-file range from two
    // internally-disjoint fragments - re-apply the disjointness guard.
    merged.push(
      ...list.filter((p) => p.fileA !== p.fileB || !overlaps(p.aStart, p.aEnd, p.bStart, p.bEnd)),
    );
  }
  merged.sort(
    (p, q) =>
      p.fileA.localeCompare(q.fileA) ||
      p.fileB.localeCompare(q.fileB) ||
      p.aStart - q.aStart ||
      p.bStart - q.bStart,
  );

  // 5. Size floors → concrete instances.
  const streamByFile = new Map(streams.map((s) => [s.file, s]));
  const toInstance = (file: string, start: number, end: number): CloneInstance => {
    const toks = streamByFile.get(file)!.tokens;
    return { file, startLine: toks[start]!.line, endLine: toks[end]!.line };
  };
  interface Built {
    tokens: number;
    lines: number;
    inst: [CloneInstance, CloneInstance];
    ranges: [{ file: string; s: number; e: number }, { file: string; s: number; e: number }];
  }
  const built: Built[] = [];
  for (const p of merged) {
    const tokenLen = p.aEnd - p.aStart + 1;
    if (tokenLen < minTokens) continue;
    const ia = toInstance(p.fileA, p.aStart, p.aEnd);
    const ib = toInstance(p.fileB, p.bStart, p.bEnd);
    const linesA = ia.endLine - ia.startLine + 1;
    const linesB = ib.endLine - ib.startLine + 1;
    if (linesA < minLines || linesB < minLines) continue;
    built.push({
      tokens: tokenLen,
      lines: linesA,
      inst: [ia, ib],
      ranges: [
        { file: p.fileA, s: p.aStart, e: p.aEnd },
        { file: p.fileB, s: p.bStart, e: p.bEnd },
      ],
    });
  }

  // 6. Containment dedup: drop G2 when an INJECTIVE mapping sends each of its
  // instances into a DISTINCT instance of a larger group (both instances of
  // G2 inside ONE instance of G1 does not qualify — G2 expresses internal
  // repetition G1 doesn't).
  built.sort((a, b) => b.tokens - a.tokens);
  const contained = (
    inner: { file: string; s: number; e: number },
    outer: { file: string; s: number; e: number },
  ): boolean => inner.file === outer.file && outer.s <= inner.s && inner.e <= outer.e;
  const kept: Built[] = [];
  for (const g2 of built) {
    let dominated = false;
    for (const g1 of kept) {
      if (g1.tokens <= g2.tokens) continue;
      const [x, y] = g2.ranges;
      const [p, q] = g1.ranges;
      // Injective mappings over 2 instances: (x→p, y→q) or (x→q, y→p).
      if ((contained(x, p) && contained(y, q)) || (contained(x, q) && contained(y, p))) {
        dominated = true;
        break;
      }
    }
    if (!dominated) kept.push(g2);
  }

  // 7. Coverage-deduped duplication math over token ranges.
  const coverage = new Map<string, Array<[number, number]>>();
  for (const g of kept) {
    for (const r of g.ranges) {
      const list = coverage.get(r.file) ?? [];
      list.push([r.s, r.e]);
      coverage.set(r.file, list);
    }
  }
  let duplicatedTokens = 0;
  for (const ranges of coverage.values()) {
    ranges.sort((a, b) => a[0] - b[0]);
    let curS = -1;
    let curE = -2;
    for (const [s, e] of ranges) {
      if (s > curE + 1) {
        duplicatedTokens += curE - curS + 1;
        curS = s;
        curE = e;
      } else {
        curE = Math.max(curE, e);
      }
    }
    duplicatedTokens += curE - curS + 1;
  }

  // 8. Class-merge: a block duplicated in n places arrives as C(n,2) pairs;
  // union pairs sharing an exact token range into one clone class so group
  // counts scale linearly with copies instead of quadratically.
  const rangeKey = (r: { file: string; s: number; e: number }): string =>
    `${r.file}\u0000${r.s}-${r.e}`;
  const classOf = new Map<string, number>();
  const classes: Array<{
    tokens: number;
    lines: number;
    members: Map<string, CloneInstance>;
  }> = [];
  for (const g of kept) {
    const keys = g.ranges.map(rangeKey);
    const hit = keys.map((k) => classOf.get(k)).find((idx) => idx !== undefined);
    const idx = hit ?? classes.push({ tokens: g.tokens, lines: g.lines, members: new Map() }) - 1;
    const cls = classes[idx]!;
    cls.tokens = Math.max(cls.tokens, g.tokens);
    for (let k = 0; k < keys.length; k++) {
      classOf.set(keys[k]!, idx);
      if (!cls.members.has(keys[k]!)) cls.members.set(keys[k]!, g.inst[k]!);
    }
  }

  const groups: CloneGroup[] = classes
    .map((c) => ({
      tokens: c.tokens,
      lines: c.lines,
      instances: [...c.members.values()].sort(
        (a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine,
      ),
    }))
    .sort(
      (a, b) =>
        b.tokens - a.tokens ||
        a.instances[0]!.file.localeCompare(b.instances[0]!.file) ||
        a.instances[0]!.startLine - b.instances[0]!.startLine,
    );

  return {
    groups,
    filesScanned: streams.length,
    totalTokens,
    duplicatedTokens,
    duplicationPct: totalTokens === 0 ? 0 : (duplicatedTokens / totalTokens) * 100,
  };
}
