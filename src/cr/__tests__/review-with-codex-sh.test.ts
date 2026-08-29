// @tests: code-reviewer-20
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sh } from '../review-with-codex.js';

describe('sh — the codex lane git seam', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'codex-sh-'));
    execFileSync('git', ['init', '-q'], { cwd });
    execFileSync('git', ['config', 'user.email', 't@e'], { cwd });
    execFileSync('git', ['config', 'user.name', 't'], { cwd });
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("reads a diff larger than node's 1MB default buffer", async () => {
    // Node\'s execFileSync default is 1MB, and this seam reads whole diffs. A
    // branch carrying a regenerated graph or any large generated artifact
    // overruns it, and the lane turns the resulting ENOBUFS into a blocking
    // "code review failed" finding — a big diff reading as bad code, on a lane
    // that is mandatory for M/L/XL sessions.
    await writeFile(join(cwd, 'big.txt'), `${'x'.repeat(64)}\n`.repeat(40_000), 'utf8');
    execFileSync('git', ['add', '-A'], { cwd });
    execFileSync('git', ['commit', '-q', '-m', 'big'], { cwd });

    const out = sh(cwd, ['show', '--format=', 'HEAD']);
    expect(out.length).toBeGreaterThan(1024 * 1024);
  });
});
