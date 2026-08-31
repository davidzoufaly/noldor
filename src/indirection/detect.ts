/**
 * Whole-corpus indirection measurement. For each in-repo module, the size of
 * its transitive in-repo import closure — how many files a reader or an agent
 * must fetch to understand it. Cross-file indirection is what costs; a long
 * file of local helpers is free by construction and out of scope.
 *
 * The ratchet number is the EXCESS SUM, not a count of flagged modules: a count
 * cannot see a closure growing 31 -> 100, and can stay flat while one module
 * crosses the threshold and another drops below it.
 */
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';

import { allExtensions, cruise } from 'dependency-cruiser';

import { CODE_FILE_RE, TEST_FILE_RE, toPosixRelative, walkCodeFiles } from '../core/repo-paths.js';
import { findUnparseableTsExtensions } from '../invariants/boundaries.js';

/**
 * Closure size above which a module is flagged. The measured p90 of this repo,
 * chosen on a plateau — 38 modules flagged at 30 and 36 at 35 — so the verdict
 * does not rest on precise tuning, which matters for a constant shipped to
 * repos it was never measured against.
 */
export const INDIRECTION_CLOSURE_THRESHOLD = 30;

export interface ModuleClosure {
  readonly source: string;
  readonly closure: number;
  readonly excess: number;
}

export interface Percentiles {
  readonly p50: number;
  readonly p75: number;
  readonly p90: number;
  readonly p99: number;
  readonly max: number;
}

/**
 * A discriminated union so the type carries the invariants: an `empty` corpus
 * has no modules and no percentiles, a `measured` one always has both, and the
 * two expected failures are values rather than exceptions (`error-result-types`).
 */
export type IndirectionResult =
  | { readonly kind: 'empty'; readonly threshold: number }
  | {
      readonly kind: 'measured';
      readonly threshold: number;
      readonly excessSum: number;
      readonly modules: readonly ModuleClosure[];
      readonly flagged: readonly ModuleClosure[];
      readonly percentiles: Percentiles;
      readonly unresolvedInScope: readonly string[];
    }
  | { readonly kind: 'no-parser'; readonly extensions: readonly string[]; readonly message: string }
  | { readonly kind: 'unmeasurable'; readonly message: string; readonly cause?: unknown };

/** The success member, for callers that have already narrowed the union. */
export type MeasuredIndirection = Extract<IndirectionResult, { kind: 'measured' }>;

export interface MeasureOptions {
  /** Roots RELATIVE to `cwd`; an absolute root makes cruise join it onto baseDir. */
  readonly roots: readonly string[];
  readonly cwd: string;
  /** Overrides {@link INDIRECTION_CLOSURE_THRESHOLD}; used by tests to pin boundaries. */
  readonly threshold?: number;
  /**
   * Parser-availability report, defaulting to dependency-cruiser's own.
   * Injectable because parser availability is a process condition: once
   * `@swc/core` is a production dependency the test environment always has it,
   * so the guard is otherwise unreachable from a test.
   */
  readonly extensions?: ReadonlyArray<{ readonly extension: string; readonly available: boolean }>;
}

interface CruiseDep {
  readonly resolved: string;
  readonly couldNotResolve?: boolean;
  readonly module?: string;
}

interface CruiseModule {
  readonly source: string;
  readonly dependencies: readonly CruiseDep[];
}

/** Nearest-rank percentile over an ascending vector. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(1, Math.ceil(p * sorted.length)) - 1]!;
}

/**
 * Ours, therefore fatal when unresolved. A bare package specifier is not:
 * dependency-cruiser reports `couldNotResolve` for healthy reasons there — an
 * optional peer that is not installed, a package whose `types` entry does not
 * resolve — and treating those as failures would hard-block pre-push in
 * consumer repos that are perfectly fine.
 *
 * `aliasPrefixes` widens that by exactly the declared alias namespace and no
 * further. dependency-cruiser reads tsconfig `paths` through the `typescript`
 * package it accepts only at `>=2 <6`, while this repo is on 7 (the same
 * constraint behind the parser guard), so an aliased import comes back
 * `couldNotResolve` — verified against `dependency-cruiser@16.10.4`, with and
 * without `tsConfig` passed. Dropping that edge would understate the ratchet,
 * so a specifier matching a declared prefix is reported and the run refuses.
 *
 * Matching on the prefix rather than on "a tsconfig declares any paths" is the
 * whole point: the broader test made an uninstalled optional peer fatal in every
 * alias-using repo, which is the hazard this doc comment exists to rule out.
 */
function isInScopeSpecifier(spec: string | undefined, aliasPrefixes: readonly string[]): boolean {
  if (spec === undefined) return false;
  if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('#')) return true;
  return aliasPrefixes.some((a) => spec === a || spec.startsWith(`${a}/`));
}

