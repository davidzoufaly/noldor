import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { loadConsumerConfig } from '../core/consumer-config.js';

import type { Invariant, InvariantResult, InvariantViolation } from './types.js';

/**
 * Root-level tsconfig files, in resolution order. The first one that parses is
 * the strictness anchor: a monorepo declares shared compiler options in
 * `tsconfig.base.json` and every package config extends it, so asserting the
 * base covers the packages without walking the whole `extends` graph.
 */
const TSCONFIG_CANDIDATES = ['tsconfig.base.json', 'tsconfig.json'] as const;

const OXLINTRC = '.oxlintrc.json';
const PACKAGE_JSON = 'package.json';

/**
 * Directories never descended when collecting workspace manifests. `dist` and
 * `.worktrees` would each yield a second copy of manifests already counted.
 */
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.worktrees', '.turbo', 'coverage']);

/**
 * How deep to look for workspace `package.json` files below the repo root.
 * Depth 3 reaches `apps/<app>/package.json` and `packages/<pkg>/package.json`,
 * which is every layout in use; going deeper only buys node_modules-shaped
 * trees this walk already skips.
 */
const WORKSPACE_SCAN_DEPTH = 3;

/**
 * The `lib` entry that makes `using` / `await using` (Explicit Resource
 * Management, TS 5.2+) type-check. Compared case-insensitively — TypeScript
 * accepts `ESNext.Disposable` and `esnext.disposable` alike.
 */
const DISPOSABLE_LIB = 'esnext.disposable';

/**
 * oxlint rules that are the React Compiler's precondition, each with why it must
 * be named rather than left to a category. Verified against oxlint 1.67 by
 * running one category at a time over a component calling `useState` inside an
 * `if`: `exhaustive-deps` fired under `correctness`, `rules-of-hooks` only under
 * `pedantic` — which is off in every config here.
 */
const REACT_HOOK_RULES = [
  {
    rule: 'react/rules-of-hooks',
    why: 'it sits in the `pedantic` category only, so a config running correctness/suspicious/perf does not run it at all — enabling the react plugin is not enough',
  },
  {
    rule: 'react/exhaustive-deps',
    why: '`correctness` covers it today, but a category can be reshuffled upstream; naming it pins the machine half in the config instead of leaving it implied (same reason `eslint/no-async-promise-executor` is listed explicitly)',
  },
] as const;

/** Severity levels oxlint treats as "this blocks the lint run". */
const DENYING_LEVELS = new Set(['error', 'deny']);

/** One unmet floor requirement. `id` is the waiver key. */
export interface FloorViolation {
  readonly id: string;
  readonly file: string;
  readonly message: string;
  readonly severity: 'error' | 'warn';
}

/** The subset of a tsconfig this invariant reads. Unknown keys are ignored. */
interface TsConfigShape {
  readonly compilerOptions?: {
    readonly noUncheckedIndexedAccess?: unknown;
    readonly exactOptionalPropertyTypes?: unknown;
    readonly lib?: unknown;
  };
}

/** The subset of an `.oxlintrc.json` this invariant reads. */
interface OxlintrcShape {
  readonly plugins?: unknown;
  readonly rules?: Readonly<Record<string, unknown>>;
}

/** The subset of a `package.json` this invariant reads. */
interface PackageJsonShape {
  readonly dependencies?: Readonly<Record<string, unknown>>;
  readonly devDependencies?: Readonly<Record<string, unknown>>;
  readonly peerDependencies?: Readonly<Record<string, unknown>>;
}

/** A parsed config file, or the reason it could not be read. */
type ReadResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

/**
 * Read and JSON-parse a repo file.
 *
 * @remarks
 * Deliberately `JSON.parse`, not a JSONC parser: adding a dependency to read
 * two config files would contradict the very rule this invariant enforces
 * (`platform-over-dependency`). A config with comments therefore reads as
 * unparseable, which the caller surfaces as a `warn` — "this floor went
 * unchecked" — never as a silent pass.
 */
