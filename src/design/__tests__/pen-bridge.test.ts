// @tests: pendev-ui-design-phase
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BRIDGE_BOOTSTRAP_PATH,
  BRIDGE_DOWN_MESSAGE,
  PENCIL_EXTENSION_ID,
  penBridgeRecipe,
  planPenBridge,
  rankPenCandidates,
} from '../pen-bridge.js';
import {
  main,
  openPenFile,
  renderLaunchFailure,
  renderPlan,
  trackedPenFiles,
  type PenLaunchDeps,
} from '../pen-bridge-cli.js';

/**
 * Scripted launcher seams: which extensions VS Code reports, and what the editor
 * launch returned. `undefined` extensions models a list that could not be read,
 * which is a different input from an empty one.
 */
function launcher(opts: {
  extensions?: readonly string[] | undefined;
  unreadable?: boolean;
  open?: { ok: boolean; error?: string };
}) {
  const opened: { absPath: string; cwd: string }[] = [];
  const deps: PenLaunchDeps = {
    listExtensions: () =>
      opts.unreadable === true ? undefined : (opts.extensions ?? [PENCIL_EXTENSION_ID]),
    open: (absPath, cwd) => {
      opened.push({ absPath, cwd });
      return opts.open ?? { ok: true };
    },
  };
  return { opened, deps };
}

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
  it('names the harness, not the file, as the cause of absent MCP tools', () => {
    const out = penBridgeRecipe('/tmp/scratch.pen');
    expect(out).toContain('checks pen-bridge');
    expect(out).toMatch(/terminal Claude Code/);
  });

  // The extension is what makes a launch a canvas rather than a text buffer, so
  // the shared recipe has to say what exit 3 means.
  it('tells the reader what a missing pen.dev extension looks like', () => {
    expect(penBridgeRecipe('/tmp/scratch.pen')).toContain(PENCIL_EXTENSION_ID);
  });
});

describe('openPenFile', () => {
  it('hands the absolute path to the editor when the extension is installed', () => {
    const { opened, deps } = launcher({ extensions: ['other.thing', PENCIL_EXTENSION_ID] });
    expect(openPenFile('/repo/docs/design/ui/a.pen', '/repo', deps)).toEqual({
      kind: 'dispatched',
    });
    expect(opened).toEqual([{ absPath: '/repo/docs/design/ui/a.pen', cwd: '/repo' }]);
  });

  // Without the extension VS Code renders the design's raw JSON in a text
  // buffer. That opens no canvas, so dispatching it would report a false wake.
  it('refuses without launching when the pen.dev extension is absent', () => {
    const { opened, deps } = launcher({ extensions: ['ms-vscode.other'] });
    expect(openPenFile('/repo/a.pen', '/repo', deps)).toEqual({ kind: 'not-installed' });
    expect(opened).toHaveLength(0);
  });

  it('refuses without launching when nothing at all is installed', () => {
    const { opened, deps } = launcher({ extensions: [] });
    expect(openPenFile('/repo/a.pen', '/repo', deps)).toEqual({ kind: 'not-installed' });
    expect(opened).toHaveLength(0);
  });

  // An unreadable list is not an empty one. Refusing here would turn a missing
  // `code` on PATH into a confident report about extensions, and would withhold
  // the one action that might still work.
  it('still launches when the extension list could not be read', () => {
    const { opened, deps } = launcher({ unreadable: true });
    expect(openPenFile('/repo/a.pen', '/repo', deps)).toEqual({ kind: 'dispatched' });
    expect(opened).toHaveLength(1);
  });

  it('reports a refused editor launch as failed, carrying the reason', () => {
    const { deps } = launcher({ open: { ok: false, error: 'code: command not found' } });
    expect(openPenFile('/repo/a.pen', '/repo', deps)).toEqual({
      kind: 'failed',
      error: 'code: command not found',
    });
  });

  it('substitutes a reason when the launch failed without one', () => {
    const { deps } = launcher({ open: { ok: false } });
    const out = openPenFile('/repo/a.pen', '/repo', deps);
    expect(out.kind).toBe('failed');
    expect(out).toMatchObject({ error: expect.stringMatching(/\S/) as unknown as string });
  });
});

describe('renderLaunchFailure', () => {
  // The remedy is the whole value: "install the app" would send the operator to
  // the editor this path deliberately left behind.
  it('names the extension, not an app, as the missing piece', () => {
    const out = renderLaunchFailure({ kind: 'not-installed' }, '/repo/a.pen');
    expect(out).toContain(PENCIL_EXTENSION_ID);
    expect(out).toContain('raw JSON');
    expect(out).not.toMatch(/desktop app/i);
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
    expect(out).toMatch(/VS Code/);
  });

  // A design saved outside the repo is a design nothing commits, so "create
  // one" alone loses it.
  it('tells a bootstrap plan to save into the repo', () => {
    expect(renderPlan({ kind: 'bootstrap', path: BRIDGE_BOOTSTRAP_PATH })).toMatch(
      /INSIDE this repo/i,
    );
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

  /** stdout captured across one `main` call, driving the real launcher. */
  // NOT Partial: the compiler, not the comment below, is what keeps a case from
  // omitting a seam and falling through to a real editor spawn.
  async function runMain(deps: PenLaunchDeps): Promise<{ code: number; out: string }> {
    const lines: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => void lines.push(a.map(String).join(' '));
    const err = console.error;
    console.error = () => {};
    try {
      const code = await main(['--pen', 'kept.pen'], repo, deps);
      return { code, out: lines.join('\n') };
    } finally {
      console.log = log;
      console.error = err;
    }
  }

  // The whole point of the `dispatched` naming is that nothing claims a wake
  // that did not happen. Printing the plan before launching defeats it: an
  // outcome that opened nothing still told the reader to retry MCP. Every case
  // supplies BOTH seams, so none can reach a real editor spawn — an earlier
  // revision passed a stub where deps were expected, a field came back
  // undefined, and a junk temp file went to the real editor.
  it.each([
    ['a missing extension', launcher({ extensions: [] }).deps, 3],
    ['a failed launch', launcher({ open: { ok: false, error: 'boom' } }).deps, 2],
  ])('says nothing about a request on %s', async (_label, deps, expected) => {
    const { code, out } = await runMain(deps);
    expect(code).toBe(expected);
    expect(out).not.toContain('requested');
    expect(out).not.toContain('retry the failing pencil MCP');
  });

  it('reports the request only once the launcher dispatched one', async () => {
    const { code, out } = await runMain(launcher({}).deps);
    expect(code).toBe(0);
    expect(out).toContain('requested');
  });
});
