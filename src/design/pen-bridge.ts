// @tests: pendev-ui-design-phase
// The pencil bridge: which editor drives `.pen` files, and how a session wakes
// the bridge instead of waiving the UI-design step.
//
// The editor is VS Code, via the pen.dev extension. Pencil MCP is the write API
// regardless — every call fails with "A file needs to be open in the editor"
// until SOME `.pen` is open there. That is a bridge-liveness gate, not a
// per-file lock: once any file is open, `execute` routes to any EXISTING `.pen`
// by `filePath`, including a scratch copy that was never opened. A `filePath`
// that does not exist is worse than an error — the write silently lands on the
// canvas the editor has open (Q-0187). The first two facts were observed in the
// render-compare export spike (2026-08-21) and lived only in that spec plus one
// lane prompt string; the recipe below is the shared source.

import {
  PENCIL_EXTENSION_ID,
  PENCIL_VIEW_TYPE,
  UI_BASELINE_DIR,
} from '../core/design-artifact-names.js';

// Re-exported so `.pen` callers reach the editor's identity through the module
// that owns the bridge, while the constants themselves stay in the core leaf —
// `noldor init` needs the view type and must not pull `src/design` into its
// import closure to get it.
export { PENCIL_EXTENSION_ID, PENCIL_VIEW_TYPE };

/** The MCP error that means the bridge is down rather than the file is bad. */
export const BRIDGE_DOWN_MESSAGE = 'A file needs to be open in the editor';

/** Where a bootstrap `.pen` is authored when the repo holds none. */
export const BRIDGE_BOOTSTRAP_PATH = 'docs/design/ui/bridge-scratch.pen';

/**
 * A `.pen` to open, ranked. Feature designs first (a session's own artifact is
 * the most likely thing the operator wants on screen), then baselines, then
 * anything else — the bridge only needs *a* file, so a far-away match is still
 * a win over waiving.
 */
export function rankPenCandidates(paths: readonly string[]): string[] {
  const rank = (p: string): number => {
    if (p.startsWith(`${UI_BASELINE_DIR}/`)) return 1;
    if (p.startsWith('docs/design/ui/')) return 0;
    return 2;
  };
  return [...paths]
    .filter((p) => p.endsWith('.pen'))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * What to do about the bridge. `open` names an existing `.pen` to hand to the
 * editor; `bootstrap` means the repo has none, so the editor must author one —
 * a distinct outcome because a hand-written `.pen` is not a design, and
 * reporting it as an ordinary open would claim a live bridge that isn't.
 */
export type PenBridgePlan = { kind: 'open'; path: string } | { kind: 'bootstrap'; path: string };

/**
 * Pick the file that wakes the bridge. `preferred` (a caller's own `.pen`, e.g.
 * a lane's scratch copy) short-circuits the ranking; otherwise the best
 * candidate wins, and an empty repo falls through to bootstrap.
 *
 * Pure, so existence is the caller's job: every path passed here must already
 * be on disk. A missing file wakes nothing, and an `open` plan naming one would
 * report a retry that can never succeed — see `trackedPenFiles` and the `--pen`
 * validation in `pen-bridge-cli.ts`, which own that check at the FS boundary.
 */
export function planPenBridge(paths: readonly string[], preferred?: string): PenBridgePlan {
  if (preferred !== undefined && preferred.endsWith('.pen')) {
    return { kind: 'open', path: preferred };
  }
  const [best] = rankPenCandidates(paths);
  return best === undefined
    ? { kind: 'bootstrap', path: BRIDGE_BOOTSTRAP_PATH }
    : { kind: 'open', path: best };
}

/**
 * The bridge-wake recipe, as a prompt fragment. Shared by every lane prompt
 * that talks to pencil MCP so the recovery step cannot drift between them —
 * `penPath` is the file that lane already owns.
 */
export function penBridgeRecipe(penPath: string): string {
  return `If every pencil MCP call fails with "${BRIDGE_DOWN_MESSAGE}", the bridge is down, not the file: run \`pnpm noldor design pen-bridge --pen ${penPath}\`, wait a few seconds, and retry the call. Once any \`.pen\` is open in VS Code, \`execute\` reaches this file by \`filePath\` even if it was never opened. A bare \`pnpm noldor design pen-bridge\` picks a tracked \`.pen\` when you have no path of your own. Exit 0 means the open was requested, not that a canvas came up — retrying the MCP call is the only way to find out. Exit 3 means the pen.dev extension (\`${PENCIL_EXTENSION_ID}\`) is not installed, so VS Code would show the file's raw JSON instead of a canvas; that is an operator action.

If instead the pencil MCP tools are absent altogether — no such tool to call, or the server reported a closed connection at session start — the harness is the cause and none of the above applies. The pencil server does not connect under the Claude Code VS Code extension; it connects from terminal Claude Code with the same configuration. Run \`pnpm noldor checks pen-bridge\` to confirm which harness this session is (its first row names it), and if it reports an unsupported harness, ask the operator to redo this step from a terminal — there is no configuration edit, and no choice of \`.pen\` editor, that fixes it from here.`;
}
