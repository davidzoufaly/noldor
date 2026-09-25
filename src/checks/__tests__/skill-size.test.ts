// @tests: gate-skill-loads-only-the-branch-a-session-takes
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SKILL_SIZE_ALGORITHM_VERSION,
  SKILL_SIZE_BASELINE,
  compareSkillSizes,
  main,
  measureSkillSizes,
  readSkillSizeBaseline,
  writeSkillSizeBaseline,
} from '../skill-size.js';

function repoWith(files: Record<string, string>): { dir: string; [Symbol.dispose](): void } {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-skill-size-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body, 'utf8');
  }
  return { dir, [Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }) };
}

async function run(
  argv: string[],
  dir: string,
): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => (out.push(String(chunk)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (err.push(String(chunk)), true));
  const code = await main(argv, dir);
  vi.restoreAllMocks();
  return { code, out: out.join(''), err: err.join('') };
}

afterEach(() => vi.restoreAllMocks());

const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

describe('measureSkillSizes', () => {
  it('counts every markdown file under .claude/skills, nested ones included, and nothing else', () => {
    using repo = repoWith({
      '.claude/skills/demo/SKILL.md': 'one two three\n',
      '.claude/skills/demo/branch.md': 'four five\n',
      '.claude/skills/demo/deep/more.md': 'six\n',
      '.claude/skills/demo/notes.txt': 'not markdown at all\n',
      'docs/design/specs/x-design.md': 'a spec is never counted\n',
    });
    expect(measureSkillSizes(repo.dir)).toEqual({
      '.claude/skills/demo/SKILL.md': 3,
      '.claude/skills/demo/branch.md': 2,
      '.claude/skills/demo/deep/more.md': 1,
    });
  });

  it('is empty when the repo has no skills folder', () => {
    using repo = repoWith({ 'README.md': 'hi\n' });
    expect(measureSkillSizes(repo.dir)).toEqual({});
  });
});

describe('compareSkillSizes', () => {
  it('names each file as grew, unrecorded, fell, same or gone', () => {
    const rows = compareSkillSizes(
      { 'a.md': 10, 'b.md': 10, 'c.md': 10, 'gone.md': 4 },
      { 'a.md': 12, 'b.md': 8, 'c.md': 10, 'new.md': 3 },
    );
    expect(rows).toEqual([
      { path: 'a.md', kind: 'grew', baseline: 10, words: 12 },
      { path: 'b.md', kind: 'fell', baseline: 10, words: 8 },
      { path: 'c.md', kind: 'same', words: 10 },
      { path: 'gone.md', kind: 'gone', baseline: 4 },
      { path: 'new.md', kind: 'unrecorded', words: 3 },
    ]);
  });
});

describe('readSkillSizeBaseline', () => {
  it('reads back what writeSkillSizeBaseline wrote', () => {
    using repo = repoWith({});
    writeSkillSizeBaseline(repo.dir, { 'a.md': 5 }, new Date('2026-09-25T00:00:00.000Z'));
    expect(readSkillSizeBaseline(repo.dir)).toEqual({
      kind: 'ok',
      baseline: {
        algorithmVersion: SKILL_SIZE_ALGORITHM_VERSION,
        recordedAt: '2026-09-25T00:00:00.000Z',
        files: { 'a.md': 5 },
      },
    });
  });

  it('reports a missing file as absent and a corrupt one as unreadable', () => {
    using missing = repoWith({});
    expect(readSkillSizeBaseline(missing.dir)).toEqual({ kind: 'absent' });
    using corrupt = repoWith({ [SKILL_SIZE_BASELINE]: '{ not json' });
    expect(readSkillSizeBaseline(corrupt.dir).kind).toBe('unreadable');
  });

  it('refuses a baseline recorded by another algorithm version', () => {
    using repo = repoWith({
      [SKILL_SIZE_BASELINE]: JSON.stringify({
        algorithmVersion: SKILL_SIZE_ALGORITHM_VERSION + 1,
        recordedAt: 'x',
        files: {},
      }),
    });
    expect(readSkillSizeBaseline(repo.dir).kind).toBe('unreadable');
  });
});

