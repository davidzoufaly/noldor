// @tests: noldor
// Spawn-level coverage of the portable gate CLIs: `features phase-flip-done`,
// `features phase-revert`, `roadmap remove-block`. These replace the gate
// skill's inline `tsx -e "import … './src/…'"` snippets, which only worked
// when the consumer repo WAS the noldor repo.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const TSX = join(process.cwd(), 'node_modules/.bin/tsx');
const FLIP = join(process.cwd(), 'src/features/phase-flip-done-cli.ts');
const REVERT = join(process.cwd(), 'src/features/phase-revert-cli.ts');
const REMOVE = join(process.cwd(), 'src/triage/remove-block-cli.ts');

function run(entry: string, args: string[], cwd: string) {
  const r = spawnSync(TSX, [entry, ...args], { cwd, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function fdRepo(phase: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'phase-cli-'));
  mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
  writeFileSync(
    join(dir, 'docs', 'features', 'my-feature.md'),
    `---\nname: my-feature\nphase: ${phase}\n---\n\nbody\n`,
  );
  return dir;
}

describe('features phase-flip-done CLI', () => {
  it('flips in-progress → done', () => {
    const dir = fdRepo('in-progress');
    const r = run(FLIP, ['my-feature'], dir);
    expect(r.status).toBe(0);
    expect(readFileSync(join(dir, 'docs/features/my-feature.md'), 'utf8')).toContain('phase: done');
  });

  it('is a no-op on a non-in-progress FD', () => {
    const dir = fdRepo('done');
    const r = run(FLIP, ['my-feature'], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('unchanged');
  });

  it('exits 1 for a missing FD or missing slug', () => {
    const dir = fdRepo('done');
    expect(run(FLIP, ['nope'], dir).status).toBe(1);
    expect(run(FLIP, [], dir).status).toBe(1);
  });
});

describe('features phase-revert CLI', () => {
  it('reverts done → in-progress', () => {
    const dir = fdRepo('done');
    const r = run(REVERT, ['my-feature'], dir);
    expect(r.status).toBe(0);
    expect(readFileSync(join(dir, 'docs/features/my-feature.md'), 'utf8')).toContain(
      'phase: in-progress',
    );
  });

  it('is a no-op on a non-done FD', () => {
    const dir = fdRepo('proposed');
    const r = run(REVERT, ['my-feature'], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('unchanged');
  });

  it('exits 1 for a missing FD', () => {
    const dir = fdRepo('done');
    expect(run(REVERT, ['nope'], dir).status).toBe(1);
  });
});

describe('roadmap remove-block CLI', () => {
  const ROADMAP = [
    '# Roadmap',
    '',
    '### Area',
    '',
    '#### My Entry',
    '',
    '- area: tooling',
    '- since: 2026-01-01',
    '- size: XS',
    '- impact: low',
    '',
    'Body of the entry.',
    '',
    '#### Other Entry',
    '',
    '- area: tooling',
    '- since: 2026-01-01',
    '- size: XS',
    '- impact: low',
    '',
    'Other body.',
    '',
  ].join('\n');

  function roadmapRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'remove-block-cli-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'roadmap.md'), ROADMAP);
    return dir;
  }

  it('removes the named block and keeps the rest', () => {
    const dir = roadmapRepo();
    const r = run(REMOVE, ['my-entry'], dir);
    expect(r.status).toBe(0);
    const out = readFileSync(join(dir, 'docs/roadmap.md'), 'utf8');
    expect(out).not.toContain('My Entry');
    expect(out).toContain('Other Entry');
  });

  it('is a no-op success when the slug is absent', () => {
    const dir = roadmapRepo();
    const r = run(REMOVE, ['ghost-entry'], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('nothing to do');
  });

  it('exits 1 when the file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'remove-block-cli-'));
    expect(run(REMOVE, ['x'], dir).status).toBe(1);
  });

  it('targets docs/backlog.md with --backlog', () => {
    // Backlog blocks are H3 entries (### Name + bullets), not roadmap's H4-under-category.
    const BACKLOG = [
      '# Backlog',
      '',
      '### My Entry',
      '',
      '- area: tooling',
      '- since: 2026-01-01',
      '- size: XS',
      '- impact: low',
      '',
      'Body of the entry.',
      '',
    ].join('\n');
    const dir = roadmapRepo();
    writeFileSync(join(dir, 'docs', 'backlog.md'), BACKLOG);
    const r = run(REMOVE, ['my-entry', '--backlog'], dir);
    expect(r.status).toBe(0);
    expect(readFileSync(join(dir, 'docs/backlog.md'), 'utf8')).not.toContain('My Entry');
    // roadmap untouched
    expect(readFileSync(join(dir, 'docs/roadmap.md'), 'utf8')).toContain('My Entry');
  });
});
