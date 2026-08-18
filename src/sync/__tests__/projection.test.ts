// @tests: feature-md-links-overhaul

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { codeAdapter } from '../adapters/code.js';
import { docsAdapter } from '../adapters/docs.js';
import { testsAdapter } from '../adapters/tests.js';
import {
  collectTaggedMany,
  diffProjection,
  loadCachedAll,
  project,
  runProjection,
  taglessKeptSlugs,
} from '../projection.js';
import type { LinkAdapter, ScanRoot } from '../projection.js';

let repo: string;

/** Adapter clone whose roots point at the throwaway repo, with a chosen origin. */
function rooted(adapter: LinkAdapter, dirs: string[], origin: ScanRoot['origin']): LinkAdapter {
  return { ...adapter, roots: (cwd) => dirs.map((d) => ({ path: join(cwd, d), origin })) };
}

function writeFd(slug: string, links: Record<string, string[]>): void {
  const body = Object.entries(links)
    .map(([k, v]) => `  ${k}:\n${v.map((p) => `    - ${p}`).join('\n')}`)
    .join('\n');
  writeFileSync(
    join(repo, 'docs', 'features', `${slug}.md`),
    `---\nname: ${slug}\nlinks:\n${body}\n---\n\n## Summary\n\nx\n`,
    'utf8',
  );
}

async function cachedFor(slug: string, key: 'code' | 'tests' | 'docs'): Promise<string[]> {
  const { byKey } = await loadCachedAll(join(repo, 'docs', 'features'), [key]);
  return byKey.get(key)?.get(slug) ?? [];
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'projection-'));
  mkdirSync(join(repo, 'docs', 'features'), { recursive: true });
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(join(repo, 'docs', 'user', 'how-to'), { recursive: true });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('clearing the last removed tag', () => {
  it('empties links.tests under --force when the final @tests tag is gone', async () => {
    writeFd('feat', { tests: ['src/gone.test.ts'] });
    const adapter = rooted(testsAdapter, ['src'], 'default');

    const exit = await runProjection(adapter, { cwd: repo, force: true });

    expect(exit).toBe(0);
    await expect(cachedFor('feat', 'tests')).resolves.toEqual([]);
  });

  it('empties links.docs under --force when the final @feature tag is gone', async () => {
    writeFd('feat', { docs: ['docs/user/how-to/gone.md'] });
    const adapter = rooted(docsAdapter, ['docs/user/how-to'], 'default');

    await runProjection(adapter, { cwd: repo, force: true });

    await expect(cachedFor('feat', 'docs')).resolves.toEqual([]);
  });

  it('drops only the removed path while other tags survive', async () => {
    writeFileSync(join(repo, 'src', 'a.test.ts'), '// @tests: feat\n', 'utf8');
    writeFd('feat', { tests: ['src/a.test.ts', 'src/gone.test.ts'] });

    await runProjection(rooted(testsAdapter, ['src'], 'default'), { cwd: repo });

    await expect(cachedFor('feat', 'tests')).resolves.toEqual(['src/a.test.ts']);
  });
});

describe('empty-scan policy', () => {
  it('keeps cached entries and reports the FD when no tag matched and --force is absent', async () => {
    writeFd('feat', { docs: ['docs/user/how-to/gone.md'] });

    const exit = await runProjection(rooted(docsAdapter, ['docs/user/how-to'], 'default'), {
      cwd: repo,
    });

    expect(exit).toBe(0);
    await expect(cachedFor('feat', 'docs')).resolves.toEqual(['docs/user/how-to/gone.md']);
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain('feat');
  });

  it('clears nothing and exits non-zero when a configured root is missing', async () => {
    writeFd('feat', { tests: ['src/gone.test.ts'] });
    const adapter = rooted(testsAdapter, ['not-there'], 'configured');

    const exit = await runProjection(adapter, { cwd: repo, force: true });

    expect(exit).toBe(1);
    await expect(cachedFor('feat', 'tests')).resolves.toEqual(['src/gone.test.ts']);
  });

  it('proceeds normally when a missing root is only a default', async () => {
    writeFd('feat', { tests: ['src/gone.test.ts'] });
    const adapter = rooted(testsAdapter, ['not-there'], 'default');

    const exit = await runProjection(adapter, { cwd: repo, force: true });

    expect(exit).toBe(0);
    await expect(cachedFor('feat', 'tests')).resolves.toEqual([]);
  });

  it('clears nothing when an existing root cannot be read', async () => {
    const locked = join(repo, 'locked');
    mkdirSync(locked);
    chmodSync(locked, 0o000);
    writeFd('feat', { tests: ['src/gone.test.ts'] });

    const exit = await runProjection(rooted(testsAdapter, ['locked'], 'default'), {
      cwd: repo,
      force: true,
    });
    chmodSync(locked, 0o755);

    expect(exit).toBe(1);
    await expect(cachedFor('feat', 'tests')).resolves.toEqual(['src/gone.test.ts']);
  });
});