/**
 * Directories under the scan roots that hold a tsconfig, to a bounded depth.
 *
 * A monorepo declares `paths` per package (`packages/<pkg>/tsconfig.json`), so
 * reading only the repo base drops those alias edges silently — the failure this
 * whole alias path exists to avoid. Depth is capped because this runs on every
 * pre-push and the answer only needs the configs a package root would carry, not
 * every one in the tree.
 */
function findTsconfigDirs(base: string, roots: readonly string[]): string[] {
  const MAX_DEPTH = 3;
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name.startsWith('tsconfig'))) out.push(dir);
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist') continue;
      walk(join(dir, e.name), depth + 1);
    }
  };
  for (const r of roots) walk(resolve(base, r), 0);
  return out;
}

/**
 * Alias namespaces declared by any tsconfig at `base` or under a scan root — a
 * monorepo commonly declares `paths` per package, and looking only at the base
 * would drop those edges silently.
 */
function declaredAliasPrefixes(base: string, roots: readonly string[]): string[] {
  const dirs = [base, ...findTsconfigDirs(base, roots)];
  const prefixes = new Set<string>();
  for (const dir of dirs) {
    for (const name of ['tsconfig.json', 'tsconfig.base.json']) {
      const p = join(dir, name);
      if (!existsSync(p)) continue;
      try {
        // Only the alias KEYS are needed, and a tsconfig routinely carries
        // comments and trailing commas that `JSON.parse` refuses — so this
        // scans the `paths` block for its keys rather than parsing the file.
        const text = readFileSync(p, 'utf8');
        const block = /"paths"\s*:\s*\{([\s\S]*?)\n\s*\}/.exec(text);
        if (block === null) continue;
        for (const m of block[1]!.matchAll(/"([^"]+)"\s*:/g)) {
          const key = m[1]!;
          if (key.startsWith('.')) continue;
          prefixes.add(key.endsWith('/*') ? key.slice(0, -2) : key);
        }
      } catch {
        // Unreadable tsconfig: no aliases learned from it. The parser guard and
        // the completeness check already cover a genuinely broken tree.
      }
    }
  }
  return [...prefixes];
}

/** cruise reports paths relative to baseDir; anything escaping it is not ours. */
function isInRepo(source: string): boolean {
  return !source.startsWith('..') && !source.startsWith(sep) && !/^[A-Za-z]:/.test(source);
}

function isMeasurable(source: string): boolean {
  return (
    isInRepo(source) &&
    CODE_FILE_RE.test(source) &&
    !source.endsWith('.d.ts') &&
    !TEST_FILE_RE.test(source) &&
    !source.split('/').includes('__tests__')
  );
}

