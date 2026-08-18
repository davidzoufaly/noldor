// @fd: feature-md-links-overhaul

import { TEST_FILE_RE } from '../../core/repo-paths.js';
import type { LinkAdapter } from '../projection.js';
import { originTaggedScanRoots } from './code.js';

/** `links.tests`, projected from `// @tests:` tags on test files. */
export const testsAdapter: LinkAdapter = {
  key: 'tests',
  tagRe: /^\/\/\s*@tests:\s*(.+?)\s*$/m,
  // Same roots as code — the two kinds differ only in which files they read,
  // which is what lets `garden detect` classify both from one traversal.
  roots: originTaggedScanRoots,
  eligible: (name) => TEST_FILE_RE.test(name),
  preserve: () => false,
  unownable: () => false,
  tagLabel: '// @tests:',
};
