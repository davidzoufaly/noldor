// @tests: abstraction-cost-ratchet
//
// The wiring, not the helper. `seedBaselineIfAbsent` is unit-tested next to the
// baseline module it lives in; what that cannot catch is `init` never calling
// it — which is the same never-seeded hole this feature exists to close, one
// layer up. So this test drives the real `noldor init` over a real consumer
// repo and asks the only question that matters: does `indirection check` in
// that repo now compare against a recorded ceiling, or does it still take the
// no-baseline green branch?
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const BIN = resolve(__dirname, '../../../bin/noldor.mjs');

/**
 * `init` is run from the src tree under test, not the compiled `dist` the bin
 * prefers: a stale build would otherwise silently exercise the previous
 * revision and report a pass for code this test never ran.
 */
const env = { ...process.env, NOLDOR_RUNTIME: 'source' };

/**
 * The smallest repo `init` accepts: one source file so the corpus is non-empty,
 * and a git commit because the rollout marker is stamped off `HEAD`.
 */
function bareConsumer(): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-init-arms-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src/a.ts'), 'export const a = 1;\n');
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'c', version: '0.0.1', type: 'module', private: true })}\n`,
  );
  const git = (...args: string[]): void => void execFileSync('git', args, { cwd: dir });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  return dir;
}

describe('noldor init arms the indirection ratchet', () => {
  it('leaves a repo whose check compares against a recorded baseline', () => {
    const dir = bareConsumer();
    try {
      execFileSync('node', [BIN, 'init'], { cwd: dir, encoding: 'utf8', env });
      expect(existsSync(join(dir, '.noldor/indirection-baseline.json'))).toBe(true);

      const verdict = JSON.parse(
        execFileSync('node', [BIN, 'indirection', 'check', '--json'], {
          cwd: dir,
          encoding: 'utf8',
          env,
        }),
      ) as { verdict: string; reason?: string; baseline?: number };

      expect(verdict.verdict).toBe('green');
      // The distinction the whole feature turns on: `no-baseline` is the
      // fail-open branch, and its absence is what proves a real comparison.
      expect(verdict.reason).toBeUndefined();
      expect(verdict.baseline).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);

  it('does not re-record a baseline the consumer already has', () => {
    const dir = bareConsumer();
    try {
      execFileSync('node', [BIN, 'init'], { cwd: dir, encoding: 'utf8', env });
      const path = join(dir, '.noldor/indirection-baseline.json');
      const recordedAt = (): string =>
        (JSON.parse(readFileSync(path, 'utf8')) as { recordedAt: string }).recordedAt;
      const first = recordedAt();

      execFileSync('node', [BIN, 'init', '--update'], { cwd: dir, encoding: 'utf8', env });

      expect(recordedAt()).toBe(first);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
