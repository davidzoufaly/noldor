import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { z } from 'zod';

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
const CONSUMER_CONFIG = '.noldor/config.json';

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
 * `lib` entries that pull in every later library at once. TypeScript ships
 * Explicit Resource Management only in `lib.esnext.disposable.d.ts`, which
 * `lib.esnext.d.ts` includes — no `es20xx` entry carries it — so an umbrella is
 * the only way to satisfy both halves of the lib floor with one entry.
 */
const LIB_UMBRELLAS = new Set(['esnext', 'esnext.full']);

/** The explicit `lib` entry carrying `Symbol.dispose` / `Symbol.asyncDispose`. */
const DISPOSABLE_LIB = 'esnext.disposable';

/**
 * Lowest `es<year>` library that carries the built-ins the
 * `platform-over-dependency` rule mandates. Set operations, iterator helpers
 * and `RegExp.escape` land in ES2025; `Object.groupBy`, `Promise.withResolvers`
 * and `Array.fromAsync` in ES2024. Probed against TypeScript directly: under
 * `lib: ["ES2023"]` every one of those six is a TS2550 "change the lib option"
 * error, so a rule that mandates them while the config stops at ES2023 mandates
 * code the repo's own compiler rejects.
 */
const ES_BUILTINS_FLOOR_YEAR = 2025;

/**
 * Matches a lib entry that provides a whole annual library: bare `es<year>` or
 * `es<year>.full`.
 *
 * A granular sub-library must NOT match. `es2025.regexp` carries `RegExp.escape`
 * and nothing else, so counting it as "es2025" passed a config providing none of
 * the Set operations or iterator helpers this floor exists to require. A year
 * beyond what TypeScript actually ships (`es9999`) is accepted here by design
 * rather than capped: a bogus lib entry is a hard `tsc` error the moment
 * anything compiles, so it is the compiler's to report, and hard-coding a known
 * maximum would red every repo that adopts the next annual library on time.
 */
const ES_YEAR_RE = /^es(\d{4})(?:\.full)?$/;

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

/**
 * Characters that can end a JSON scalar — digits, `true`/`false`/`null` letters,
 * and the numeric punctuation. Used to tell "comma after a value" (droppable
 * when trailing) from "comma after nothing" (a malformed document).
 */
const VALUE_TAIL_RE = /[\w.+-]/;

/** Severity levels oxlint treats as "this blocks the lint run". */
const DENYING_LEVELS = new Set(['error', 'deny']);

/** One unmet floor requirement. `id` is the waiver key. */
export interface FloorViolation {
  readonly id: string;
  readonly file: string;
  readonly message: string;
  readonly severity: 'error' | 'warn';
}

/**
 * The subset of a tsconfig this invariant reads.
 *
 * @remarks
 * Validated rather than cast: the repo rule is parse-at-the-boundary, and a
 * config file is external input however much it looks like ours. The concrete
 * failure the cast allowed was a file containing `null` — valid JSON, so
 * `JSON.parse` succeeded, and the first property read threw a `TypeError` out of
 * the invariant instead of reporting a finding. Individual options stay
 * `unknown` because the floor asserts `=== true`, not "is a boolean": a config
 * with `"strict": "yes"` must report as unmet, not as unparseable.
 */
