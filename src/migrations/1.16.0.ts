// @fd: dead-code-detection-with-knip
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Migration, MigrationStep } from './types.js';

const CONFIG = '.noldor/config.json';

/**
 * Appends the key as text before the closing brace rather than re-serialising, so
 * the consumer's key order and formatting survive and the diff is one block.
 */
function computeSteps(cwd: string, apply: boolean): MigrationStep[] {
  const path = join(cwd, CONFIG);
  if (!existsSync(path)) return [];
  const before = readFileSync(path, 'utf8');
  let cfg: unknown;
  try {
    cfg = JSON.parse(before);
  } catch {
    return []; // unparseable config — leave it; `doctor` and every loader report it loudly
  }
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg) || 'deadCode' in cfg) {
    return [];
  }
  const indent = /^([ \t]+)"/m.exec(before)?.[1] ?? '  ';
  const close = before.lastIndexOf('}');
  const separator = Object.keys(cfg).length === 0 ? '' : ',';
  const after =
    `${before.slice(0, close).trimEnd()}${separator}\n` +
    `${indent}"deadCode": {\n${indent}${indent}"enabled": false\n${indent}}\n` +
    before.slice(close);
  if (apply) writeFileSync(path, after);
  return [{ path: CONFIG, before, after }];
}

/** Adds the dead-code opt-in switch, off, so every consumer can see it (ADR 0011). */
export const migration_1_16_0: Migration = {
  from: '1.13.0',
  to: '1.16.0',
  description:
    'add "deadCode": { "enabled": false } to .noldor/config.json. To turn the dead-code check on: install knip, write a knip config, run `pnpm noldor dead-code baseline`, commit .noldor/dead-code-baseline.json, then set enabled to true',
  dryRun: (cwd) => computeSteps(cwd, false),
  migrate: (cwd) => computeSteps(cwd, true),
};
