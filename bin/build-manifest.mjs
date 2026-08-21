// Single owner of "what the build is made of": the compiled input set, the
// runtime assets `tsc` cannot emit, and the dist paths both must produce.
//
// The copier, the digest, the orphan prune and the runtime selector all read
// this module. A second list drifting by one path would be silent — the digest
// would never match, dist would never be selected, and only a direct runtime
// assertion would notice. Plain `.mjs` because the selector runs before any
// TypeScript is loadable.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Non-TypeScript files the runtime reads, which `tsc` never emits.
 * Repo-relative POSIX paths.
 */
export const RUNTIME_ASSETS = [
  'src/cr/cr-record.schema.json',
  'src/cr/lanes/escalate-prompt.md',
  'src/cr/standalone-prompt.md',
  'src/dashboard/static/dist/agents.js',
  'src/dashboard/static/dist/drag.js',
  'src/testing/fixtures/canned/add-greeting-helper.json',
];

/**
 * Non-TypeScript files under `src/` that are deliberately NOT runtime assets,
 * each with the reason, so the fail-closed scan does not trip on them.
 */
export const NON_RUNTIME_FILES = {
  'src/dashboard/static/tsconfig.json': 'build config for the browser bundle',
  'src/invariants/.dependency-cruiser.cjs':
    'no reader — boundaries.ts builds cruise() options in code',
};

/**
 * Paths neither the compiler nor the asset scan looks at: what `tsconfig.json`
 * excludes, plus generated trees that live under `src/`.
 *
 * `graphify-out` is a cache directory (gitignored at `.gitignore:54`) holding
 * hundreds of files in any workspace that has run graphify. Listing it here
 * rather than asking git what is ignored is deliberate: `prepare` runs the build
 * with the package root inside a consumer's `node_modules/`, which git reports as
 * ignored wholesale — so a git query would silently turn the fail-closed asset
 * scan into a no-op exactly where it matters. A future generated tree therefore
 * reds the build until someone adds it here, which is the behaviour a
 * fail-closed guard should have.
 */
const EXCLUDED = [
  /(^|\/)__tests__(\/|$)/,
  /\.test\.ts$/,
  /^src\/fixtures(\/|$)/,
  /(^|\/)graphify-out(\/|$)/,
];

const isExcluded = (rel) => EXCLUDED.some((re) => re.test(rel));
const toPosix = (p) => p.split(sep).join('/');

function walk(root, dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const rel = toPosix(relative(root, abs));
    if (entry.isDirectory()) {
      walk(root, abs, out);
      continue;
    }
    out.push(rel);
  }
  return out;
}

/**
 * Every file under `src/`, repo-relative, unfiltered.
 *
 * @param root - Package root.
 * @returns Sorted repo-relative POSIX paths.
 */
export function allSourceFiles(root) {
  return walk(root, join(root, 'src'), []).sort();
}

/**
 * The set `tsc` compiles: `src/**\/*.ts` minus tests and fixtures.
 *
 * @param root - Package root.
 * @returns Sorted repo-relative POSIX paths.
 */
export function compiledInputs(root) {
  return allSourceFiles(root).filter((rel) => rel.endsWith('.ts') && !isExcluded(rel));
}

/**
 * Everything whose content decides whether a build is current.
 *
 * `tsconfig.json` is a member because compiler options change emission without
 * changing the input set — editing `target` or `outDir` must invalidate a build.
 *
 * @param root - Package root.
 * @returns Sorted repo-relative POSIX paths.
 */
export function digestInputs(root) {
  // Only paths that exist: the digest covers the path LIST as well as content,
  // so a deleted input changes the digest by leaving the list. A runtime asset
  // vanishing from src is the copier's fail-closed check, not the digest's.
  return [...compiledInputs(root), ...RUNTIME_ASSETS, 'tsconfig.json']
    .filter((rel) => existsSync(join(root, rel)))
    .sort();
}

/**
 * The dist path each digest input must produce, derived rather than observed —
 * an incremental no-op leaves required outputs untouched, so "what tsc wrote"
 * would under-report.
 *
 * @param root - Package root.
 * @returns Sorted dist-relative POSIX paths.
 */
export function expectedOutputs(root) {
  const compiled = compiledInputs(root).map((rel) =>
    rel.replace(/^src\//, '').replace(/\.ts$/, '.js'),
  );
  // Mirrors digestInputs: only assets present in src are expected in dist, so
  // removing one drops it from both the digest and the prune's keep-set.
  const assets = RUNTIME_ASSETS.filter((rel) => existsSync(join(root, rel))).map((rel) =>
    rel.replace(/^src\//, ''),
  );
  return [...compiled, ...assets].sort();
}

/**
 * Non-TypeScript files under `src/` that are neither a runtime asset nor a
 * declared non-runtime file — a new asset nobody wired up.
 *
 * @param root - Package root.
 * @returns Sorted repo-relative POSIX paths; empty when the manifest is complete.
 */
export function unmanifestedAssets(root) {
  const known = new Set([...RUNTIME_ASSETS, ...Object.keys(NON_RUNTIME_FILES)]);
  return allSourceFiles(root).filter(
    (rel) => !rel.endsWith('.ts') && !isExcluded(rel) && !known.has(rel),
  );
}

/**
 * Read a digest input, failing loudly rather than hashing an unreadable file as
 * empty.
 *
 * @param root - Package root.
 * @param rel - Repo-relative path.
 * @returns File contents.
 */
export function readInput(root, rel) {
  return readFileSync(join(root, rel));
}
