// @tests: noldor
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FD_COMMAND_ROT_IGNORE_MARKER, detectFdCommandRot } from '../fd-command-rot.js';

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

// `commandTokens` and friends moved to `src/cli/command-registry.ts` (Q-0148);
// their unit coverage lives in `src/cli/__tests__/command-registry.test.ts`.
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

  it('suppresses a phantom on a line carrying the ignore marker', async () => {
    const repo = repoWith([
      {
        slug: 'shipped',
        body: 'Rejected: `pnpm noldor gate --drain <slug>` <!-- noldor-fd-command-rot-ignore -->',
      },
    ]);
    expect(await detectFdCommandRot(repo)).toEqual([]);
  });

  it('suppresses the line after a marker alone on its own line', async () => {
    const repo = repoWith([
      {
        slug: 'shipped',
        body: ['<!-- noldor-fd-command-rot-ignore -->', 'Road not taken: `noldor ghost-cmd`.'].join(
          '\n',
        ),
      },
    ]);
    expect(await detectFdCommandRot(repo)).toEqual([]);
  });

  it('suppresses only the marked line, not its neighbours', async () => {
    const repo = repoWith([
      {
        slug: 'shipped',
        body: [
          'Live phantom above: `pnpm noldor phantom-above`.',
          'Rejected: `pnpm noldor phantom-marked` <!-- noldor-fd-command-rot-ignore -->',
          'Live phantom below: `pnpm noldor phantom-below`.',
        ].join('\n\n'),
      },
    ]);
    const gaps = await detectFdCommandRot(repo);
    expect(gaps.map((g) => g.message.split(': ').at(-1))).toEqual([
      'phantom-above',
      'phantom-below',
    ]);
  });

  it('suppresses a marked line inside a fenced block', async () => {
    const repo = repoWith([
      {
        slug: 'shipped',
        body: [
          '```bash',
          'pnpm noldor fenced-ghost # <!-- noldor-fd-command-rot-ignore -->',
          '```',
        ].join('\n'),
      },
    ]);
    expect(await detectFdCommandRot(repo)).toEqual([]);
  });

  it('keeps fence boundaries intact when a marker precedes an opening fence', async () => {
    // Blanking the fence opener would invert every later boundary; the phantom
    // inside the second fence must still be reported.
    const repo = repoWith([
      {
        slug: 'shipped',
        body: [
          '<!-- noldor-fd-command-rot-ignore -->',
          '```bash',
          'pnpm noldor first-ghost',
          '```',
          '',
          '```bash',
          'pnpm noldor second-ghost',
          '```',
        ].join('\n'),
      },
    ]);
    const gaps = await detectFdCommandRot(repo);
    expect(gaps.map((g) => g.message.split(': ').at(-1))).toEqual(['first-ghost', 'second-ghost']);
  });

  it('exports the marker string the FD bodies embed', () => {
    expect(FD_COMMAND_ROT_IGNORE_MARKER).toBe('noldor-fd-command-rot-ignore');
  });

  it('returns empty when the features dir is missing', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'fd-command-rot-empty-'));
    expect(await detectFdCommandRot(empty)).toEqual([]);
  });
});
