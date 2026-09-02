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
import { appBundleFor, main, openPenFile, renderPlan, trackedPenFiles } from '../pen-bridge-cli.js';

/**
 * A scripted `open` run. `stderr` is the signal that matters — macOS reports a
 * launch failure there, and for `-b` also with a non-zero exit.
 */
function runner(result: { status?: number | null; stderr?: string; error?: Error }) {
  const calls: { cmd: string; args: readonly string[] }[] = [];
  const run = (cmd: string, args: readonly string[]) => {
    calls.push({ cmd, args });
    return { status: result.status ?? 0, stderr: result.stderr ?? '', error: result.error };
  };
  return { calls, run };
}

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
  it('names the failing MCP message and the wake command', () => {
    const recipe = penBridgeRecipe('/tmp/scratch.pen');
    expect(recipe).toContain(BRIDGE_DOWN_MESSAGE);
    expect(recipe).toContain('design pen-bridge --pen /tmp/scratch.pen');
  });

  // The recipe is interpolated into lane prompts, so a surviving `code <path>`
  // sends an agent to an editor this bridge no longer drives.
  it('sends nobody to the VS Code CLI', () => {
    expect(penBridgeRecipe('/tmp/scratch.pen')).not.toContain('code /tmp/scratch.pen');
  });

  // Measured: a GUI launch from a non-GUI context exits 0 and starts nothing,
  // so an agent that believes it can recover alone waives the design step.
  it('says the operator, not the agent, starts a stopped app', () => {
    expect(penBridgeRecipe('/tmp/scratch.pen')).toMatch(/cannot start|start it yourself/i);
  });
});

describe('openPenFile', () => {
  it('asks macOS to open the file in the pencil bundle without taking focus', () => {
    const { calls, run } = runner({});
    const out = openPenFile('/repo/docs/design/ui/a.pen', '/repo', { platform: 'darwin', run });
    expect(out).toEqual({ kind: 'dispatched' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe('open');
    expect(calls[0]?.args).toEqual([
      '-g',
      '-b',
      'dev.pencil.desktop',
      '/repo/docs/design/ui/a.pen',
    ]);
  });

  // There is no `open` and no bundle id off macOS, and the `code` fallback is
  // gone from this path — so spawning anything would be a guess.
  it.each(['linux', 'win32'])('refuses on %s without spawning', (platform) => {
    const { calls, run } = runner({});
    expect(openPenFile('/repo/a.pen', '/repo', { platform, run })).toEqual({
      kind: 'unsupported-platform',
      platform,
    });
    expect(calls).toHaveLength(0);
  });

  // Measured 2026-09-02: `open -g -b <unregistered> f` exits 1 with this marker.
  it('reads the LSCopyApplicationURLs marker as a missing app, not a failed launch', () => {
    const { run } = runner({
      status: 1,
      stderr:
        'LSCopyApplicationURLsForBundleIdentifier() failed while trying to determine the application with bundle identifier dev.pencil.desktop.',
    });
    const out = openPenFile('/repo/a.pen', '/repo', { platform: 'darwin', run });
    expect(out.kind).toBe('not-installed');
  });

  it.each([
    ['a non-zero exit', { status: 3, stderr: '' }],
    ['stderr on a zero exit', { status: 0, stderr: 'kLSNoExecutableErr' }],
    ['a spawn error', { status: null, stderr: '', error: new Error('ENOENT') }],
  ])('reports %s as a failed launch', (_label, result) => {
    expect(
      openPenFile('/repo/a.pen', '/repo', { platform: 'darwin', ...runner(result) }).kind,
    ).toBe('failed');
  });
});

describe('renderPlan', () => {
  it('tells an open plan to retry the MCP call', () => {
    expect(renderPlan({ kind: 'open', path: 'a.pen' })).toContain('retry the failing pencil MCP');
  });

  // `open` exits 0 for a launch that never happened, so the only honest claim
  // is that the open was requested.
  it('claims a request rather than an open', () => {
    const out = renderPlan({ kind: 'open', path: 'a.pen' });
    expect(out).toContain('requested');
    expect(out).not.toContain('opening a.pen');
  });

  it('does not claim to open anything under --print-only', () => {
    const out = renderPlan({ kind: 'open', path: 'a.pen' }, false);
    expect(out).not.toContain('requested');
    expect(out).toContain('a.pen');
    expect(out).not.toContain('code a.pen');
  });

  it('tells a bootstrap plan to author the file in the editor', () => {
    const out = renderPlan({ kind: 'bootstrap', path: BRIDGE_BOOTSTRAP_PATH });
    expect(out).toContain(BRIDGE_BOOTSTRAP_PATH);
    expect(out).toContain('encrypted');
  });

  // The desktop app parks self-authored documents under ~/.pencil/documents/,
  // where nothing commits them — so "create one" alone loses the design.
  it('tells a bootstrap plan to save into the repo', () => {
    expect(renderPlan({ kind: 'bootstrap', path: BRIDGE_BOOTSTRAP_PATH })).toMatch(/save as/i);
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