async function readJson<T>(root: string, rel: string): Promise<ReadResult<T>> {
  try {
    return { ok: true, value: JSON.parse(await readFile(join(root, rel), 'utf8')) as T };
  } catch {
    return { ok: false };
  }
}

/** Every dependency name declared in a `package.json`, across all three ranges. */
function declaredDependencies(pkg: PackageJsonShape): Set<string> {
  return new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);
}

/**
 * Repo-relative paths of every `package.json` at or below the root, to
 * {@link WORKSPACE_SCAN_DEPTH}.
 *
 * @remarks
 * A workspace monorepo declares `react` in `apps/<app>/package.json`, not at
 * the root — reading only the root manifest reports "no React here" for exactly
 * the repos whose React floor matters most. Walking the tree covers pnpm, npm
 * and yarn workspaces identically without parsing three different workspace
 * config formats, and without a glob dependency.
 */
export async function findPackageManifests(root: string): Promise<string[]> {
  const found: string[] = [];
  const queue: string[] = [root];

  while (queue.length > 0) {
    const dir = queue.pop() as string;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable dir — nothing to collect here
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name)) continue;
        const child = join(dir, entry.name);
        // Depth is measured in path segments below the root.
        if (relative(root, child).split(sep).length < WORKSPACE_SCAN_DEPTH) queue.push(child);
        continue;
      }
      if (entry.name === PACKAGE_JSON) found.push(relative(root, join(dir, entry.name)));
    }
  }

  return found.toSorted();
}

/**
 * Union of the dependencies declared across every manifest in the repo.
 *
 * @returns The dependency names, and whether any manifest was readable at all —
 *   a repo whose manifests all failed to parse must not read as "no react".
 */
async function workspaceDependencies(
  root: string,
): Promise<{ readonly names: Set<string>; readonly readAny: boolean }> {
  const names = new Set<string>();
  let readAny = false;
  for (const rel of await findPackageManifests(root)) {
    const read = await readJson<PackageJsonShape>(root, rel);
    if (!read.ok) continue;
    readAny = true;
    for (const name of declaredDependencies(read.value)) names.add(name);
  }
  return { names, readAny };
}

/** Whether an oxlint rule setting denies (blocks) rather than warns or allows. */
export function isDenied(setting: unknown): boolean {
  if (typeof setting === 'string') return DENYING_LEVELS.has(setting);
  // Array form is `[level, options]` — the level is the first element.
  if (Array.isArray(setting))
    return typeof setting[0] === 'string' && DENYING_LEVELS.has(setting[0]);
  return false;
}

/**
 * The tsconfig half of the floor.
 *
 * `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are `warn`, not
 * `error`, on purpose: both are real migrations on an existing tree (221 and 47
 * errors respectively when first probed against this repo), and the tsconfig is
 * consumer-owned. Blocking a commit on a multi-day migration would train people
 * to bypass the hook. `esnext.disposable` is `error` because it costs nothing —
 * it only widens the type surface, unlocking `using` for the
 * `deterministic-cleanup` rule.
 *
 * Covers the strictness flags only. `lib` is checked separately by
 * {@link disposableLibChecks}, because a monorepo splits the two across files:
 * shared strictness in `tsconfig.base.json`, `lib` in the config that names a
 * target environment. Asserting both against one anchor would silently skip
 * whichever half lives in the other file.
 *
 * @param path - Repo-relative path of the tsconfig that was read (for reporting).
 * @param cfg - Its parsed contents.
 */
