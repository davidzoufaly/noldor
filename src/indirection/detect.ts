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
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

import { allExtensions, cruise } from 'dependency-cruiser';

import {
  CODE_FILE_RE,
  TEST_FILE_RE,
  WALK_EXCLUDED_DIRS,
  toPosixRelative,
  walkCodeFiles,
} from '../core/repo-paths.js';
import { findUnparseableTsExtensions } from '../invariants/boundaries.js';
import { stripJsonc } from '../invariants/toolchain-floor.js';

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
 * further. Most aliased imports never reach here any more — `declaredAliases`
 * hands cruise an `enhancedResolveOptions.alias` map built from the same
 * tsconfig `paths`, and enhanced-resolve follows it. What still reaches here is
 * an alias with no usable target: a prefix two tsconfigs claim for different
 * directories, a malformed `paths` value, or a target directory that does not
 * exist. Dropping such an edge would understate the ratchet, so a specifier
 * matching a declared prefix is reported and the run refuses.
 *
 * The alias map is what makes that rare. dependency-cruiser's own tsconfig
 * route reads `paths` through the `typescript` package it accepts only at
 * `>=2 <6`, while this repo is on 7 (the same constraint behind the parser
 * guard) — so on TS 7 an aliased import came back `couldNotResolve` whether or
 * not `tsConfig` was passed, verified against `dependency-cruiser@16.10.4`.
 * enhanced-resolve is a direct dependency of the cruiser and consults no
 * `typescript` install, so it is unaffected by that ceiling.
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
 * Depth-bounded directory walk over the scan roots, invoking `visit` with each
 * directory's entries. One walker rather than two near-identical ones: the
 * tsconfig and package-root scans differ only in what they harvest, and the
 * clone gate flagged the copy. Kept local to this module because the sharing is
 * intra-file — free on the indirection axis, which is the whole distinction the
 * abstraction-cost rule draws.
 *
 * Depth is capped because this runs on every pre-push and only the configs a
 * package root would carry matter, not every one in the tree.
 */
const WALK_MAX_DEPTH = 3;

function walkRoots(
  base: string,
  roots: readonly string[],
  visit: (dir: string, entries: readonly Dirent[]) => void,
): void {
  const walk = (dir: string, depth: number): void => {
    if (depth > WALK_MAX_DEPTH) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    visit(dir, entries);
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.') || WALK_EXCLUDED_DIRS.has(e.name)) continue;
      walk(join(dir, e.name), depth + 1);
    }
  };
  for (const r of roots) walk(resolve(base, r), 0);
}

/**
 * Every `tsconfig*.json` under the scan roots, plus any at the repo base.
 *
 * A monorepo declares `paths` per package (`packages/<pkg>/tsconfig.json`), so
 * reading only the base drops those alias edges silently. Every matching
 * filename is returned, not two hard-coded names: a package whose aliases live
 * in `tsconfig.app.json` would otherwise be discovered as "holds a tsconfig"
 * and yield no prefixes, which is a silent drop dressed as coverage.
 */
function findTsconfigFiles(base: string, roots: readonly string[]): string[] {
  const out = new Set<string>();
  const harvest = (dir: string, entries: readonly Dirent[]): void => {
    for (const e of entries) {
      if (e.isFile() && e.name.startsWith('tsconfig') && e.name.endsWith('.json')) {
        out.add(join(dir, e.name));
      }
    }
  };
  // The base itself, without descending — its own tsconfig still counts.
  walkRoots(base, ['.'], (dir, entries) => {
    if (dir === base) harvest(dir, entries);
  });
  walkRoots(base, roots, harvest);
  return [...out];
}

/**
 * The alias namespaces declared by any tsconfig under the scan roots, and the
 * absolute directories each one points at.
 *
 * Parsed, not pattern-matched. An earlier version scanned the `paths` block with
 * a lazy regex and was formatting-dependent in both directions: a single-line
 * `paths` block let the match run past it and harvest sibling option keys — so
 * `strict` became an alias prefix and an ordinary bare import was reported — and
 * a whole tsconfig on one line matched nothing, dropping real aliases in
 * silence. Two semantically identical tsconfigs gave opposite verdicts, and the
 * baseline principles say to avoid regex for exactly this reason. `stripJsonc`
 * is the repo's existing comment- and trailing-comma-tolerant reader, so the
 * commented tsconfig that `tsc --init` emits parses here too.
 *
 * `targets` follows TypeScript's own rule: a `paths` entry resolves against
 * `baseUrl` when one is declared, and against the tsconfig's own directory when
 * one is not (the TS 4.1+ default). Getting that backwards would point the
 * alias at a directory that does not exist and reintroduce the unresolved edge
 * this map exists to remove.
 *
 * A prefix declared by two tsconfigs with DIFFERENT targets is dropped from
 * `targets` and kept in `prefixes`, so it stays reported rather than guessed at.
 * `enhancedResolveOptions.alias` is one global map with no notion of which
 * package a specifier came from, and its array form resolves first-hit-wins —
 * so a monorepo where two packages each declare `@/*` for their own `src` would
 * silently attribute one package's import to the other package's file. A wrong
 * edge is worse than a missing one: the ratchet would move for a reason no
 * reader could reconstruct. Reporting it keeps that repo exactly where it is
 * today, which is honest, and the message names the prefix.
 */
