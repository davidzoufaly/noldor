// src/release/__tests__/release-fd-changelog.test.ts
// @tests: dynamic-fd-changelog, framework-pr-flow-agent-auto-merge

import { describe, expect, it } from 'vitest';

import { extractUnreleasedSummary, prependChangelogBlock } from '../release-fd-changelog.js';

// Note: `renderChangelogBlock` tests moved to `release-fd-changelog-in-progress.test.ts`
// against the new `renderPerReleaseBlock` (renamed in the same pass that added
// `#### PRs` sub-section + phase awareness). Behavioral coverage is preserved
// across the two files.

describe('extractUnreleasedSummary', () => {
  it('extracts `#### Summary` text from a `### Unreleased` block', () => {
    const body = [
      '## Summary',
      '',
      'feature summary',
      '',
      '## Changelog',
      '',
      '### Unreleased',
      '',
      '#### Summary',
      '',
      'Added boolean ops — subtract and intersect.',
      '',
      '### 0.3.0',
      '',
      '#### Summary',
      '',
      'old summary',
      '',
    ].join('\n');
    expect(extractUnreleasedSummary(body)).toBe('Added boolean ops — subtract and intersect.');
  });

  it('handles multi-paragraph summaries', () => {
    const body = [
      '## Changelog',
      '',
      '### Unreleased',
      '',
      '#### Summary',
      '',
      'Paragraph one.',
      '',
      'Paragraph two.',
      '',
    ].join('\n');
    expect(extractUnreleasedSummary(body)).toBe('Paragraph one.\n\nParagraph two.');
  });

  it('returns null when no `### Unreleased` block exists', () => {
    const body = '## Changelog\n\n### 0.3.0\n\n#### Summary\n\nold\n';
    expect(extractUnreleasedSummary(body)).toBeNull();
  });

  it('returns empty string when `### Unreleased` exists without `#### Summary`', () => {
    const body = '## Changelog\n\n### Unreleased\n\n';
    expect(extractUnreleasedSummary(body)).toBe('');
  });
});

