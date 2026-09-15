// @tests: test-suites-read-live-repo-state-shifting-full-suite-failures
//
// Keeps the seam from being bypassed. Without this, the next probe added to
// `preflight-probes.ts` can spawn `gh` or `npm` directly again, and the only
// symptom is a test file that goes red on a slow network once a fortnight.
//
// Modelled on `src/core/agent-runner/__tests__/no-stray-spawns.test.ts`, with
// two deliberate differences. It keys on the PRIMITIVE, not on a literal
// command name: `runCli` spawns a command that comes from `noldorCliCommand` —
// a variable — so a command-name-keyed pattern could never see the very call
// site the seam exists to cover. And it needs no carve-out for the sanctioned
// spawn, because that lives in `run-command.ts`; an exception inside the
// scanned file is exactly where a regression would be added.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const PROBES = join(import.meta.dirname, '../preflight-probes.ts');

/**
 * Spawn primitives, matched as calls. Multiline-tolerant so a `spawn(\n 'gh'`
 * shape a line-based grep misses is still caught.
 */
const SPAWN_CALL = /\b(?:execFile|execFileSync|execFileP|execSync|spawn|spawnSync|fork)\s*\(/g;

describe('preflight probe spawn containment', () => {
  it('preflight-probes.ts contains no spawn primitive at all', () => {
    const src = readFileSync(PROBES, 'utf8');
    const hits = [...src.matchAll(SPAWN_CALL)].map((m) => {
      const line = src.slice(0, m.index).split('\n').length;
      return `preflight-probes.ts:${line} ${m[0]}`;
    });
    expect(
      hits,
      'probes must reach the outside world through ctx.runCommand — see src/release/run-command.ts',
    ).toStrictEqual([]);
  });

  it('preflight-probes.ts does not import node:child_process', () => {
    expect(readFileSync(PROBES, 'utf8')).not.toContain('node:child_process');
  });

  it('the scan would catch a spawn handed a variable, not just a literal command', () => {
    // The gap this rule exists to close. A command-name-keyed pattern (the
    // precedent's shape) reports nothing here; this one must report it.
    const withVariable = 'const [cmd, args] = noldorCliCommand(a);\nawait execFileP(cmd, args);\n';
    expect([...withVariable.matchAll(SPAWN_CALL)]).toHaveLength(1);
  });

  it('the scan does not fire on the two non-I/O URL strings the probes keep', () => {
    // `https://registry.npmjs.org` is a config default and `https://cli.github.com/`
    // is operator-facing fix text. Forbidding URLs would false-red on both.
    const src = readFileSync(PROBES, 'utf8');
    expect(src).toContain('https://registry.npmjs.org');
    expect(src).toContain('https://cli.github.com/');
  });
});