describe('unreadable inputs never read as an empty scan', () => {
  it('clears nothing when a listed file disappears before it is read', async () => {
    writeFd('feat', { tests: ['src/gone.test.ts'] });
    const vanishing = join(repo, 'src', 'vanishing.test.ts');
    writeFileSync(vanishing, '// @tests: feat\n', 'utf8');
    const adapter: LinkAdapter = {
      ...testsAdapter,
      roots: (cwd) => [{ path: join(cwd, 'src'), origin: 'default' }],
      // Delete the file between the directory listing and the read.
      eligible: (name) => {
        if (name === 'vanishing.test.ts') rmSync(vanishing, { force: true });
        return testsAdapter.eligible(name);
      },
    };

    const exit = await runProjection(adapter, { cwd: repo, force: true });

    expect(exit).toBe(1);
    await expect(cachedFor('feat', 'tests')).resolves.toEqual(['src/gone.test.ts']);
  });

  it('clears nothing when one FD frontmatter will not parse', async () => {
    writeFd('feat', { tests: ['src/gone.test.ts'] });
    writeFileSync(
      join(repo, 'docs', 'features', 'broken.md'),
      '---\nname: [unclosed\n---\n\n## Summary\n',
      'utf8',
    );

    const exit = await runProjection(rooted(testsAdapter, ['src'], 'default'), {
      cwd: repo,
      force: true,
    });

    expect(exit).toBe(1);
    await expect(cachedFor('feat', 'tests')).resolves.toEqual(['src/gone.test.ts']);
  });
});

describe('--check', () => {
  it('exits 0 when the cache matches the scan', async () => {
    writeFileSync(join(repo, 'src', 'a.test.ts'), '// @tests: feat\n', 'utf8');
    writeFd('feat', { tests: ['src/a.test.ts'] });

    const exit = await runProjection(rooted(testsAdapter, ['src'], 'default'), {
      cwd: repo,
      check: true,
    });

    expect(exit).toBe(0);
  });

  it('exits 1 and names the stale FD without writing', async () => {
    writeFileSync(join(repo, 'src', 'a.test.ts'), '// @tests: feat\n', 'utf8');
    writeFd('feat', { tests: ['src/stale.test.ts'] });

    const exit = await runProjection(rooted(testsAdapter, ['src'], 'default'), {
      cwd: repo,
      check: true,
    });

    expect(exit).toBe(1);
    await expect(cachedFor('feat', 'tests')).resolves.toEqual(['src/stale.test.ts']);
  });
});

describe('--quiet', () => {
  it('suppresses the tagless-kept report that a plain run prints', async () => {
    writeFd('feat', { docs: ['docs/user/how-to/gone.md'] });
    const adapter = rooted(docsAdapter, ['docs/user/how-to'], 'default');

    await runProjection(adapter, { cwd: repo, quiet: true });
    const quiet = vi.mocked(console.log).mock.calls.flat().join('\n');
    vi.mocked(console.log).mockClear();
    await runProjection(adapter, { cwd: repo });
    const loud = vi.mocked(console.log).mock.calls.flat().join('\n');

    expect(quiet).not.toContain('existing links kept');
    expect(loud).toContain('existing links kept');
  });
});

describe('doc tag anchoring', () => {
  it('ignores the convention quoted in a table cell or after a bullet', async () => {
    writeFileSync(
      join(repo, 'docs', 'user', 'how-to', 'conventions.md'),
      '# Conventions\n\n| cmd | tag |\n| --- | <!-- @feature: <slug> --> |\n' +
        '\n- Tag the doc with `<!-- @feature: quoted -->` near the top.\n',
      'utf8',
    );
    writeFd('real', { docs: [] });

    await runProjection(rooted(docsAdapter, ['docs/user/how-to'], 'default'), { cwd: repo });

    await expect(cachedFor('real', 'docs')).resolves.toEqual([]);
  });

  it('honors a tag at line start', async () => {
    writeFileSync(
      join(repo, 'docs', 'user', 'how-to', 'guide.md'),
      '<!-- @feature: real -->\n\n# Guide\n',
      'utf8',
    );
    writeFd('real', { docs: [] });

    await runProjection(rooted(docsAdapter, ['docs/user/how-to'], 'default'), { cwd: repo });

    await expect(cachedFor('real', 'docs')).resolves.toEqual(['docs/user/how-to/guide.md']);
  });
});

