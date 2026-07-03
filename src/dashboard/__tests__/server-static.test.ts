// @tests: framework-doc-extraction
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Verify the dashboard static dir is resolvable from the package itself,
// not from process.cwd(). The dist file ships in the package; serving it
// must not depend on which directory pnpm dashboard was launched from.
describe('dashboard STATIC_ROOT', () => {
  it('drag.js exists relative to dashboard module', () => {
    const dashboardSrc = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const dragJs = resolve(dashboardSrc, 'static', 'dist', 'drag.js');
    expect(existsSync(dragJs)).toBe(true);
  });
});
