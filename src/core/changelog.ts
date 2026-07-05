import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/** A single git commit relevant to a Noldor page. */
export interface Commit {
  hash: string;
  subject: string;
  files: string[];
  /**
   * `Noldor-Sibling-Scope` trailer tokens (`noldor` / `noldor:<slug>`),
   * `[]` when the commit carries no such trailer. Optional so hand-built
   * commit lists without the field stay valid; `loadCommits` always fills it.
   */
  siblingScopes?: string[];
}

/** Parsed Conventional Commits subject. */
export interface ParsedScope {
  type: string | null;
  scope: string | null;
  slug: string | null;
}

const SUBJECT_RE = /^(?<type>\w+)(?:\((?<scope>[^)]+)\))?:/;

/**
 * Parse a Conventional Commits subject line into type / scope / slug.
 *
 * - `docs(noldor): ...` → `{type: 'docs', scope: 'noldor', slug: null}`
 * - `feat(noldor:workflow): ...` → `{type: 'feat', scope: 'noldor:workflow', slug: 'workflow'}`
 * - Other scoped commits resolve to `{type, scope, slug: null}`
 *
 * @param subject - Commit subject line
 * @returns Parsed scope record (`type` is null on parse failure)
 */
export function parseScope(subject: string): ParsedScope {
  const match = SUBJECT_RE.exec(subject);
  if (!match) return { type: null, scope: null, slug: null };
  const { type, scope } = match.groups as { type: string; scope?: string };
  if (!scope) return { type, scope: null, slug: null };
  if (scope === 'noldor') return { type, scope, slug: null };
  if (scope.startsWith('noldor:')) return { type, scope, slug: scope.slice('noldor:'.length) };
  return { type, scope, slug: null };
}

/**
 * Filter commits down to those that should appear in a given page's
 * changelog. A commit qualifies when it touched the page file AND any of:
 * - its subject scope is `noldor` (framework-wide)
 * - its subject scope is `noldor:<pageSlug>`
 * - its `Noldor-Sibling-Scope` trailer lists `noldor` or `noldor:<pageSlug>`
 *   (mixed code+doc commits keep their code scope in the subject)
 *
 * @param commits - Candidate commits (typically from `loadCommits`)
 * @param pageSlug - Page slug (`workflow`, `lifecycle`, ..., or `index` for README)
 * @returns Filtered list of commits
 */
export function filterCommitsForPage(commits: Commit[], pageSlug: string): Commit[] {
  const pagePath = pageSlug === 'index' ? 'docs/noldor/README.md' : `docs/noldor/${pageSlug}.md`;
  return commits.filter((c) => {
    if (!c.files.includes(pagePath)) return false;

    const parsed = parseScope(c.subject);
    if (parsed.scope === 'noldor' || parsed.slug === pageSlug) return true;

    const siblings = c.siblingScopes ?? [];
    return siblings.includes('noldor') || siblings.includes(`noldor:${pageSlug}`);
  });
}

/**
 * Load the git history of a single page using `git log --follow`.
 *
 * @param pagePath - Repository-relative path to the page file
 * @returns Commits with hash, subject, and changed file list
 */
export async function loadCommits(pagePath: string): Promise<Commit[]> {
  const { stdout } = await execFileP('git', [
    'log',
    '--follow',
    // %(trailers:key=…) needs git >= 2.22. `unfold` joins indent-folded
    // trailer values onto one line so the tab-split line parse stays safe
    // (an indented continuation is legal per detectDroppedTrailers and would
    // otherwise emit a literal newline into the log line).
    '--format=%H%x09%s%x09%(trailers:key=Noldor-Sibling-Scope,valueonly,separator=%x2C,unfold)',
    '--name-only',
    '--',
    pagePath,
  ]);
  const COMMIT_LINE_RE = /^[0-9a-f]{40}\t/;
  const commits: Commit[] = [];
  let current: Commit | null = null;
  for (const line of stdout.split('\n')) {
    if (COMMIT_LINE_RE.test(line)) {
      if (current) commits.push(current);
      const [hash, subject, siblingRaw] = line.split('\t');
      current = {
        hash,
        subject,
        files: [],
        // Handles all three shapes uniformly: a single trailer value
        // containing ", ", multiple trailer lines joined by the %x2C
        // separator, and the empty third field when the trailer is absent.
        siblingScopes: (siblingRaw ?? '')
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0),
      };
    } else if (line.trim().length > 0 && current) {
      current.files.push(line);
    }
  }
  if (current) commits.push(current);
  return commits;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const pageIdx = args.indexOf('--page');
  const targetSlug = pageIdx >= 0 ? args[pageIdx + 1] : null;

  const slugs = targetSlug ? [targetSlug] : await listPageSlugs();
  for (const slug of slugs) {
    const pagePath = slug === 'index' ? 'docs/noldor/README.md' : `docs/noldor/${slug}.md`;
    const commits = await loadCommits(pagePath);
    const filtered = filterCommitsForPage(commits, slug);
    console.log(`\n## ${slug}\n`);
    if (filtered.length === 0) {
      console.log('_no commits yet_');
      continue;
    }
    for (const c of filtered) {
      console.log(`- ${c.hash.slice(0, 7)} ${c.subject}`);
    }
  }
}

async function listPageSlugs(): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  const files = await readdir('docs/noldor');
  return files
    .filter((f) => f.endsWith('.md'))
    .map((f) => (f === 'README.md' ? 'index' : f.replace(/\.md$/, '')));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