const TsConfigSchema = z
  .object({
    compilerOptions: z
      .object({
        noUncheckedIndexedAccess: z.unknown().optional(),
        exactOptionalPropertyTypes: z.unknown().optional(),
        lib: z.unknown().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

type TsConfigShape = z.infer<typeof TsConfigSchema>;

/** The subset of an `.oxlintrc.json` this invariant reads. */
const OxlintrcSchema = z
  .object({
    plugins: z.unknown().optional(),
    rules: z.record(z.unknown()).optional(),
  })
  .passthrough();

type OxlintrcShape = z.infer<typeof OxlintrcSchema>;

/** The subset of a `package.json` this invariant reads. */
const PackageJsonSchema = z
  .object({
    dependencies: z.record(z.unknown()).optional(),
    devDependencies: z.record(z.unknown()).optional(),
    peerDependencies: z.record(z.unknown()).optional(),
  })
  .passthrough();

type PackageJsonShape = z.infer<typeof PackageJsonSchema>;

/**
 * Why a config could not be read. The distinction drives both the message and
 * the severity: a file that is simply absent is a different repo state from a
 * file that exists and is broken, and reporting the second as the first sends
 * the operator looking for a syntax error in a file they never wrote.
 */
type ReadFailure = 'absent' | 'invalid';

/** The outcome of scanning a JSON-with-comments document. */
export type JsoncScan =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly detail: string };

/** A validated config file, or the reason it could not be read. */
type ReadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ReadFailure; readonly detail: string };

/**
 * Strip comments and trailing commas from a JSON-with-comments document.
 *
 * @remarks
 * TypeScript accepts both in a tsconfig — `tsc --init` emits a file full of
 * comments — and so does oxlint. Reading such a file with bare `JSON.parse`
 * makes it *unparseable*, which is how the blocking half of this floor became
 * bypassable: a commented tsconfig downgraded the whole check to one advisory
 * warning, so `disposable-lib` and the ES built-ins floor never ran and
 * pre-commit passed.
 *
 * Hand-rolled rather than delegated, for two reasons. A JSONC dependency to read
 * two config files would contradict `platform-over-dependency`, the very rule
 * this invariant exists to make enforceable. And TypeScript 7 exposes no
 * in-process JS parser API — its root export carries `version` alone, with
 * parsing behind the tsgo API server — so `ts.readConfigFile` is not available
 * to call even if a dependency were acceptable.
 *
 * The scanner tracks string state so a `//` or `/*` inside a string literal
 * survives, which a regex-based strip gets wrong on any config containing a URL
 * (`"$schema": "https://…"` — present in this repo's own `.oxlintrc.json`).
 *
 * Lexically invalid input is rejected rather than repaired: an unterminated
 * block comment or string would otherwise be silently swallowed, and a stripper
 * that turns a broken document into a parseable one contradicts the guarantee
 * that a present-but-invalid config blocks.
 *
 * @param text - Raw file contents.
 * @returns The document with comments removed and trailing commas dropped, or
 *   why it could not be scanned.
 */
export function stripJsonc(text: string): JsoncScan {
  const out: string[] = [];
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out.push(ch); // keep newlines so error offsets stay roughly aligned
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        // A space, not nothing: removing an inline comment with no separator
        // left behind joins the tokens either side of it, so `1/*c*/2` became
        // `12` and `tru/*c*/e` became `true` — a malformed config repaired into
        // a parseable one, which is the bypass this scanner exists to prevent.
        // JSON whitespace is insignificant, so this can never break valid input.
        out.push(' ');
        i += 1;
      } else if (ch === '\n') {
        out.push(ch);
      }
      continue;
    }
    if (inString) {
      out.push(ch);
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out.push(ch);
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    out.push(ch);
  }

  if (inBlockComment) return { ok: false, detail: 'unterminated block comment' };
  if (inString) return { ok: false, detail: 'unterminated string literal' };

  // Trailing commas: a comma whose next non-whitespace character closes the
  // collection. Safe on the comment-stripped text, where no comma can be inside
  // a comment and string contents were pushed verbatim above.
  return { ok: true, text: dropTrailingCommas(out.join('')) };
}

/**
 * Remove `,` immediately preceding a `}` or `]`, ignoring whitespace between —
 * but only where the comma actually follows a value.
 *
 * The distinction matters because this must not *repair* a broken document:
 * `{,}` and `[,]` are invalid JSONC, and dropping their comma hands
 * `JSON.parse` something that succeeds, so a malformed config would read as a
 * checked one. A comma is therefore droppable only when the previous
 * significant character ends a value (`}`, `]`, a closing quote, or an
 * identifier/number character).
 */