interface DeclaredAliases {
  /** Every declared namespace, whether or not it could be given a target. */
  readonly prefixes: readonly string[];
  /** `enhancedResolveOptions.alias`: prefix -> absolute directories, in order. */
  readonly targets: Readonly<Record<string, readonly string[]>>;
  /** Prefixes two tsconfigs claim for different directories; left unresolved. */
  readonly conflicts: readonly string[];
}

type CruiseResolveOptions = NonNullable<
  NonNullable<Parameters<typeof cruise>[1]>['enhancedResolveOptions']
>;

/**
 * The alias map as cruise's `enhancedResolveOptions`.
 *
 * `alias` is missing from dependency-cruiser's published `IResolveOptions`
 * type, but it is forwarded verbatim rather than dropped: its
 * `main/resolve-options/normalize.mjs` spreads the caller's resolve options
 * into what it hands enhanced-resolve, and the cruiser then classifies the
 * resulting edge as `aliased-webpack`. So the cast asserts a runtime contract
 * the types under-describe, not one they contradict — verified against
 * `dependency-cruiser@16.10.4`.
 *
 * The alias fixture tests are what keep that assertion honest: a release that
 * stopped forwarding `alias` turns those red with unresolved edges, rather than
 * silently under-measuring the ratchet.
 */
function aliasResolveOptions(alias: DeclaredAliases['targets']): CruiseResolveOptions {
  return { alias } as unknown as CruiseResolveOptions;
}

function declaredAliases(base: string, roots: readonly string[]): DeclaredAliases {
  const prefixes = new Set<string>();
  const targets = new Map<string, string[]>();
  const conflicts = new Set<string>();
  for (const file of findTsconfigFiles(base, roots)) {
    let raw: string;
    try {
      raw = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const scan = stripJsonc(raw);
    if (!scan.ok) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(scan.text);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    const compilerOptions = (parsed as { compilerOptions?: unknown }).compilerOptions;
    if (typeof compilerOptions !== 'object' || compilerOptions === null) continue;
    const paths = (compilerOptions as { paths?: unknown }).paths;
    if (typeof paths !== 'object' || paths === null) continue;
    const baseUrl = (compilerOptions as { baseUrl?: unknown }).baseUrl;
    const from = resolve(dirname(file), typeof baseUrl === 'string' ? baseUrl : '.');
    for (const [key, value] of Object.entries(paths as Record<string, unknown>)) {
      if (key.startsWith('.')) continue;
      const prefix = key.endsWith('/*') ? key.slice(0, -2) : key;
      prefixes.add(prefix);
      // A malformed entry contributes a prefix but no target: the specifier
      // stays reported, which is the same fail-safe as a conflict.
      if (!Array.isArray(value)) continue;
      const dirs = value
        .filter((v): v is string => typeof v === 'string')
        .map((v) => resolve(from, v.endsWith('/*') ? v.slice(0, -2) : v));
      if (dirs.length === 0) continue;
      const prior = targets.get(prefix);
      if (prior === undefined) targets.set(prefix, dirs);
      else if (prior.join('\0') !== dirs.join('\0')) conflicts.add(prefix);
    }
  }
  for (const prefix of conflicts) targets.delete(prefix);
  return {
    prefixes: [...prefixes],
    targets: Object.fromEntries(targets),
    conflicts: [...conflicts],
  };
}

/**
 * The dependency-cruiser `exclude` pattern for the directories every repo walk
 * skips, anchored to whole path segments so it cannot match a longer name.
 */
function excludedSegments(): string {
  const names = [...WALK_EXCLUDED_DIRS, '__tests__'].map((n) => n.replace(/\./g, '\\.'));
  return `(^|/)(${names.join('|')})(/|$)`;
}

/**
 * The workspace package a repo-relative path belongs to, or `undefined` for a
 * file outside any package.
 *
 * A package root is a directory holding a `package.json`, which is
 * layout-agnostic — it does not assume `packages/`. Deepest match wins, so a
 * nested package is attributed to itself rather than its parent.
 */
function packageOf(source: string, packageRoots: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const root of packageRoots) {
    if (source === root || source.startsWith(`${root}/`)) {
      if (best === undefined || root.length > best.length) best = root;
    }
  }
  return best;
}

