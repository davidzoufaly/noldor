import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
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

import { runCodex } from '../../lanes/codex.js';
import type { LaneInput } from '../../lane-types.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'codex-'));
  await mkdir(join(root, '.noldor', 'cr'), { recursive: true });
  execFileFn.mockReset();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const baseInput = (over: Partial<LaneInput> = {}): LaneInput => ({
  slug: 'x',
  artifact: 'docs/superpowers/specs/x.md',
  kind: 'spec',
  fdPath: 'docs/features/x.md',
  artifactSha: 'aaa',
  repoRoot: root,
  ...over,
});

describe('runCodex', () => {
  it('wraps codex JSON output as LaneFindings', async () => {
    execFileFn.mockImplementation((_c, _a, _o, cb) => {
      cb(
        null,
        JSON.stringify({
          summary: 'codex clean',
          findings: [],
        }),
        '',
      );
    });
    const r = await runCodex(baseInput());
    expect(r.ok).toBe(true);
    const j = JSON.parse(await readFile(r.sinkPath, 'utf8'));
    expect(j.lane).toBe('codex');
    expect(j.summary).toBe('codex clean');
  });

  it('emits synthetic blocker on non-zero exit', async () => {
    execFileFn.mockImplementation((_c, _a, _o, cb) => {
      const err = new Error('exit 1') as NodeJS.ErrnoException & { code?: number };
      (err as { code?: number }).code = 1;
      cb(err, '', 'codex barfed');
    });
    const r = await runCodex(baseInput());
    expect(r.ok).toBe(false);
    const j = JSON.parse(await readFile(r.sinkPath, 'utf8'));
    expect(j.blockers[0].message).toMatch(/codex.*errored/i);
  });

  it('appends --base-sha when input.baseSha set and CLI supports it', async () => {
    execFileFn.mockImplementation((_c, args, _o, cb) => {
      expect(args).toContain('--base-sha');
      expect(args).toContain('beef');
      cb(null, JSON.stringify({ summary: 'delta clean', findings: [] }), '');
    });
    await runCodex(baseInput({ baseSha: 'beef' }), { supportsBaseSha: true });
  });

  it('falls back to full review when --base-sha unsupported, logs warning', async () => {
    execFileFn.mockImplementation((_c, args, _o, cb) => {
      expect(args).not.toContain('--base-sha');
      cb(null, JSON.stringify({ summary: 'full clean', findings: [] }), '');
    });
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await runCodex(baseInput({ baseSha: 'beef' }), { supportsBaseSha: false });
    expect(spy).toHaveBeenCalledWith(expect.stringMatching(/base-sha.*fall back/i));
    spy.mockRestore();
  });
});
