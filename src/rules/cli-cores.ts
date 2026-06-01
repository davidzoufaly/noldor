import { getRules } from './index-cache.js';
import { loadRulesFromDir } from './load.js';
import { resolveRules, type ResolveQuery, type ResolveResult } from './resolve.js';
import type { Rule } from './types.js';

export function runResolve(cwd: string, query: ResolveQuery): ResolveResult {
  return resolveRules(getRules(cwd), query);
}

export function runList(cwd: string): Rule[] {
  return getRules(cwd);
}

export interface ValidateResult {
  ok: boolean;
  errors: string[];
  count: number;
}

export function runValidate(cwd: string): ValidateResult {
  const { rules, errors } = loadRulesFromDir(cwd);
  return { ok: errors.length === 0, errors, count: rules.length };
}
