import { access, readdir, realpath } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { allExtensions, cruise } from 'dependency-cruiser';

import { loadConsumerConfig } from '../core/consumer-config.js';
import type { Invariant, InvariantResult, InvariantViolation } from './types.js';

// SCAN_PATHS + FORBIDDEN_RULES removed — sourced from consumer config.

/** Extensions the boundaries scan needs a TypeScript-capable parser for. */
const TS_EXTENSIONS = new Set(['.ts', '.tsx']);

/**
 * Whether any scanned path holds a TypeScript source file.
 *
 * The parser guard below only matters for a tree dependency-cruiser must parse
 * as TypeScript; a JS-only consumer (which never had `typescript` on disk) must
 * not be told to install a transpiler it has no use for.
 *
 * @param root - Absolute repo root, symlinks resolved.
 * @param relPaths - Existing scan paths, relative to `root`.
 * @returns True on the first `.ts`/`.tsx` file found.
 */
export async function containsTsSources(
  root: string,
  relPaths: readonly string[],
): Promise<boolean> {
  const queue = relPaths.map((relPath) => join(root, relPath));
  while (queue.length > 0) {
    const current = queue.pop() as string;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      // `current` is a file (or unreadable) — a scanPath may name one directly.
      if (TS_EXTENSIONS.has(extname(current))) {
        return true;
      }
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
          continue;
        }
        queue.push(join(current, entry.name));
        continue;
      }
      if (TS_EXTENSIONS.has(extname(entry.name))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * TypeScript extensions dependency-cruiser reports as having no parser.
 *
 * @param extensions - dependency-cruiser's `allExtensions` availability report.
 * @returns The unparseable TypeScript extensions, empty when all are covered.
 */
export function findUnparseableTsExtensions(
  extensions: ReadonlyArray<{ readonly extension: string; readonly available: boolean }>,
): string[] {
  return extensions
    .filter((ext) => TS_EXTENSIONS.has(ext.extension) && !ext.available)
    .map((ext) => ext.extension);
}

/**
 * Build the boundaries invariant plugin.
 *
 * Reads `scanPaths` + `boundaries` from `.noldor/config.json` consumer block.
 * `boundaries` follows dependency-cruiser's forbidden-rule shape
 * (`{name, severity, from: {path}, to: {path}}` with regex strings).
 *
 * @param repoRoot - Absolute path to repo root (symlinks resolved via `realpath`
 *   internally so that `dependency-cruiser` path patterns match correctly).
 * @returns Plugin that runs `dependency-cruiser` against package source dirs
 *   and flags any forbidden cross-package import.
 */
export function makeBoundariesInvariant(repoRoot: string): Invariant {
  return {
    description: 'No forbidden cross-package imports',
    name: 'boundaries',
    async run(): Promise<InvariantResult> {
      const start = Date.now();
      const { scanPaths, boundaries } = loadConsumerConfig(repoRoot);
      const realRoot = await realpath(repoRoot);

      const existingRelPaths: string[] = [];
      for (const relPath of scanPaths) {
        try {
          await access(join(realRoot, relPath));
          existingRelPaths.push(relPath);
        } catch {
          // path absent — skip silently
        }
      }

      if (existingRelPaths.length === 0) {
        return { invariant: 'boundaries', violations: [], durationMs: Date.now() - start };
      }

      // dependency-cruiser parses TypeScript through whichever transpiler it can
      // import: `typescript` (it supports >=2 <6 only) or `@swc/core`. With
      // TypeScript 7 installed and no swc, neither is available — `cruise` then
      // yields zero modules for a `.ts` tree, i.e. a silent green. Fail loudly
      // instead: an unparseable tree is an unverified boundary, not a clean one.
      const unparseable = findUnparseableTsExtensions(allExtensions);
      if (unparseable.length > 0 && (await containsTsSources(realRoot, existingRelPaths))) {
        return {
          invariant: 'boundaries',
          violations: [
            {
              file: 'package.json',
              message: `dependency-cruiser cannot parse ${unparseable.join(', ')} — no supported transpiler installed (it accepts typescript >=2 <6, or @swc/core). Boundaries went unchecked; install @swc/core as a devDependency to restore it under TypeScript 7.`,
            },
          ],
          durationMs: Date.now() - start,
        };
      }

      const result = await cruise(existingRelPaths, {
        baseDir: realRoot,
        validate: true,
        ruleSet: { forbidden: [...boundaries] },
        doNotFollow: { path: 'node_modules' },
        exclude: { path: '__tests__|\\.test\\.ts$' },
        tsPreCompilationDeps: true,
      });

      const violations: InvariantViolation[] = [];
      const output = result.output;

      if (typeof output === 'object' && output !== null && 'modules' in output) {
        type CruiseModule = {
          source: string;
          dependencies: ReadonlyArray<{
            resolved: string;
            rules?: ReadonlyArray<{ name: string; severity: string }>;
          }>;
        };
        const modules = (output as { modules: ReadonlyArray<CruiseModule> }).modules;
        for (const mod of modules) {
          for (const dep of mod.dependencies) {
            for (const rule of dep.rules ?? []) {
              if (rule.severity === 'error' || rule.severity === 'warn') {
                violations.push({
                  file: mod.source,
                  message: `forbidden import (${rule.name}): ${mod.source} -> ${dep.resolved}`,
                });
              }
            }
          }
        }
      }

      return { invariant: 'boundaries', violations, durationMs: Date.now() - start };
    },
  };
}

/**
 * Default boundaries invariant instance using `process.cwd()` as repo root.
 */
export const boundaries: Invariant = makeBoundariesInvariant(process.cwd());
