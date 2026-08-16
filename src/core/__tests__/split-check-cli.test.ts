// @tests: framework-auto-split-suggestion-for-big-features-and-plans
import { describe, expect, it } from 'vitest';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runSplitCheck } from '../split-check-cli.js';

const OVERSIZED_BODY = [
  'One block, seven scopes.',
  ...Array.from({ length: 7 }, (_, i) => `- scope ${i} — its own concern`),
].join('\n');

function makeFixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'split-check-'));
  mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
  writeFileSync(
    join(dir, 'docs', 'roadmap.md'),
    [
      '# Roadmap',
      '',
      '### Giant Entry',
      '',
      '- area: tooling',
      '- size: S',
      '',
      OVERSIZED_BODY,
      '',
      '### Tidy Entry',
      '',
      '- area: tooling',
      '- size: S',
      '',
      'One small change.',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, 'docs', 'backlog.md'),
    ['### Parked Giant', '', '- area: tooling', '', OVERSIZED_BODY, ''].join('\n'),
  );
  const thirty = Array.from({ length: 30 }, (_, i) => `    - src/f${i}.ts`).join('\n');
  writeFileSync(
    join(dir, 'docs', 'features', 'wide-parent.md'),
    ['---', 'links:', '  code:', thirty, '---', '', '## Summary', ''].join('\n'),
  );
  return dir;
}

describe('runSplitCheck', () => {
  it('--entry: oversized roadmap entry → exit 2 with one line per signal', () => {
    const dir = makeFixtureRepo();
    const res = runSplitCheck(['--entry', 'giant-entry'], dir);
    expect(res.exitCode).toBe(2);
    expect(res.lines).toHaveLength(1);
    expect(res.lines[0]).toContain('[E2]');
  });

  it('--entry: clean entry → exit 0, no output', () => {
    const dir = makeFixtureRepo();
    expect(runSplitCheck(['--entry', 'tidy-entry'], dir)).toEqual({ exitCode: 0, lines: [] });
  });

  it('--entry: falls back to backlog when the slug is not in the roadmap', () => {
    const dir = makeFixtureRepo();
    const res = runSplitCheck(['--entry', 'parked-giant'], dir);
    expect(res.exitCode).toBe(2);
    expect(res.lines[0]).toContain('[E2]');
  });

  it('--entry: unknown slug → exit 1 infra error naming the slug', () => {
    const dir = makeFixtureRepo();
    const res = runSplitCheck(['--entry', 'no-such-slug'], dir);
    expect(res.exitCode).toBe(1);
    expect(res.lines.join('\n')).toContain('no-such-slug');
  });

  it('--plan: 1001-row plan → exit 2 with a P1 line; 1000 rows → exit 0', () => {
    const dir = makeFixtureRepo();
    writeFileSync(join(dir, 'big-plan.md'), Array.from({ length: 1001 }, () => 'row').join('\n'));
    writeFileSync(join(dir, 'ok-plan.md'), Array.from({ length: 1000 }, () => 'row').join('\n'));
    const over = runSplitCheck(['--plan', 'big-plan.md'], dir);
    expect(over.exitCode).toBe(2);
    expect(over.lines[0]).toContain('[P1]');
    expect(runSplitCheck(['--plan', 'ok-plan.md'], dir).exitCode).toBe(0);
  });

  it('--plan: unreadable path → exit 1', () => {
    const dir = makeFixtureRepo();
    expect(runSplitCheck(['--plan', 'missing.md'], dir).exitCode).toBe(1);
  });

  it('--fd: one --add over the breadth threshold → exit 2 F1; duplicate adds count once', () => {
    const dir = makeFixtureRepo();
    const over = runSplitCheck(['--fd', 'wide-parent', '--add', 'src/new.ts'], dir);
    expect(over.exitCode).toBe(2);
    expect(over.lines[0]).toContain('[F1]');
    const dup = runSplitCheck(
      ['--fd', 'wide-parent', '--add', 'src/f0.ts', '--add', 'src/f0.ts'],
      dir,
    );
    expect(dup.exitCode).toBe(0);
  });

  it('--fd: missing FD → exit 1', () => {
    const dir = makeFixtureRepo();
    expect(runSplitCheck(['--fd', 'nope'], dir).exitCode).toBe(1);
  });

  it('no mode / conflicting modes / dangling flag → exit 1 usage', () => {
    const dir = makeFixtureRepo();
    expect(runSplitCheck([], dir).exitCode).toBe(1);
    expect(runSplitCheck([], dir).lines[0]).toContain('usage');
    expect(runSplitCheck(['--entry', 'x', '--plan', 'y'], dir).exitCode).toBe(1);
    expect(runSplitCheck(['--entry'], dir).exitCode).toBe(1);
  });

  it('--spec: clean spec → exit 0; >20 criteria → exit 2 with an S2 line', () => {
    const dir = makeFixtureRepo();
    const clean = ['# Spec', '', '## Acceptance criteria', '', '- one criterion', ''].join('\n');
    writeFileSync(join(dir, 'clean-spec.md'), clean);
    expect(runSplitCheck(['--spec', 'clean-spec.md'], dir)).toEqual({ exitCode: 0, lines: [] });
    const bloated = [
      '# Spec',
      '',
      '## Acceptance criteria',
      '',
      ...Array.from({ length: 21 }, (_, i) => `- criterion ${i}`),
      '',
    ].join('\n');
    writeFileSync(join(dir, 'bloated-spec.md'), bloated);
    const res = runSplitCheck(['--spec', 'bloated-spec.md'], dir);
    expect(res.exitCode).toBe(2);
    expect(res.lines).toHaveLength(1);
    expect(res.lines[0]).toContain('[S2]');
  });

  it('--spec: >6000-word spec → exit 2 with an S1 line', () => {
    const dir = makeFixtureRepo();
    const big = Array.from({ length: 6001 }, (_, i) => `w${i}`).join(' ');
    writeFileSync(join(dir, 'big-spec.md'), big);
    const res = runSplitCheck(['--spec', 'big-spec.md'], dir);
    expect(res.exitCode).toBe(2);
    expect(res.lines[0]).toContain('[S1]');
  });

  it('--spec: unreadable path → exit 1 naming the path', () => {
    const dir = makeFixtureRepo();
    const res = runSplitCheck(['--spec', 'missing-spec.md'], dir);
    expect(res.exitCode).toBe(1);
    expect(res.lines.join('\n')).toContain('cannot read spec');
  });

  it('--spec conflicts with --plan → exit 1 usage', () => {
    const dir = makeFixtureRepo();
    expect(runSplitCheck(['--spec', 'a.md', '--plan', 'b.md'], dir).exitCode).toBe(1);
  });
});

