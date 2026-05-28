import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileFn } = vi.hoisted(() => ({ execFileFn: vi.fn() }));
vi.mock('node:child_process', () => ({
  execFile: (
    cmd: string,
    args: string[],
    opts: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) => execFileFn(cmd, args, opts, cb),
}));

import {
  claudeSupportsMaxThinking,
  multiterminalDepDone,
  runStandalone,
} from '../../lanes/standalone.js';
import type { LaneInput } from '../../lane-types.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'so-'));
  await mkdir(join(root, '.noldor', 'cr'), { recursive: true });
  execFileFn.mockReset();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const input = (): LaneInput => ({
  slug: 'x',
  artifact: 'docs/superpowers/specs/x.md',
  kind: 'spec',
  fdPath: 'docs/features/x.md',
  artifactSha: 'aaa',
  repoRoot: root,
});

describe('claudeSupportsMaxThinking', () => {
  it('returns true when --max-thinking present in help', async () => {
    execFileFn.mockImplementation((_c, _a, _o, cb) => cb(null, 'flags:\n  --max-thinking\n', ''));
    expect(await claudeSupportsMaxThinking()).toBe(true);
  });
  it('returns false when absent', async () => {
    execFileFn.mockImplementation((_c, _a, _o, cb) => cb(null, 'flags:\n  --other\n', ''));
    expect(await claudeSupportsMaxThinking()).toBe(false);
  });
});

describe('multiterminalDepDone', () => {
  it('true when FD phase done + introduced set', async () => {
    const path = join(root, 'docs', 'features', 'fix-multiterminal-dev-flow-bug.md');
    await mkdir(join(root, 'docs', 'features'), { recursive: true });
    await writeFile(path, '---\nphase: done\nintroduced: v0.6.0\n---\n', 'utf8');
    expect(await multiterminalDepDone({ cwd: root })).toBe(true);
  });
  it('false when phase still in-progress', async () => {
    const path = join(root, 'docs', 'features', 'fix-multiterminal-dev-flow-bug.md');
    await mkdir(join(root, 'docs', 'features'), { recursive: true });
    await writeFile(path, '---\nphase: in-progress\n---\n', 'utf8');
    expect(await multiterminalDepDone({ cwd: root })).toBe(false);
  });
  it('false when FD missing', async () => {
    expect(await multiterminalDepDone({ cwd: root })).toBe(false);
  });
});

describe('runStandalone', () => {
  it('writes stub AFTER osascript spawn succeeds', async () => {
    execFileFn.mockImplementation((_cmd, _a, _o, cb) => {
      cb(null, '', '');
    });
    const r = await runStandalone(input());
    const j = JSON.parse(await readFile(r.sinkPath, 'utf8'));
    expect(j.lane).toBe('standalone');
    expect(j.finishedAt).toBeUndefined();
    expect(j.summary).toMatch(/running/);
    expect(j.templateSha).toMatch(/^[0-9a-f]{40}$/);
  });
  it('does not write stub when osascript preflight fails', async () => {
    execFileFn.mockImplementation((cmd, _a, _o, cb) => {
      if (cmd === 'osascript') cb(new Error('no iTerm'), '', '');
      else cb(null, '', '');
    });
    await expect(runStandalone(input())).rejects.toThrow();
    const entries = await readdir(join(root, '.noldor', 'cr'));
    expect(entries.filter((e) => !e.endsWith('.tmp'))).toHaveLength(0);
  });
  it('ignores baseSha (always full review)', async () => {
    execFileFn.mockImplementation((_c, _a, _o, cb) => cb(null, '', ''));
    const r = await runStandalone({ ...input(), baseSha: 'b', fullReview: false });
    const j = JSON.parse(await readFile(r.sinkPath, 'utf8'));
    expect(j.baseSha).toBeUndefined();
  });
});
