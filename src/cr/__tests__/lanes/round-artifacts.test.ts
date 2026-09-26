// @tests: ui-design-review-lane
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { swapRoundArtifacts } from '../../lanes/round-artifacts.js';

async function priorRound(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'round-art-'));
  await mkdir(join(root, 'slug'), { recursive: true });
  await writeFile(join(root, 'slug', 'old.json'), 'old', 'utf8');
  return root;
}

describe('swapRoundArtifacts', () => {
  it('replaces the round directory with the new set', async () => {
    const root = await priorRound();
    const r = await swapRoundArtifacts(root, 'slug', [{ name: 'new.json', body: 'new' }]);
    expect(r).toEqual({ ok: true });
    expect(await readdir(join(root, 'slug'))).toEqual(['new.json']);
    expect(await readFile(join(root, 'slug', 'new.json'), 'utf8')).toBe('new');
    expect((await readdir(root)).filter((e) => e.startsWith('.'))).toEqual([]);
  });

  it('keeps the prior round when handed nothing', async () => {
    const root = await priorRound();
    expect(await swapRoundArtifacts(root, 'slug', [])).toEqual({ ok: true });
    expect(await readdir(join(root, 'slug'))).toEqual(['old.json']);
  });

  it('reports a failure detail instead of throwing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'round-art-'));
    const notADir = join(dir, 'file');
    await writeFile(notADir, 'x', 'utf8');
    const r = await swapRoundArtifacts(notADir, 'slug', [{ name: 'a.json', body: 'a' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).not.toBe('');
  });
});