describe('CLI exit-code contract (subprocess, mirrors lint-plan-snippets)', () => {
  // pnpm --silent normalises any non-zero exit to 1, so we invoke tsx directly
  // via pnpm exec to get the real exit code from the script.
  const rootDir = new URL('../../..', import.meta.url).pathname;
  function runCli(args: string[]): { stdout: string; status: number } {
    try {
      const stdout = execFileSync(
        'pnpm',
        ['exec', 'tsx', join(rootDir, 'src/core/split-check-cli.ts'), ...args],
        { encoding: 'utf8', cwd: rootDir },
      );
      return { stdout, status: 0 };
    } catch (err) {
      const e = err as { stdout?: Buffer | string; status?: number };
      const stdout = typeof e.stdout === 'string' ? e.stdout : (e.stdout?.toString() ?? '');
      return { stdout, status: e.status ?? 1 };
    }
  }

  it('exits 2 with signal lines on stdout for an oversized plan', () => {
    const dir = mkdtempSync(join(tmpdir(), 'split-cli-'));
    const path = join(dir, 'plan.md');
    writeFileSync(path, Array.from({ length: 1001 }, () => 'row').join('\n'));
    const { stdout, status } = runCli(['--plan', path]);
    expect(status).toBe(2);
    expect(stdout).toContain('[P1]');
  });

  it('exits 0 silently for a small plan', () => {
    const dir = mkdtempSync(join(tmpdir(), 'split-cli-clean-'));
    const path = join(dir, 'plan.md');
    writeFileSync(path, '# tiny\n');
    const { stdout, status } = runCli(['--plan', path]);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe('');
  });

  it('exits 1 with usage on stdout when no mode flag is given', () => {
    const { stdout, status } = runCli([]);
    expect(status).toBe(1);
    expect(stdout.toLowerCase()).toContain('usage');
  });
});
