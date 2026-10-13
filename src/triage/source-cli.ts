// @fd: gate-flow-rework
// `noldor triage source <slug> [--json]` — print the raw `ideas.md` bullet a roadmap
// entry was triaged from, and say which of its backticked names the tree still holds.
//
// A promoted block paraphrases its bullet, and the paraphrase can be wrong: a block
// stated the reverse of its bullet, another named an "info panel" no component is
// called. Sessions that built from the block built the wrong thing, so the gate reads
// the bullet before building and checks the names it cites against the code.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { isEntrypoint } from '../core/cli-entry.js';
import { loadDocRoots } from '../core/doc-roots.js';
import { gitCommonDir } from './retro-cli.js';

const LABEL = 'triage source';
const USAGE = 'usage: noldor triage source <slug> [--json]\n';
const MARKER_RE = /\[triaged\s+(\d{4}-\d{2}-\d{2})\s+→([^\]]*)\]/g;
const BACKTICK_RE = /`([^`\n]+)`/g;
// The queue documents and the idea file quote the bullet's names themselves, so a hit
// there proves nothing about the code.
const GREP_EXCLUDES = [':!ideas.md', ':!docs/roadmap.md', ':!docs/backlog.md'];

/** One `ideas.md` bullet whose `[triaged …]` marker names the slug. */
export interface SourceBullet {
  line: number;
  triaged: string;
  text: string;
}

/** A backticked name from a bullet and how many tracked files contain it. */
export interface NameCheck {
  name: string;
  files: number;
}

type Result<T> = { success: true; data: T } | { success: false; errors: string[] };

/**
 * Find every top-level bullet whose `[triaged <date> → a, b]` marker lists `slug`.
 * A bullet runs from its `- ` line through the indented lines under it; a merge can
 * stamp several bullets with one slug, so all of them are returned.
 */
export function findSourceBullets(ideas: string, slug: string): SourceBullet[] {
  const lines = ideas.split('\n');
  const out: SourceBullet[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!(lines[i] ?? '').startsWith('- ')) continue;
    let end = i + 1;
    while (end < lines.length && /^\s+\S/.test(lines[end] ?? '')) end += 1;
    const text = lines.slice(i, end).join('\n');
    for (const m of text.matchAll(MARKER_RE)) {
      const slugs = (m[2] ?? '').split(',').map((s) => s.trim());
      if (slugs.includes(slug)) {
        out.push({ line: i + 1, triaged: m[1] ?? '', text });
        break;
      }
    }
    i = end - 1;
  }
  return out;
}

/**
 * The backticked names a bullet cites, deduplicated in order. A span holding
 * whitespace is a command or a sentence, not a name to grep for, so it is skipped.
 */
export function citedNames(text: string): string[] {
  const names = [...text.matchAll(BACKTICK_RE)]
    .map((m) => (m[1] ?? '').trim())
    .filter((n) => n.length >= 3 && !/\s/.test(n));
  return [...new Set(names)];
}

function countFiles(cwd: string, name: string): Result<number> {
  const run = spawnSync('git', ['grep', '-l', '-F', '-e', name, '--', '.', ...GREP_EXCLUDES], {
    cwd,
    encoding: 'utf8',
  });
  // `git grep` exits 1 for "no match", which is an answer, not a failure.
  if (run.status === 0)
    return { success: true, data: run.stdout.split('\n').filter(Boolean).length };
  if (run.status === 1 && run.stderr === '') return { success: true, data: 0 };
  return {
    success: false,
    errors: [run.error?.message ?? (run.stderr.trim() || `git grep exited ${run.status}`)],
  };
}

function render(slug: string, path: string, bullets: SourceBullet[], checks: NameCheck[]): string {
  const out = bullets.map((b) => `source: ${path}:${b.line} (triaged ${b.triaged})\n${b.text}\n`);
  if (checks.length > 0) {
    out.push('names:');
    for (const c of checks) {
      out.push(
        c.files > 0 ? `  found    \`${c.name}\` (${c.files} files)` : `  MISSING  \`${c.name}\``,
      );
    }
  }
  out.push(
    `next: build ${slug} from the bullet, not the roadmap block; where they disagree the bullet wins, and a MISSING name is a claim to grep for before coding`,
  );
  return `${out.join('\n')}\n`;
}

/**
 * CLI entrypoint. Reads the main checkout's `ideas.md` (a worktree's copy is stale or,
 * in a consumer that gitignores it, absent). Exit 0 bullet found, 1 no bullet names
 * the slug, 2 usage or git failure.
 */
export function main(argv: readonly string[], cwd = process.cwd()): number {
  const slug = argv.find((a) => !a.startsWith('--'));
  const json = argv.includes('--json');
  if (slug === undefined) {
    process.stderr.write(USAGE);
    return 2;
  }
  const common = gitCommonDir(cwd);
  if (!common.success) {
    process.stderr.write(`${LABEL}: not inside a git repository (${common.errors.join('; ')})\n`);
    return 2;
  }
  const path = loadDocRoots(dirname(common.data)).ideas;
  const bullets = existsSync(path) ? findSourceBullets(readFileSync(path, 'utf8'), slug) : [];
  if (bullets.length === 0) {
    process.stderr.write(
      `${LABEL}: no bullet in ${path} carries a [triaged … → ${slug}] marker — the marker may name a shorthand slug; search ideas.md by the entry's wording, else read the block skeptically\n`,
    );
    return 1;
  }
  const checks: NameCheck[] = [];
  for (const name of citedNames(bullets.map((b) => b.text).join('\n'))) {
    const files = countFiles(cwd, name);
    if (!files.success) {
      process.stderr.write(`${LABEL}: ${files.errors.join('; ')}\n`);
      return 2;
    }
    checks.push({ name, files: files.data });
  }
  process.stdout.write(
    json
      ? `${JSON.stringify({ slug, ideasMd: path, bullets, names: checks }, null, 2)}\n`
      : render(slug, path, bullets, checks),
  );
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
