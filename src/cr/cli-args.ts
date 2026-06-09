import type { Lane } from './context.js';

export interface PlanReview {
  kind: 'plan' | 'spec';
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
  /** Present only for artifact (plan/spec) review invocations. */
  review?: PlanReview;
  /** Present only for `--help`. */
  help?: boolean;
}

const RANGE_RE = /^(.+)\.\.(.+)$/;
const SHA_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function parseCliArgs(argv: readonly string[]): Invocation {
  let lane: Lane = { kind: 'gate' };
  let rerun = false;
  let dryRun = false;
  let paths: string[] = [];
  let help = false;

  let reviewKind: 'plan' | 'spec' | null = null;
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
    } else if (a === '--plan' || a === '--spec') {
      if (reviewKind !== null) throw new Error('--plan and --spec are mutually exclusive');
      reviewKind = a === '--plan' ? 'plan' : 'spec';
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
    } else if (SHA_RE.test(a)) {
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