function dropTrailingCommas(text: string): string {
  const chars = [...text];
  let inString = false;
  let escaped = false;
  const drop = new Set<number>();
  let pendingComma = -1;
  let prevEndsValue = false;

  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i] as string;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') {
        inString = false;
        prevEndsValue = true;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      pendingComma = -1;
      continue;
    }
    if (ch === ',') {
      pendingComma = prevEndsValue ? i : -1;
      prevEndsValue = false;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue;
    if ((ch === '}' || ch === ']') && pendingComma >= 0) drop.add(pendingComma);
    prevEndsValue = ch === '}' || ch === ']' || VALUE_TAIL_RE.test(ch);
    pendingComma = -1;
  }

  return chars.filter((_, i) => !drop.has(i)).join('');
}

/**
 * Read, JSONC-tolerantly parse, and schema-validate a repo config file.
 *
 * @param root - Absolute repo root.
 * @param rel - Repo-relative path of the file.
 * @param schema - Shape the parsed value must satisfy.
 * @returns The validated value, or whether the file was absent versus invalid.
 */
async function readConfig<T>(
  root: string,
  rel: string,
  schema: z.ZodType<T>,
): Promise<ReadResult<T>> {
  let text: string;
  try {
    text = await readFile(join(root, rel), 'utf8');
  } catch (err) {
    const code = (err as { code?: string }).code;
    return code === 'ENOENT' || code === 'EISDIR'
      ? { ok: false, failure: 'absent', detail: 'file not present' }
      : { ok: false, failure: 'invalid', detail: `unreadable: ${(err as Error).message}` };
  }

  const scan = stripJsonc(text);
  if (!scan.ok) return { ok: false, failure: 'invalid', detail: `not valid JSONC: ${scan.detail}` };

  let raw: unknown;
  try {
    raw = JSON.parse(scan.text);
  } catch (err) {
    return {
      ok: false,
      failure: 'invalid',
      detail: `not valid JSON/JSONC: ${(err as Error).message}`,
    };
  }

  const parsed = schema.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        failure: 'invalid',
        detail: `unexpected shape: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`,
      };
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
    const read = await readConfig(root, rel, PackageJsonSchema);
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
 * to bypass the hook.
 *
 * Covers the strictness flags only. `lib` is checked separately by
 * {@link libFloorChecks}, because a monorepo splits the two across files:
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

/** The `es<year>` a lib entry belongs to, or `undefined` if it names no year. */
function libYear(entry: string): number | undefined {
  const m = ES_YEAR_RE.exec(entry);
  return m ? Number(m[1]) : undefined;
}

/**
 * The `lib` half of the tsconfig floor, checked per file.
 *
 * Asserts the two things the enforced prose rules need from the type surface:
 * Explicit Resource Management, without which `using` / `await using` do not
 * compile and `deterministic-cleanup` is unenforceable; and the ES2024–2025
 * built-ins that `platform-over-dependency` mandates by name. The second half
 * exists because a rule requiring `Object.groupBy` while the config stops at
 * ES2023 requires code the repo's own compiler rejects — probed directly:
 * `Object.groupBy`, `Promise.withResolvers`, `Set.prototype.union`,
 * `RegExp.escape` and the iterator helpers are all TS2550 under `lib: ["ES2023"]`.
 *
 * Both are `error`: widening `lib` only adds declarations, so it cannot break
 * existing code — verified by raising this repo to `["ESNext", "DOM"]` with a
 * clean `tsc --noEmit`.
 *
 * A `lib` array absent from a config means "inherit" — from `extends`, or from
 * `target`'s default — so this only asserts on a config that *declares* a `lib`,
 * i.e. one that has taken ownership of its type surface. Walking the `extends`
 * graph to compute the effective set is not available to do: TypeScript 7 ships
 * no in-process JS parser API, so there is no `ts.parseJsonConfigFileContent` to
 * call. Per-package configs below the root are likewise out of scope — the root
 * anchor is the documented approximation, not a claim of completeness.
 *
 * @param path - Repo-relative path of the tsconfig that was read (for reporting).
 * @param cfg - Its parsed contents.
 */
