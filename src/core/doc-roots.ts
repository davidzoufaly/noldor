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
 * Returns absolute paths to the standard noldor doc locations anchored at
 * `cwd`: features/ (feature MDs), roadmap.md, backlog.md, vision.md,
 * ideas.md (repo ROOT, not docs/ — tracked here; consumers may gitignore theirs),
 * milestones/ (milestone MDs), plans/ (superpowers/plans), and
 * specs/ (superpowers/specs). Default is `process.cwd()`. Use as a single
 * source of truth instead of scattering `process.cwd()/docs/...` strings
 * across dashboard, garden, and core modules.
 */
export function loadDocRoots(cwd: string = process.cwd()): DocRoots {
  return {
    features: join(cwd, 'docs', 'features'),
    roadmap: join(cwd, 'docs', 'roadmap.md'),
    backlog: join(cwd, 'docs', 'backlog.md'),
    vision: join(cwd, 'docs', 'vision.md'),
    ideas: join(cwd, 'ideas.md'),
    milestones: join(cwd, 'docs', 'milestones'),
    plans: join(cwd, 'docs', 'superpowers', 'plans'),
    specs: join(cwd, 'docs', 'superpowers', 'specs'),
  };
}