export function tsconfigFloorChecks(path: string, cfg: TsConfigShape): FloorViolation[] {
  const out: FloorViolation[] = [];
  const opts = cfg.compilerOptions ?? {};

  if (opts.noUncheckedIndexedAccess !== true) {
    out.push({
      id: 'no-unchecked-indexed-access',
      file: path,
      severity: 'warn',
      message: `${path}: compilerOptions.noUncheckedIndexedAccess is not true. \`strict\` does not imply it, and it is the single highest-yield flag left — it makes \`arr[i]\` and \`record[key]\` \`T | undefined\`, which is the real shape of an index read. Turning it on is a migration; schedule it or record a waiver in .noldor/config.json consumer.toolchainFloor.waivers.`,
    });
  }

  if (opts.exactOptionalPropertyTypes !== true) {
    out.push({
      id: 'exact-optional-property-types',
      file: path,
      severity: 'warn',
      message: `${path}: compilerOptions.exactOptionalPropertyTypes is not true, so \`{ a?: string }\` still accepts an explicit \`a: undefined\` — "absent" and "present but undefined" stay indistinguishable. Migration; schedule it or record a waiver.`,
    });
  }

  return out;
}

/**
 * The `lib` half of the tsconfig floor, checked per file.
 *
 * A `lib` array absent from a config means "inherit" — from `extends`, or from
 * `target`'s default, neither of which carries the disposable types. So this
 * only asserts on a config that *declares* a `lib`, i.e. one that has taken
 * ownership of its type surface; a config without one is not the place the
 * entry belongs.
 *
 * @param path - Repo-relative path of the tsconfig that was read (for reporting).
 * @param cfg - Its parsed contents.
 */
export function disposableLibChecks(path: string, cfg: TsConfigShape): FloorViolation[] {
  const lib = cfg.compilerOptions?.lib;
  if (!Array.isArray(lib)) return [];
  const hasDisposable = lib.some(
    (entry) => typeof entry === 'string' && entry.toLowerCase() === DISPOSABLE_LIB,
  );
  if (hasDisposable) return [];
  return [
    {
      id: 'disposable-lib',
      file: path,
      severity: 'error',
      message: `${path}: compilerOptions.lib omits "ESNext.Disposable", so \`using\` / \`await using\` do not type-check and the deterministic-cleanup rule is unenforceable. Adding it widens the type surface only — it cannot break existing code.`,
    },
  ];
}

/**
 * The React half of the floor. Only meaningful once `react` is a dependency.
 *
 * @remarks
 * `react/rules-of-hooks` lives in the `pedantic` category only, so a config
 * running `correctness`/`suspicious`/`perf` with the `react` plugin enabled does
 * not run it — verified per category against a component calling `useState`
 * inside an `if`. Since compliance with the Rules of React is the React
 * Compiler's precondition — it skips components it cannot prove pure, and the
 * lint feedback is what turns that convention into an enforceable rule — a
 * silently-absent rules-of-hooks means the compiler quietly stops optimizing.
 * `react/exhaustive-deps` is category-covered today and is named anyway, so the
 * contract is pinned in the config rather than implied. Both are `error`: naming
 * a rule costs nothing, and a false positive is one `overrides` block away
 * (Playwright's `await use(page)` fixture reads as a conditional `use()` hook).
 *
 * @param cfg - Parsed `.oxlintrc.json`.
 */
export function reactFloorChecks(cfg: OxlintrcShape): FloorViolation[] {
  const out: FloorViolation[] = [];
  const plugins = Array.isArray(cfg.plugins) ? cfg.plugins : [];

  if (!plugins.includes('react')) {
    out.push({
      id: 'react-plugin',
      file: OXLINTRC,
      severity: 'error',
      message: `${OXLINTRC}: react is a dependency but the "react" oxlint plugin is not enabled, so no React rule runs at all.`,
    });
    return out;
  }

  const rules = cfg.rules ?? {};
  for (const { rule, why } of REACT_HOOK_RULES) {
    if (!isDenied(rules[rule])) {
      out.push({
        id: 'react-hooks-rules',
        file: OXLINTRC,
        severity: 'error',
        message: `${OXLINTRC}: "${rule}" is not set to error — ${why}. Rules-of-hooks compliance is what lets the React Compiler memoize a component instead of silently skipping it.`,
      });
    }
  }

  return out;
}

/**
 * Resolve the whole floor for a repo root, before waivers are applied.
 *
 * @param root - Absolute repo root.
 * @returns Every unmet requirement, plus a `warn` for each config that could
 *   not be parsed (an unchecked floor is reported, never assumed green).
 */
