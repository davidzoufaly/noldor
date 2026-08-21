// One scanner for "does every relative specifier in a compiled tree resolve".
// Shared by the in-tree test and the packed-consumer contract, which previously
// carried two near-identical copies — and the copies disagreed: one lacked the
// extensionless assertion, and both counted a directory as resolved, so
// `from './core'` passed the very check meant to catch it.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Strip line and block comments; `tsc` preserves prose that mentions imports. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * Relative specifiers a module actually imports.
 *
 * Covers `from '…'` (the specifier always sits beside `from`, so a declaration
 * wrapped across lines is still matched), bare side-effect `import '…'`, and
 * dynamic `import('…')`.
 *
 * @param text - Module source.
 * @returns The relative specifiers.
 */
export function relativeSpecifiers(text) {
  const body = stripComments(text);
  const specs = [];
  for (const m of body.matchAll(/\bfrom\s*['"](\.[^'"]*)['"]/g)) specs.push(m[1]);
  for (const m of body.matchAll(/(?:^|[;{}\s])import\s*['"](\.[^'"]*)['"]/g)) specs.push(m[1]);
  for (const m of body.matchAll(/\bimport\(\s*['"](\.[^'"]*)['"]\s*\)/g)) specs.push(m[1]);
  return specs;
}

/**
 * Every `.js` file under `dir`.
 *
 * @param dir - Directory to walk.
 * @param out - Accumulator.
 * @returns Absolute paths.
 */
export function jsFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) jsFiles(abs, out);
    else if (entry.name.endsWith('.js')) out.push(abs);
  }
  return out;
}

function resolvesToFile(target) {
  try {
    if (statSync(target).isFile()) return true;
  } catch {
    // fall through to the directory-index form
  }
  try {
    return statSync(join(target, 'index.js')).isFile();
  } catch {
    return false;
  }
}

/**
 * Audit a compiled tree's relative imports.
 *
 * @param distRoot - Root of the compiled tree.
 * @returns `{ unresolved, extensionless }`, each `file -> specifier` strings.
 */
export function auditImportGraph(distRoot) {
  const unresolved = [];
  const extensionless = [];
  for (const file of jsFiles(distRoot)) {
    const label = file.slice(distRoot.length + 1);
    for (const spec of relativeSpecifiers(readFileSync(file, 'utf8'))) {
      if (!/\.(js|json|mjs|cjs)$/.test(spec)) extensionless.push(`${label} -> ${spec}`);
      if (!resolvesToFile(join(dirname(file), spec))) unresolved.push(`${label} -> ${spec}`);
    }
  }
  return { extensionless, unresolved };
}