describe('noldor skill-size check', () => {
  const SKILL = '.claude/skills/demo/SKILL.md';

  it('passes when every file is within its baseline, a shrunk one included', async () => {
    using repo = repoWith({ [SKILL]: words(50), '.claude/skills/demo/branch.md': words(20) });
    await run(['baseline'], repo.dir);
    writeFileSync(join(repo.dir, SKILL), words(40));
    expect((await run(['check'], repo.dir)).code).toBe(0);
  });

  it('refuses a push that adds 200 words to a SKILL.md, naming the file, until the baseline is re-recorded', async () => {
    using repo = repoWith({ [SKILL]: words(100) });
    await run(['baseline'], repo.dir);
    writeFileSync(join(repo.dir, SKILL), words(300));
    const refused = await run(['check'], repo.dir);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain(`${SKILL} — 300 words, baseline 100 (+200)`);
    await run(['baseline'], repo.dir);
    expect((await run(['check'], repo.dir)).code).toBe(0);
  });

  it('refuses a new skill file that has no baseline entry', async () => {
    using repo = repoWith({ [SKILL]: words(10) });
    await run(['baseline'], repo.dir);
    writeFileSync(join(repo.dir, '.claude/skills/demo/new-branch.md'), words(5));
    const refused = await run(['check'], repo.dir);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('.claude/skills/demo/new-branch.md — 5 words, no baseline entry');
  });

  it('exits 3 with the record remedy when there is no baseline, or an unreadable one', async () => {
    using none = repoWith({ [SKILL]: words(10) });
    const missing = await run(['check'], none.dir);
    expect(missing.code).toBe(3);
    expect(missing.err).toContain('pnpm noldor skill-size baseline');
    using corrupt = repoWith({ [SKILL]: words(10), [SKILL_SIZE_BASELINE]: '[]' });
    expect((await run(['check'], corrupt.dir)).code).toBe(3);
  });

  it('exits 2 on an unknown subcommand or extra argument', async () => {
    using repo = repoWith({});
    expect((await run(['report'], repo.dir)).code).toBe(2);
    expect((await run(['check', '--json'], repo.dir)).code).toBe(2);
  });
});

describe('noldor skill-size baseline', () => {
  it('says the previous baseline was unreadable instead of listing every file as new', async () => {
    using repo = repoWith({
      '.claude/skills/a/SKILL.md': words(3),
      [SKILL_SIZE_BASELINE]: '{ torn',
    });
    const rerecord = await run(['baseline'], repo.dir);
    expect(rerecord.code).toBe(0);
    expect(rerecord.out).toContain('the previous baseline was unreadable');
    expect(rerecord.out).not.toContain('new .claude/skills/a/SKILL.md');
  });

  it('records every skill file and prints which ones moved', async () => {
    using repo = repoWith({
      '.claude/skills/a/SKILL.md': words(3),
      '.claude/skills/b/SKILL.md': words(4),
    });
    const first = await run(['baseline'], repo.dir);
    expect(first.code).toBe(0);
    expect(first.out).toContain('new .claude/skills/a/SKILL.md — 3 words');
    const stored = JSON.parse(readFileSync(join(repo.dir, SKILL_SIZE_BASELINE), 'utf8')) as {
      files: Record<string, number>;
    };
    expect(stored.files).toEqual({
      '.claude/skills/a/SKILL.md': 3,
      '.claude/skills/b/SKILL.md': 4,
    });
    writeFileSync(join(repo.dir, '.claude/skills/a/SKILL.md'), words(5));
    expect((await run(['baseline'], repo.dir)).out).toContain(
      'RAISED .claude/skills/a/SKILL.md — 5 words, baseline 3 (+2)',
    );
  });
});