describe('prependChangelogBlock', () => {
  it('inserts a new block at the top of an existing `## Changelog` section', () => {
    const body = [
      '## Usage',
      '',
      'Use it.',
      '',
      '## Changelog',
      '',
      '### 0.3.0',
      '',
      '#### Summary',
      '',
      'old',
      '',
    ].join('\n');
    const out = prependChangelogBlock(
      body,
      '### 0.4.0\n\n#### Summary\n\nnew\n\n#### Commits\n\n- feat: foo',
    );
    expect(out).toMatch(
      /## Changelog\n\n### 0\.4\.0\n\n#### Summary\n\nnew\n\n#### Commits\n\n- feat: foo\n\n### 0\.3\.0/,
    );
  });

  it('replaces a `### Unreleased` block with the new versioned block', () => {
    const body = [
      '## Changelog',
      '',
      '### Unreleased',
      '',
      '#### Summary',
      '',
      'staged text',
      '',
      '### 0.3.0',
      '',
      '#### Summary',
      '',
      'old',
      '',
    ].join('\n');
    const out = prependChangelogBlock(
      body,
      '### 0.4.0\n\n#### Summary\n\nstaged text\n\n#### Commits\n\n- feat: foo',
    );
    expect(out).not.toContain('### Unreleased');
    expect(out).toContain('### 0.4.0');
    expect(out).toMatch(/### 0\.4\.0[\s\S]*### 0\.3\.0/);
  });

  it('creates a `## Changelog` section if missing', () => {
    const body = '## Usage\n\nUse it.\n';
    const out = prependChangelogBlock(
      body,
      '### 0.4.0\n\n#### Summary\n\nfoo\n\n#### Commits\n\n- feat: foo',
    );
    expect(out).toContain('## Changelog\n\n### 0.4.0');
  });

  it('locates ## Changelog by line-anchored heading, not inline prose reference', () => {
    // Regression: an FD body whose Summary references the literal "## Changelog"
    // string inside backticks must not have its prose corrupted by the inserter.
    const body = [
      '## Summary',
      '',
      'The renderer prefers the per-version `## Changelog > ### <version> > #### Summary` block.',
      '',
      '## Changelog',
      '',
      '### 0.3.0',
      '',
      '#### Summary',
      '',
      'old',
      '',
    ].join('\n');
    const out = prependChangelogBlock(body, '### 0.4.0\n\n#### Summary\n\nnew');
    expect(out).toContain('per-version `## Changelog > ### <version> > #### Summary` block.');
    expect(out).toMatch(/\n## Changelog\n\n### 0\.4\.0\n\n#### Summary\n\nnew\n\n### 0\.3\.0/);
  });
});

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach } from 'vitest';

import { generateFdChangelogs } from '../release-fd-changelog.js';

const execFileP = promisify(execFile);

async function gitInRepo(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', args, { cwd });
  return stdout.trim();
}

async function commitInRepo(
  cwd: string,
  file: string,
  content: string,
  message: string,
): Promise<void> {
  await writeFile(join(cwd, file), content, 'utf8');
  await gitInRepo(cwd, ['add', file]);
  await gitInRepo(cwd, ['commit', '-m', message]);
}

const FD_BASE = [
  '---',
  'name: Foo',
  'phase: done',
  'category: Tooling',
  'area: foo',
  'packages:',
  '  - web',
  'links:',
  '  code: []',
  '  docs: []',
  '  tests: []',
  '---',
  '',
  '## Summary',
  '',
  'foo summary',
  '',
  '## User Story',
  '',
  'story',
  '',
  '## Usage',
  '',
  'use',
  '',
  '## Changelog',
  '',
];

describe('generateFdChangelogs', () => {
  let repo: string;
  let featuresDir: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'gfc-'));
    await gitInRepo(repo, ['init', '-q']);
    await gitInRepo(repo, ['config', 'user.email', 'test@test']);
    await gitInRepo(repo, ['config', 'user.name', 'Test']);
    await gitInRepo(repo, ['config', 'commit.gpgsign', 'false']);
    featuresDir = join(repo, 'docs', 'features');
    await mkdir(featuresDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('first-done FD renders `### Initial Release (v<X>)` block (not per-release)', async () => {
    await commitInRepo(
      repo,
      'docs/features/foo.md',
      [...FD_BASE, ''].join('\n'),
      'chore: bootstrap',
    );
    await gitInRepo(repo, ['tag', 'v0.0.0']);
    await commitInRepo(repo, 'a.txt', 'x', 'feat(web:foo): add toggle (#1)');
    const result = await generateFdChangelogs({
      featuresDir,
      previousTag: 'v0.0.0',
      newVersion: '0.1.0',
      date: '2026-05-08',
      repoUrl: 'https://x',
      cwd: repo,
      offline: true,
    });
    expect(result.get('foo')).toContain('### Initial Release (v0.1.0)');
    expect(result.get('foo')).toContain('#### Summary');
    expect(result.get('foo')).toContain('Add toggle');
    expect(result.get('foo')).toContain('#### PRs');
    expect(result.get('foo')).toContain('#1:');
    // No separate `### 0.1.0` per-version block — Initial Release replaces it.
    expect(result.get('foo')).not.toMatch(/^### 0\.1\.0\b/m);
    expect(result.get('foo')).not.toContain('#### Commits');
    const written = await readFile(join(featuresDir, 'foo.md'), 'utf8');
    expect(written).toContain('### Initial Release (v0.1.0)');
    expect(written).toContain('Add toggle');
    expect(written).not.toContain('- feat: add toggle');
  });

  it('first-done drops any staged `### Unreleased` block', async () => {
    const fdContent = [
      ...FD_BASE,
      '### Unreleased',
      '',
      '#### Summary',
      '',
      'Old operator-staged copy.',
      '',
    ].join('\n');
    await commitInRepo(repo, 'docs/features/foo.md', fdContent, 'chore: bootstrap');
    await gitInRepo(repo, ['tag', 'v0.0.0']);
    await commitInRepo(repo, 'a.txt', 'x', 'feat(web:foo): add toggle (#7)');

    const result = await generateFdChangelogs({
      featuresDir,
      previousTag: 'v0.0.0',
      newVersion: '0.1.0',
      date: '2026-05-08',
      repoUrl: 'https://x',
      cwd: repo,
      offline: true,
    });
    expect(result.get('foo')).not.toContain('Old operator-staged copy');
    expect(result.get('foo')).toContain('Add toggle');
    const written = await readFile(join(featuresDir, 'foo.md'), 'utf8');
    expect(written).toContain('### Initial Release (v0.1.0)');
    expect(written).not.toContain('### Unreleased');
    expect(written).not.toContain('Old operator-staged copy');
  });

  it('skips FDs with zero qualifying commits even when `### Unreleased` is staged', async () => {
    const fdContent = [
      ...FD_BASE,
      '### Unreleased',
      '',
      '#### Summary',
      '',
      'staged but no commits.',
      '',
    ].join('\n');
    await commitInRepo(repo, 'docs/features/foo.md', fdContent, 'chore: bootstrap');
    await gitInRepo(repo, ['tag', 'v0.0.0']);
    await commitInRepo(repo, 'a.txt', 'x', 'feat(web): no slug here');
    const result = await generateFdChangelogs({
      featuresDir,
      previousTag: 'v0.0.0',
      newVersion: '0.1.0',
      date: '2026-05-08',
      repoUrl: 'https://x',
      cwd: repo,
      offline: true,
    });
    expect(result.size).toBe(0);
  });

  it('in-progress FD with qualifying commits renders `### <X> (in-progress)` block', async () => {
    const inProgressFd = FD_BASE.map((l) => (l === 'phase: done' ? 'phase: in-progress' : l));
    await commitInRepo(
      repo,
      'docs/features/bar.md',
      [...inProgressFd, '## Changelog', '']
        .join('\n')
        .replace(/## Changelog\n\n## Changelog\n\n$/, '## Changelog\n\n'),
      'chore: bootstrap',
    );
    await gitInRepo(repo, ['tag', 'v0.0.0']);
    await commitInRepo(repo, 'a.txt', 'x', 'feat(web:bar): early work (#11)');

    const result = await generateFdChangelogs({
      featuresDir,
      previousTag: 'v0.0.0',
      newVersion: '0.2.0',
      date: '2026-05-08',
      repoUrl: 'https://x',
      cwd: repo,
      offline: true,
    });

    expect(result.get('bar')).toContain('### 0.2.0 (in-progress)');
    expect(result.get('bar')).not.toContain('### Initial Release');
    expect(result.get('bar')).toContain('#### PRs');
    expect(result.get('bar')).toContain('#11:');
  });

  it('done FD with introduced set renders normal `### <X>` block (no Initial Release)', async () => {
    const enhancementFd = [...FD_BASE];
    const phaseIdx = enhancementFd.indexOf('phase: done');
    enhancementFd.splice(phaseIdx + 1, 0, 'introduced: 0.1.0');
    await commitInRepo(
      repo,
      'docs/features/baz.md',
      [...enhancementFd, ''].join('\n'),
      'chore: bootstrap',
    );
    await gitInRepo(repo, ['tag', 'v0.1.0']);
    await commitInRepo(repo, 'a.txt', 'x', 'feat(web:baz): enhancement (#42)');

    const result = await generateFdChangelogs({
      featuresDir,
      previousTag: 'v0.1.0',
      newVersion: '0.2.0',
      date: '2026-05-08',
      repoUrl: 'https://x',
      cwd: repo,
      offline: true,
    });

    expect(result.get('baz')).toContain('### 0.2.0');
    expect(result.get('baz')).not.toContain('(in-progress)');
    expect(result.get('baz')).not.toContain('### Initial Release');
  });

  it('phase=proposed FD is skipped entirely', async () => {
    const proposedFd = FD_BASE.map((l) => (l === 'phase: done' ? 'phase: proposed' : l));
    await commitInRepo(
      repo,
      'docs/features/qux.md',
      [...proposedFd, ''].join('\n'),
      'chore: bootstrap',
    );
    await gitInRepo(repo, ['tag', 'v0.0.0']);
    await commitInRepo(repo, 'a.txt', 'x', 'feat(web:qux): early (#3)');

    const result = await generateFdChangelogs({
      featuresDir,
      previousTag: 'v0.0.0',
      newVersion: '0.1.0',
      date: '2026-05-08',
      repoUrl: 'https://x',
      cwd: repo,
      offline: true,
    });
    expect(result.has('qux')).toBe(false);
  });
});
