// @tests: ui-design-review-lane
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCapture } from '../run-capture.js';

describe('runCapture env', () => {
  it('merges the extra variables over the inherited environment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'run-capture-env-'));
    const r = await runCapture(
      `printf '%s|%s' "$NOLDOR_GEOMETRY_SURFACE" "$PATH" > out.txt`,
      dir,
      10_000,
      { NOLDOR_GEOMETRY_SURFACE: 'dashboard' },
    );
    expect(r.code).toBe(0);
    const [surface, path] = (await readFile(join(dir, 'out.txt'), 'utf8')).split('|');
    expect(surface).toBe('dashboard');
    expect(path).toBe(process.env.PATH);
  });

  it('inherits the environment unchanged when no env is given', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'run-capture-env-'));
    const r = await runCapture(
      `printf '%s' "\${NOLDOR_GEOMETRY_SURFACE-unset}" > out.txt`,
      dir,
      10_000,
    );
    expect(r.code).toBe(0);
    expect(await readFile(join(dir, 'out.txt'), 'utf8')).toBe('unset');
  });
});
