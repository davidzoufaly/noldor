// @tests: gate-skill-loads-only-the-branch-a-session-takes
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { checkSkillRouters } from '../skill-router.js';

function repoWith(files: Record<string, string>): { dir: string; [Symbol.dispose](): void } {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-skill-router-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body, 'utf8');
  }
  return { dir, [Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A shipped `demo` skill folder: every file written under `.claude/skills/` and as its `templates/` twin. */
function shippedDemo(
  files: Record<string, string>,
  extra: Record<string, string> = {},
): ReturnType<typeof repoWith> {
  const all: Record<string, string> = { ...extra };
  for (const [name, body] of Object.entries(files)) {
    all[`.claude/skills/demo/${name}`] = body;
    all[`templates/.claude/skills/demo/${name}`] = body;
  }
  return repoWith(all);
}

describe('checkSkillRouters', () => {
  it('names a read-now link whose file does not exist, with its line', () => {
    using repo = shippedDemo({
      'SKILL.md': '# demo\n\n**Read now:** [`fork.md`](fork.md) — on a fork\n',
    });
    expect(checkSkillRouters(repo.dir)).toEqual([
      {
        skillPath: '.claude/skills/demo/SKILL.md',
        line: 3,
        kind: 'missing-branch-file',
        detail:
          'read-now link `fork.md` resolves to `.claude/skills/demo/fork.md`, which does not exist',
      },
    ]);
  });

  it('names a branch file that no read-now link reaches', () => {
    using repo = shippedDemo({ 'SKILL.md': '# demo\n', 'orphan.md': 'rules nobody reads\n' });
    expect(checkSkillRouters(repo.dir)).toEqual([
      {
        skillPath: '.claude/skills/demo/orphan.md',
        line: 1,
        kind: 'unreachable-branch-file',
        detail:
          'no chain of **Read now:** links from .claude/skills/demo/SKILL.md reaches this file',
      },
    ]);
  });

  it('still reports a branch file that only a plain link reaches', () => {
    using repo = shippedDemo({ 'SKILL.md': 'See [the fork](fork.md).\n', 'fork.md': 'rules\n' });
    expect(checkSkillRouters(repo.dir).map((f) => f.kind)).toEqual(['unreachable-branch-file']);
  });

  it('accepts a chain of read-now links through a second branch file', () => {
    using repo = shippedDemo({
      'SKILL.md': '**Read now:** [`a.md`](a.md)\n',
      'a.md': '**Read now:** [`b.md`](b.md) — on red\n',
      'b.md': 'the end\n',
    });
    expect(checkSkillRouters(repo.dir)).toEqual([]);
  });

  it('accepts a read-now link out of the folder to a repo page that exists', () => {
    using repo = shippedDemo(
      {
        'SKILL.md':
          '**Read now:** [`docs/noldor/drain-mode.md`](../../../docs/noldor/drain-mode.md)\n',
      },
      { 'docs/noldor/drain-mode.md': '# Drain Mode\n' },
    );
    expect(checkSkillRouters(repo.dir)).toEqual([]);
  });

  it('ignores a placeholder link that only shows the line shape, and a URL', () => {
    using repo = shippedDemo({
      'SKILL.md':
        'A fork carries **Read now:** [`<file>`](<file>).\n**Read now:** [spec](https://example.com/x.md)\n',
    });
    expect(checkSkillRouters(repo.dir)).toEqual([]);
  });

  it('leaves a consumer skill with no templates/ twin alone', () => {
    using repo = repoWith({
      '.claude/skills/team/SKILL.md': '**Read now:** [`gone.md`](gone.md)\n',
      '.claude/skills/team/orphan.md': 'x\n',
    });
    expect(checkSkillRouters(repo.dir)).toEqual([]);
  });
});
