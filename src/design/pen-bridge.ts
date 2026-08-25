// @tests: pendev-ui-design-phase
// The pencil bridge: which editor drives `.pen` files, and how a session wakes
// the bridge instead of waiving the UI-design step.
//
// `.pen` is encrypted, so pencil MCP is the only reader — and every MCP call
// fails with "A file needs to be open in the editor" until SOME `.pen` is open
// in a running VS Code Pencil tab. That is a bridge-liveness gate, not a
// per-file lock: once any file is open, `execute` routes to any `.pen` by
// `filePath`, including a scratch copy that was never opened. Both facts were
// observed in the render-compare export spike (2026-08-21) and lived only in
// that spec plus one lane prompt string; the recipe below is the shared source.

/**
 * The declared default editor. The VS Code extension wins over the standalone
 * desktop app for one reason only: `code <file>.pen` wakes the bridge from a
 * shell, so an agent can recover unattended. The desktop app satisfies pencil
 * MCP just as well but has no scriptable open, so it is the fallback a human
 * drives.
 */
export const PENCIL_EDITOR_DEFAULT = 'vscode' as const;

/** VS Code extension that hosts the bridge. */
export const PENCIL_EXTENSION_ID = 'highagency.pencildev';

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
    if (p.startsWith('docs/design/ui/baseline/')) return 1;
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
 * a distinct outcome because Node cannot write a `.pen` (encrypted format), and
 * reporting it as an ordinary open would claim a live bridge that isn't.
 */
export type PenBridgePlan = { kind: 'open'; path: string } | { kind: 'bootstrap'; path: string };

/**
 * Pick the file that wakes the bridge. `preferred` (a caller's own `.pen`, e.g.
 * a lane's scratch copy) short-circuits the ranking; otherwise the best
 * candidate wins, and an empty repo falls through to bootstrap.
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
  return `If every pencil MCP call fails with "${BRIDGE_DOWN_MESSAGE}", the bridge is down, not the file: run \`code ${penPath}\` in a shell (VS Code with the \`${PENCIL_EXTENSION_ID}\` extension is the default editor), wait a few seconds, and retry. Once any \`.pen\` is open in a running Pencil tab, \`execute\` reaches this file by \`filePath\` even if it was never opened. \`pnpm noldor design pen-bridge\` finds and opens a \`.pen\` for you when you have no path of your own; the pencil desktop app is the fallback when no \`code\` command is available, and it has to be opened by hand.`;
}
