// @tests: acceptance-verify-lane, noldor
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { amendSubagentReceipt } from '../amend-receipt.js';

function makeRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'amend-receipt-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd });
  spawnSync('git', ['config', 'user.email', 'a@b'], { cwd });
  spawnSync('git', ['config', 'user.name', 'a'], { cwd });
  mkdirSync(join(cwd, '.noldor'), { recursive: true });
  writeFileSync(join(cwd, 'a.ts'), 'export const x = 1\n');
  spawnSync('git', ['add', '.'], { cwd });
  spawnSync('git', ['commit', '-q', '-m', 'feat: thing\n\nNoldor-Path: full-new\n'], { cwd });
  return cwd;
}

function lastMsg(cwd: string): string {
  return spawnSync('git', ['log', '-1', '--format=%B'], { cwd, encoding: 'utf8' }).stdout;
}

function receipts(cwd: string): string[] {
  return (
    lastMsg(cwd)
      .split('\n')
      // Case-insensitive to match the impl's trailer-token matching, so a
      // lowercase-key duplicate the impl strips can't hide from the assertion.
      .filter((l) => l.toLowerCase().startsWith('noldor-reviewed-subagent:'))
  );
}

function headTree(cwd: string): string {
  return spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd, encoding: 'utf8' }).stdout.trim();
}

describe('amendSubagentReceipt', () => {
  it('appends Noldor-Reviewed-Subagent: <tree> to tip commit', () => {
    const cwd = makeRepo();
    const tree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], {
      cwd,
      encoding: 'utf8',
    }).stdout.trim();
    const r = amendSubagentReceipt({ cwd });
    expect(r.amended).toBe(true);
    expect(r.tree).toBe(tree);
    expect(lastMsg(cwd)).toMatch(new RegExp(`Noldor-Reviewed-Subagent: ${tree}`));
  });

  it('is idempotent — second run is no-op when trailer matches HEAD^{tree}', () => {
    const cwd = makeRepo();
    amendSubagentReceipt({ cwd });
    const r2 = amendSubagentReceipt({ cwd });
    expect(r2.amended).toBe(false);
  });

  it('replaces the stale receipt across amend rounds — one receipt per commit', () => {
    const cwd = makeRepo();
    amendSubagentReceipt({ cwd });
    const stale = headTree(cwd);
    // CR round 2: fix applied onto the SAME commit -> new tree, stale receipt still in msg.
    writeFileSync(join(cwd, 'a.ts'), 'export const x = 2\n');
    spawnSync('git', ['add', '.'], { cwd });
    spawnSync('git', ['commit', '-q', '--amend', '--no-edit'], { cwd });
    const fresh = headTree(cwd);
    expect(fresh).not.toBe(stale);

    const r = amendSubagentReceipt({ cwd });
    expect(r.amended).toBe(true);
    expect(receipts(cwd)).toEqual([`Noldor-Reviewed-Subagent: ${fresh}`]);
    expect(lastMsg(cwd)).not.toContain(stale);
  });

  it('collapses pre-existing duplicate receipts to a single fresh one', () => {
    const cwd = makeRepo();
    spawnSync(
      'git',
      [
        'commit',
        '-q',
        '--amend',
        '-m',
        'feat: thing\n\nNoldor-Path: full-new\nNoldor-Reviewed-Subagent: dead\nNoldor-Reviewed-Subagent: beef\n',
      ],
      { cwd },
    );
    expect(receipts(cwd)).toHaveLength(2);

    const r = amendSubagentReceipt({ cwd });
    expect(r.amended).toBe(true);
    expect(receipts(cwd)).toEqual([`Noldor-Reviewed-Subagent: ${r.tree}`]);
    expect(lastMsg(cwd)).toContain('Noldor-Path: full-new');
  });

  it('re-amends when HEAD^{tree} changes (stale trailer must be refreshed)', () => {
    const cwd = makeRepo();
    amendSubagentReceipt({ cwd });
    writeFileSync(join(cwd, 'b.ts'), 'export const y = 2\n');
    spawnSync('git', ['add', '.'], { cwd });
    spawnSync('git', ['commit', '-q', '-m', 'feat: more\n\nNoldor-Path: full-new\n'], { cwd });
    const newTree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], {
      cwd,
      encoding: 'utf8',
    }).stdout.trim();
    const r = amendSubagentReceipt({ cwd });
    expect(r.amended).toBe(true);
    expect(r.tree).toBe(newTree);
    expect(lastMsg(cwd)).toMatch(new RegExp(`Noldor-Reviewed-Subagent: ${newTree}`));
  });
});
