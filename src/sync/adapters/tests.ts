// @fd: feature-md-links-overhaul

import { TEST_FILE_RE } from '../../core/repo-paths.js';
import type { LinkAdapter } from '../projection.js';
import { sourceTreeAdapter } from './code.js';

/**
 * `links.tests`, projected from `// @tests:` tags on test files. Shares the code
 * kind's roots — the two differ only in which files they read, which is what
 * lets `garden detect` classify both from one traversal.
 */
export const testsAdapter: LinkAdapter = sourceTreeAdapter({
  key: 'tests',
  tagRe: /^\/\/\s*@tests:\s*(.+?)\s*$/m,
  eligible: (name) => TEST_FILE_RE.test(name),
  tagLabel: '// @tests:',
});
