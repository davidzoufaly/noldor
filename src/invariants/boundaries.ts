import { access, realpath } from 'node:fs/promises';
import { join } from 'node:path';

import { cruise } from 'dependency-cruiser';

import type { Invariant, InvariantResult, InvariantViolation } from './types.js';

const SCAN_PATHS = [
  'packages/engine/src',
  'packages/format/src',
  'packages/viewport/src',
  'apps/web/src',
] as const;

const FORBIDDEN_RULES = [
  {
    from: { path: '^packages/engine/src' },
    name: 'engine-no-viewport',
    severity: 'error' as const,
    to: { path: '^packages/viewport/' },
  },
  {
    from: { path: '^packages/engine/src' },
    name: 'engine-no-web',
    severity: 'error' as const,
    to: { path: '^apps/web/' },
  },
  {
    from: { path: '^packages/viewport/src' },
    name: 'viewport-no-web',
    severity: 'error' as const,
    to: { path: '^apps/web/' },
  },
  {
    from: { path: '^packages/format/src' },
    name: 'format-no-non-format',
    severity: 'error' as const,
    to: { path: '^(packages/(?!format(?:/|$))|apps/)' },
  },
] as const;

/**
 * Build the boundaries invariant plugin.
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

      // Resolve symlinks so dep-cruiser relative paths are anchored correctly.
      const realRoot = await realpath(repoRoot);

      // Only scan paths that actually exist (partial repos in tests are fine).
      const existingRelPaths: string[] = [];
      for (const relPath of SCAN_PATHS) {
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

      // dependency-cruiser programmatic API:
      //   - `baseDir` anchors relative source/resolved paths for rule matching
      //   - `validate: true` must be explicit (default is false)
      //   - `ruleSet.forbidden` is the correct nesting (top-level `forbidden` is silently ignored)
      const result = await cruise(existingRelPaths, {
        baseDir: realRoot,
        validate: true,
        ruleSet: { forbidden: [...FORBIDDEN_RULES] },
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

      return {
        invariant: 'boundaries',
        violations,
        durationMs: Date.now() - start,
      };
    },
  };
}

/**
 * Default boundaries invariant instance using `process.cwd()` as repo root.
 *
 * @remarks
 * Used by the invariants runner when scanning the real repo.
 */
export const boundaries: Invariant = makeBoundariesInvariant(process.cwd());
