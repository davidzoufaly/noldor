// Runtime Node-floor guard. Must stay dependency-free and parse on Node
// versions BELOW the floor — the whole point is a deterministic message
// before tsx (or any dependency) loads and crashes with something cryptic.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Extracts the major-version floor from a `>=NN` style engines range.
 * Returns null when the range carries no leading number it can read.
 */
export function minMajor(range) {
  const match = /(\d+)/.exec(String(range));
  return match ? Number(match[1]) : null;
}

/**
 * Returns an error message when `actual` (a `process.versions.node` string)
 * falls below the floor declared by `range`, else null.
 */
export function checkNodeFloor(range, actual) {
  const floor = minMajor(range);
  if (floor === null) return null;
  const actualMajor = Number(String(actual).split('.')[0]);
  if (Number.isNaN(actualMajor) || actualMajor >= floor) return null;
  return (
    `noldor requires Node ${range} (engines.node), but this is Node ${actual}. ` +
    `Upgrade Node to ${floor} or newer.`
  );
}

/**
 * Reads engines.node from the package's own package.json and exits 1 with a
 * deterministic message when the running Node is below the floor.
 */
export function assertNodeFloor(actual = process.versions.node) {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8'));
  const range = pkg.engines && pkg.engines.node;
  if (!range) return;
  const error = checkNodeFloor(range, actual);
  if (error) {
    console.error(error);
    process.exit(1);
  }
}
