// @tests: noldor
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditCodexCrOverrides } from '../codex-cr-override-audit.js';

function makeRepo(rows: string[]): string {
  const cwd = mkdtempSync(join(tmpdir(), 'cr-audit-'));
  mkdirSync(join(cwd, '.noldor'), { recursive: true });
  writeFileSync(join(cwd, '.noldor', 'cr-overrides.log'), rows.join('\n') + '\n');
  return cwd;
}

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

describe('auditCodexCrOverrides', () => {
  it('warns when ≥ 3 overrides land in the last 14 days', () => {
    const cwd = makeRepo([
      `${iso(1)}\tcodex offline`,
      `${iso(2)}\tcodex offline`,
      `${iso(3)}\tcodex offline`,
    ]);
    const r = auditCodexCrOverrides({ cwd });
    expect(r).toContainEqual(expect.objectContaining({ kind: 'frequency', count: 3 }));
  });

  it('flags reasons shorter than 10 chars', () => {
    const cwd = makeRepo([`${iso(1)}\tnope`]);
    const r = auditCodexCrOverrides({ cwd });
    expect(r).toContainEqual(expect.objectContaining({ kind: 'short-reason', reason: 'nope' }));
  });

  it('flags repeated identical reasons', () => {
    const cwd = makeRepo([
      `${iso(1)}\tcodex offline temporarily`,
      `${iso(2)}\tcodex offline temporarily`,
      `${iso(3)}\tcodex offline temporarily`,
    ]);
    const r = auditCodexCrOverrides({ cwd });
    expect(r).toContainEqual(expect.objectContaining({ kind: 'repeated', count: 3 }));
  });

  it('returns empty findings for healthy state', () => {
    const cwd = makeRepo([`${iso(1)}\tcodex offline (one-off — fixed in PR #42)`]);
    const r = auditCodexCrOverrides({ cwd });
    expect(r).toEqual([]);
  });

  it('suppresses bootstrap-reason rows from frequency + repeated counters', () => {
    const reason = 'bootstrap — feature added the gate that would block its own commits';
    const cwd = makeRepo([
      `${iso(1)}\t${reason}`,
      `${iso(1)}\t${reason}`,
      `${iso(1)}\t${reason}`,
      `${iso(1)}\t${reason}`,
      `${iso(1)}\t${reason}`,
    ]);
    // 5 bootstrap rows would normally trip frequency (≥3) + repeated; both suppressed.
    expect(auditCodexCrOverrides({ cwd })).toEqual([]);
  });
});
