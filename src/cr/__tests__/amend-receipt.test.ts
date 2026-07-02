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
