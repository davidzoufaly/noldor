import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { stageFrameworkDocs } from '../stage-framework-docs.js';

function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-stage-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t.t', { cwd: dir });
  execSync('git config user.name t', { cwd: dir });

  mkdirSync(join(dir, '.noldor/classification'), { recursive: true });
  mkdirSync(join(dir, 'docs/features'), { recursive: true });
  mkdirSync(join(dir, 'docs/superpowers/plans'), { recursive: true });
  mkdirSync(join(dir, 'docs/superpowers/specs'), { recursive: true });
  mkdirSync(join(dir, 'packages/noldor/docs/features'), { recursive: true });
  mkdirSync(join(dir, 'packages/noldor/docs/superpowers/plans'), { recursive: true });
  mkdirSync(join(dir, 'packages/noldor/docs/superpowers/specs'), { recursive: true });

  writeFileSync(join(dir, 'docs/features/alpha.md'), '# alpha');
  writeFileSync(join(dir, 'docs/features/beta.md'), '# beta');
  writeFileSync(join(dir, 'docs/superpowers/plans/2026-05-01-alpha-plan.md'), '# alpha plan');
  writeFileSync(join(dir, 'docs/superpowers/specs/2026-05-01-alpha-design.md'), '# alpha spec');

  writeFileSync(
    join(dir, 'docs/roadmap.md'),
    `# Roadmap\n\n#### entry-one\n\nfw entry\n\n#### entry-two\n\nproduct entry\n`,
  );
  writeFileSync(join(dir, 'docs/backlog.md'), `# Backlog\n\n#### backlog-one\n\nfw backlog\n`);

  writeFileSync(
    join(dir, '.noldor/classification/framework.txt'),
    [
      'feature\talpha',
      'plan\t2026-05-01-alpha-plan.md',
      'spec\t2026-05-01-alpha-design.md',
      'roadmap\tentry-one',
      'backlog\tbacklog-one',
    ].join('\n'),
  );

  execSync('git add -A && git commit -q -m init', { cwd: dir });
  return dir;
}

describe('stageFrameworkDocs', () => {
  it('dry-run prints plan without mutating', () => {
    const dir = setupRepo();
    try {
      const plan = stageFrameworkDocs({ cwd: dir, apply: false });
      expect(plan.moves).toHaveLength(3);
      expect(plan.partitions).toHaveLength(2);
      expect(existsSync(join(dir, 'docs/features/alpha.md'))).toBe(true);
      expect(existsSync(join(dir, 'packages/noldor/docs/features/alpha.md'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('apply moves files and partitions blocks', () => {
    const dir = setupRepo();
    try {
      stageFrameworkDocs({ cwd: dir, apply: true });

      expect(existsSync(join(dir, 'docs/features/alpha.md'))).toBe(false);
      expect(existsSync(join(dir, 'packages/noldor/docs/features/alpha.md'))).toBe(true);
      expect(
        existsSync(join(dir, 'packages/noldor/docs/superpowers/plans/2026-05-01-alpha-plan.md')),
      ).toBe(true);
      expect(
        existsSync(join(dir, 'packages/noldor/docs/superpowers/specs/2026-05-01-alpha-design.md')),
      ).toBe(true);

      const fwRoadmap = readFileSync(join(dir, 'packages/noldor/docs/roadmap.md'), 'utf8');
      expect(fwRoadmap).toContain('#### entry-one');
      expect(fwRoadmap).not.toContain('#### entry-two');

      const prodRoadmap = readFileSync(join(dir, 'docs/roadmap.md'), 'utf8');
      expect(prodRoadmap).toContain('#### entry-two');
      expect(prodRoadmap).not.toContain('#### entry-one');

      const fwBacklog = readFileSync(join(dir, 'packages/noldor/docs/backlog.md'), 'utf8');
      expect(fwBacklog).toContain('#### backlog-one');

      expect(existsSync(join(dir, 'docs/features/beta.md'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses git mv for files (preserves history)', () => {
    const dir = setupRepo();
    try {
      stageFrameworkDocs({ cwd: dir, apply: true });
      const status = execSync('git status --porcelain', { cwd: dir, encoding: 'utf8' });
      expect(status).toMatch(
        /R\s+docs\/features\/alpha\.md\s+->\s+packages\/noldor\/docs\/features\/alpha\.md/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
