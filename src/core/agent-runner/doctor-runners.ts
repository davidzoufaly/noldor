import { execFileSync } from 'node:child_process';
import { CLAUDE_BIN } from './runners/claude.js';
import { CODEX_BIN } from './runners/codex.js';
import { OPENCODE_BIN } from './runners/opencode.js';
import type { AgentsConfig, RunnerName } from './types.js';

const BINS: Record<RunnerName, string> = {
  claude: CLAUDE_BIN,
  codex: CODEX_BIN,
  opencode: OPENCODE_BIN,
};

export interface RunnerCheck {
  runner: RunnerName;
  status: 'ok' | 'missing' | 'below-floor';
  detail: string;
}

/** Numeric per-segment dotted-version compare (`0.10.0 > 0.6.0`); no range syntax. */
export function compareDotted(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** Every runner the config actually references: the default + each role's runner. */
export function referencedRunners(cfg: AgentsConfig): RunnerName[] {
  const set = new Set<RunnerName>([cfg.default]);
  for (const rc of Object.values(cfg.roles)) {
    if (rc) set.add(rc.runner);
  }
  return [...set];
}

export type VersionProbe = (bin: string) => string | null;

function defaultProbe(bin: string): string | null {
  try {
    const out = execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000 });
    const m = out.match(/\d+(\.\d+)+/);
    return m ? m[0] : out.trim() || '0';
  } catch {
    return null;
  }
}

/**
 * Presence + version-floor check for every *configured* runner only — a
 * consumer who never opted into opencode is not flagged for missing it.
 * Below-floor is an error, not a warning: a floor exists because something is
 * known-broken below it (spec D4).
 */
export function checkRunners(cfg: AgentsConfig, probe: VersionProbe = defaultProbe): RunnerCheck[] {
  return referencedRunners(cfg).map((runner) => {
    const version = probe(BINS[runner]);
    if (version === null) {
      return { runner, status: 'missing' as const, detail: `'${BINS[runner]}' not found on PATH` };
    }
    const floor = cfg.versionFloors[runner];
    if (floor && compareDotted(version, floor) < 0) {
      return { runner, status: 'below-floor' as const, detail: `${version} < floor ${floor}` };
    }
    return { runner, status: 'ok' as const, detail: version };
  });
}
