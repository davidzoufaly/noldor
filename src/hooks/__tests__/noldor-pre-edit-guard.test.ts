import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPreEditGuard } from '../noldor-pre-edit-guard';

function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qfpeg-'));
  mkdirSync(join(dir, '.noldor'));
  return dir;
}

describe('noldor pre-edit guard', () => {
  it('passes in soft mode when no rollout marker exists', () => {
    const dir = setupRepo();
    expect(runPreEditGuard({ cwd: dir, filePath: 'packages/web/src/foo.ts' }).ok).toBe(true);
  });

  it('passes post-rollout when a /gate session exists', () => {
    const dir = setupRepo();
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), 'abc123\n');
    writeFileSync(
      join(dir, '.noldor', 'session.json'),
      JSON.stringify({ path: 'micro-chore', startedAt: 'x' }),
    );
    expect(runPreEditGuard({ cwd: dir, filePath: 'README.md' }).ok).toBe(true);
  });

  it('fails post-rollout without a session even for allowlisted files', () => {
    const dir = setupRepo();
    writeFileSync(join(dir, '.noldor', 'rollout-marker'), 'abc123\n');
    const r = runPreEditGuard({ cwd: dir, filePath: 'README.md' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/\/gate/);
  });
});
