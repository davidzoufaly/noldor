// @fd: memory-intake-lessons-learned-pipeline

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { atomicWriteFileSync } from '../core/atomic-write.js';
import { isEntrypoint } from '../core/cli-entry.js';
import { loadDocRoots } from '../core/doc-roots.js';
import { acquirePidLock, releasePidLock } from '../core/pid-lock.js';

const LABEL = 'retro';
const USAGE =
  'usage: noldor triage retro --slug <slug> --pr <n> --file <notes> | --none\n' +
  '  <notes> holds one "lesson: <text>" or "followup: <text>" per line\n';
const LESSONS = 'Lessons';
const FOLLOWUPS = 'Not groomed';
const LOCK_FILE = 'noldor-ideas.lock';
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PR_RE = /^[1-9]\d*$/;
const NOTE_KINDS = [
  ['lesson:', 'lessons'],
  ['followup:', 'followups'],
] as const;

type Parsed<T> = { success: true; data: T } | { success: false; errors: string[] };

/** A validated `noldor triage retro` invocation. */
type RetroArgs = { slug: string; pr: string } & ({ none: true } | { none: false; file: string });

/** The notes a retro writes, one entry per bullet. */
interface Notes {
  lessons: string[];
  followups: string[];
}

function parseRetroArgs(argv: readonly string[]): Parsed<RetroArgs> {
  const values = new Map<string, string>();
  let none = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (flag === '--none') {
      none = true;
      continue;
    }
    if (!['--slug', '--pr', '--file'].includes(flag)) {
      return { success: false, errors: [`unknown argument ${flag}`] };
    }
    const value = argv[++i];
    if (value === undefined) return { success: false, errors: [`${flag} requires a value`] };
    values.set(flag, value);
  }
  const slug = values.get('--slug') ?? '';
  const pr = values.get('--pr') ?? '';
  const file = values.get('--file');
  const errors = [
    ...(SLUG_RE.test(slug) ? [] : ['--slug must be a kebab-case slug']),
    ...(PR_RE.test(pr) ? [] : ['--pr must be a positive integer']),
    ...(none && file !== undefined ? ['--none cannot be combined with --file'] : []),
    ...(!none && file === undefined ? ['pass --file <notes>, or --none'] : []),
  ];
  if (errors.length > 0) return { success: false, errors };
  return {
    success: true,
    data: file === undefined ? { slug, pr, none: true } : { slug, pr, none: false, file },
  };
}

/**
 * Read the notes file: one `lesson: <text>` or `followup: <text>` per line, blank
 * lines skipped. Notes come from a file, never from argv: where `pnpm noldor` is a
 * package script, pnpm hands argv to `sh` inside double quotes, which runs any
 * backtick or `$(...)` a note quotes. A note that would read as a heading is
 * refused, so it cannot break the section structure.
 */
function readNotes(path: string): Parsed<Notes> {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { success: false, errors: [`cannot read --file ${path}: ${reason}`] };
  }
  const notes: Notes = { lessons: [], followups: [] };
  const errors: string[] = [];
  for (const [i, line] of raw.split('\n').entries()) {
    const text = line.trim();
    if (text === '') continue;
    const kind = NOTE_KINDS.find(([prefix]) => text.startsWith(prefix));
    if (kind === undefined) {
      errors.push(`line ${i + 1}: start it with "lesson:" or "followup:"`);
      continue;
    }
    const note = oneLine(text.slice(kind[0].length));
    if (note === '') errors.push(`line ${i + 1}: the note is empty`);
    else if (note.startsWith('#')) errors.push(`line ${i + 1}: a note cannot start with #`);
    else notes[kind[1]].push(note);
  }
  if (errors.length === 0 && notes.lessons.length + notes.followups.length === 0) {
    errors.push(`${path} holds no notes; pass --none instead`);
  }
  return errors.length > 0 ? { success: false, errors } : { success: true, data: notes };
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Git's common dir, whose parent is the checkout every worktree shares. A drain
 * child runs in `.worktrees/<slug>/`, and an `ideas.md` written there is deleted
 * with the worktree, so the retro always targets that parent.
 */
