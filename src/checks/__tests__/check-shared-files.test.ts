// @tests: parallel-worktree-workflow

import { describe, expect, it } from 'vitest';

import { evaluate, parseNameStatus, type StagedChange } from '../check-shared-files.js';

const WORKTREE = '/repo/.worktrees/foo';
const MAIN = '/repo';

/** Terse builder so a case reads as the git state it stands for. */
function mod(...paths: string[]): StagedChange[] {
  return paths.map((path) => ({ path, change: 'modify' }) as const);
}

describe('check-shared-files / parseNameStatus', () => {
  it('parses add / modify / delete records from -z output', () => {
    const raw = 'A\0src/new.ts\0M\0src/old.ts\0D\0src/gone.ts\0';
    expect(parseNameStatus(raw)).toEqual([
      { path: 'src/new.ts', change: 'add' },
      { path: 'src/old.ts', change: 'modify' },
      { path: 'src/gone.ts', change: 'delete' },
    ]);
  });

  it('expands a rename into a delete of the old path and an add of the new one', () => {
    const raw = 'R100\0docs/design/ui/a.pen\0docs/design/ui/archive/a.pen\0';
    expect(parseNameStatus(raw)).toEqual([
      { path: 'docs/design/ui/a.pen', change: 'delete' },
      { path: 'docs/design/ui/archive/a.pen', change: 'add' },
    ]);
  });

  it('records a copy as an add of the destination only', () => {
    expect(parseNameStatus('C75\0src/a.ts\0src/b.ts\0')).toEqual([
      { path: 'src/b.ts', change: 'add' },
    ]);
  });

  it('keeps paths containing spaces intact', () => {
    expect(parseNameStatus('M\0docs/my notes.md\0')).toEqual([
      { path: 'docs/my notes.md', change: 'modify' },
    ]);
  });

  it('returns nothing for an empty diff', () => {
    expect(parseNameStatus('')).toEqual([]);
  });

  it('stops at a truncated rename record instead of emitting a half-parsed path', () => {
    expect(parseNameStatus('M\0src/a.ts\0R100\0src/b.ts\0')).toEqual([
      { path: 'src/a.ts', change: 'modify' },
    ]);
  });
});

describe('check-shared-files / evaluate — shared roots', () => {
  it('allows a shared root file staged from the main worktree', () => {
    expect(evaluate(mod('CLAUDE.md'), MAIN, {})).toEqual([]);
  });

  it('allows shared root files when NOLDOR_ALLOW_SHARED=1', () => {
    expect(evaluate(mod('CLAUDE.md'), WORKTREE, { NOLDOR_ALLOW_SHARED: '1' })).toEqual([]);
  });

  it('allows ordinary files staged from a worktree', () => {
    expect(evaluate(mod('src/foo.ts', 'docs/x.md'), WORKTREE, {})).toEqual([]);
  });

  it('blocks CLAUDE.md, package.json, pnpm-lock.yaml and the engineering rules', () => {
    const result = evaluate(
      mod('pnpm-lock.yaml', 'package.json', '.claude/engineering-rules.md', 'CLAUDE.md'),
      WORKTREE,
      {},
    );
    expect(result.map((v) => v.path).toSorted()).toEqual(
      ['.claude/engineering-rules.md', 'CLAUDE.md', 'package.json', 'pnpm-lock.yaml'].toSorted(),
    );
    expect(result.every((v) => v.reason === 'shared-root')).toBe(true);
  });

  it('blocks .claude/skills/** and .claude/commands/** but not other .claude files', () => {
    const result = evaluate(
      mod('.claude/skills/foo.md', '.claude/commands/bar.md', '.claude/notes.md'),
      WORKTREE,
      {},
    );
    expect(result.map((v) => v.path).toSorted()).toEqual(
      ['.claude/commands/bar.md', '.claude/skills/foo.md'].toSorted(),
    );
  });
});

describe('check-shared-files / evaluate — .pen write guard', () => {
  const BASELINE = 'docs/design/ui/baseline/app.pen';
  const ARCHIVED = 'docs/design/ui/archive/2026-08-24-liquid-glass-ui.pen';

  it('blocks a baseline .pen edited from a feature worktree', () => {
    expect(evaluate(mod(BASELINE), WORKTREE, {})).toEqual([
      { path: BASELINE, reason: 'pen-baseline' },
    ]);
  });

  it('blocks a baseline .pen deleted from a feature worktree', () => {
    expect(evaluate([{ path: BASELINE, change: 'delete' }], WORKTREE, {})).toEqual([
      { path: BASELINE, reason: 'pen-baseline' },
    ]);
  });

  it('allows the baseline write-back when NOLDOR_ALLOW_PEN_WRITE=1', () => {
    expect(evaluate(mod(BASELINE), WORKTREE, { NOLDOR_ALLOW_PEN_WRITE: '1' })).toEqual([]);
  });

  it('allows a baseline .pen edited from the main worktree (ui-sync remediation)', () => {
    expect(evaluate(mod(BASELINE), MAIN, {})).toEqual([]);
  });

  it('blocks an in-place edit of an archived .pen from the main worktree', () => {
    expect(evaluate(mod(ARCHIVED), MAIN, {})).toEqual([{ path: ARCHIVED, reason: 'pen-archive' }]);
  });

  it('blocks an archived .pen moved back out of archive/', () => {
    const staged = parseNameStatus(`R100\0${ARCHIVED}\0docs/design/ui/live.pen\0`);
    expect(evaluate(staged, WORKTREE, {})).toEqual([{ path: ARCHIVED, reason: 'pen-archive' }]);
  });

  it('allows `design archive` moving a feature .pen into archive/', () => {
    const staged = parseNameStatus(
      'R100\0docs/design/ui/2026-08-27-x.pen\0docs/design/ui/archive/2026-08-27-x.pen\0',
    );
    expect(evaluate(staged, WORKTREE, {})).toEqual([]);
  });

  it('leaves the live feature .pen and non-.pen archive files alone', () => {
    expect(
      evaluate(
        mod('docs/design/ui/2026-08-27-x.pen', 'docs/design/specs/archive/2026-08-01-y-design.md'),
        WORKTREE,
        {},
      ),
    ).toEqual([]);
  });

  it('reports a shared root and a .pen violation together in one run', () => {
    const result = evaluate(mod('CLAUDE.md', ARCHIVED), WORKTREE, {});
    expect(result.toSorted((a, b) => a.path.localeCompare(b.path))).toEqual(
      [
        { path: 'CLAUDE.md', reason: 'shared-root' },
        { path: ARCHIVED, reason: 'pen-archive' },
      ].toSorted((a, b) => a.path.localeCompare(b.path)),
    );
  });
});
