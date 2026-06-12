// @tests: acceptance-verify-lane
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePort } from '../port.js';

describe('resolvePort', () => {
  it('returns a free ephemeral port', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-port-'));
    const port = await resolvePort(dir);
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65_536);
  });

  it('ignores .env.local PORT — verify must never share the dev-server port', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-port-'));
    writeFileSync(join(dir, '.env.local'), 'PORT=4321\n');
    await expect(resolvePort(dir)).resolves.not.toBe(4321);
  });
});
