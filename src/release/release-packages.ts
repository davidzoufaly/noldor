import { readFile, writeFile } from 'node:fs/promises';

import { loadConsumerConfig } from '../core/consumer-config.js';
import { isEntrypoint } from '../core/cli-entry.js';

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
 * Apply {@link bumpPackageJson} to every file in the lockstep set, writing
 * back in place.
 *
 * @param newVersion - Target semver to write
 * @returns Paths that were rewritten (omits files that already match)
 */
export async function bumpAllPackages(newVersion: string): Promise<string[]> {
  const { lockstepPackages } = loadConsumerConfig();
  const touched: string[] = [];
  for (const path of lockstepPackages) {
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

if (isEntrypoint(import.meta.url)) {
  void main();
}
