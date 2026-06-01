import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { RuleFrontmatterSchema, frontmatterToRule, type Rule } from './types.js';

export interface LoadResult {
  rules: Rule[];
  errors: string[];
}

const RULES_SUBDIR = join('.noldor', 'rules');

export function loadRulesFromDir(cwd: string = process.cwd()): LoadResult {
  const dir = join(cwd, RULES_SUBDIR);
  const errors: string[] = [];
  if (!existsSync(dir)) return { rules: [], errors };

  const seen = new Set<string>();
  const rules: Rule[] = [];

  for (const name of readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()) {
    const raw = readFileSync(join(dir, name), 'utf8');
    let parsedFm: Rule;
    try {
      const { data, content } = matter(raw);
      const fm = RuleFrontmatterSchema.parse(data);
      parsedFm = frontmatterToRule(fm, content);
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (seen.has(parsedFm.id)) {
      errors.push(`${name}: duplicate id '${parsedFm.id}'`);
      continue;
    }
    seen.add(parsedFm.id);
    rules.push(parsedFm);
  }

  return { rules, errors };
}
