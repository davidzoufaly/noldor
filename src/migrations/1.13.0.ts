// @fd: scaffold-one-agent-rules-file-not-two
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROJECT_CLAUDE_FILES,
  RULES_FILE,
  agentsMdWiring,
  importLines,
  readClaudeFiles,
  rulesImportFor,
  type ClaudeFileViews,
} from '../checks/check-agents-md-wiring.js';
import { loadAgentsConfig } from '../core/agent-runner/registry.js';
import { planRegionSync } from '../templates/managed-region.js';
import { TEMPLATES_ROOT } from '../templates/manifest.js';
import type { Migration, MigrationStep } from './types.js';

const NOLDOR_MD = '.claude/noldor.md';

/** sha256 of each `.claude/noldor.md` noldor shipped. Only an untouched copy is removed. */
const SHIPPED_NOLDOR_MD: ReadonlySet<string> = new Set([
  'e82257d331bda359dcf8ec380f8ac963e05810690511aedd235ec4f7cc19f6e1',
  'ab23391280b56727bc741d75d200fb609605b2ece6c34430db98375460b3ee86',
]);

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Each import of the removed `.claude/noldor.md` becomes the file's `AGENTS.md`
 * import while no project CLAUDE file has one, and is dropped after that — so at
 * most one import is written, and no import the consumer already had is removed.
 */
function repointNoldorImports(views: ClaudeFileViews): ClaudeFileViews {
  let imported = agentsMdWiring(views) === 'wired';
  const next: ClaudeFileViews = { ...views };
  for (const file of PROJECT_CLAUDE_FILES) {
    const view = views[file];
    if (view === undefined || view.linksToRulesFile) continue;
    const hits = new Set(importLines(file, view.content, NOLDOR_MD));
    if (hits.size === 0) continue;
    const lines = view.content.split('\n').flatMap((line, i) => {
      if (!hits.has(i)) return [line];
      if (imported) return [];
      imported = true;
      return [rulesImportFor(file)];
    });
    next[file] = { ...view, content: lines.join('\n') };
  }
  return next;
}

/** Prepend the `AGENTS.md` import to the root CLAUDE file (else `.claude/CLAUDE.md`) when unwired. */
function addRulesImport(views: ClaudeFileViews): ClaudeFileViews {
  if (agentsMdWiring(views) !== 'unwired') return views;
  for (const file of PROJECT_CLAUDE_FILES) {
    const view = views[file];
    if (view === undefined) continue;
    return { ...views, [file]: { ...view, content: `${rulesImportFor(file)}\n\n${view.content}` } };
  }
  return views;
}

/** The `AGENTS.md` change the template calls for, or `null` when the region is current. */
function rulesFileStep(cwd: string): MigrationStep | null {
  const template = readFileSync(join(TEMPLATES_ROOT, RULES_FILE), 'utf8');
  const path = join(cwd, RULES_FILE);
  if (!existsSync(path)) return { path: RULES_FILE, before: '', after: template };
  const before = readFileSync(path, 'utf8');
  const sync = planRegionSync(before, template, RULES_FILE);
  if (sync.kind === 'malformed') {
    throw new Error(
      `${RULES_FILE}: noldor:rules markers: ${sync.reason} — repair them by hand, then re-run 'noldor upgrade'`,
    );
  }
  return sync.kind === 'unchanged' ? null : { path: RULES_FILE, before, after: sync.content };
}

/**
 * The steps depend on each other — step 2 acts only on a file step 1 removed,
 * step 3 must see step 2's rewrite — so every step is computed on an in-memory
 * view first and written only at the end. That is what makes `--dry-run` list
 * exactly what a real run does.
 */
function computeSteps(cwd: string, apply: boolean): MigrationStep[] {
  const steps: MigrationStep[] = [];

  const noldorMdPath = join(cwd, NOLDOR_MD);
  let removed = false;
  if (existsSync(noldorMdPath)) {
    const content = readFileSync(noldorMdPath);
    removed = SHIPPED_NOLDOR_MD.has(sha256(content));
    steps.push(
      removed
        ? { path: NOLDOR_MD, before: content.toString('utf8'), after: '' }
        : {
            path: NOLDOR_MD,
            before: '(consumer-modified, left as-is)',
            after: '(consumer-modified, left as-is)',
          },
    );
  }

  const before = readClaudeFiles(cwd);
  let views = before;
  if (loadAgentsConfig(cwd).targets.includes('claude')) {
    if (removed) views = repointNoldorImports(views);
    views = addRulesImport(views);
  }
  const claudeSteps = PROJECT_CLAUDE_FILES.flatMap((file) => {
    const was = before[file]?.content;
    const now = views[file]?.content;
    return was !== undefined && now !== undefined && was !== now
      ? [{ path: file, before: was, after: now }]
      : [];
  });
  steps.push(...claudeSteps);

  const rules = rulesFileStep(cwd);
  if (rules !== null) steps.push(rules);

  if (apply) {
    if (removed) rmSync(noldorMdPath);
    for (const step of claudeSteps) writeFileSync(join(cwd, step.path), step.after);
    if (rules !== null) writeFileSync(join(cwd, RULES_FILE), rules.after);
  }
  return steps;
}

/**
 * Move a consumer onto `AGENTS.md` as its one rules file: remove the vendored
 * `.claude/noldor.md` (no runtime ever loaded it), point a CLAUDE file at
 * `AGENTS.md` so Claude Code still reads it, and bring `AGENTS.md`'s framework
 * region current. `from` is `1.0.0`, the last registered `to`, so every anchor
 * from `1.0.0` up resolves (see `resolveChain`).
 */
export const migration_1_13_0: Migration = {
  from: '1.0.0',
  to: '1.13.0',
  description:
    'make AGENTS.md the one rules file: remove the vendored .claude/noldor.md, import AGENTS.md from a CLAUDE.md, sync the noldor:rules region',
  dryRun: (cwd) => computeSteps(cwd, false),
  migrate: (cwd) => computeSteps(cwd, true),
};
