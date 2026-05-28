// @tests: architecture-invariants

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeKeyboardBindingInvariant } from '../../invariants/keyboard-binding.js';

async function makeRepo() {
  const root = await mkdtemp(join(tmpdir(), 'inv-kb-'));
  await mkdir(join(root, 'docs/features'), { recursive: true });
  return root;
}

async function writeFeature(
  repo: string,
  slug: string,
  frontmatter: Record<string, unknown>,
  body: string,
) {
  const fmLines = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n');
  await writeFile(join(repo, 'docs/features', `${slug}.md`), `---\n${fmLines}\n---\n\n${body}\n`);
}

describe('keyboard-binding plugin', () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await rm(repo, { force: true, recursive: true });
  });

  it('passes when UI feature slug appears in keyboard-shortcuts.md', async () => {
    await writeFeature(
      repo,
      'toolbar',
      { area: 'web', name: 'Toolbar', phase: 'done' },
      '## Usage\n',
    );
    await writeFeature(
      repo,
      'keyboard-shortcuts',
      { area: 'web', name: 'KS', phase: 'done' },
      '## Usage\n- toolbar: Cmd+T\n',
    );
    const inv = makeKeyboardBindingInvariant(repo);
    const result = await inv.run();
    expect(result.violations).toHaveLength(0);
  });

  it('flags UI feature missing from keyboard-shortcuts.md', async () => {
    await writeFeature(
      repo,
      'toolbar',
      { area: 'web', name: 'Toolbar', phase: 'done' },
      '## Usage\n',
    );
    await writeFeature(
      repo,
      'keyboard-shortcuts',
      { area: 'web', name: 'KS', phase: 'done' },
      '## Usage\n- (empty)\n',
    );
    const inv = makeKeyboardBindingInvariant(repo);
    const result = await inv.run();
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.message).toContain('toolbar');
  });

  it('respects the not-applicable opt-out comment', async () => {
    await writeFeature(
      repo,
      'empty-scene',
      { area: 'web', name: 'Empty', phase: 'done' },
      '<!-- keyboard: not-applicable -->\n## Usage\n',
    );
    await writeFeature(
      repo,
      'keyboard-shortcuts',
      { area: 'web', name: 'KS', phase: 'done' },
      '## Usage\n- (empty)\n',
    );
    const inv = makeKeyboardBindingInvariant(repo);
    const result = await inv.run();
    expect(result.violations).toHaveLength(0);
  });

  it('skips non-web features and non-active phases', async () => {
    await writeFeature(repo, 'csg', { area: 'engine', name: 'CSG', phase: 'done' }, '## Usage\n');
    await writeFeature(
      repo,
      'future',
      { area: 'web', name: 'Future', phase: 'planned' },
      '## Usage\n',
    );
    await writeFeature(
      repo,
      'keyboard-shortcuts',
      { area: 'web', name: 'KS', phase: 'done' },
      '## Usage\n- (empty)\n',
    );
    const inv = makeKeyboardBindingInvariant(repo);
    const result = await inv.run();
    expect(result.violations).toHaveLength(0);
  });
});
