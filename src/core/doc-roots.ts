import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface DocRoots {
  features: string;
  roadmap: string;
  backlog: string;
  vision: string;
  ideas: string;
  milestones: string;
  plans: string;
  specs: string;
}

/**
 * Resolve a design-doc subdir renamed `docs/superpowers/<sub>` →
 * `docs/design/<sub>` in 1.0.0 (Q-0006). Prefer the new location; fall back to
 * the legacy path ONLY when the new dir is absent and the legacy dir still
 * exists — i.e. a consumer who bumped the package but has not yet run
 * `noldor upgrade`. When neither exists (fresh repo, or a writer creating the
 * first spec/plan) the new location wins so nothing lands under the old name.
 *
 * TRANSITION ALIAS — delete this fallback in the release after 1.0.0, once
 * every consumer has run the 1.0.0 migration. Tracked by Q-0006.
 */
function resolveDesignSubdir(cwd: string, sub: 'plans' | 'specs'): string {
  const next = join(cwd, 'docs', 'design', sub);
  if (existsSync(next)) return next;
  const legacy = join(cwd, 'docs', 'superpowers', sub);
  if (existsSync(legacy)) return legacy;
  return next;
}

/**
 * Returns absolute paths to the standard noldor doc locations anchored at
 * `cwd`: features/ (feature MDs), roadmap.md, backlog.md, vision.md,
 * ideas.md (repo ROOT, not docs/ — tracked here; consumers may gitignore theirs),
 * milestones/ (milestone MDs), plans/ (design/plans), and
 * specs/ (design/specs). Default is `process.cwd()`. Use as a single
 * source of truth instead of scattering `process.cwd()/docs/...` strings
 * across dashboard, garden, and core modules.
 *
 * `plans`/`specs` route through {@link resolveDesignSubdir} so a not-yet-migrated
 * consumer (docs/superpowers still on disk) keeps resolving during the 1.0.0
 * transition window.
 */
export function loadDocRoots(cwd: string = process.cwd()): DocRoots {
  return {
    features: join(cwd, 'docs', 'features'),
    roadmap: join(cwd, 'docs', 'roadmap.md'),
    backlog: join(cwd, 'docs', 'backlog.md'),
    vision: join(cwd, 'docs', 'vision.md'),
    ideas: join(cwd, 'ideas.md'),
    milestones: join(cwd, 'docs', 'milestones'),
    plans: resolveDesignSubdir(cwd, 'plans'),
    specs: resolveDesignSubdir(cwd, 'specs'),
  };
}
