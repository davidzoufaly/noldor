import { execFileSync } from 'node:child_process';
import { loadAgentsConfig } from '../core/agent-runner/registry.js';
import { filterTemplatesByAgents } from '../templates/agent-filter.js';
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
 * itself a member of `templateFiles()`. Non-templated changes are ignored, as
 * are template subtrees outside the consumer's `agents.targets` (a claude-only
 * consumer carries no `.opencode/` / `AGENTS.md` twins — same filter as doctor).
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
  const targeted = new Set(
    filterTemplatesByAgents(templateFiles(root), loadAgentsConfig(opts.cwd).targets),
  );
  const rels = new Set<string>();
  for (const f of opts.changedFiles) {
    if (f.startsWith(TEMPLATES_PREFIX)) {
      const rel = f.slice(TEMPLATES_PREFIX.length);
      if (targeted.has(rel)) rels.add(rel);
    } else if (targeted.has(f)) {
      rels.add(f);
    }
  }
  const offenders = computeDrift(root, opts.cwd, [...rels]).filter((e) => e.status !== 'unchanged');
  return { ok: offenders.length === 0, offenders };
}

/**
 * Resolve the changed-file list for the current hook context.
 * - pre-commit: lefthook passes `{staged_files}` as argv → use them verbatim.
 * - pre-push: no argv → diff the range being pushed (`@{upstream}..HEAD`,
 *   falling back to `origin/main..HEAD` when no upstream is configured).
 */
function resolveChangedFiles(args: readonly string[]): string[] {
  if (args.length > 0) return [...args];
  let range = 'origin/main..HEAD';
  try {
    execFileSync('git', ['rev-parse', '--abbrev-ref', '@{upstream}'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    range = '@{upstream}..HEAD';
  } catch {
    // no upstream — keep origin/main fallback
  }
  try {
    return execFileSync('git', ['diff', '--name-only', range], { encoding: 'utf-8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Driver: resolve changed files, check template sync, exit 0 (OK) or 1 (drift).
 *
 * @returns Exit code — `0` may proceed, `1` is blocked.
 */
export function main(): number {
  const changedFiles = resolveChangedFiles(process.argv.slice(2));
  const { ok, offenders } = checkTemplateSync({ cwd: process.cwd(), changedFiles });
  if (ok) {
    process.stdout.write('template-sync OK\n');
    return 0;
  }
  process.stderr.write('template-sync: templated file(s) out of sync with templates/:\n');
  for (const o of offenders) {
    const hint =
      o.status === 'missing'
        ? `consumer copy absent — run 'noldor init --update'`
        : `differs from templates/${o.path} — edit the template too, or run 'noldor init --update'`;
    process.stderr.write(`  ${o.path} (${o.status}): ${hint}\n`);
  }
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