export async function measureIndirection(opts: MeasureOptions): Promise<IndirectionResult> {
  const threshold = opts.threshold ?? INDIRECTION_CLOSURE_THRESHOLD;

  // Resolve symlinks before anything else. cruise emits paths relative to
  // `baseDir`, and when `baseDir` is a symlink (every macOS `tmpdir()` is) it
  // resolves imports through the real path and emits an escaped
  // `../../../private/var/...` twin alongside the in-tree module. The twin
  // fails the containment check below, so the in-tree module's dependency
  // misses `byId` and its closure collapses to 0 — a silent under-measure, not
  // a throw. `src/invariants/boundaries.ts` calls `realpath` for the same reason.
  const base = realpathSync(opts.cwd);

  // Absent roots are skipped, not fatal. `DEFAULT_SCAN_ROOTS` is the union of
  // layouts (`packages`, `apps`, `scripts`, `src`), and `repo-paths.ts` states
  // that roots which do not exist are "ENOENT-skipped by every walker" — but
  // `cruise` throws on one, so a consumer that never set `scanPaths` would have
  // every push hard-blocked by a missing `apps/`. Deduped as well: a repeated or
  // overlapping root would otherwise enumerate the same file twice.
  // `src/invariants/boundaries.ts` filters the same way before cruising.
  // `resolve` in both the existence test and the walk below — `join` disagrees
  // with it for an absolute root, and `scanPaths` is validated only as a
  // non-empty string, so an absolute entry used to resolve to nothing, report
  // `empty`, and let `baseline` record 0 — the gate silently disabling itself.
  // An absolute root is refused rather than guessed at: it cannot be handed to
  // cruise, which joins roots onto `baseDir`.
  const absolute = opts.roots.filter((r) => isAbsolute(r));
  if (absolute.length > 0) {
    return {
      kind: 'unmeasurable',
      message:
        `scan root(s) must be repo-relative, got absolute: ${absolute.join(', ')} — ` +
        `cruise joins roots onto baseDir, so an absolute root cannot be measured`,
    };
  }
  const roots = [...new Set(opts.roots)].filter((r) => existsSync(resolve(base, r)));
  if (roots.length === 0) return { kind: 'empty', threshold };

  // Does any MEASURABLE source file exist? Counting tests here would call a
  // test-only tree non-empty and then report it unmeasurable, since the cruise
  // below excludes them — a legitimately excluded corpus is empty, not broken.
  const candidateAbs = roots
    .flatMap((r) => walkCodeFiles(resolve(base, r), { includeTests: false }))
    .filter((f) => !f.endsWith('.d.ts'));
  if (candidateAbs.length === 0) return { kind: 'empty', threshold };

  // The measured set is the INTERSECTION of what cruise reported and what the
  // walker admits. Without it, a file under a `WALK_EXCLUDED_DIRS` directory
  // that some measured module imports would enter the metric even though the
  // walker never offered it as a candidate — two different corpus rules.
  const candidates = new Set(candidateAbs.map((f) => toPosixRelative(base, realpathSync(f))));

  const unparseable = findUnparseableTsExtensions(opts.extensions ?? allExtensions);
  if (unparseable.length > 0) {
    return {
      kind: 'no-parser',
      extensions: unparseable,
      message:
        `no TypeScript parser available for ${unparseable.join(', ')} — install @swc/core ` +
        `(dependency-cruiser accepts typescript >=2 <6, or @swc/core)`,
    };
  }

  // Aliases cannot be resolved in this toolchain (see `isInScopeSpecifier`), so
  // collect the declared namespaces and report only specifiers inside them.
  const aliasPrefixes = declaredAliasPrefixes(base, roots);

  let raw: readonly CruiseModule[];
  try {
    const result = await cruise(roots, {
      baseDir: base,
      validate: false,
      doNotFollow: { path: 'node_modules' },
      // Anchored to path segments, because `walkCodeFiles` excludes on an
      // EXACT directory name (`WALK_EXCLUDED_DIRS.has(name)`). An unanchored
      // substring made a directory merely CONTAINING `__tests__` — e.g.
      // `src/__tests__helpers/` — excluded here but enumerated there, so the
      // two corpus rules disagreed and the completeness guard tripped on a
      // healthy repo.
      exclude: { path: `(^|/)(node_modules|__tests__)(/|$)|${TEST_FILE_RE.source}` },
      tsPreCompilationDeps: true,
    });
    const out = result.output;
    raw =
      typeof out === 'object' && out !== null && 'modules' in out
        ? (out as { modules: readonly CruiseModule[] }).modules
        : [];
  } catch (e) {
    // The cruiser is an external boundary: convert its throw to a result and
    // keep the original as `cause`, per error-result-types.
    return {
      kind: 'unmeasurable',
      message: `dependency-cruiser failed: ${e instanceof Error ? e.message : String(e)}`,
      cause: e,
    };
  }

  const measured = raw.filter((m) => isMeasurable(m.source) && candidates.has(m.source));
  // Against `candidates.size`, not `candidateAbs.length`: the latter is the raw
  // enumeration, so overlapping roots double-count a file and would trip this
  // branch on a healthy repo.
  if (measured.length < candidates.size) {
    // Partial output is not a measurement. A candidate the walker offered but
    // cruise did not report back means the graph is missing edges we cannot
    // see, which would understate every closure that should have crossed it.
    return {
      kind: 'unmeasurable',
      message:
        `${candidates.size} source file(s) on disk but dependency-cruiser reported ` +
        `${measured.length} — the graph is incomplete and cannot be measured`,
    };
  }

  const byId = new Map(measured.map((m) => [m.source, m]));

  const unresolvedInScope: string[] = [];
  for (const m of measured) {
    for (const d of m.dependencies) {
      if (d.couldNotResolve === true && isInScopeSpecifier(d.module, aliasPrefixes)) {
        unresolvedInScope.push(`${m.source} -> ${d.module ?? d.resolved}`);
      }
    }
  }

  const closureOf = (id: string): number => {
    const seen = new Set<string>();
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const d of byId.get(cur)?.dependencies ?? []) {
        if (!byId.has(d.resolved) || seen.has(d.resolved)) continue;
        seen.add(d.resolved);
        stack.push(d.resolved);
      }
    }
    seen.delete(id);
    return seen.size;
  };

  const modules = measured
    .map((m) => {
      const closure = closureOf(m.source);
      return { source: m.source, closure, excess: Math.max(0, closure - threshold) };
    })
    .sort((a, b) => b.closure - a.closure || a.source.localeCompare(b.source));

  // `map` already returns a fresh array, so sorting it in place is safe and the
  // spread would be redundant (oxlint unicorn/no-useless-spread).
  const sorted = modules.map((m) => m.closure).sort((a, b) => a - b);

  return {
    kind: 'measured',
    threshold,
    excessSum: modules.reduce((n, m) => n + m.excess, 0),
    modules,
    flagged: modules.filter((m) => m.excess > 0),
    percentiles: {
      p50: percentile(sorted, 0.5),
      p75: percentile(sorted, 0.75),
      p90: percentile(sorted, 0.9),
      p99: percentile(sorted, 0.99),
      max: sorted.at(-1) ?? 0,
    },
    unresolvedInScope,
  };
}
