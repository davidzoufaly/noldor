import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

/**
 * Rewrite a package.json's `version` field, preserving whitespace and
 * trailing-newline conventions. Pure string operation (no JSON.stringify
 * round-trip) so existing formatting survives the bump.
 *
 * @param raw - Raw package.json file contents
 * @param newVersion - Target semver
 * @returns The rewritten file contents
 */
export function bumpPackageJson(raw: string, newVersion: string): string {
  return raw.replace(/("version"\s*:\s*")([^"]+)(")/, `$1${newVersion}$3`);
}

/**
 * The lockstep set: every package.json that must move together at release.
 * Kept explicit (not auto-discovered) so release touches exactly these files.
 * Adding a new package to the monorepo = add its path here.
 */
const LOCKSTEP_PACKAGES = [
  'package.json',
  'apps/web/package.json',
  'packages/format/package.json',
  'packages/engine/package.json',
  'packages/viewport/package.json',
  'packages/test-fixtures/package.json',
  'packages/examples/package.json',
] as const;

/**
 * Apply {@link bumpPackageJson} to every file in the lockstep set, writing
 * back in place.
 *
 * @param newVersion - Target semver to write
 * @returns Paths that were rewritten (omits files that already match)
 */
export async function bumpAllPackages(newVersion: string): Promise<string[]> {
  const touched: string[] = [];
  for (const path of LOCKSTEP_PACKAGES) {
    const raw = await readFile(path, 'utf8');
    const out = bumpPackageJson(raw, newVersion);
    if (out !== raw) {
      await writeFile(path, out, 'utf8');
      touched.push(path);
    }
  }
  return touched;
}

async function main(): Promise<void> {
  const newVersion = process.env.NEW_VERSION;
  if (!newVersion) {
    console.error('NEW_VERSION env var required.');
    process.exitCode = 1;
    return;
  }
  const touched = await bumpAllPackages(newVersion);
  console.log(`Bumped ${touched.length} package.json file(s) to ${newVersion}.`);
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('release-packages');
if (invokedDirect) {
  void main();
}