describe('adapter preserve and unownable policy', () => {
  it('keeps a directory entry through a code projection', () => {
    const result = project(['src/a.ts'], ['packages/scenes', 'src/old.ts'], codeAdapter, true);
    expect(result).toEqual({ skipped: false, next: ['packages/scenes', 'src/a.ts'] });
  });

  it('has no directory-preservation path for tests or docs', () => {
    for (const adapter of [testsAdapter, docsAdapter]) {
      expect(project(['a'], ['some/dir'], adapter, true)).toEqual({ skipped: false, next: ['a'] });
    }
  });

  it('omits an FD whose kept entries all sit under a templated root', () => {
    const cached = new Map<string, string[]>([
      ['framework', ['docs/noldor/drain-mode.md']],
      ['owned', ['docs/user/how-to/a.md']],
    ]);
    expect(taglessKeptSlugs(new Map(), cached, docsAdapter)).toEqual(['owned']);
  });

  it('still refuses to clear the templated entries it declines to report', () => {
    expect(project([], ['docs/noldor/drain-mode.md'], docsAdapter).skipped).toBe(true);
  });
});

describe('byte-identical FDs', () => {
  it('projects each independently rather than aliasing one frontmatter object', async () => {
    // gray-matter memoizes by content string, so two FDs whose frontmatter
    // matches byte for byte share one parsed `data`. Writing through it would
    // let the first FD's projection decide the second's.
    for (const slug of ['one', 'two']) {
      writeFileSync(
        join(repo, 'docs', 'features', `${slug}.md`),
        '---\nname: same\nlinks:\n  tests:\n    - src/gone.test.ts\n---\n\n## Summary\n\nx\n',
        'utf8',
      );
    }
    writeFileSync(join(repo, 'src', 'a.test.ts'), '// @tests: two\n', 'utf8');

    await runProjection(rooted(testsAdapter, ['src'], 'default'), { cwd: repo, force: true });

    await expect(cachedFor('one', 'tests')).resolves.toEqual([]);
    await expect(cachedFor('two', 'tests')).resolves.toEqual(['src/a.test.ts']);
  });
});

describe('failure reporting', () => {
  it('describes each failing input in terms that match how it is fixed', async () => {
    writeFd('feat', { tests: ['src/gone.test.ts'] });
    writeFileSync(
      join(repo, 'docs', 'features', 'unreportable.md'),
      '---\nname: [unclosed-for-reporting\n---\n\n## Summary\n',
      'utf8',
    );

    await runProjection(rooted(testsAdapter, ['src'], 'default'), { cwd: repo, force: true });

    const printed = vi.mocked(console.error).mock.calls.flat().join('\n');
    expect(printed).toContain('cannot parse feature MD');
    expect(printed).not.toContain('cannot read scan root');
  });
});

describe('collectTaggedMany', () => {
  it('classifies code and tests from one traversal of the shared root', async () => {
    writeFileSync(join(repo, 'src', 'a.ts'), '// @fd: feat\n', 'utf8');
    writeFileSync(join(repo, 'src', 'a.test.ts'), '// @tests: feat\n', 'utf8');
    const adapters = [
      rooted(codeAdapter, ['src'], 'default'),
      rooted(testsAdapter, ['src'], 'default'),
    ];

    const scans = await collectTaggedMany(adapters, repo);

    expect(scans.get('code')?.tagged.map((t) => t.path)).toEqual(['src/a.ts']);
    expect(scans.get('tests')?.tagged.map((t) => t.path)).toEqual(['src/a.test.ts']);
  });

  it('reports an unreadable root on every kind sharing it', async () => {
    const adapters = [
      rooted(codeAdapter, ['missing'], 'configured'),
      rooted(testsAdapter, ['missing'], 'configured'),
    ];

    const scans = await collectTaggedMany(adapters, repo);

    expect(scans.get('code')?.failures).toHaveLength(1);
    expect(scans.get('tests')?.failures).toHaveLength(1);
  });
});

describe('diffProjection', () => {
  it('excludes FDs the write path would skip', () => {
    const cached = new Map<string, string[]>([['feat', ['docs/user/how-to/gone.md']]]);
    expect(diffProjection(new Map(), cached, docsAdapter)).toEqual([]);
  });
});
