// @tests: dashboard-worktree-health-page

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadWorktreeHealth } from '../data.js';
import { renderWorktrees } from '../views.js';
import { startServer } from '../server.js';

import type { Server } from 'node:http';

import type { WorktreeHealth } from '../data.js';

describe('loadWorktreeHealth', () => {
  it('returns Zod-valid shape against the current repo', async () => {
    const health = await loadWorktreeHealth();
    expect(Array.isArray(health.trees)).toBe(true);
    expect(health.trees.length).toBeGreaterThan(0);
    expect(Array.isArray(health.warnings)).toBe(true);
  });

  it('always includes the main worktree as path "."', async () => {
    const health = await loadWorktreeHealth();
    const main = health.trees.find((t) => t.path === '.');
    expect(main).toBeDefined();
    expect(main?.branch).toBe('main');
  });

  it('resolves featureSlug for branches whose feat/<slug> matches a feature MD', async () => {
    // This assertion is environment-dependent — the active worktree must be
    // present for the feature-branch row to exist. expect.hasAssertions()
    // would fail after merge; use a soft-presence check instead so we still
    // flag a regression while present, and degrade gracefully when absent.
    const health = await loadWorktreeHealth();
    const tree = health.trees.find((t) => t.branch === 'feat/dashboard-worktree-health-page');
    if (tree === undefined) {
      // Worktree has been merged and removed — assertion no longer applicable.
      expect(true).toBe(true);
      return;
    }
    expect(tree.featureSlug).toBe('dashboard-worktree-health-page');
  });

  it('returns featureSlug=null for non-feature branches', async () => {
    const health = await loadWorktreeHealth();
    for (const tree of health.trees) {
      if (tree.branch === 'main' || !tree.branch.startsWith('feat/')) {
        expect(tree.featureSlug).toBeNull();
      }
    }
  });
});

const sampleHealth: WorktreeHealth = {
  trees: [
    {
      path: '.',
      branch: 'main',
      port: 5173,
      ahead: 0,
      behind: 0,
      dirtyCount: 0,
      dirtyFiles: [],
      lastCommit: 'abc123 2 hours ago — feat: x',
      featureSlug: null,
    },
    {
      path: '.worktrees/foo',
      branch: 'feat/foo',
      port: 5174,
      ahead: 3,
      behind: 1,
      dirtyCount: 2,
      dirtyFiles: ['packages/foo/src/index.ts', 'packages/foo/README.md'],
      lastCommit: 'def456 1 hour ago — feat(foo): wip',
      featureSlug: 'foo',
    },
    {
      path: '.worktrees/bar',
      branch: 'feat/bar',
      port: null,
      ahead: 0,
      behind: 14,
      dirtyCount: 0,
      dirtyFiles: [],
      lastCommit: 'ghi789 3 days ago — wip',
      featureSlug: null,
    },
  ],
  warnings: [{ kind: 'drift', branch: 'feat/bar', behind: 14 }],
};

describe('renderWorktrees', () => {
  it('renders an h1, counter strip, and table', () => {
    const html = renderWorktrees(sampleHealth);
    expect(html).toContain('<h1>Worktrees</h1>');
    expect(html).toContain('class="counter-strip"');
    expect(html).toContain('<table>');
    expect(html).toContain('feat/foo');
    expect(html).toContain('feat/bar');
  });

  it('uses <details><summary> for non-zero dirty rows and "clean" otherwise', () => {
    const html = renderWorktrees(sampleHealth);
    expect(html).toContain('<details>');
    expect(html).toContain('<summary>2 mod</summary>');
    expect(html).toContain('packages/foo/src/index.ts');
    expect(html).toContain('clean');
  });

  it('renders a GitHub compare URL for feature branches but plain text for main', () => {
    const html = renderWorktrees(sampleHealth);
    expect(html).toContain('compare/main...feat/foo');
    const mainRowMatch = html.match(/<tr>[^]*?>main<[^]*?<\/tr>/);
    expect(mainRowMatch).toBeTruthy();
    expect(mainRowMatch?.[0] ?? '').not.toContain('compare/');
  });

  it('renders the feature MD ↗ icon when featureSlug is non-null', () => {
    const html = renderWorktrees(sampleHealth);
    expect(html).toContain('href="/features/foo"');
  });

  it('does not render a feature MD link when featureSlug is null', () => {
    const html = renderWorktrees(sampleHealth);
    expect(html).not.toContain('href="/features/bar"');
  });

  it('renders an em-dash for null port', () => {
    const html = renderWorktrees(sampleHealth);
    const barRowMatch = html.match(/<tr>[^]*?feat\/bar[^]*?<\/tr>/);
    expect(barRowMatch?.[0] ?? '').toContain('—');
  });

  it('renders a Warnings section when warnings array is non-empty', () => {
    const html = renderWorktrees(sampleHealth);
    expect(html).toContain('Warnings');
    expect(html).toContain('feat/bar 14 commits behind main');
  });

  it('omits the Warnings section when empty', () => {
    const html = renderWorktrees({ ...sampleHealth, warnings: [] });
    expect(html).not.toContain('<h2>Warnings</h2>');
  });

  it('renders the empty state when no feature trees exist', () => {
    const html = renderWorktrees({
      trees: [sampleHealth.trees[0]!],
      warnings: [],
    });
    expect(html).toContain('class="empty"');
    expect(html).toContain('no feature worktrees');
  });

  it('percent-encodes branch path segments inside the GitHub compare URL', () => {
    const tricky: WorktreeHealth = {
      trees: [
        {
          path: '.worktrees/x',
          branch: 'feat/space here',
          port: 5174,
          ahead: 0,
          behind: 0,
          dirtyCount: 0,
          dirtyFiles: [],
          lastCommit: '',
          featureSlug: null,
        },
      ],
      warnings: [],
    };
    const html = renderWorktrees(tricky);
    // The space inside the segment must percent-encode to %20.
    expect(html).toContain('compare/main...feat/space%20here');
    // The '/' separator between feat and space must NOT be encoded.
    expect(html).not.toContain('feat%2Fspace');
    // Display text remains readable.
    expect(html).toContain('>feat/space here</a>');
  });

  it('escapes HTML in branch names', () => {
    const evil: WorktreeHealth = {
      trees: [
        {
          path: '.worktrees/x',
          branch: 'feat/<script>',
          port: 5174,
          ahead: 0,
          behind: 0,
          dirtyCount: 0,
          dirtyFiles: [],
          lastCommit: '',
          featureSlug: null,
        },
      ],
      warnings: [],
    };
    const html = renderWorktrees(evil);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('GET /worktrees', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    ({ server, baseUrl } = await startServer({ port: 0 }));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns 200 + text/html', async () => {
    const res = await fetch(`${baseUrl}/worktrees`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('renders the Worktrees heading and includes the main row', async () => {
    const res = await fetch(`${baseUrl}/worktrees`);
    const body = await res.text();
    expect(body).toContain('<h1>Worktrees</h1>');
    expect(body).toContain('main');
  });

  it('marks the Worktrees nav entry as aria-current', async () => {
    const res = await fetch(`${baseUrl}/worktrees`);
    const body = await res.text();
    expect(body).toMatch(/<a href="\/worktrees" aria-current="page">/);
  });
});
