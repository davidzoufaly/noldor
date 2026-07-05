import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import matter from 'gray-matter';
import { z } from 'zod';

import { resolveEntryRef } from './entry-id.js';

export const sizeSchema = z.enum(['XS', 'S', 'M', 'L', 'XL']);
export const impactSchema = z.enum(['low', 'med', 'high', 'critical']);
export const confidenceSchema = z.enum(['low', 'med', 'high']);

export type Size = z.infer<typeof sizeSchema>;
export type Impact = z.infer<typeof impactSchema>;
export type Confidence = z.infer<typeof confidenceSchema>;

export interface ScoringInputs {
  size: Size;
  impact: Impact;
  confidence?: Confidence;
  deps: readonly string[];
  /**
   * Returns true iff the reference (a slug or a `Q-NNNN` entry ID) names shipped
   * work — concretely, a feature MD with frontmatter `phase: done`. An ID is
   * resolved to its slug first. Every other state (file missing, `phase != done`,
   * ref only in roadmap or backlog, unknown ref) returns false. See
   * `resolveIsShipped` below for the canonical FS-backed implementation.
   */
  isShipped: (ref: string) => boolean;
}

const EFFORT: Record<Size, number> = { XS: 0.5, S: 1, M: 2, L: 3, XL: 5 };
const IMPACT: Record<Impact, number> = { low: 1, med: 2, high: 4, critical: 8 };
const CONFIDENCE: Record<Confidence, number> = { low: 0.5, med: 0.75, high: 1.0 };

/**
 * Pure scoring formula: `round(100 × (impact × confidence × dep_factor) / effort)`
 * where `dep_factor = 1 / (1 + unshipped_dep_count)`. Missing confidence
 * defaults to `med`. Throws on unknown size/impact/confidence values so callers
 * surface bad input as a programmer error rather than a silent zero.
 */
export function scoreEntry(input: ScoringInputs): number {
  const effort = EFFORT[input.size];
  if (effort === undefined) throw new Error(`unknown size value: ${input.size}`);
  const impact = IMPACT[input.impact];
  if (impact === undefined) throw new Error(`unknown impact value: ${input.impact}`);
  const conf = CONFIDENCE[input.confidence ?? 'med'];
  if (conf === undefined) throw new Error(`unknown confidence value: ${input.confidence}`);

  const unshippedCount = input.deps.filter((slug) => !input.isShipped(slug)).length;
  const depFactor = 1 / (1 + unshippedCount);

  return Math.round((100 * impact * conf * depFactor) / effort);
}

export interface ResolverPaths {
  featuresDir: string;
  /** Read once to resolve `Q-NNNN` entry-ID `deps:` references to slugs via `resolveEntryRef`. */
  roadmapPath: string;
  /** Read once alongside `roadmapPath` for the same ID→slug resolution. */
  backlogPath: string;
}

/**
 * Build an `isShipped(ref)` function backed by the file system. `ref` may be a
 * slug or a stable entry ID (`Q-NNNN`) — an ID is first resolved to its slug via
 * `resolveEntryRef` (scanning roadmap + backlog entries, then FD `entry-id`
 * frontmatter). Returns true iff the resolved `<featuresDir>/<slug>.md` exists
 * AND its frontmatter `phase` reads exactly `done`. Every other state — file
 * absent, frontmatter missing, non-`done` phase, unknown ID, slug present only
 * in roadmap/backlog — returns false. Roadmap/backlog are consulted only for
 * ID resolution, never as a shipped signal on their own. The two doc files are
 * read once at build time, not per-dep.
 */
export function resolveIsShipped(paths: ResolverPaths): (ref: string) => boolean {
  const roadmapRaw = existsSync(paths.roadmapPath) ? readFileSync(paths.roadmapPath, 'utf8') : '';
  const backlogRaw = existsSync(paths.backlogPath) ? readFileSync(paths.backlogPath, 'utf8') : '';
  return (ref: string): boolean => {
    const slug = resolveEntryRef(ref, { roadmapRaw, backlogRaw, featuresDir: paths.featuresDir });
    const fdPath = join(paths.featuresDir, `${slug}.md`);
    if (!existsSync(fdPath)) return false;
    const raw = readFileSync(fdPath, 'utf8');
    const parsed = matter(raw);
    return (parsed.data as { phase?: unknown }).phase === 'done';
  };
}

const USAGE =
  'usage: tsx score.ts --size=<XS|S|M|L|XL> --impact=<low|med|high|critical> [--confidence=<low|med|high>] [--blocked-by=<slug|Q-id,…>] [--deps=<slug|Q-id,…> (alias)] [--features-dir=<path>]\n';

/**
 * CLI entrypoint. Run via:
 *   pnpm tsx scripts/triage/score.ts --size=M --impact=high --confidence=med --deps=foo,bar
 * Prints the integer score to stdout. The `/triage` skill prose shells out
 * to this for each proposal row. Bad/missing input prints USAGE to stderr
 * and returns exit code 2 (no stack trace).
 */
function main(argv: readonly string[]): number {
  const args = new Map<string, string>();
  for (const arg of argv.slice(2)) {
    const m = /^--([\w-]+)=(.*)$/.exec(arg);
    if (m) args.set(m[1] ?? '', m[2] ?? '');
  }
  const sizeArg = args.get('size');
  const impactArg = args.get('impact');
  const confidenceArg = args.get('confidence');
  // `blocked-by` is the first-class flag; `deps` is the legacy alias — union both.
  const depsArg = [args.get('deps'), args.get('blocked-by')]
    .filter((v): v is string => v !== undefined)
    .join(',');
  const featuresDir = args.get('features-dir') ?? 'docs/features';

  const sizeParse = sizeSchema.safeParse(sizeArg);
  const impactParse = impactSchema.safeParse(impactArg);
  if (!sizeParse.success || !impactParse.success) {
    process.stderr.write(USAGE);
    return 2;
  }

  let confidence: Confidence | undefined;
  if (confidenceArg !== undefined) {
    const confidenceParse = confidenceSchema.safeParse(confidenceArg);
    if (!confidenceParse.success) {
      process.stderr.write(USAGE);
      return 2;
    }
    confidence = confidenceParse.data;
  }

  const deps = [
    ...new Set(
      depsArg
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  ];
  const isShipped = resolveIsShipped({
    featuresDir,
    roadmapPath: 'docs/roadmap.md',
    backlogPath: 'docs/backlog.md',
  });
  const score = scoreEntry({
    size: sizeParse.data,
    impact: impactParse.data,
    confidence,
    deps,
    isShipped,
  });
  process.stdout.write(`${score}\n`);
  return 0;
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  process.exit(main(process.argv));
}
