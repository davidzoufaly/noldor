// @tests: pendev-ui-design-phase
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BRIDGE_BOOTSTRAP_PATH,
  BRIDGE_DOWN_MESSAGE,
  penBridgeRecipe,
  planPenBridge,
  rankPenCandidates,
} from '../pen-bridge.js';
import { appBundleFor, main, renderPlan, trackedPenFiles } from '../pen-bridge-cli.js';

describe('appBundleFor', () => {
  it.each([
    [
      'the VS Code shim inside its bundle',
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      '/Applications/Visual Studio Code.app',
    ],
    [
      'an Insiders install',
      '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code',
      '/Applications/Visual Studio Code - Insiders.app',
    ],
    [
      'a fork in a non-standard location',
      '/Users/me/Apps/Cursor.app/Contents/Resources/app/bin/code',
      '/Users/me/Apps/Cursor.app',
    ],
    ['the bundle directory itself', '/Applications/Code.app', '/Applications/Code.app'],
  ])('finds the bundle for %s', (_label, bin, expected) => {
    expect(appBundleFor(bin)).toBe(expected);
  });

  it.each([
    ['a Linux system install', '/usr/bin/code'],
    ['a bare relative name', 'code'],
    ['the filesystem root', '/'],
  ])('returns undefined for %s — no bundle, so no background launch', (_label, bin) => {
    expect(appBundleFor(bin)).toBeUndefined();
  });

  // The walk must terminate on every input, since it runs inside a hook.
  it('terminates on a path with no bundle however deep', () => {
    expect(appBundleFor(`/${'a/'.repeat(200)}code`)).toBeUndefined();
  });
});

describe('rankPenCandidates', () => {
  it('prefers a feature design over a baseline over anything else', () => {
    expect(
      rankPenCandidates([
        'vendor/misc.pen',
        'docs/design/ui/baseline/app.pen',
        'docs/design/ui/2026-08-25-foo.pen',
      ]),
    ).toEqual([
      'docs/design/ui/2026-08-25-foo.pen',
      'docs/design/ui/baseline/app.pen',
      'vendor/misc.pen',
    ]);
  });

  it('drops non-.pen paths and orders ties by name', () => {
    expect(
      rankPenCandidates(['docs/design/ui/b.pen', 'README.md', 'docs/design/ui/a.pen']),
    ).toEqual(['docs/design/ui/a.pen', 'docs/design/ui/b.pen']);
  });
});

describe('planPenBridge', () => {
  it('opens the best candidate when the repo tracks one', () => {
    expect(planPenBridge(['x/other.pen', 'docs/design/ui/baseline/app.pen'])).toEqual({
      kind: 'open',
      path: 'docs/design/ui/baseline/app.pen',
    });
  });

  it("short-circuits to the caller's own file", () => {
    expect(planPenBridge(['docs/design/ui/baseline/app.pen'], '/tmp/scratch.pen')).toEqual({
      kind: 'open',
      path: '/tmp/scratch.pen',
    });
  });

  it('ignores a preferred path that is not a .pen', () => {
    expect(planPenBridge(['docs/design/ui/baseline/app.pen'], '/tmp/scratch.png')).toEqual({
      kind: 'open',
      path: 'docs/design/ui/baseline/app.pen',
    });
  });

  it('falls through to bootstrap when no .pen exists', () => {
    // The repo-with-no-design case: Node cannot author an encrypted `.pen`, so
    // this must stay distinguishable from an ordinary open.
    expect(planPenBridge([])).toEqual({ kind: 'bootstrap', path: BRIDGE_BOOTSTRAP_PATH });
  });
});

describe('penBridgeRecipe', () => {
  it('names the failing MCP message, the wake command, and the desktop fallback', () => {
    const recipe = penBridgeRecipe('/tmp/scratch.pen');
    expect(recipe).toContain(BRIDGE_DOWN_MESSAGE);
    expect(recipe).toContain('code /tmp/scratch.pen');
    expect(recipe).toContain('desktop app');
  });
});

describe('renderPlan', () => {
  it('tells an open plan to retry the MCP call', () => {
    expect(renderPlan({ kind: 'open', path: 'a.pen' })).toContain('retry the failing pencil MCP');
  });

  it('does not claim to open anything under --print-only', () => {
    const out = renderPlan({ kind: 'open', path: 'a.pen' }, false);
    expect(out).not.toContain('opening');
    expect(out).toContain('code a.pen');
  });

  it('tells a bootstrap plan to author the file in the editor', () => {
    const out = renderPlan({ kind: 'bootstrap', path: BRIDGE_BOOTSTRAP_PATH });
    expect(out).toContain(BRIDGE_BOOTSTRAP_PATH);
    expect(out).toContain('encrypted');
  });
});

describe('trackedPenFiles', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'pen-bridge-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    writeFileSync(join(repo, 'kept.pen'), 'x');
    writeFileSync(join(repo, 'gone.pen'), 'x');
    execFileSync('git', ['add', 'kept.pen', 'gone.pen'], { cwd: repo });
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('drops an indexed .pen that is missing from the worktree', () => {
    rmSync(join(repo, 'gone.pen'));
    expect(trackedPenFiles(repo)).toEqual(['kept.pen']);
  });

  it('reports no candidates outside a git repo', () => {
    const bare = mkdtempSync(join(tmpdir(), 'pen-bridge-bare-'));
    try {
      expect(trackedPenFiles(bare)).toEqual([]);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it('bootstraps rather than opening when every indexed .pen is deleted', async () => {
    rmSync(join(repo, 'kept.pen'));
    rmSync(join(repo, 'gone.pen'));
    await expect(main(['--print-only'], repo)).resolves.toBe(1);
  });

  it('rejects a --pen path that is not on disk', async () => {
    await expect(main(['--pen', 'nope.pen', '--print-only'], repo)).resolves.toBe(2);
  });

  it('accepts a --pen path that exists', async () => {
    await expect(main(['--pen', 'kept.pen', '--print-only'], repo)).resolves.toBe(0);
  });
});
