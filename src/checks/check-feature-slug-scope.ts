// scripts/checks/check-feature-slug-scope.ts
// @tests: feature-md-links-overhaul

import { readFile, readdir } from 'node:fs/promises';
import { basename } from 'node:path';

const SUBJECT_RE = /^(?<type>\w+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?:/;

/** Inputs to {@link validateFeatureSlugScope}. */
export interface ValidateFeatureSlugScopeInput {
  /** Full commit message. Only the first line is parsed. */
  message: string;
  /** Set of valid feature slugs (filenames in `docs/features/`, sans `.md`). */
  knownSlugs: Set<string>;
}

/** Result of feature-slug scope validation. */
export interface ValidateFeatureSlugScopeResult {
  success: boolean;
  error?: string;
}

/**
 * Reject commits whose `<type>(<scope>)` scope contains `:` and resolves to
 * an unknown feature slug. Noldor-prefixed scopes are delegated to the
 * separate `validate-noldor-scope` hook and pass through here.
 */
export function validateFeatureSlugScope(
  input: ValidateFeatureSlugScopeInput,
): ValidateFeatureSlugScopeResult {
  const subject = input.message.split('\n')[0];
  const m = SUBJECT_RE.exec(subject);
  if (!m?.groups) {
    return { success: true };
  }
  const scope = m.groups.scope;
  if (!scope || !scope.includes(':')) {
    return { success: true };
  }
  if (scope.startsWith('noldor')) {
    return { success: true };
  }
  const segments = scope.split(':');
  if (segments.length !== 2) {
    return {
      success: false,
      error: 'Scope `' + scope + '` has more than one `:`. Expected at most one.',
    };
  }
  const slug = segments[1];
  if (!input.knownSlugs.has(slug)) {
    return {
      success: false,
      error:
        'Scope `' +
        scope +
        '` references unknown feature slug `' +
        slug +
        '`. Expected `docs/features/' +
        slug +
        '.md` to exist.',
    };
  }
  return { success: true };
}

export async function loadKnownSlugs(...featuresDirs: string[]): Promise<Set<string>> {
  // Default: scan both Charuy product features and packages/noldor/ framework
  // features (Phase B of framework-doc-extraction split them across two dirs).
  // Phase C eventually retargets each side independently; for now the
  // commit-msg scope check accepts slugs from either tree.
  const dirs =
    featuresDirs.length > 0 ? featuresDirs : ['docs/features', 'packages/noldor/docs/features'];
  const slugs = new Set<string>();
  for (const featuresDir of dirs) {
    let entries;
    try {
      entries = await readdir(featuresDir, { withFileTypes: true });
    } catch {
      continue; // missing dir is OK — single-side setups remain supported
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        slugs.add(entry.name.replace(/\.md$/, ''));
      }
    }
  }
  return slugs;
}

async function main(): Promise<void> {
  const messageFile = process.argv[2];
  if (!messageFile) {
    console.error('Commit message file path required.');
    process.exitCode = 1;
    return;
  }
  const message = await readFile(messageFile, 'utf8');
  const knownSlugs = await loadKnownSlugs();
  const result = validateFeatureSlugScope({ message, knownSlugs });
  if (!result.success) {
    console.error(result.error);
    process.exitCode = 1;
  }
}

const invokedDirect =
  process.argv[1] && basename(process.argv[1]).startsWith('check-feature-slug-scope');
if (invokedDirect) {
  void main();
}
