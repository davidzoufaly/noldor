import { computeDrift, type DriftEntry } from '../templates/diff.js';
import { templateFiles, TEMPLATES_ROOT } from '../templates/manifest.js';

const TEMPLATES_PREFIX = 'templates/';

/** Result of a template-sync check. */
export interface TemplateSyncResult {
  readonly ok: boolean;
  readonly offenders: DriftEntry[]; // status 'drifted' | 'missing'
}

/**
 * Given the files a commit/push touched, verify every templated file among them
 * is byte-identical to its `templates/` copy.
 *
 * A changed path is "templated" if it is `templates/<rel>` (→ `<rel>`) or is
 * itself a member of `templateFiles()`. Non-templated changes are ignored.
 *
 * @param opts.cwd - Consumer root (repo root).
 * @param opts.changedFiles - Repo-relative POSIX paths touched by the commit/push.
 * @param opts.templatesRoot - Template root; defaults to the package `TEMPLATES_ROOT`.
 */
export function checkTemplateSync(opts: {
  cwd: string;
  changedFiles: readonly string[];
  templatesRoot?: string;
}): TemplateSyncResult {
  const root = opts.templatesRoot ?? TEMPLATES_ROOT;
  const known = new Set(templateFiles(root));
  const rels = new Set<string>();
  for (const f of opts.changedFiles) {
    if (f.startsWith(TEMPLATES_PREFIX)) rels.add(f.slice(TEMPLATES_PREFIX.length));
    else if (known.has(f)) rels.add(f);
  }
  const offenders = computeDrift(root, opts.cwd, [...rels]).filter((e) => e.status !== 'unchanged');
  return { ok: offenders.length === 0, offenders };
}
