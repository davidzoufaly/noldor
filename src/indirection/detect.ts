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
import { realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

import { allExtensions, cruise } from 'dependency-cruiser';

import { CODE_FILE_RE, TEST_FILE_RE, walkCodeFiles } from '../core/repo-paths.js';
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
 */
function isInScopeSpecifier(spec: string | undefined): boolean {
  if (spec === undefined) return false;
  return spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('#');
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

  // Does any MEASURABLE source file exist? Counting tests here would call a
  // test-only tree non-empty and then report it unmeasurable, since the cruise
  // below excludes them — a legitimately excluded corpus is empty, not broken.
  const candidateAbs = opts.roots
    .flatMap((r) => walkCodeFiles(resolve(base, r), { includeTests: false }))
    .filter((f) => !f.endsWith('.d.ts'));
  if (candidateAbs.length === 0) return { kind: 'empty', threshold };

  // The measured set is the INTERSECTION of what cruise reported and what the
  // walker admits. Without it, a file under a `WALK_EXCLUDED_DIRS` directory
  // that some measured module imports would enter the metric even though the
  // walker never offered it as a candidate — two different corpus rules.
  const candidates = new Set(
    candidateAbs.map((f) => relative(base, realpathSync(f)).split(sep).join('/')),
  );

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

  let raw: readonly CruiseModule[];
  try {
    const result = await cruise([...opts.roots], {
      baseDir: base,
      validate: false,
      doNotFollow: { path: 'node_modules' },
      exclude: { path: `node_modules|__tests__|${TEST_FILE_RE.source}` },
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
  if (measured.length < candidateAbs.length) {
    // Partial output is not a measurement. A candidate the walker offered but
    // cruise did not report back means the graph is missing edges we cannot
    // see, which would understate every closure that should have crossed it.
    return {
      kind: 'unmeasurable',
      message:
        `${candidateAbs.length} source file(s) on disk but dependency-cruiser reported ` +
        `${measured.length} — the graph is incomplete and cannot be measured`,
    };
  }

  const byId = new Map(measured.map((m) => [m.source, m]));

  const unresolvedInScope: string[] = [];
  for (const m of measured) {
    for (const d of m.dependencies) {
      if (d.couldNotResolve === true && isInScopeSpecifier(d.module)) {
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
