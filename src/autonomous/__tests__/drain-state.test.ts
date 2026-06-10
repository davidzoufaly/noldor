import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeState } from '../drain-state.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drain-state-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('writeState', () => {
  it('writes a JSON heartbeat under .noldor/', () => {
    writeState(dir, {
      pid: 1,
      startedAt: 't',
      phase: 'spawning',
      currentSlug: 'x',
      shipped: 0,
      skip: [],
      retries: {},
    });
    const j = JSON.parse(readFileSync(join(dir, '.noldor/drain-state.json'), 'utf8'));
    expect(j.phase).toBe('spawning');
    expect(j.currentSlug).toBe('x');
  });

  it('never throws when the target dir is unwritable (best-effort)', () => {
    if (process.getuid?.() === 0) return; // root bypasses perms (CI containers) — the chmod wouldn't bite
    const ro = mkdtempSync(join(tmpdir(), 'drain-state-ro-'));
    chmodSync(ro, 0o500); // r-x: cannot create the .noldor subdir
    try {
      expect(() =>
        writeState(ro, {
          pid: 1,
          startedAt: 't',
          phase: 'idle',
          currentSlug: null,
          shipped: 0,
          skip: [],
          retries: {},
        }),
      ).not.toThrow();
    } finally {
      chmodSync(ro, 0o700);
      rmSync(ro, { recursive: true, force: true });
    }
  });
});
