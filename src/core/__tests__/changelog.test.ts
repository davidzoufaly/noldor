// @tests: noldor, scope-sibling-trailer-for-doc-sync-commits
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { filterCommitsForPage, loadCommits, parseScope } from '../changelog.js';

describe('parseScope', () => {
  it('parses noldor scope (no slug)', () => {
    expect(parseScope('docs(noldor): refactor')).toEqual({
      type: 'docs',
      scope: 'noldor',
      slug: null,
    });
  });

  it('parses noldor:slug scope', () => {
    expect(parseScope('feat(noldor:workflow): add rule')).toEqual({
      type: 'feat',
      scope: 'noldor:workflow',
      slug: 'workflow',
    });
  });

  it('returns non-null for non-noldor commits but slug is null', () => {
    expect(parseScope('feat(engine): add cylinder')).toEqual({
      type: 'feat',
      scope: 'engine',
      slug: null,
    });
  });

  it('returns null scope for unscoped commits', () => {
    expect(parseScope('chore: tidy')).toEqual({ type: 'chore', scope: null, slug: null });
  });
});

describe('filterCommitsForPage', () => {
  it('includes commits with matching slug', () => {
    const commits = [
      {
        hash: 'abc123def456',
        subject: 'docs(noldor:workflow): add rule',
        files: ['docs/noldor/workflow.md'],
      },
    ];
    expect(filterCommitsForPage(commits, 'workflow')).toHaveLength(1);
  });

  it('includes framework-wide commits that touched the page', () => {
    const commits = [
      {
        hash: 'abc123def456',
        subject: 'refactor(noldor): rename sections',
        files: ['docs/noldor/workflow.md', 'docs/noldor/git-and-commits.md'],
      },
    ];
    expect(filterCommitsForPage(commits, 'workflow')).toHaveLength(1);
  });

  it('excludes commits whose scope matches a different page', () => {
    const commits = [
      {
        hash: 'abc123def456',
        subject: 'docs(noldor:lifecycle): update',
        files: ['docs/noldor/workflow.md'],
      },
    ];
    expect(filterCommitsForPage(commits, 'workflow')).toHaveLength(0);
  });

  it('excludes commits without noldor scope even if path matches', () => {
    const commits = [
      {
        hash: 'abc123def456',
        subject: 'docs: misc',
        files: ['docs/noldor/workflow.md'],
      },
    ];
    expect(filterCommitsForPage(commits, 'workflow')).toHaveLength(0);
  });
});

describe('filterCommitsForPage — Noldor-Sibling-Scope', () => {
  it('includes a sibling-trailer commit that touched the page', () => {
    const commits = [
      {
        hash: 'abc123def456',
        subject: 'feat(prep): add dispatch runner',
        files: ['src/prep/dispatch.ts', 'docs/noldor/workflow.md'],
        siblingScopes: ['noldor:workflow'],
      },
    ];
    expect(filterCommitsForPage(commits, 'workflow')).toHaveLength(1);
  });

  it('includes a bare-noldor sibling commit that touched the page', () => {
    const commits = [
      {
        hash: 'abc123def456',
        subject: 'feat(core): rework markers',
        files: ['src/core/session.ts', 'docs/noldor/workflow.md'],
        siblingScopes: ['noldor'],
      },
    ];
    expect(filterCommitsForPage(commits, 'workflow')).toHaveLength(1);
  });

  it('excludes a sibling-trailer commit for pages not in the list', () => {
    const commits = [
      {
        hash: 'abc123def456',
        subject: 'feat(prep): add dispatch runner',
        files: ['src/prep/dispatch.ts', 'docs/noldor/lifecycle.md'],
        siblingScopes: ['noldor:workflow'],
      },
    ];
    expect(filterCommitsForPage(commits, 'lifecycle')).toHaveLength(0);
  });

  it('excludes a sibling-trailer commit that did not touch the page file', () => {
    const commits = [
      {
        hash: 'abc123def456',
        subject: 'feat(prep): add dispatch runner',
        files: ['src/prep/dispatch.ts'],
        siblingScopes: ['noldor:workflow'],
      },
    ];
    expect(filterCommitsForPage(commits, 'workflow')).toHaveLength(0);
  });
});

describe('loadCommits — sibling-trailer parsing', () => {
  it('parses Noldor-Sibling-Scope values from git history (empty when absent)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-changelog-'));
    const prevCwd = process.cwd();
    try {
      execSync('git init -q', { cwd: dir });
      execSync('git config user.email t@t.t', { cwd: dir });
      execSync('git config user.name t', { cwd: dir });
      mkdirSync(join(dir, 'docs', 'noldor'), { recursive: true });
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'docs', 'noldor', 'workflow.md'), '# Workflow\n');
      execSync('git add docs/noldor/workflow.md', { cwd: dir });
      execSync('git commit -q -m "docs(noldor:workflow): seed page"', { cwd: dir });
      writeFileSync(join(dir, 'src', 'dispatch.ts'), 'export {};\n');
      writeFileSync(join(dir, 'docs', 'noldor', 'workflow.md'), '# Workflow\n\nMore.\n');
      execSync('git add src/dispatch.ts docs/noldor/workflow.md', { cwd: dir });
      execSync(
        'git commit -q -m "feat(prep): add dispatch runner" -m "Noldor-Sibling-Scope: noldor:workflow, noldor:lifecycle"',
        { cwd: dir },
      );
      process.chdir(dir);
      const commits = await loadCommits('docs/noldor/workflow.md');
      expect(commits).toHaveLength(2);
      expect(commits[0].subject).toBe('feat(prep): add dispatch runner');
      expect(commits[0].siblingScopes).toEqual(['noldor:workflow', 'noldor:lifecycle']);
      // `git log --follow -- <path>` filters --name-only to the followed
      // file, so `files` lists only the page (verified on git 2.43.1).
      expect(commits[0].files).toEqual(['docs/noldor/workflow.md']);
      expect(commits[1].siblingScopes).toEqual([]);
      expect(filterCommitsForPage(commits, 'workflow')).toHaveLength(2);
    } finally {
      process.chdir(prevCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
