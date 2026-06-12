import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { notify } from '../notify.js';

describe('notify', () => {
  it('no-ops when command is undefined', () => {
    expect(() => notify(undefined, 'cycle-summary', { shipped: 1 }, '/tmp')).not.toThrow();
  });

  it('runs the command with NOLDOR_NOTIFY_KIND and NOLDOR_NOTIFY_JSON env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'notify-'));
    try {
      notify(
        `printf '%s|%s' "$NOLDOR_NOTIFY_KIND" "$NOLDOR_NOTIFY_JSON" > ${dir}/out.txt`,
        'escalation',
        { slug: 'a' },
        dir,
      );
      const out = readFileSync(join(dir, 'out.txt'), 'utf8');
      expect(out).toBe('escalation|{"slug":"a"}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('swallows a failing command (fail-open)', () => {
    expect(() => notify('exit 7', 'watcher-tripped', {}, '/tmp')).not.toThrow();
  });
});
