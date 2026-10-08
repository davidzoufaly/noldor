// @fd: memory-intake-lessons-learned-pipeline

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { atomicWriteFileSync } from '../core/atomic-write.js';
import { isEntrypoint } from '../core/cli-entry.js';
import { loadDocRoots } from '../core/doc-roots.js';
import { acquireSuiteLock, releaseSuiteLock } from '../testing/suite-lock.js';

const LABEL = 'retro';
const USAGE =
  'usage: noldor triage retro --slug <slug> --pr <n> [--lesson <text>]... [--followup <text>]... | --none\n';
const LESSONS = 'Lessons';
const FOLLOWUPS = 'Not groomed';
const LOCK_FILE = 'noldor-ideas.lock';
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PR_RE = /^[1-9]\d*$/;

/** A validated `noldor triage retro` invocation. */
interface RetroArgs {
  slug: string;
  pr: string;
  lessons: string[];
  followups: string[];
  none: boolean;
}

type Parsed = { success: true; data: RetroArgs } | { success: false; errors: string[] };

/**
 * Read and validate the retro flags. Note text is collapsed to one line, so a
 * pasted multi-line note cannot break the section structure; a note that is
 * empty after that, or that would read as a heading, is refused.
 */
function parseRetroArgs(argv: readonly string[]): Parsed {
  const values = new Map<string, string>();
  const lessons: string[] = [];
  const followups: string[] = [];
  let none = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (flag === '--none') {
      none = true;
      continue;
    }
    if (!['--slug', '--pr', '--lesson', '--followup'].includes(flag)) {
      return { success: false, errors: [`unknown argument ${flag}`] };
    }
    const value = argv[++i];
    if (value === undefined) return { success: false, errors: [`${flag} requires a value`] };
    if (flag === '--lesson') lessons.push(oneLine(value));
    else if (flag === '--followup') followups.push(oneLine(value));
    else values.set(flag, value);
  }
  const slug = values.get('--slug') ?? '';
  const pr = values.get('--pr') ?? '';
  const notes = [...lessons, ...followups];
  const errors = [
    ...(SLUG_RE.test(slug) ? [] : ['--slug must be a kebab-case slug']),
    ...(PR_RE.test(pr) ? [] : ['--pr must be a positive integer']),
    ...(none && notes.length > 0 ? ['--none cannot be combined with --lesson/--followup'] : []),
    ...(!none && notes.length === 0 ? ['pass at least one --lesson/--followup, or --none'] : []),
    ...(notes.some((n) => n === '') ? ['a note is empty'] : []),
    ...(notes.some((n) => n.startsWith('#')) ? ['a note cannot start with #'] : []),
  ];
  return errors.length > 0
    ? { success: false, errors }
    : { success: true, data: { slug, pr, lessons, followups, none } };
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Git's common dir, whose parent is the checkout every worktree shares. A drain
 * child runs in `.worktrees/<slug>/`, and an `ideas.md` written there is deleted
 * with the worktree, so the retro always targets that parent.
 */
function gitCommonDir(
  cwd: string,
): { success: true; data: string } | { success: false; errors: string[] } {
  try {
    const dir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { success: true, data: dir.trim() };
  } catch (err) {
    return { success: false, errors: [err instanceof Error ? err.message : String(err)] };
  }
}

function isH1orH2(line: string): boolean {
  return line.startsWith('# ') || line.startsWith('## ');
}

function ensureSection(lines: string[], name: string): void {
  if (lines.includes(`## ${name}`)) return;
  const verticals = lines.indexOf('## Verticals');
  if (verticals !== -1) {
    lines.splice(verticals, 0, `## ${name}`, '');
    return;
  }
  while (lines.length > 0 && lines.at(-1) === '') lines.pop();
  if (lines.length > 0) lines.push('');
  lines.push(`## ${name}`, '');
}

