import type { Lane } from './context.js';

export interface ArtifactReview {
  kind: 'plan' | 'spec' | 'code';
  /** Path of the artifact under review. For `code` it is a label only — the review reads a git diff, not the file. */
  artifact: string;
  slug?: string;
  baseSha?: string;
  fullReview: boolean;
}

export interface Invocation {
  lane: Lane;
  paths: string[];
  rerun: boolean;
  dryRun: boolean;
  /** Present only for orchestrate-lane review invocations (`--plan` / `--spec` / `--code`). */
  review?: ArtifactReview;
  /** Present only for `--help`. */
  help?: boolean;
}

const RANGE_RE = /^(.+)\.\.(.+)$/;
/**
 * A REVISION, not an object name: `origin/main`, `HEAD~1` and `v1.2.3` are all
 * valid here. Named apart from `isSha` in `src/core/sha.ts` on purpose — that one
 * is hex-only, for the rungs that interpolate a sha into a git argument. Two
 * consts called `SHA_RE` with different contracts is how the wrong one gets
 * reused.
 */
const REV_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function parseCliArgs(argv: readonly string[]): Invocation {
  let lane: Lane = { kind: 'gate' };
  let rerun = false;
  let dryRun = false;
  let paths: string[] = [];
  let help = false;

  let reviewKind: 'plan' | 'spec' | 'code' | null = null;
  let artifact: string | undefined;
  let slug: string | undefined;
  let baseSha: string | undefined;
  let fullReview = false;

  const requireValue = (flag: string, v: string | undefined): string => {
    if (!v) throw new Error(`${flag} requires a value`);
    return v;
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help') {
      help = true;
    } else if (a === '--rerun') {
      rerun = true;
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--working') {
      lane = { kind: 'working' };
    } else if (a === '--plan' || a === '--spec' || a === '--code') {
      if (reviewKind !== null) throw new Error('--plan, --spec and --code are mutually exclusive');
      reviewKind = a.slice(2) as 'plan' | 'spec' | 'code';
      artifact = requireValue(a, argv[++i]);
    } else if (a === '--slug') {
      slug = requireValue('--slug', argv[++i]);
    } else if (a === '--base-sha') {
      baseSha = requireValue('--base-sha', argv[++i]);
    } else if (a === '--full-review') {
      fullReview = true;
    } else if (a === '--paths') {
      const v = argv[++i];
      if (!v) throw new Error('--paths requires a comma-separated list');
      paths = v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (RANGE_RE.test(a)) {
      const m = RANGE_RE.exec(a)!;
      lane = { kind: 'range', from: m[1], to: m[2] };
    } else if (REV_RE.test(a)) {
      lane = { kind: 'sha', sha: a };
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }

  if (rerun && dryRun) throw new Error('--rerun and --dry-run are mutually exclusive');

  const inv: Invocation = { lane, paths, rerun, dryRun };
  if (help) inv.help = true;
  if (reviewKind !== null) {
    inv.review = { kind: reviewKind, artifact: artifact!, fullReview };
    if (slug !== undefined) inv.review.slug = slug;
    if (baseSha !== undefined) inv.review.baseSha = baseSha;
  }
  return inv;
}
