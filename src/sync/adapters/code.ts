// @fd: feature-md-links-overhaul

import { scanRoots } from '../../core/repo-paths.js';
import { loadConsumerConfig } from '../../core/consumer-config.js';
import type { LinkAdapter, ScanRoot } from '../projection.js';

const CODE_FILE_RE = /\.(ts|tsx|js|jsx)$/;
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;

/**
 * Label each scan root by whether the consumer named it. A configured root that
 * has vanished is a coverage gap the operator can fix; a default root's absence
 * is the union-of-layouts fallback working as designed.
 *
 * @param cwd - Consumer root
 * @returns Absolute roots tagged with their origin
 */
export function originTaggedScanRoots(cwd: string): ScanRoot[] {
  const configured = loadConsumerConfig(cwd).scanPaths.length > 0;
  return scanRoots(cwd).map((r) => ({
    path: `${cwd}/${r}`,
    origin: configured ? ('configured' as const) : ('default' as const),
  }));
}

/** `links.code`, projected from `// @fd:` tags on non-test source files. */
export const codeAdapter: LinkAdapter = {
  key: 'code',
  tagRe: /^\/\/\s*@fd:\s*(.+?)\s*$/m,
  roots: originTaggedScanRoots,
  eligible: (name) => CODE_FILE_RE.test(name) && !TEST_FILE_RE.test(name),
  // A directory entry carries no file extension and so can never hold a tag.
  // Package-level attribution (`packages/sample-scenes`) is hand-curated and the
  // scan must leave it alone.
  preserve: (p) => !CODE_FILE_RE.test(p),
  unownable: () => false,
  tagLabel: '// @fd:',
};
