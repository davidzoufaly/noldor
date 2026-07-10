import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { TEMPLATES_ROOT, templateFiles } from '../templates/manifest.js';
import { copyTemplate } from '../templates/copy.js';
import type { Migration, MigrationStep } from './types.js';

// Intentionally independent of `prefix-skills-codemod.ts`'s NAMES: that codemod is
// a one-shot dev tool (may be deleted after this rename lands), whereas this
// migration ships forever — coupling a permanent migration to a throwaway module's
// export would be worse than duplicating a fixed 9-item list.
const OLD_SKILL_DIRS = [
  'gate',
  'garden',
  'triage',
  'promote',
  'milestone',
  'new-feature',
  'draft-feature-md',
  'refactor',
  'release-sweep',
];

/** Template files under a given repo-relative dir prefix. */
function templatesUnder(prefix: string): string[] {
  return templateFiles().filter((p) => p.startsWith(prefix));
}

/**
 * Record adds/updates for `rel` against the consumer. When `apply`, copy from
 * templates (update:true — a framework twin the consumer never edits); otherwise
 * classify by byte-compare without writing. Unchanged files are omitted.
 */
function syncFiles(cwd: string, rel: string[], apply: boolean, steps: MigrationStep[]): void {
  if (apply) {
    for (const e of copyTemplate(TEMPLATES_ROOT, cwd, rel, { update: true })) {
      if (e.status === 'unchanged') continue;
      steps.push({
        path: e.path,
        before: e.status === 'added' ? '' : '(prior)',
        after: '(template)',
      });
    }
  } else {
    for (const p of rel) {
      const dest = join(cwd, p);
      if (!existsSync(dest)) steps.push({ path: p, before: '', after: '(template)' });
      else if (!readFileSync(join(TEMPLATES_ROOT, p)).equals(readFileSync(dest)))
        steps.push({ path: p, before: '(prior)', after: '(template)' });
    }
  }
}

/**
 * True iff the consumer's old `.claude/skills/<name>` is noldor's vendored twin:
 * a `SKILL.md` whose frontmatter `name:` is the bare skill name (noldor's
 * pre-rename convention). Guards against silently deleting a consumer-authored
 * homonymous or hand-customized skill that happens to sit at the same path — the
 * very collision this FD exists to surface (B3).
 */
function isNoldorVendoredSkill(cwd: string, name: string): boolean {
  const md = join(cwd, '.claude/skills', name, 'SKILL.md');
  if (!existsSync(md)) return false;
  return new RegExp(`^name: ${name}$`, 'm').test(readFileSync(md, 'utf8'));
}

/**
 * True-rename semantics: for EACH of the 9 skills the consumer ACTUALLY vendored,
 * install its `noldor-` counterpart from templates and remove the old — for BOTH
 * runner surfaces: the Claude skill dir `.claude/skills/<name>/` (guarded by
 * isNoldorVendoredSkill) and the opencode command shim `.opencode/command/<name>.md`
 * (only some skills have one, e.g. `gate`; scoped by template-counterpart presence).
 * A consumer that never had a surface for a skill — e.g. a codex-only repo, or an
 * opencode repo without a given command — gets nothing for it: no old => no new, so
 * agent/subset scoping is respected without reading config. docs/noldor twins
 * (agent-agnostic framework docs) are refreshed unconditionally so vendored pages
 * stop instructing bare `/gate`; unchanged pages sha-match and are skipped.
 */
function computeSteps(cwd: string, apply: boolean): MigrationStep[] {
  const steps: MigrationStep[] = [];
  for (const name of OLD_SKILL_DIRS) {
    // Claude skill dir — guarded rename.
    const oldDir = join(cwd, '.claude/skills', name);
    if (existsSync(oldDir)) {
      if (isNoldorVendoredSkill(cwd, name)) {
        syncFiles(cwd, templatesUnder(`.claude/skills/noldor-${name}/`), apply, steps);
        steps.push({ path: `.claude/skills/${name}/`, before: '(dir)', after: '' });
        if (apply) rmSync(oldDir, { recursive: true, force: true });
      } else {
        // Consumer-owned homonym: leave untouched, surface in the report.
        steps.push({
          path: `.claude/skills/${name}/`,
          before: '(consumer-owned, left as-is)',
          after: '(consumer-owned, left as-is)',
        });
      }
    }
    // Opencode command shim — scoped by whether a template counterpart exists.
    const oldCmd = join(cwd, '.opencode/command', `${name}.md`);
    const tplCmd = templatesUnder(`.opencode/command/noldor-${name}.md`);
    if (existsSync(oldCmd) && tplCmd.length > 0) {
      syncFiles(cwd, tplCmd, apply, steps);
      steps.push({ path: `.opencode/command/${name}.md`, before: '(file)', after: '' });
      if (apply) rmSync(oldCmd, { force: true });
    }
  }
  syncFiles(cwd, templatesUnder('docs/noldor/'), apply, steps);
  return steps;
}

/** Rename each vendored framework skill to `noldor-*` in a consumer tree. */
export const migration_0_6_0: Migration = {
  from: '0.5.0',
  to: '0.6.0',
  description:
    'rename vendored framework skills to noldor-* (per-skill install prefixed + remove old, only for skills the consumer had) + refresh docs/noldor twins',
  dryRun: (cwd) => computeSteps(cwd, false),
  migrate: (cwd) => computeSteps(cwd, true),
};
