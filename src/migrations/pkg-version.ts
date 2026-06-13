import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMPLATES_ROOT } from '../templates/manifest.js';

/**
 * The framework package's own version, read from its `package.json`.
 * `TEMPLATES_ROOT` resolves to `<pkg-root>/templates` from this module's
 * on-disk location (see src/templates/manifest.ts), so its parent is the
 * package root where `package.json` lives — works under `workspace:*` and a
 * flat `node_modules/noldor/` install alike.
 */
export function installedFrameworkVersion(): string {
  const pkgPath = join(TEMPLATES_ROOT, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
  if (!pkg.version) throw new Error(`framework package.json at ${pkgPath} has no version`);
  return pkg.version;
}
