// @tests: noldor
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandTokens, detectFdCommandRot } from '../fd-command-rot.js';

interface FdSpec {
  slug: string;
  phase?: string;
  body: string;
}

/**
 * Build a temp repo. The registry always includes the real `noldor` manifest
 * (imported, not read from the repo); `scripts` and `catalogHeadings` seed the
 * package.json and script-catalog halves of the union.
 */
function repoWith(
  fds: FdSpec[],
  opts: { scripts?: string[]; catalogHeadings?: string[] } = {},
): string {
  const repo = mkdtempSync(join(tmpdir(), 'fd-command-rot-'));
  mkdirSync(join(repo, 'docs', 'features'), { recursive: true });
  for (const fd of fds) {
    writeFileSync(
      join(repo, 'docs', 'features', `${fd.slug}.md`),
      `---\nname: ${fd.slug}\nphase: ${fd.phase ?? 'done'}\n---\n\n${fd.body}\n`,
    );
  }
  if (opts.scripts) {
    const scripts = Object.fromEntries(opts.scripts.map((s) => [s, 'echo']));
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts }));
  }
  if (opts.catalogHeadings) {
    mkdirSync(join(repo, 'docs', 'noldor'), { recursive: true });
    writeFileSync(
      join(repo, 'docs', 'noldor', 'script-catalog.md'),
      `# Script Catalog\n\n${opts.catalogHeadings.map((h) => `### ${h}\n`).join('\n')}`,
    );
  }
  return repo;
}

describe('commandTokens', () => {
  it('strips pnpm/noldor launchers and keeps leading command words', () => {
    expect(commandTokens('pnpm noldor garden detect')).toEqual(['garden', 'detect']);
    expect(commandTokens('noldor doctor')).toEqual(['doctor']);
    expect(commandTokens('pnpm release')).toEqual(['release']);
    expect(commandTokens('pnpm noldor:changelog')).toEqual(['noldor:changelog']);
  });

  it('stops at flags, placeholders, and inline shell comments', () => {
    expect(commandTokens('pnpm noldor autonomous run --source plans')).toEqual([
      'autonomous',
      'run',
    ]);
    expect(commandTokens('pnpm noldor worktrees create <slug>')).toEqual(['worktrees', 'create']);
    expect(commandTokens('pnpm validate:milestones # snapshot schema')).toEqual([
      'validate:milestones',
    ]);
    expect(commandTokens('pnpm noldor classify-feature-track [--apply]')).toEqual([
      'classify-feature-track',
    ]);
  });

  it('rejects non-commands and pnpm built-ins', () => {
    expect(commandTokens('some prose text')).toBeNull();
    expect(commandTokens('pnpm install')).toBeNull();
    expect(commandTokens('pnpm pack')).toBeNull();
    expect(commandTokens('pnpm noldor')).toBeNull();
  });
});

describe('detectFdCommandRot', () => {
  it('flags a documented command that resolves against nothing in the CLI surface', async () => {
    const repo = repoWith([
      { slug: 'my-feature', body: 'Run `pnpm noldor totally-made-up-cmd` to do the thing.' },
    ]);
    const gaps = await detectFdCommandRot(repo);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].category).toBe('fd-command-rot');
    expect(gaps[0].itemId).toBe('my-feature');
    expect(gaps[0].message).toContain('totally-made-up-cmd');
  });

  it('resolves real manifest commands, package scripts, and catalog aliases', async () => {
    const repo = repoWith(
      [
        {
          slug: 'my-feature',
          body: [
            'Manifest: `pnpm noldor garden detect` and `noldor doctor`.',
            'Script: `pnpm release`. Alias: `pnpm foo:bar`.',
            'Built-in: `pnpm install`. Positional arg: `noldor roadmap remove-block my-slug`.',
          ].join('\n\n'),
        },
      ],
      { scripts: ['release'], catalogHeadings: ['foo:bar'] },
    );
    expect(await detectFdCommandRot(repo)).toEqual([]);
  });

  it('flags a command missing its manifest group prefix', async () => {
    // `fill-links-code-gaps` is a `features` sub-command; bare form is rot.
    const repo = repoWith([
      { slug: 'my-feature', body: 'Old form: `pnpm noldor fill-links-code-gaps --auto-high`.' },
    ]);
    const gaps = await detectFdCommandRot(repo);
    expect(gaps.map((g) => g.message)).toEqual([
      'my-feature: documented command not in CLI surface (manifest/scripts/script-catalog): fill-links-code-gaps',
    ]);
  });

  it('scans only done FDs and dedupes repeated phantoms', async () => {
    const repo = repoWith([
      {
        slug: 'shipped',
        body: '`pnpm noldor ghost-cmd` then again `pnpm noldor ghost-cmd --json`.',
      },
      { slug: 'wip', phase: 'in-progress', body: 'Future: `pnpm noldor not-yet-built`.' },
    ]);
    const gaps = await detectFdCommandRot(repo);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].itemId).toBe('shipped');
    expect(gaps[0].message).toContain('ghost-cmd');
  });

  it('returns empty when the features dir is missing', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'fd-command-rot-empty-'));
    expect(await detectFdCommandRot(empty)).toEqual([]);
  });
});
