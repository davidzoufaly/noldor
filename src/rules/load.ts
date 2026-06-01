import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { ZodError } from 'zod';
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

  const rules: Rule[] = [];

  for (const name of readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()) {
    let parsedFm: Rule;
    try {
      const raw = readFileSync(join(dir, name), 'utf8');
      const { data, content } = matter(raw);
      const fm = RuleFrontmatterSchema.parse(data);
      parsedFm = frontmatterToRule(fm, content);
    } catch (err) {
      const message =
        err instanceof ZodError
          ? err.issues.map((i) => i.message).join('; ')
          : err instanceof Error
            ? err.message
            : String(err);
      errors.push(`${name}: ${message}`);
      continue;
    }
    // The filename is the canonical id: `rules resolve`/`list` key off the id, so a
    // drifting `id:` frontmatter produces output that doesn't match the file on disk.
    // Enforcing equality also makes duplicate ids structurally impossible (filenames
    // within a dir are unique), so no separate dup check is needed.
    const expectedId = name.slice(0, -'.md'.length);
    if (parsedFm.id !== expectedId) {
      errors.push(`${name}: id '${parsedFm.id}' must match filename (expected id '${expectedId}')`);
      continue;
    }
    rules.push(parsedFm);
  }

  return { rules, errors };
}
