// @tests: gate-skill-loads-only-the-branch-a-session-takes
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { countWords } from '../../utils/word-count.js';

const ROOT = join(__dirname, '..', '..', '..');
const GATE_DIR = join(ROOT, '.claude', 'skills', 'noldor-gate');
/** `.claude/skills/noldor-gate/SKILL.md` at c7bc4bc, the tree the split was designed against. */
const PRE_SPLIT_WORDS = 13_690;

const gateFile = (name: string): string => readFileSync(join(GATE_DIR, name), 'utf8');
const wordsIn = (path: string): number => countWords(readFileSync(path, 'utf8'));
/** A bare name sits beside `SKILL.md`; a path with a slash is repo-relative. */
const resolveLoadFile = (name: string): string =>
  name.includes('/') ? join(ROOT, name) : join(GATE_DIR, name);

interface LoadRow {
  session: string;
  everyRun: string[];
  onlyWhen: string[];
}

/** The router's load table, one row per session. */
function loadTable(): LoadRow[] {
  const lines = gateFile('SKILL.md').split('\n');
  const head = lines.findIndex((line) => line.startsWith('| Session |'));
  if (head < 0) throw new Error('SKILL.md has no load table');
  const mdFiles = (cell: string): string[] =>
    [...cell.matchAll(/`([^`]+\.md)`/g)].map((m) => m[1]!);
  const rows: LoadRow[] = [];
  for (const line of lines.slice(head + 2)) {
    if (!line.startsWith('|')) break;
    const [session = '', everyRun = '', onlyWhen = ''] = line
      .slice(1, -1)
      .split(' | ')
      .map((cell) => cell.trim());
    rows.push({ session, everyRun: mdFiles(everyRun), onlyWhen: mdFiles(onlyWhen) });
  }
  return rows;
}

describe('the gate skill loads only the branch a session takes', () => {
  it('keeps the router at or under 3,000 words', () => {
    expect(wordsIn(join(GATE_DIR, 'SKILL.md'))).toBeLessThanOrEqual(3000);
  });

  it('has a load-table row for every path and mode, naming only files that exist', () => {
    const rows = loadTable();
    expect(rows.map((r) => r.session)).toEqual([
      '`micro-chore`',
      '`fast-track`',
      '`specs-only-new`',
      '`specs-only-attach`',
      '`full-new`',
      '`full-attach`',
      '`--drain <slug>`',
      '`--drain <slug> --finish`',
      '`--resume <slug>` under `NOLDOR_DRAIN=1`',
      '`--resume <slug>`',
    ]);
    for (const row of rows) {
      for (const file of [...row.everyRun, ...row.onlyWhen]) {
        expect(existsSync(resolveLoadFile(file)), `${row.session} → ${file}`).toBe(true);
      }
    }
  });

  it('loads a clean specs-only-new run in under half the pre-split skill', () => {
    const row = loadTable().find((r) => r.session === '`specs-only-new`');
    expect(row?.everyRun).toEqual(['artifact-review.md', 'fd-close.md', 'code-review.md']);
    const load = [join(GATE_DIR, 'SKILL.md'), ...(row?.everyRun ?? []).map(resolveLoadFile)]
      .map(wordsIn)
      .reduce((sum, n) => sum + n, 0);
    expect(load).toBeLessThan(PRE_SPLIT_WORDS / 2);
  });

  it('carries no incident-history ids in any gate skill file', () => {
    for (const file of readdirSync(GATE_DIR).filter((f) => f.endsWith('.md'))) {
      expect(gateFile(file), file).not.toMatch(/Q-\d{4}|PR #\d+/);
    }
  });

  it('closes the FD on the drain Resume path with every noldor command fd-close.md runs', () => {
    const page = readFileSync(join(ROOT, 'docs', 'noldor', 'drain-mode.md'), 'utf8');
    const start = page.indexOf('\n## Resume path');
    const resume = page.slice(start, page.indexOf('\n## ', start + 1));
    const commands = new Set(
      [...gateFile('fd-close.md').matchAll(/pnpm noldor [a-z-]+ [a-z-]+/g)].map((m) => m[0]),
    );
    expect([...commands].toSorted()).toEqual([
      'pnpm noldor cr bootstrap',
      'pnpm noldor design archive',
      'pnpm noldor features phase-flip-done',
    ]);
    for (const command of commands) expect(resume, command).toContain(command);
  });
});
