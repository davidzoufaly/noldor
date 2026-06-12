// @tests: acceptance-verify-lane
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePort } from '../port.js';

describe('resolvePort', () => {
  it('reads PORT from .env.local at the worktree root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-port-'));
    writeFileSync(join(dir, '.env.local'), 'FOO=bar\nPORT=4321\n');
    await expect(resolvePort(dir)).resolves.toBe(4321);
  });

  it('tolerates trailing comments on the PORT line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-port-'));
    writeFileSync(join(dir, '.env.local'), 'PORT=4322 # per-tree dev port\n');
    await expect(resolvePort(dir)).resolves.toBe(4322);
  });

  it('falls back to a free ephemeral port when .env.local is absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-port-'));
    const port = await resolvePort(dir);
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65_536);
  });
});
