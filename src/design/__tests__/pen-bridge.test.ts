// @tests: pendev-ui-design-phase
import { describe, expect, it } from 'vitest';

import {
  BRIDGE_BOOTSTRAP_PATH,
  BRIDGE_DOWN_MESSAGE,
  penBridgeRecipe,
  planPenBridge,
  rankPenCandidates,
} from '../pen-bridge.js';
import { renderPlan } from '../pen-bridge-cli.js';

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
