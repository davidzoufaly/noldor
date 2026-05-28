import type { Lane } from './context.js';

export interface Invocation {
  lane: Lane;
  paths: string[];
  rerun: boolean;
  dryRun: boolean;
}

const RANGE_RE = /^(.+)\.\.(.+)$/;
const SHA_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function parseCliArgs(argv: readonly string[]): Invocation {
  let lane: Lane = { kind: 'gate' };
  let rerun = false;
  let dryRun = false;
  let paths: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rerun') {
      rerun = true;
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--working') {
      lane = { kind: 'working' };
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
  return { lane, paths, rerun, dryRun };
}
