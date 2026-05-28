import { readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Package-asset resolution: TEMPLATES_ROOT is computed from this module's own
// on-disk location, never from process.cwd(). Works identically whether the
// package is consumed via `workspace:*` (this file lives at
// `packages/noldor/src/templates/manifest.ts`) or installed flat under
// `node_modules/noldor/` (then under the pkg's `dist/` or `src/`). The 2-level
// walk reaches the pkg root, where `templates/` lives.
const here = dirname(fileURLToPath(import.meta.url));
export const TEMPLATES_ROOT = join(here, '..', '..', 'templates');

/** Enumerate every file under TEMPLATES_ROOT, returning paths relative to it. */
export function templateFiles(root: string = TEMPLATES_ROOT): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else out.push(relative(root, full));
    }
  }
  walk(root);
  return out.toSorted();
}
