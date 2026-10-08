// @tests: memory-intake-lessons-learned-pipeline
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { main } from '../retro-cli.js';

const execFileAsync = promisify(execFile);
const TODAY = '2026-10-08';
const CHARUY_SHAPE = [
  '# Ideas',
  '',
  '## Not groomed',
  '',
  '- an older raw idea',
  '',
  '## Verticals',
  '',
  '### Core',
  '',
  '#### Later',
  '',
  '- a vertical idea',
  '',
].join('\n');

let repo: string;
let notesDir: string;
let noteFiles = 0;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function ideas(root = repo): string {
  return readFileSync(join(root, 'ideas.md'), 'utf8');
}

function notes(...lines: string[]): string {
  const path = join(notesDir, `notes-${++noteFiles}.txt`);
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}

function retro(...argv: string[]): Promise<number> {
  return main(argv, { cwd: repo, today: TODAY });
}

beforeEach(async () => {
  repo = realpathSync(await mkdtemp(join(tmpdir(), 'retro-cli-')));
  notesDir = realpathSync(await mkdtemp(join(tmpdir(), 'retro-notes-')));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 't');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'root');
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
  await rm(notesDir, { recursive: true, force: true });
});

describe('noldor triage retro', () => {
  it('writes to the main checkout ideas.md when run from a worktree', async () => {
    writeFileSync(join(repo, 'ideas.md'), CHARUY_SHAPE);
    git(repo, 'add', 'ideas.md');
    git(repo, 'commit', '-q', '-m', 'ideas');
    const tree = join(repo, '.worktrees', 's');
    git(repo, 'worktree', 'add', '-q', '-b', 'feat/s', tree);

    const code = await main(['--slug', 's', '--pr', '1', '--file', notes('lesson: x')], {
      cwd: tree,
      today: TODAY,
    });

    expect(code).toBe(0);
    expect(ideas()).toContain(`- x (s, PR #1, ${TODAY})`);
    expect(ideas(tree)).toBe(CHARUY_SHAPE);
  });

  it('creates ideas.md with both sections when the file is absent', async () => {
    expect(await retro('--slug', 's', '--pr', '2', '--file', notes('lesson: a trap'))).toBe(0);

    const body = ideas();
    expect(body).toMatch(/^## Not groomed$/m);
    expect(body).toMatch(/^## Lessons$/m);
    expect(body.indexOf('- a trap')).toBeGreaterThan(body.indexOf('## Lessons'));
  });

  it('inserts a missing Lessons section before Verticals without moving any line', async () => {
    writeFileSync(join(repo, 'ideas.md'), CHARUY_SHAPE);

    expect(await retro('--slug', 's', '--pr', '3', '--file', notes('lesson: L1'))).toBe(0);

    const lines = ideas().split('\n');
    const lessons = lines.indexOf('## Lessons');
    expect(lessons).toBeGreaterThan(lines.indexOf('- an older raw idea'));
    expect(lessons).toBeLessThan(lines.indexOf('## Verticals'));
    const kept = lines.filter((l) => CHARUY_SHAPE.split('\n').includes(l) && l !== '');
    expect(kept).toStrictEqual(CHARUY_SHAPE.split('\n').filter((l) => l !== ''));
  });

  it('puts follow-ups under Not groomed and lessons under Lessons, skipping blank lines', async () => {
    writeFileSync(join(repo, 'ideas.md'), CHARUY_SHAPE);

    const file = notes('followup: F1', '', 'lesson: L1');
    expect(await retro('--slug', 's', '--pr', '4', '--file', file)).toBe(0);

    const body = ideas();
    const followup = body.indexOf(`- F1 (s, PR #4, ${TODAY})`);
    expect(followup).toBeGreaterThan(body.indexOf('## Not groomed'));
    expect(followup).toBeLessThan(body.indexOf('## Lessons'));
    expect(body.indexOf(`- L1 (s, PR #4, ${TODAY})`)).toBeGreaterThan(body.indexOf('## Lessons'));
  });

  it('adds a missing Not groomed section ahead of Lessons', async () => {
    writeFileSync(join(repo, 'ideas.md'), '## Lessons\n\n- old\n\n## Verticals\n');

    expect(await retro('--slug', 's', '--pr', '5', '--file', notes('followup: F1'))).toBe(0);

    const body = ideas();
    expect(body.indexOf('- F1')).toBeGreaterThan(body.indexOf('## Not groomed'));
    expect(body.indexOf('## Not groomed')).toBeLessThan(body.indexOf('## Verticals'));
  });

  it('keeps one copy across re-runs, even on a later day, but not across PRs', async () => {
    const file = notes('lesson: same');
    await retro('--slug', 's', '--pr', '6', '--file', file);
    await main(['--slug', 's', '--pr', '6', '--file', file], { cwd: repo, today: '2026-10-09' });
    await retro('--slug', 's', '--pr', '7', '--file', file);

    const copies = ideas()
      .split('\n')
      .filter((l) => l.startsWith('- same '));
    expect(copies).toStrictEqual([`- same (s, PR #6, ${TODAY})`, `- same (s, PR #7, ${TODAY})`]);
  });

  it('writes a note repeated within one file once', async () => {
    await retro('--slug', 's', '--pr', '14', '--file', notes('lesson: twice', 'lesson: twice'));

    expect(
      ideas()
        .split('\n')
        .filter((l) => l.startsWith('- twice ')),
    ).toHaveLength(1);
  });

  it('appends to an existing heading that carries trailing whitespace', async () => {
    writeFileSync(join(repo, 'ideas.md'), '## Lessons  \n\n- old\n');

    await retro('--slug', 's', '--pr', '15', '--file', notes('lesson: new'));

    expect(ideas().match(/^## Lessons/gm)).toHaveLength(1);
    expect(ideas()).toContain('- new (s, PR #15');
  });

  it('treats an indented heading as the same section, and as a section end', async () => {
    writeFileSync(join(repo, 'ideas.md'), '  ## Lessons\n\n- old\n\n  ## Verticals\n\n- v\n');

    await retro('--slug', 's', '--pr', '16', '--file', notes('lesson: new'));

    const body = ideas();
    expect(body.match(/^\s*## Lessons/gm)).toHaveLength(1);
    expect(body).toContain(`- new (s, PR #16, ${TODAY})`);
    expect(body.indexOf('- new')).toBeLessThan(body.indexOf('## Verticals'));
  });

  it('collapses runs of whitespace inside a note', async () => {
    await retro('--slug', 's', '--pr', '8', '--file', notes('lesson:   first \t  second  '));

    expect(ideas()).toContain(`- first second (s, PR #8, ${TODAY})`);
  });

  it('writes shell metacharacters in a note as literal text', async () => {
    const note = 'run `git status` and $(touch pwned); "quoted" \\ done';

    expect(await retro('--slug', 's', '--pr', '17', '--file', notes(`lesson: ${note}`))).toBe(0);

    expect(ideas()).toContain(`- ${note} (s, PR #17, ${TODAY})`);
  });

  it('writes nothing for --none', async () => {
    expect(await retro('--slug', 's', '--pr', '9', '--none')).toBe(0);

    expect(existsSync(join(repo, 'ideas.md'))).toBe(false);
  });

  it.each<[string, () => string[]]>([
    [
      '--none with --file',
      () => ['--slug', 's', '--pr', '1', '--none', '--file', notes('lesson: x')],
    ],
    ['neither --file nor --none', () => ['--slug', 's', '--pr', '1']],
    ['a non-numeric PR', () => ['--slug', 's', '--pr', 'abc', '--file', notes('lesson: x')]],
    ['a zero PR', () => ['--slug', 's', '--pr', '0', '--file', notes('lesson: x')]],
    ['a non-kebab slug', () => ['--slug', 'Not A Slug', '--pr', '1', '--file', notes('lesson: x')]],
    ['a missing slug', () => ['--pr', '1', '--file', notes('lesson: x')]],
    ['note text on the command line', () => ['--slug', 's', '--pr', '1', '--lesson', 'x']],
    [
      'an unknown flag',
      () => ['--slug', 's', '--pr', '1', '--file', notes('lesson: x'), '--bogus'],
    ],
    ['--file without a value', () => ['--slug', 's', '--pr', '1', '--file']],
    [
      'an unreadable --file',
      () => ['--slug', 's', '--pr', '1', '--file', join(notesDir, 'absent.txt')],
    ],
    ['a file with no notes', () => ['--slug', 's', '--pr', '1', '--file', notes('', '  ')]],
    [
      'a line without a prefix',
      () => ['--slug', 's', '--pr', '1', '--file', notes('lesson: ok', 'stray')],
    ],
    [
      'a heading-shaped note',
      () => ['--slug', 's', '--pr', '1', '--file', notes('lesson: ## hijack')],
    ],
    ['a blank note', () => ['--slug', 's', '--pr', '1', '--file', notes('followup:    ')]],
  ])('exits 2 and writes nothing for %s', async (_name, argv) => {
    expect(await retro(...argv())).toBe(2);

    expect(existsSync(join(repo, 'ideas.md'))).toBe(false);
  });

  it('lands both bullets when two writer processes run at once', async () => {
    writeFileSync(join(repo, 'ideas.md'), CHARUY_SHAPE);

    const cli = (slug: string, pr: string) =>
      execFileAsync(
        process.execPath,
        [
          join(process.cwd(), 'bin/noldor.mjs'),
          'triage',
          'retro',
          '--slug',
          slug,
          '--pr',
          pr,
          '--file',
          notes(`lesson: from ${slug}`),
        ],
        { cwd: repo },
      );

    await Promise.all([cli('a', '10'), cli('b', '11')]);

    expect(ideas()).toContain('- from a (a, PR #10');
    expect(ideas()).toContain('- from b (b, PR #11');
  });

  it('never stages or commits, tracked or gitignored', async () => {
    writeFileSync(join(repo, 'ideas.md'), CHARUY_SHAPE);
    git(repo, 'add', 'ideas.md');
    git(repo, 'commit', '-q', '-m', 'ideas');
    const head = git(repo, 'rev-parse', 'HEAD');

    await retro('--slug', 's', '--pr', '12', '--file', notes('lesson: tracked'));
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('');
    expect(git(repo, 'status', '--porcelain')).toBe('M ideas.md');

    git(repo, 'rm', '-q', '--cached', 'ideas.md');
    writeFileSync(join(repo, '.gitignore'), 'ideas.md\n');
    git(repo, 'add', '.gitignore');
    git(repo, 'commit', '-q', '-m', 'ignore ideas');
    const ignoredHead = git(repo, 'rev-parse', 'HEAD');

    await retro('--slug', 's', '--pr', '13', '--file', notes('lesson: ignored'));
    expect(ideas()).toContain('- ignored (s, PR #13');
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('');
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(ignoredHead);
    expect(ignoredHead).not.toBe(head);
  });
});
