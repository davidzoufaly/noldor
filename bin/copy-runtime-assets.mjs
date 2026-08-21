// Copies the non-TypeScript files the runtime reads into dist. `tsc` emits
// JavaScript only, so without this the dashboard serves 404s for its static
// bundle and the codex CR lane loses its schema.
//
// Fails closed in both directions: a manifest entry missing from src, or any
// unlisted non-TypeScript file anywhere under src outside the test and fixture
// exclusions. The scan walks the whole tree, so a new asset under a new
// directory or with a new extension trips it too.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { RUNTIME_ASSETS, unmanifestedAssets } from './build-manifest.mjs';

/**
 * Copy every runtime asset into `dist`.
 *
 * @param root - Package root.
 * @returns The dist-relative paths written.
 */
export function copyRuntimeAssets(root) {
  const missing = RUNTIME_ASSETS.filter((rel) => !existsSync(join(root, rel)));
  if (missing.length > 0) {
    throw new Error(`runtime assets missing from src: ${missing.join(', ')}`);
  }
  const unlisted = unmanifestedAssets(root);
  if (unlisted.length > 0) {
    throw new Error(
      `unlisted non-TypeScript file(s) under src — add to RUNTIME_ASSETS or NON_RUNTIME_FILES in bin/build-manifest.mjs: ${unlisted.join(', ')}`,
    );
  }
  const written = [];
  for (const rel of RUNTIME_ASSETS) {
    const target = join(root, 'dist', rel.replace(/^src\//, ''));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, rel), target);
    written.push(rel.replace(/^src\//, ''));
  }
  return written;
}