/** Append bullets after the section's last non-blank line; returns how many were new. */
function appendToSection(
  lines: string[],
  name: string,
  bullets: { key: string; line: string }[],
): number {
  const heading = lines.indexOf(`## ${name}`);
  let end = heading + 1;
  while (end < lines.length && !isH1orH2(lines[end]!)) end++;
  const section = lines.slice(heading + 1, end);
  const fresh = bullets.filter((b) => !section.some((l) => l.startsWith(b.key)));
  if (fresh.length === 0) return 0;
  let last = end - 1;
  while (last > heading && lines[last]!.trim() === '') last--;
  const block = fresh.map((b) => b.line);
  if (last === heading) block.unshift('');
  if (end === last + 1 && end < lines.length) block.push('');
  lines.splice(last + 1, 0, ...block);
  return fresh.length;
}

/**
 * Add the retro's bullets to an `ideas.md` body, scaffolding any missing
 * section. The dedup key is note + slug + PR without the date, so a re-run on a
 * later day skips while the same lesson from another PR is kept.
 */
function applyRetro(
  content: string,
  args: RetroArgs,
  today: string,
): { content: string; lessons: number; followups: number } {
  const lines = content === '' ? [] : content.replace(/\n$/, '').split('\n');
  const bullet = (text: string) => {
    const key = `- ${text} (${args.slug}, PR #${args.pr}, `;
    return { key, line: `${key}${today})` };
  };
  if (content === '' || args.followups.length > 0) ensureSection(lines, FOLLOWUPS);
  if (content === '' || args.lessons.length > 0) ensureSection(lines, LESSONS);
  const followups = appendToSection(lines, FOLLOWUPS, args.followups.map(bullet));
  const lessons = appendToSection(lines, LESSONS, args.lessons.map(bullet));
  return { content: `${lines.join('\n')}\n`, lessons, followups };
}

/** Injectable context for tests: the directory the command runs in and today's date. */
export interface RetroContext {
  cwd?: string;
  today?: string;
}

/**
 * CLI entrypoint for `noldor triage retro`. Writes the session's lessons and
 * follow-ups into the main checkout's `ideas.md` under a cross-worktree lock and
 * never stages or commits. Exit 0 written or nothing to write, 2 usage, 1 I/O.
 */
export async function main(argv: readonly string[], ctx: RetroContext = {}): Promise<number> {
  const parsed = parseRetroArgs(argv);
  if (!parsed.success) {
    process.stderr.write(`${LABEL}: ${parsed.errors.join('; ')}\n${USAGE}`);
    return 2;
  }
  const args = parsed.data;
  if (args.none) {
    process.stdout.write(`${LABEL}: nothing to capture\n`);
    return 0;
  }
  const cwd = ctx.cwd ?? process.cwd();
  const today = ctx.today ?? new Date().toISOString().slice(0, 10);
  const common = gitCommonDir(cwd);
  if (!common.success) {
    process.stderr.write(`${LABEL}: not inside a git repository (${common.errors.join('; ')})\n`);
    return 1;
  }
  const target = loadDocRoots(dirname(common.data)).ideas;
  const lockPath = join(common.data, LOCK_FILE);
  const self = { pid: process.pid, startedAt: new Date().toISOString() };
  const lock = await acquireSuiteLock(lockPath, self, { timeoutMs: 5_000, pollMs: 50 });
  if (lock.kind === 'timed-out' || lock.kind === 'failed') {
    const why = lock.kind === 'failed' ? lock.reason : `held by pid ${lock.holder?.pid ?? '?'}`;
    process.stderr.write(`${LABEL}: could not lock ${lockPath} (${why}); re-run once\n`);
    return 1;
  }
  try {
    const before = existsSync(target) ? readFileSync(target, 'utf8') : '';
    const after = applyRetro(before, args, today);
    if (after.content !== before) atomicWriteFileSync(target, after.content);
    process.stdout.write(
      `${LABEL}: ${after.lessons} lessons, ${after.followups} follow-ups → ${target}\n`,
    );
    return 0;
  } catch (err) {
    process.stderr.write(`${LABEL}: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  } finally {
    if (lock.kind === 'acquired') releaseSuiteLock(lockPath, self);
  }
}

if (isEntrypoint(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
