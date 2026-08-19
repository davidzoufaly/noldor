// @tests: pendev-ui-design-phase
// Per-surface UI-design baseline freshness (spec U7). Same posture as
// graph-freshness.ts — reported, never thrown — but ancestry-based
// (merge-base), never committer timestamps, and evaluated per configured
// surface so one surface's sync cannot mask another's drift.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { braceExpand } from 'minimatch';

import type { UiConfig } from '../core/ui-predicate.js';
import { GRAPH_IRRELEVANT_EXCLUDES } from './graph-freshness.js';

const execFileAsync = promisify(execFile);

export interface UiSurfaceFreshness {
  surface: string;
  status: 'fresh' | 'stale' | 'uninitialized' | 'skipped';
  uiCommit?: string;
  baselineCommit?: string;
  detail: string;
}

export interface UiFreshnessVerdict {
  overall: 'fresh' | 'stale' | 'uninitialized' | 'skipped';
  surfaces: UiSurfaceFreshness[];
}

export const BASELINE_DIR = 'docs/design/ui/baseline';

const REMEDIATION = 'run `pnpm noldor design ui-sync` in a pencil-capable session, then commit';

/**
 * Pure ancestry classifier — the U7 decision procedure, testable without a
 * repo. No `equal` parameter: `git merge-base --is-ancestor A A` exits 0, so
 * the U == B case already arrives as `uiIsAncestorOfBaseline: true`.
 */
export function classifyAncestry(
  uiIsAncestorOfBaseline: boolean,
  baselineIsAncestorOfUi: boolean,
): 'fresh' | 'stale' | 'skipped' {
  if (uiIsAncestorOfBaseline) return 'fresh';
  if (baselineIsAncestorOfUi) return 'stale';
  return 'skipped'; // unrelated / diverged / shallow-cut — never a false red
}

async function git(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return { ok: true, stdout: stdout.trim() };
  } catch {
    return { ok: false, stdout: '' };
  }
}

async function latestCommit(cwd: string, paths: string[]): Promise<string> {
  const { stdout } = await git(cwd, ['log', '-1', '--format=%H', '--', ...paths]);
  return stdout;
}

/**
 * `git merge-base --is-ancestor` exits 0 = yes, 1 = no, anything else = an
 * operational failure (missing object, broken repo). The three outcomes must
 * stay distinct: collapsing an error into "no" can combine with the reverse
 * probe into a false blocking `stale` — the one verdict U7 forbids minting
 * from a git failure.
 */
async function isAncestor(
  cwd: string,
  a: string,
  b: string,
): Promise<{ ok: true; isAncestor: boolean } | { ok: false }> {
  try {
    await execFileAsync('git', ['merge-base', '--is-ancestor', a, b], { cwd });
    return { ok: true, isAncestor: true };
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 1) return { ok: true, isAncestor: false };
    return { ok: false };
  }
}

const RANK: Record<UiSurfaceFreshness['status'], number> = {
  stale: 3,
  uninitialized: 2,
  fresh: 1,
  skipped: 0,
};

/**
 * Evaluate baseline freshness for every configured surface. `config` is the
 * consumer's `uiPaths`/`uiSurfaces` slice; absent/empty `uiPaths` skips the
 * whole check (feature not adopted). Every git failure degrades to a
 * per-surface `skipped` with detail — reported, never thrown.
 */
export async function evaluateUiDesignFreshness(
  cwd: string,
  config: UiConfig,
): Promise<UiFreshnessVerdict> {
  const uiPaths = config.uiPaths ?? [];
  if (uiPaths.length === 0) {
    return { overall: 'skipped', surfaces: [] };
  }

  const shallow = await git(cwd, ['rev-parse', '--is-shallow-repository']);
  if (shallow.ok && shallow.stdout === 'true') {
    return {
      overall: 'skipped',
      surfaces: [
        { surface: '*', status: 'skipped', detail: 'shallow clone — ancestry unavailable' },
      ],
    };
  }

  const surfaceMap: Record<string, string[]> = config.uiSurfaces ?? { app: uiPaths };
  const surfaces: UiSurfaceFreshness[] = [];

  for (const [surface, globs] of Object.entries(surfaceMap).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const baselineFile = `${BASELINE_DIR}/${surface}.pen`;
    // `:(glob)` magic: surface globs are minimatch patterns (predicate side);
    // plain git pathspecs use wildmatch where `*` crosses `/` and `**`
    // degrades. The glob magic makes git honor the same double-star semantics,
    // keeping "one pattern language everywhere" true (the excludes already
    // rely on it — see GRAPH_IRRELEVANT_EXCLUDES). Braces are the one
    // minimatch construct wildmatch lacks, so expand them here first —
    // otherwise `src/{a,b}/**` silently matches no history and the surface
    // bypasses enforcement as `skipped`.
    const uiCommit = await latestCommit(cwd, [
      ...globs.flatMap((g) => braceExpand(g)).map((g) => `:(glob)${g}`),
      ...GRAPH_IRRELEVANT_EXCLUDES,
    ]);
    if (uiCommit === '') {
      surfaces.push({ surface, status: 'skipped', detail: 'no commits touch this surface' });
      continue;
    }
    const baselineCommit = await latestCommit(cwd, [baselineFile]);
    if (baselineCommit === '') {
      surfaces.push({
        surface,
        status: 'uninitialized',
        uiCommit,
        detail: `${baselineFile} does not exist in history — bootstrap: ${REMEDIATION}`,
      });
      continue;
    }
    const forward = await isAncestor(cwd, uiCommit, baselineCommit);
    const backward = await isAncestor(cwd, baselineCommit, uiCommit);
    if (!forward.ok || !backward.ok) {
      surfaces.push({
        surface,
        status: 'skipped',
        uiCommit,
        baselineCommit,
        detail: `git merge-base failed probing ${uiCommit.slice(0, 8)} / ${baselineCommit.slice(0, 8)} — indeterminate, never a false red`,
      });
      continue;
    }
    const status = classifyAncestry(forward.isAncestor, backward.isAncestor);
    surfaces.push({
      surface,
      status,
      uiCommit,
      baselineCommit,
      detail:
        status === 'fresh'
          ? `baseline at/after UI (${baselineCommit.slice(0, 8)})`
          : status === 'stale'
            ? `UI ${uiCommit.slice(0, 8)} newer than baseline ${baselineCommit.slice(0, 8)} — ${REMEDIATION}`
            : `commits ${uiCommit.slice(0, 8)} / ${baselineCommit.slice(0, 8)} share no ancestry — indeterminate`,
    });
  }

  const overall = surfaces.reduce<UiFreshnessVerdict['overall']>(
    (worst, s) => (RANK[s.status] > RANK[worst] ? s.status : worst),
    'skipped',
  );
  return { overall: surfaces.length === 0 ? 'skipped' : overall, surfaces };
}