function gitCommonDir(cwd: string): Parsed<string> {
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
  const text = line.trimStart();
  return text.startsWith('# ') || text.startsWith('## ');
}

function headingIndex(lines: readonly string[], name: string): number {
  return lines.findIndex((l) => l.trim() === `## ${name}`);
}

function ensureSection(lines: string[], name: string): void {
  if (headingIndex(lines, name) !== -1) return;
  const verticals = headingIndex(lines, 'Verticals');
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
  const heading = headingIndex(lines, name);
  let end = heading + 1;
  while (end < lines.length && !isH1orH2(lines[end]!)) end++;
  const section = lines.slice(heading + 1, end);
  const fresh = [...new Map(bullets.map((b) => [b.key, b])).values()].filter(
    (b) => !section.some((l) => l.startsWith(b.key)),
  );
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
  notes: Notes,
  today: string,
): { content: string; lessons: number; followups: number } {
  const lines = content === '' ? [] : content.replace(/\n$/, '').split('\n');
  const bullet = (text: string) => {
    const key = `- ${text} (${args.slug}, PR #${args.pr}, `;
    return { key, line: `${key}${today})` };
  };
  if (content === '' || notes.followups.length > 0) ensureSection(lines, FOLLOWUPS);
  if (content === '' || notes.lessons.length > 0) ensureSection(lines, LESSONS);
  const followups = appendToSection(lines, FOLLOWUPS, notes.followups.map(bullet));
  const lessons = appendToSection(lines, LESSONS, notes.lessons.map(bullet));
  return { content: `${lines.join('\n')}\n`, lessons, followups };
}

/** Injectable context for tests: the directory the command runs in and today's date. */
export interface RetroContext {
  cwd?: string;
  today?: string;
}

/**
 * CLI entrypoint for `noldor triage retro`. Reads the session's lessons and
 * follow-ups from `--file` and writes them into the main checkout's `ideas.md`
 * under a cross-worktree lock; never stages or commits. Exit 0 written or nothing
 * to write, 2 usage (including a malformed notes file), 1 I/O or lock.
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
  const notes = readNotes(resolve(cwd, args.file));
  if (!notes.success) {
    process.stderr.write(`${LABEL}: ${notes.errors.join('; ')}\n${USAGE}`);
    return 2;
  }
  const today = ctx.today ?? new Date().toISOString().slice(0, 10);
  const common = gitCommonDir(cwd);
  if (!common.success) {
    process.stderr.write(`${LABEL}: not inside a git repository (${common.errors.join('; ')})\n`);
    return 1;
  }
  const target = loadDocRoots(dirname(common.data)).ideas;
  const lockPath = join(common.data, LOCK_FILE);
  const self = { pid: process.pid, startedAt: new Date().toISOString() };
  const lock = await acquirePidLock(lockPath, self, { timeoutMs: 5_000, pollMs: 50 });
  if (lock.kind === 'timed-out' || lock.kind === 'failed') {
    const why = lock.kind === 'failed' ? lock.reason : `held by pid ${lock.holder?.pid ?? '?'}`;
    process.stderr.write(`${LABEL}: could not lock ${lockPath} (${why}); re-run once\n`);
    return 1;
  }
  try {
    const before = existsSync(target) ? readFileSync(target, 'utf8') : '';
    const after = applyRetro(before, args, notes.data, today);
    if (after.content !== before) atomicWriteFileSync(target, after.content);
    process.stdout.write(
      `${LABEL}: ${after.lessons} lessons, ${after.followups} follow-ups → ${target}\n`,
    );
    return 0;
  } catch (err) {
    process.stderr.write(`${LABEL}: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  } finally {
    if (lock.kind === 'acquired') releasePidLock(lockPath, self);
  }
}

if (isEntrypoint(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