export function libFloorChecks(path: string, cfg: TsConfigShape): FloorViolation[] {
  const declared = cfg.compilerOptions?.lib;
  if (declared === undefined) return [];
  if (!Array.isArray(declared)) {
    // `"lib": "ESNext"` is a plausible typo that `tsc` rejects outright. Reading
    // it as "no lib declared, therefore inherited" silently skipped both checks
    // on a config that does not compile at all.
    return [
      {
        id: 'lib-malformed',
        file: path,
        severity: 'error',
        message: `${path}: compilerOptions.lib is ${typeof declared === 'string' ? 'a string' : `a ${typeof declared}`}, not an array — \`tsc\` rejects that, and the lib floor cannot be checked against it. Write it as an array (\`"lib": ["ESNext", "DOM"]\`).`,
      },
    ];
  }

  const entries = declared
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.toLowerCase());
  const umbrella = entries.some((entry) => LIB_UMBRELLAS.has(entry));
  const out: FloorViolation[] = [];

  if (!umbrella && !entries.includes(DISPOSABLE_LIB)) {
    out.push({
      id: 'disposable-lib',
      file: path,
      severity: 'error',
      message: `${path}: compilerOptions.lib provides no Explicit Resource Management — add "ESNext.Disposable", or an umbrella entry ("ESNext" / "ESNext.Full") which includes it. Without it \`using\` / \`await using\` do not type-check and the deterministic-cleanup rule is unenforceable. Widening lib only adds declarations; it cannot break existing code.`,
    });
  }

  const bestYear = Math.max(0, ...entries.map((entry) => libYear(entry) ?? 0));
  if (!umbrella && bestYear < ES_BUILTINS_FLOOR_YEAR) {
    out.push({
      id: 'lib-es-builtins',
      file: path,
      severity: 'error',
      message: `${path}: compilerOptions.lib reaches ${bestYear === 0 ? 'no es<year> entry' : `es${bestYear}`}, below es${ES_BUILTINS_FLOOR_YEAR} — so the built-ins the platform-over-dependency rule mandates by name do not type-check (Object.groupBy and Promise.withResolvers need es2024; Set operations, iterator helpers and RegExp.escape need es2025). An enforced rule must not require code this config rejects: raise lib to "ESNext" (or es${ES_BUILTINS_FLOOR_YEAR}), or waive this id and stop mandating those APIs.`,
    });
  }

  return out;
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
 * @returns Every unmet requirement. A config that is present but broken is an
 *   `error` — the repo owns a file its own toolchain cannot read, and treating
 *   that as advisory is what let the blocking half of the floor be bypassed. A
 *   config that is merely absent is reported on its own terms.
 */
