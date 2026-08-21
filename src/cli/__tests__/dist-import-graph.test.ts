// @tests: noldor-package-lift
// Every relative specifier in the compiled tree must resolve on disk.
//
// This is the check that catches what `--help` cannot: the router returns on a
// help flag BEFORE dispatching, so sweeping `<cmd> --help` proves only that the
// router loads. And tsx resolves an extensionless relative import while plain
// Node ESM does not, so a `from '../core/session'` that works in a checkout
// crashes the same command under dist. Static resolution finds that class
// without executing 112 entrypoints, which importing them would.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '../../..');
const DIST = join(REPO_ROOT, 'dist');

function jsFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) jsFiles(abs, out);
    else if (entry.name.endsWith('.js')) out.push(abs);
  }
  return out;
}

/**
 * Relative specifiers in `import` / `export ... from` position.
 *
 * Comment lines are skipped: `tsc` preserves comments verbatim, and prose that
 * documents a regen command or an example re-export is not an import.
 *
 * @param text - A compiled module's source.
 * @returns The relative specifiers it actually imports.
 */
function relativeSpecifiers(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    for (const m of line.matchAll(/(?:^|;)\s*(?:import|export)[^'"]*from\s*['"](\.[^'"]*)['"]/g)) {
      out.push(m[1] as string);
    }
    for (const m of line.matchAll(/\bimport\(\s*['"](\.[^'"]*)['"]\s*\)/g)) {
      out.push(m[1] as string);
    }
  }
  return out;
}

describe('the compiled import graph', () => {
  it('has a build to check', () => {
    expect(existsSync(join(DIST, 'cli/index.js'))).toBe(true);
  });

  it('resolves every relative specifier on disk', () => {
    const broken: string[] = [];
    for (const file of jsFiles(DIST)) {
      const text = readFileSync(file, 'utf8');
      for (const spec of relativeSpecifiers(text)) {
        const target = resolve(dirname(file), spec);
        if (existsSync(target)) continue;
        if (existsSync(join(target, 'index.js'))) continue;
        broken.push(`${file.slice(DIST.length + 1)} -> ${spec}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('carries no extensionless relative specifier', () => {
    const offenders: string[] = [];
    for (const file of jsFiles(DIST)) {
      for (const spec of relativeSpecifiers(readFileSync(file, 'utf8'))) {
        if (!/\.(js|json|mjs|cjs)$/.test(spec)) {
          offenders.push(`${file.slice(DIST.length + 1)} -> ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
