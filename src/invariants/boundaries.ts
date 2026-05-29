import { access, realpath } from 'node:fs/promises';
import { join } from 'node:path';

import { cruise } from 'dependency-cruiser';

import { loadConsumerConfig } from '../core/consumer-config.js';
import type { Invariant, InvariantResult, InvariantViolation } from './types.js';

// SCAN_PATHS + FORBIDDEN_RULES removed — sourced from consumer config.

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