export async function collectFloorViolations(root: string): Promise<FloorViolation[]> {
  const out: FloorViolation[] = [];

  // Read every root candidate: the FIRST that validates is the strictness
  // anchor, while the `lib` requirements are asserted against each one that
  // declares a `lib` — see libFloorChecks for why the two cannot share an anchor.
  let anchored = false;
  let sawCandidate = false;
  for (const candidate of TSCONFIG_CANDIDATES) {
    const read = await readConfig(root, candidate, TsConfigSchema);
    if (!read.ok) {
      if (read.failure === 'absent') continue;
      sawCandidate = true;
      out.push({
        id: 'tsconfig-invalid',
        file: candidate,
        severity: 'error',
        message: `${candidate}: ${read.detail}. The TypeScript floor cannot be checked against a config the invariant cannot read — and an unchecked floor must not read as a met one, so this blocks rather than warns. Comments and trailing commas are tolerated; this is something else.`,
      });
      continue;
    }
    sawCandidate = true;
    if (!anchored) {
      out.push(...tsconfigFloorChecks(candidate, read.value));
      anchored = true;
    }
    out.push(...libFloorChecks(candidate, read.value));
  }
  if (!sawCandidate) {
    out.push({
      id: 'tsconfig-absent',
      file: TSCONFIG_CANDIDATES[1],
      severity: 'warn',
      message: `no root tsconfig found (${TSCONFIG_CANDIDATES.join(' / ')}) — the TypeScript floor went unchecked. A repo with no root tsconfig may be intentional (a pure-JS consumer), which is why this warns rather than blocks.`,
    });
  }

  const deps = await workspaceDependencies(root);
  if (!deps.readAny) {
    out.push({
      id: 'manifests-unreadable',
      file: PACKAGE_JSON,
      severity: 'warn',
      message: `no ${PACKAGE_JSON} in this repo validated, so the React floor went unchecked — its trigger is whether \`react\` is a declared dependency, and that question has no answer here. Reported rather than assumed: "no manifest readable" must not read as "react is not a dependency".`,
    });
    return out;
  }

  if (deps.names.has('react')) {
    const oxlintrc = await readConfig(root, OXLINTRC, OxlintrcSchema);
    if (oxlintrc.ok) {
      out.push(...reactFloorChecks(oxlintrc.value));
    } else {
      out.push({
        id: oxlintrc.failure === 'absent' ? 'oxlintrc-absent' : 'oxlintrc-invalid',
        file: OXLINTRC,
        severity: 'error',
        message:
          oxlintrc.failure === 'absent'
            ? `react is a dependency but there is no ${OXLINTRC}, so no React lint rule runs at all — the same end state as a config with the plugin disabled, which this floor already blocks.`
            : `react is a dependency but ${OXLINTRC}: ${oxlintrc.detail}. oxlint cannot read it either, so no React rule is running.`,
      });
    }
  }

  return out;
}

/** Waived floor ids with their reasons, plus why the waiver block was unusable. */
interface WaiverLoad {
  readonly waivers: ReadonlyArray<{ id: string; reason: string }>;
  readonly error?: string;
}

/**
 * Read the waived floor ids from `.noldor/config.json`.
 *
 * @remarks
 * Tolerant of an absent consumer config — a repo without one waives nothing
 * rather than throwing, mirroring `loadScopeAliases`. What it is deliberately
 * *not* tolerant of is silence: `ToolchainFloorSchema` is `.strict()`, so a
 * single stray key inside `toolchainFloor` rejects the whole block and discards
 * every waiver in it. Swallowing that left the operator staring at a blocking
 * floor they had already waived, with nothing pointing at the typo — so the
 * message is carried out and reported as a `warn`.
 */
function loadWaivers(root: string): WaiverLoad {
  // An absent consumer config waives nothing and is not a problem — most repos
  // running this floor have no `toolchainFloor` block at all. Only a config that
  // EXISTS and could not be used is worth a warn; conflating the two put a
  // "waivers could not be read" line in front of every consumer without one.
  if (!existsSync(join(root, CONSUMER_CONFIG))) return { waivers: [] };
  try {
    return { waivers: loadConsumerConfig(root).toolchainFloor?.waivers ?? [] };
  } catch (err) {
    return { waivers: [], error: (err as Error).message };
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
      const load = loadWaivers(repoRoot);
      const waived = new Map(load.waivers.map((w) => [w.id, w.reason]));
      const violations: InvariantViolation[] = [];

      if (load.error !== undefined) {
        violations.push({
          file: CONSUMER_CONFIG,
          severity: 'warn',
          message: `toolchain-floor waivers could not be read, so every floor item below is reported unwaived: ${load.error}`,
        });
      }

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
