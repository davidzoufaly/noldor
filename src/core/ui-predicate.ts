// @tests: pendev-ui-design-phase
// UI-design-stage predicate: which sessions are UI-bearing, and which baseline
// surfaces they affect. Pure — callers inject the candidate paths, the config
// slice and (for expansion) the repo file list. Matching reuses the repo's one
// minimatch idiom (`{ dot: true }`, see src/core/allowlist.ts) so uiPaths
// globs behave exactly like every other glob the framework consumes.

import { minimatch } from 'minimatch';

/** Verdict + everything downstream quantifies over (spec U2). */
export interface UiVerdict {
  verdict: 'required' | 'skip';
  /** Sorted names of surfaces whose globs matched ≥1 candidate path. */
  affectedSurfaces: string[];
  /** Candidate paths that matched `uiPaths` but no declared surface — config gaps. */
  unmappedPaths: string[];
}

/** The FD frontmatter slice the predicate reads. `design` is operator-only. */
export interface UiFrontmatter {
  design?: 'required' | 'skip';
}

/** The consumer-config slice the predicate reads. */
export interface UiConfig {
  uiPaths?: string[];
  uiSurfaces?: Record<string, string[]>;
}

const GLOB_META_RE = /[*?[{]/;
/** The single surface a `uiPaths`-only consumer has when `uiSurfaces` is absent. */
export const IMPLICIT_SURFACE = 'app';

const matches = (path: string, glob: string): boolean => minimatch(path, glob, { dot: true });

/** True when any concrete path matches any glob. Empty inputs prove nothing → false. */
export function isUiBearing(paths: string[], uiPaths: string[]): boolean {
  if (paths.length === 0 || uiPaths.length === 0) return false;
  return paths.some((p) => uiPaths.some((g) => matches(p, g)));
}

/**
 * Expand one `Touches:` / `links.code` value into concrete repo paths. One
 * pattern language everywhere: glob values are minimatch patterns evaluated
 * against the caller-provided file list (`git ls-files` output), never git
 * pathspecs. An existing directory reads as `<dir>/**`. Concrete paths pass
 * through untouched (they need not exist — ship-time diffs are authoritative).
 */
export function expandCandidateValue(
  value: string,
  repoFiles: readonly string[],
  isDirectory: (path: string) => boolean,
): string[] {
  const pattern = GLOB_META_RE.test(value)
    ? value
    : isDirectory(value)
      ? `${value.replace(/\/$/, '')}/**`
      : null;
  if (pattern === null) return [value];
  return repoFiles.filter((f) => matches(f, pattern));
}

/**
 * The U2 truth table. FD `design:` override first (absolute in both
 * directions), then glob intersection; surface resolution rides the verdict so
 * callers never re-derive it. A `required` verdict may carry zero affected
 * surfaces (override without config, or config gaps) — the design step, not
 * this function, enforces the zero-affected-surfaces rule.
 */
export function sessionUiVerdict(
  fd: UiFrontmatter,
  candidatePaths: readonly string[],
  config: UiConfig,
): UiVerdict {
  const uiPaths = config.uiPaths ?? [];
  const matching = candidatePaths.filter((p) => uiPaths.some((g) => matches(p, g)));

  const resolveSurfaces = (
    paths: string[],
  ): Pick<UiVerdict, 'affectedSurfaces' | 'unmappedPaths'> => {
    if (config.uiSurfaces === undefined) {
      return {
        affectedSurfaces: paths.length > 0 ? [IMPLICIT_SURFACE] : [],
        unmappedPaths: [],
      };
    }
    const affected = new Set<string>();
    const unmapped: string[] = [];
    for (const p of paths) {
      const owners = Object.entries(config.uiSurfaces).filter(([, globs]) =>
        globs.some((g) => matches(p, g)),
      );
      if (owners.length === 0) unmapped.push(p);
      for (const [name] of owners) affected.add(name);
    }
    return { affectedSurfaces: [...affected].sort(), unmappedPaths: unmapped };
  };

  if (fd.design === 'skip') return { verdict: 'skip', affectedSurfaces: [], unmappedPaths: [] };
  if (fd.design === 'required') return { verdict: 'required', ...resolveSurfaces(matching) };
  if (uiPaths.length === 0 || matching.length === 0) {
    return { verdict: 'skip', affectedSurfaces: [], unmappedPaths: [] };
  }
  return { verdict: 'required', ...resolveSurfaces(matching) };
}
