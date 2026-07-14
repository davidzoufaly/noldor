import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LANE_ALIASES } from '../core/lanes.js';
import type { Migration, MigrationStep } from './types.js';

/** Rewrite legacy lane values in a crLanes array; returns null if unchanged. */
function rewriteLanes(arr: unknown): string[] | null {
  if (!Array.isArray(arr)) return null;
  let changed = false;
  const out = arr.map((v) => {
    if (typeof v === 'string' && v in LANE_ALIASES) {
      changed = true;
      return LANE_ALIASES[v];
    }
    return v as string;
  });
  return changed ? out : null;
}

/**
 * First config-*value* migration. `crLanes` is a top-level sibling of the
 * `consumer` block (parsed by `noldorConfigSchema`, not `ConsumerConfigSchema`),
 * so it is not reachable via the typed `config` arg — round-trip the raw JSON
 * directly (modeled on `writeFrameworkVersion`). Idempotent: already-canonical
 * values produce no step.
 */
function computeSteps(cwd: string, apply: boolean): MigrationStep[] {
  const path = join(cwd, '.noldor', 'config.json');
  if (!existsSync(path)) return [];
  const before = readFileSync(path, 'utf8');
  let cfg: { crLanes?: Record<string, unknown> };
  try {
    cfg = JSON.parse(before);
  } catch {
    return []; // unparseable config — leave it; a loud failure surfaces elsewhere
  }
  const crLanes = cfg.crLanes;
  if (!crLanes || typeof crLanes !== 'object') return [];
  let changed = false;
  for (const kind of Object.keys(crLanes)) {
    const rewritten = rewriteLanes(crLanes[kind]);
    if (rewritten) {
      crLanes[kind] = rewritten;
      changed = true;
    }
  }
  if (!changed) return [];
  const after = `${JSON.stringify(cfg, null, 2)}\n`;
  if (apply) writeFileSync(path, after);
  return [{ path: '.noldor/config.json', before, after }];
}

/** crLanes lane values → canonical role-refs (subagent→reviewer, verify→verifier). */
export const migration_0_7_0: Migration = {
  from: '0.6.0',
  to: '0.7.0',
  description: 'rewrite crLanes lane values subagent->reviewer, verify->verifier',
  dryRun: (cwd) => computeSteps(cwd, false),
  migrate: (cwd) => computeSteps(cwd, true),
};
