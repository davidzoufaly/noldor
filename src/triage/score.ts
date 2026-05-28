import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import matter from 'gray-matter';
import { z } from 'zod';

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
   * Returns true iff the slug names shipped work — concretely, a feature MD at
   * `<featuresDir>/<slug>.md` with frontmatter `phase: done`. Every other state
   * (file missing, file present with `phase != done`, slug only in roadmap or
   * backlog, unknown slug) returns false. See `resolveIsShipped` below for the
   * canonical FS-backed implementation.
   */
  isShipped: (slug: string) => boolean;
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
  /** Unused in the lookup but accepted so the caller can document the full data set. Reserved for future extensions. */
  roadmapPath: string;
  /** Unused in the lookup. Reserved for future extensions. */
  backlogPath: string;
}

/**
 * Build an `isShipped(slug)` function backed by the file system. Returns true
 * iff `<featuresDir>/<slug>.md` exists AND its frontmatter `phase` field reads
 * exactly `done`. Any other state — file absent, frontmatter missing, phase
 * value other than `done` — returns false. The roadmap / backlog paths are
 * deliberately not consulted: an entry's mere presence in those lists never
 * counts as shipped under the v1 rule.
 */
export function resolveIsShipped(paths: ResolverPaths): (slug: string) => boolean {
  return (slug: string): boolean => {
    const fdPath = join(paths.featuresDir, `${slug}.md`);
    if (!existsSync(fdPath)) return false;
    const raw = readFileSync(fdPath, 'utf8');
    const parsed = matter(raw);
    return (parsed.data as { phase?: unknown }).phase === 'done';
  };
}

const USAGE =
  'usage: tsx score.ts --size=<XS|S|M|L|XL> --impact=<low|med|high|critical> [--confidence=<low|med|high>] [--deps=<slug,slug>] [--features-dir=<path>]\n';

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
  const depsArg = args.get('deps') ?? '';
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

  const deps = depsArg
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
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
