// @tests: pendev-ui-design-phase
// Per-surface UI-design baseline freshness (spec U7). Same posture as
// graph-freshness.ts — reported, never thrown — but ancestry-based
// (merge-base), never committer timestamps, and evaluated per configured
// surface so one surface's sync cannot mask another's drift.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { braceExpand } from 'minimatch';

import { isUiBearing, type UiConfig } from '../core/ui-predicate.js';
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

/**
 * Latest commit touching `paths`. `ok: false` is an operational git failure —
 * distinct from `sha: ''` (history has no matching commit) — because conflating
 * them would mint `uninitialized`/red from a broken repo, and every git failure
 * must degrade to `skipped`.
 */
async function latestCommit(cwd: string, paths: string[]): Promise<{ ok: boolean; sha: string }> {
  const r = await git(cwd, ['log', '-1', '--format=%H', '--', ...paths]);
  return { ok: r.ok, sha: r.stdout };
}

/**
 * Does `path` exist in the HEAD commit? `git cat-file -e HEAD:<path>` exits 0
 * when present; a missing path exits non-zero WITH a recognizable "does not
 * exist" / "Not a valid object name" message, while other non-zero exits are
 * operational failures — kept distinct so the caller degrades to `skipped`
 * instead of minting a blocking `uninitialized` from a broken repo (exit code
 * 128 alone is ambiguous between the two, so the stderr text decides).
 */
async function existsAtHead(
  cwd: string,
  path: string,
): Promise<{ ok: true; exists: boolean } | { ok: false }> {
  try {
    await execFileAsync('git', ['cat-file', '-e', `HEAD:${path}`], { cwd });
    return { ok: true, exists: true };
  } catch (err) {
    const stderr = String((err as { stderr?: string }).stderr ?? '');
    if (/does not exist|exists on disk, but not in|Not a valid object name/i.test(stderr)) {
      return { ok: true, exists: false };
    }
    return { ok: false };
  }
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
    const ui = await latestCommit(cwd, [
      ...globs.flatMap((g) => braceExpand(g)).map((g) => `:(glob)${g}`),
      ...GRAPH_IRRELEVANT_EXCLUDES,
    ]);
    if (!ui.ok) {
      surfaces.push({ surface, status: 'skipped', detail: 'git log failed — indeterminate' });
      continue;
    }
    const uiCommit = ui.sha;
    if (uiCommit === '') {
      surfaces.push({ surface, status: 'skipped', detail: 'no commits touch this surface' });
      continue;
    }
    // Existence AT HEAD decides `uninitialized`, not history and not the
    // working tree: `git log` still returns the commit that DELETED the
    // baseline (a delete postdating the UI commit would classify as fresh with
    // no baseline), and a working-tree check flips on uncommitted deletions or
    // untracked recreations — U7 reads committed state only.
    const atHead = await existsAtHead(cwd, baselineFile);
    if (!atHead.ok) {
      surfaces.push({ surface, status: 'skipped', detail: 'git cat-file failed — indeterminate' });
      continue;
    }
    if (!atHead.exists) {
      surfaces.push({
        surface,
        status: 'uninitialized',
        uiCommit,
        detail: `${baselineFile} is not in HEAD — bootstrap and commit: ${REMEDIATION}`,
      });
      continue;
    }
    const baseline = await latestCommit(cwd, [baselineFile]);
    if (!baseline.ok || baseline.sha === '') {
      // Present at HEAD but log yields nothing — an inconsistent read, never a
      // verdict to enforce on.
      surfaces.push({ surface, status: 'skipped', detail: 'git log failed — indeterminate' });
      continue;
    }
    const baselineCommit = baseline.sha;
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

  // Declared-surface maps can under-cover uiPaths (the schema cannot prove glob
  // coverage), so UI commits outside every surface would otherwise be checked
  // by nobody. Probe the union commit and match its CHANGED PATHS in-process
  // with minimatch — the same engine the predicate uses — never ancestry, which
  // an unrelated later baseline commit would falsely satisfy: any changed path
  // that matches uiPaths but no declared surface is an unmapped UI change.
  if (config.uiSurfaces !== undefined) {
    const all = await git(cwd, [
      'log',
      '-1',
      '--format=%H',
      '--name-only',
      '--',
      ...uiPaths.flatMap((g) => braceExpand(g)).map((g) => `:(glob)${g}`),
      ...GRAPH_IRRELEVANT_EXCLUDES,
    ]);
    if (all.ok && all.stdout !== '') {
      const lines = all.stdout.split('\n');
      const sha = lines[0].trim();
      const files = lines.slice(1).filter((l) => l.trim().length > 0);
      const surfaceGlobs = Object.values(config.uiSurfaces).flat();
      const unmapped = files.filter(
        (f) => isUiBearing([f], uiPaths) && !isUiBearing([f], surfaceGlobs),
      );
      if (unmapped.length > 0) {
        surfaces.push({
          surface: '(unmapped)',
          status: 'stale',
          uiCommit: sha,
          detail: `UI commit ${sha.slice(0, 8)} touches uiPaths outside every declared surface (${unmapped[0]}${unmapped.length > 1 ? ` +${unmapped.length - 1}` : ''}) — extend uiSurfaces, then ${REMEDIATION}`,
        });
      }
    }
  }

  const overall = surfaces.reduce<UiFreshnessVerdict['overall']>(
    (worst, s) => (RANK[s.status] > RANK[worst] ? s.status : worst),
    'skipped',
  );
  return { overall: surfaces.length === 0 ? 'skipped' : overall, surfaces };
}
