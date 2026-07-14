import { readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Package-asset resolution: TEMPLATES_ROOT is computed from this module's own
// on-disk location, never from process.cwd(). Works identically whether the
// package is consumed via `workspace:*` (this file lives under the consumer
// monorepo's `packages/<pkg>/src/templates/manifest.ts`) or installed flat under
// `node_modules/noldor/` (then under the pkg's `dist/` or `src/`). The 2-level
// walk reaches the pkg root, where `templates/` lives.
const here = dirname(fileURLToPath(import.meta.url));
export const TEMPLATES_ROOT = join(here, '..', '..', 'templates');

/**
 * Templates that are STARTERS, not synced twins: `init` copies them only when
 * the consumer file is absent, `init --update` never overwrites them, `init
 * --adopt` never snapshots them back (the live file holds consumer-specific
 * values), and template-sync/doctor never report drift on them.
 */
export const SCAFFOLD_ONLY_TEMPLATES: ReadonlySet<string> = new Set([
  '.noldor/config.json',
  // Consumer root lefthook.yml: the extends-shim starter — the consumer owns
  // it and appends project hooks (framework jobs live in lefthook/noldor.yml).
  'lefthook.yml',
  // Formatter config starter: scaffolded hooks invoke `pnpm fmt` / `fmt:check`
  // (oxfmt), which hard-errors without a config file.
  '.oxfmtrc.json',
  // Claude Code hooks starter: wires the `pre-edit-guard` PreToolUse gate (live
  // edit-gating) + the dashboard-ensure SessionStart hook. The consumer owns it
  // and appends their own hooks — template-sync would otherwise clobber those,
  // so this is a scaffold, not a synced twin.
  '.claude/settings.json',
]);

/** Enumerate every file under TEMPLATES_ROOT, returning paths relative to it. */
export function templateFiles(root: string = TEMPLATES_ROOT): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else out.push(relative(root, full));
    }
  }
  walk(root);
  return out.toSorted();
}
