import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { walkRepo } from '../core/fd-load.js';
import { defineInvariant } from './types.js';
import type { Invariant, InvariantViolation } from './types.js';

// ADVISORY ON PURPOSE — this reports, it does not enforce.
//
// The enforcement is the type system: `slugPath` and every builder above it
// demand a branded `Slug`, so passing raw argv text to one is a compile error.
// What no type can catch is a call site that ignores the builders and joins a
// slug itself, and no static pass in this repo can catch it either: TypeScript 7
// dropped the in-process JS compiler API (see `public-api-tsdoc.ts`), and the
// one AST-capable invariant, `boundaries`, is already dark for that reason
// (dependency-cruiser accepts `typescript >=2 <6` or `@swc/core`).
//
// So this is a text scan, and its blind spots are known and stated rather than
// papered over: it cannot see a root hidden in a const (`join(cwd, MILESTONES_DIR,
// …)`), a literal split across arguments (`join(cwd, 'docs', 'features', …)`),
// or a root returned by a call (`join(loadDocRoots(cwd).milestones, …)`). Those
// are exactly the shapes the brand does catch. Nothing claims that zero
// violations here means the policy holds — that claim is what would make the
// check dangerous rather than merely weak.

/** Slug-rooted directory literals, as they appear inside a single string. */
const SLUG_ROOT_LITERALS = [
  '.worktrees',
  'docs/features',
  'docs/milestones',
  '.noldor/cr',
  '.noldor/design',
  '.noldor/dev-',
] as const;

/**
 * Modules allowed to join a slug-rooted literal: the guarded builders
 * themselves, plus the test tree, which constructs expected paths on purpose.
 */
const SANCTIONED = [
  'src/core/slug-paths.ts',
  'src/core/doc-roots.ts',
  'src/worktrees/worktree-paths.ts',
  'src/cr/filename.ts',
  'src/design/ledger.ts',
  'src/cr/autofix-ledger.ts',
] as const;

/** A `join(...)` call and the line it starts on. */
const JOIN_CALL_RE = /\bjoin\s*\(([^;]*?)\)/gs;

function isSanctioned(relPath: string): boolean {
  if (relPath.includes('__tests__') || relPath.endsWith('.test.ts')) return true;
  return SANCTIONED.some((s) => relPath === s);
}

/**
 * The slug-rooted literal an argument opens with, in any quote style.
 *
 * The quote matters: it is what distinguishes a string literal from an
 * identifier that merely contains the same characters.
 */
function rootLiteralIn(arg: string): (typeof SLUG_ROOT_LITERALS)[number] | undefined {
  return SLUG_ROOT_LITERALS.find((lit) => ["'", '"', '`'].some((q) => arg.includes(`${q}${lit}`)));
}

/**
 * Split a `join(...)` argument list on top-level commas.
 *
 * Naive but sufficient: it only has to tell "is anything appended after the
 * root literal", and nesting inside quotes, parens or template holes is the
 * only thing that would mis-split.
 */
function splitArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let i = 0; i < args.length; i++) {
    const ch = args[i]!;
    if (quote !== null) {
      if (ch === quote && args[i - 1] !== '\\') quote = null;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
    } else if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

/**
 * Violations in one file's source text.
 *
 * A join whose slug-rooted literal is its LAST argument is a directory root,
 * not a slug path — `join(cwd, 'docs/features')` feeds a `readdir`, and the
 * names it yields come from the filesystem rather than from an argument. Only a
 * join that appends something after the root is building a path from a value,
 * so only that shape is reported. Without this, the check fires on every
 * directory walker in `src/garden` and becomes noise that gets waived.
 *
 * @param relPath - Repo-relative path, used for the sanctioned-module check.
 * @param text - The file's source.
 * @returns One advisory violation per suspect join.
 */
export function scanSource(relPath: string, text: string): InvariantViolation[] {
  if (isSanctioned(relPath)) return [];
  const out: InvariantViolation[] = [];
  for (const m of text.matchAll(JOIN_CALL_RE)) {
    const args = splitArgs(m[1]!);
    const rootIdx = args.findIndex((arg) => rootLiteralIn(arg) !== undefined);
    // rootIdx === 0: no anchor precedes the literal, so this composes a
    // relative label (`join('docs/features', entry)` → a display path), not a
    // filesystem path — nothing to escape from.
    // rootIdx === last: the literal IS the whole root, feeding a readdir.
    if (rootIdx <= 0 || rootIdx === args.length - 1) continue;
    const literal = rootLiteralIn(args[rootIdx]!)!;
    out.push({
      file: relPath,
      line: text.slice(0, m.index).split('\n').length,
      severity: 'warn',
      message: `joins a value onto the slug-rooted literal '${literal}' outside the guarded builders — build it through src/core/slug-paths.ts so the slug is parsed and containment-checked`,
    });
  }
  return out;
}

/**
 * Build the choke-point invariant for a specific repo root.
 *
 * @param repoRoot - Repository root whose `src/` tree should be scanned.
 * @returns A plugin instance bound to that root.
 */
export function makeSlugPathChokePointInvariant(repoRoot: string): Invariant {
  return defineInvariant(
    'slug-path-choke-point',
    'reports slug-rooted path joins outside the guarded builders (advisory — the brand is the enforcement)',
    async () => {
      const violations: InvariantViolation[] = [];
      const files: string[] = [];
      await walkRepo(join(repoRoot, 'src'), files);
      for (const abs of files) {
        if (!abs.endsWith('.ts')) continue;
        violations.push(...scanSource(relative(repoRoot, abs), await readFile(abs, 'utf8')));
      }
      return violations;
    },
  );
}

/** Pre-built singleton using `process.cwd()` as repo root. */
export const slugPathChokePoint: Invariant = makeSlugPathChokePointInvariant(process.cwd());
