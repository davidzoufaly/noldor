import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRulesFromDir } from './load.js';
import type { Rule } from './types.js';

export const INDEX_FILE = join('.noldor', '.rules-index.json');
const RULES_DIR = join('.noldor', 'rules');

interface CachedIndex {
  stamp: number; // max mtimeMs across rules dir + files
  rules: Rule[];
}

function dirStamp(cwd: string): number {
  const dir = join(cwd, RULES_DIR);
  if (!existsSync(dir)) return 0;
  let max = statSync(dir).mtimeMs;
  for (const name of readdirSync(dir)) {
    const m = statSync(join(dir, name)).mtimeMs;
    if (m > max) max = m;
  }
  return max;
}

export function getRules(cwd: string = process.cwd()): Rule[] {
  const stamp = dirStamp(cwd);
  const cachePath = join(cwd, INDEX_FILE);
  if (existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as CachedIndex;
      if (cached.stamp === stamp) return cached.rules;
    } catch {
      // fall through to rebuild
    }
  }
  const { rules } = loadRulesFromDir(cwd);
  const payload: CachedIndex = { stamp, rules };
  if (existsSync(join(cwd, '.noldor'))) {
    writeFileSync(cachePath, JSON.stringify(payload), 'utf8');
  }
  return rules;
}
