import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// The same fail-closed runtime-asset list the build's digest uses (PR #360).
// bin/build-manifest.mjs is plain ESM — importable from src via tsx/dist alike.
import { RUNTIME_ASSETS } from '../../bin/build-manifest.mjs';

const toPosix = (p: string): string => p.split(sep).join('/');

function walk(root: string, dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(root, full, out);
    else out.push(toPosix(relative(root, full)));
  }
}

/**
 * Package-root-relative paths the binary embeds (spec Unit 1): templates/**
 * + package.json + the dist projection of every RUNTIME_ASSETS entry. A new
 * runtime asset rides in automatically — the manifest is imported, never
 * duplicated.
 */
export function packFileList(pkgRoot: string): string[] {
  const files: string[] = ['package.json'];
  walk(pkgRoot, join(pkgRoot, 'templates'), files);
  for (const asset of RUNTIME_ASSETS) {
    files.push(asset.replace(/^src\//, 'dist/'));
  }
  return [...new Set(files)].sort();
}