/**
 * Directories under the scan roots that declare a `package.json`, repo-relative.
 */
function findPackageRoots(base: string, roots: readonly string[]): string[] {
  const out = new Set<string>();
  walkRoots(base, roots, (dir, entries) => {
    if (!entries.some((e) => e.isFile() && e.name === 'package.json')) return;
    const rel = toPosixRelative(base, dir);
    // The repo root itself is not a boundary — everything would be "outside".
    if (rel !== '' && !rel.startsWith('..')) out.add(rel);
  });
  return [...out];
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
  // An absolute root cannot be handed to cruise, which joins roots onto
  // `baseDir`; a parent-escaping one measures files `isInRepo` then discards, so
  // it surfaced as a misdescribed "incomplete graph". `scanPaths` is validated
  // only as a non-empty string, so both are equally reachable — refuse both with
  // the same message rather than measuring something wrong.
  const escaping = opts.roots.filter(
    (r) => isAbsolute(r) || toPosixRelative(base, resolve(base, r)).startsWith('..'),
  );
  if (escaping.length > 0) {
    return {
      kind: 'unmeasurable',
      message: `scan root(s) must be repo-relative and inside the repo, got: ${escaping.join(', ')}`,
    };
  }
  const requested = [...new Set(opts.roots)];
  const roots = requested.filter((r) => existsSync(resolve(base, r)));
  // A partial miss is legitimately skippable — `DEFAULT_SCAN_ROOTS` is a union
  // of layouts, so most of it is absent in any given repo. But when NO
  // configured root exists, "empty" would record a zero baseline and leave the
  // gate green forever: a `scanPaths: ["sourse"]` typo silently disabled it.
  if (roots.length === 0) {
    return {
      kind: 'unmeasurable',
      message:
        `none of the configured scan root(s) exist: ${requested.join(', ')} — ` +
        `check consumer.scanPaths in .noldor/config.json`,
    };
  }

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

  // Read the declared `paths` twice over: as an alias map enhanced-resolve can
  // follow, and as the namespace list that decides which leftover unresolved
  // specifier is ours to report (see `isInScopeSpecifier`).
  const aliases = declaredAliases(base, roots);

  let raw: readonly CruiseModule[];
  try {
    const result = await cruise(roots, {
      baseDir: base,
      validate: false,
      doNotFollow: { path: 'node_modules' },
      // Resolve tsconfig `paths` through enhanced-resolve, which
      // dependency-cruiser depends on directly and which needs no `typescript`
      // install at all — so it works on the TS version this repo is actually on
      // (see `isInScopeSpecifier` for why the built-in tsconfig route cannot).
      enhancedResolveOptions: aliasResolveOptions(aliases.targets),
      // Derived from `WALK_EXCLUDED_DIRS` and anchored to path segments, so the
      // two corpus rules have one source. `walkCodeFiles` excludes on an EXACT
      // directory name, so an unanchored substring made a directory merely
      // CONTAINING `__tests__` — `src/__tests__helpers/` — excluded here but
      // enumerated there, and the completeness guard tripped on a healthy repo.
      // Restating the set instead of deriving it also left cruise parsing every
      // `dist` and `coverage` tree the walker never offers.
      exclude: { path: `${excludedSegments()}|${TEST_FILE_RE.source}` },
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

  // A workspace sibling is a published boundary, not an in-repo hop: the edge
  // into it counts once, but its own closure is not inherited. Without this a
  // monorepo's ordinary cross-package import inflates every closure upstream of
  // it and reds the gate on a normal layout.
  const packageRoots = findPackageRoots(base, roots);
  const pkgOf = new Map(measured.map((m) => [m.source, packageOf(m.source, packageRoots)]));

  const unresolvedInScope: string[] = [];
  for (const m of measured) {
    for (const d of m.dependencies) {
      if (d.couldNotResolve === true && isInScopeSpecifier(d.module, aliases.prefixes)) {
        unresolvedInScope.push(`${m.source} -> ${d.module ?? d.resolved}`);
      }
    }
  }

  const closureOf = (id: string): number => {
    const home = pkgOf.get(id);
    const seen = new Set<string>();
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const d of byId.get(cur)?.dependencies ?? []) {
        if (!byId.has(d.resolved) || seen.has(d.resolved)) continue;
        seen.add(d.resolved);
        // Count the crossing, then stop: a file in another workspace package is
        // one fetch, not a doorway into that package's whole graph.
        if (pkgOf.get(d.resolved) === home) stack.push(d.resolved);
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
