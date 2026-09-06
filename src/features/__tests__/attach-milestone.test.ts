import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach } from 'vitest';
import { describe, expect, it } from 'vitest';

import { resolveAttachMilestone } from '../attach-milestone.js';

// @tests: decouple-milestones-from-semver

describe(resolveAttachMilestone, () => {
  it('adopts when the entry declares a milestone and the parent does not', () => {
    expect(resolveAttachMilestone('mvp', undefined)).toBe('adopt');
  });

  it('is a noop when both name the same milestone', () => {
    expect(resolveAttachMilestone('mvp', 'mvp')).toBe('noop');
  });

  it('conflicts when the two differ', () => {
    expect(resolveAttachMilestone('mvp', 'public-beta')).toBe('conflict');
  });

  // An entry with nothing to say can never conflict, whatever the parent holds
  // — the parent's own assignment is none of the attach's business.
  it('is a noop whenever the entry declares nothing', () => {
    expect(resolveAttachMilestone(undefined, undefined)).toBe('noop');
    expect(resolveAttachMilestone(undefined, 'mvp')).toBe('noop');
  });
});

// The CLI's own guards, exercised end to end: a traversal-shaped parent must not
// resolve to a file outside docs/features/, and a non-string frontmatter value
// must not degrade into "the parent declares none" and authorize an adopt.
describe('features attach-milestone CLI guards', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'attach-milestone-cli-'));
    await mkdir(join(repo, 'docs/features'), { recursive: true });
    await writeFile(
      join(repo, 'docs/roadmap.md'),
      ['### Entry', '', '- area: tooling', '- milestone: mvp', '', 'Body.', ''].join('\n'),
    );
    await writeFile(join(repo, 'docs/vision.md'), '---\nmilestone: sneaky\n---\nvision\n');
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  const writeParent = async (slug: string, milestone?: string): Promise<void> => {
    await writeFile(
      join(repo, 'docs/features', `${slug}.md`),
      [
        '---',
        `name: ${slug}`,
        ...(milestone ? [`milestone: ${milestone}`] : []),
        '---',
        'body',
      ].join('\n'),
    );
  };

  const run = (parent: string): { status: number; stderr: string; stdout: string } => {
    try {
      const stdout = execFileSync(
        process.execPath,
        [join(process.cwd(), 'bin/noldor.mjs'), 'features', 'attach-milestone', 'entry', parent],
        { cwd: repo, env: { ...process.env, NOLDOR_RUNTIME: 'source' }, encoding: 'utf8' },
      );
      return { status: 0, stdout, stderr: '' };
    } catch (err) {
      const e = err as { status: number; stdout: string; stderr: string };
      return { status: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
  };

  it('adopts when the parent declares no milestone', async () => {
    await writeParent('parent');
    const r = run('parent');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('adopt');
  });

  it('exits 1 on a conflicting parent', async () => {
    await writeParent('parent', 'other');
    expect(run('parent').status).toBe(1);
  });

  it('refuses a traversal-shaped parent instead of reading outside docs/features', () => {
    const r = run('../vision');
    expect(r.status).toBe(2);
    expect(r.stdout).not.toContain('adopt');
  });

  // Exit 1 means "conflict" to /noldor-promote, which stops the promotion and
  // tells the operator the two named different milestones. An IO or YAML fault
  // must never wear that code.
  it('exits 2, not 1, when the parent FD frontmatter is unparseable', async () => {
    await writeFile(
      join(repo, 'docs/features/parent.md'),
      ['---', 'name: "unclosed', '---', 'body'].join('\n'),
    );
    expect(run('parent').status).toBe(2);
  });

  it('exits 2, not 1, when a queue path is a directory rather than a file', async () => {
    await rm(join(repo, 'docs/roadmap.md'));
    await mkdir(join(repo, 'docs/roadmap.md'), { recursive: true });
    await writeParent('parent');
    expect(run('parent').status).toBe(2);
  });

  it('refuses a parent whose milestone frontmatter is not a string', async () => {
    await writeFile(
      join(repo, 'docs/features/parent.md'),
      ['---', 'name: parent', 'milestone: 123', '---', 'body'].join('\n'),
    );
    const r = run('parent');
    expect(r.status).toBe(2);
    expect(r.stdout).not.toContain('adopt');
  });
});