export async function collectFloorViolations(root: string): Promise<FloorViolation[]> {
  const out: FloorViolation[] = [];

  // Read every root candidate: the FIRST that parses is the strictness anchor,
  // while the `lib` requirement is asserted against each one that declares a
  // `lib` — see disposableLibChecks for why the two cannot share an anchor.
  let anchored = false;
  for (const candidate of TSCONFIG_CANDIDATES) {
    const read = await readJson<TsConfigShape>(root, candidate);
    if (!read.ok) continue;
    if (!anchored) {
      out.push(...tsconfigFloorChecks(candidate, read.value));
      anchored = true;
    }
    out.push(...disposableLibChecks(candidate, read.value));
  }
  if (!anchored) {
    out.push({
      id: 'tsconfig-unreadable',
      file: TSCONFIG_CANDIDATES[1],
      severity: 'warn',
      message: `no root tsconfig parsed as JSON (${TSCONFIG_CANDIDATES.join(' / ')}) — the TypeScript floor went unchecked. Comments in a tsconfig are the usual cause.`,
    });
  }

  const deps = await workspaceDependencies(root);
  if (deps.readAny && deps.names.has('react')) {
    const oxlintrc = await readJson<OxlintrcShape>(root, OXLINTRC);
    if (oxlintrc.ok) {
      out.push(...reactFloorChecks(oxlintrc.value));
    } else {
      out.push({
        id: 'oxlintrc-unreadable',
        file: OXLINTRC,
        severity: 'warn',
        message: `react is a dependency but ${OXLINTRC} did not parse as JSON — the React lint floor went unchecked.`,
      });
    }
  }

  return out;
}

/**
 * Read the waived floor ids from `.noldor/config.json`.
 *
 * Tolerant by design, mirroring `loadScopeAliases`: a repo with no consumer
 * config waives nothing rather than throwing, so the floor still reports.
 */
function loadWaivers(root: string): ReadonlyArray<{ id: string; reason: string }> {
  try {
    return loadConsumerConfig(root).toolchainFloor?.waivers ?? [];
  } catch {
    return [];
  }
}

/**
 * Build the toolchain-floor invariant plugin.
 *
 * Asserts the executable half of the engineering principles that lives in
 * config rather than in code — the flags and lint rules a prose rule cannot
 * enforce on its own. Runs from `checks invariants`, so it is live in this repo
 * and in every consumer that installs the framework, reading each repo's own
 * config rather than a template copy (a consumer owns `.oxlintrc.json` and its
 * tsconfig; template-sync deliberately never touches them).
 *
 * A waived id is skipped and re-reported as a `warn` carrying its reason, so a
 * declined floor item stays visible instead of disappearing.
 *
 * @param repoRoot - Absolute path to the repo root whose config is checked.
 * @returns Invariant plugin instance.
 *
 * @example
 * ```typescript
 * const result = await makeToolchainFloorInvariant(process.cwd()).run();
 * ```
 */
export function makeToolchainFloorInvariant(repoRoot: string): Invariant {
  return {
    description: 'tsconfig + oxlint config meet the engineering-principles floor',
    name: 'toolchain-floor',
    async run(): Promise<InvariantResult> {
      const start = Date.now();
      const waivers = loadWaivers(repoRoot);
      const waived = new Map(waivers.map((w) => [w.id, w.reason]));
      const violations: InvariantViolation[] = [];

      for (const v of await collectFloorViolations(repoRoot)) {
        const reason = waived.get(v.id);
        violations.push(
          reason === undefined
            ? { file: v.file, message: v.message, severity: v.severity }
            : {
                file: v.file,
                message: `[waived: ${v.id}] ${reason}`,
                severity: 'warn',
              },
        );
      }

      return { invariant: 'toolchain-floor', violations, durationMs: Date.now() - start };
    },
  };
}

/** Default plugin instance bound to `process.cwd()`. Used by the registry. */
export const toolchainFloor: Invariant = makeToolchainFloorInvariant(process.cwd());
