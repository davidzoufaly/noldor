import { execFileSync } from 'node:child_process';

import { ARCHIVE_DIR, UI_BASELINE_DIR } from '../core/design-artifact-names.js';

const BLOCK_LIST: ReadonlyArray<string | RegExp> = [
  'CLAUDE.md',
  '.claude/CLAUDE.md',
  '.claude/engineering-rules.md',
  'pnpm-lock.yaml',
  'package.json',
  /^\.claude\/skills\/[^/]+/,
  /^\.claude\/commands\/[^/]+/,
];

const BASELINE_PREFIX = `${UI_BASELINE_DIR}/`;
const ARCHIVE_SEGMENT = `/${ARCHIVE_DIR}/`;
/** Waives both `.pen` rules. Gate Step 4's baseline write-back is the one sanctioned baseline edit. */
const PEN_OVERRIDE = 'NOLDOR_ALLOW_PEN_WRITE';

/** What a staged path had done to it. Renames expand to a delete of the old path plus an add of the new one. */
export type ChangeKind = 'add' | 'modify' | 'delete';

/** One staged path with the change that produced it. */
export interface StagedChange {
  readonly path: string;
  readonly change: ChangeKind;
}

/** Why a staged path is refused. */
export type BlockReason = 'shared-root' | 'pen-baseline' | 'pen-archive';

/** One refused path with its reason. */
export interface Violation {
  readonly path: string;
  readonly reason: BlockReason;
}

/**
 * Parse `git diff --cached --name-status -z` output into staged changes.
 *
 * `-z` because a plain `--name-status` quotes and escapes paths containing
 * spaces or non-ASCII, which no downstream prefix test would match. Rename and
 * copy records carry two paths; a rename expands to `delete(old) + add(new)` so
 * that "moved into `archive/`" reads as an add (sanctioned by `design archive`)
 * while "moved out of `archive/`" reads as a delete (never sanctioned).
 *
 * @param raw - Raw stdout of the `-z` diff.
 * @returns One {@link StagedChange} per affected path, in git's order.
 */
export function parseNameStatus(raw: string): readonly StagedChange[] {
  const fields = raw.split('\0').filter((f) => f.length > 0);
  const out: StagedChange[] = [];
  let i = 0;
  while (i < fields.length) {
    const status = fields[i] ?? '';
    const code = status.charAt(0);
    if (code === 'R' || code === 'C') {
      const from = fields[i + 1];
      const to = fields[i + 2];
      if (from === undefined || to === undefined) break; // truncated record — nothing trustworthy follows
      if (code === 'R') out.push({ path: from, change: 'delete' });
      out.push({ path: to, change: 'add' });
      i += 3;
      continue;
    }
    const path = fields[i + 1];
    if (path === undefined) break;
    out.push({ path, change: code === 'A' ? 'add' : code === 'D' ? 'delete' : 'modify' });
    i += 2;
  }
  return out;
}

function isPen(path: string): boolean {
  return path.endsWith('.pen');
}

/**
 * Decide which staged paths the commit may not carry.
 *
 * Two independent guards. The shared-root list is worktree-scoped: those files
 * are shared across worktrees, so an edit belongs on main where every tree sees
 * it. The `.pen` guards exist because pencil MCP ignores the `filePath` it is
 * given and writes to whatever canvas the app has open, so a wrong target is a
 * silent write to another feature's artifact rather than an error:
 * - a baseline `.pen` touched from a feature worktree is refused, because the
 *   only sanctioned baseline write is the gate's ship-time write-back;
 * - an archived `.pen` modified or deleted is refused everywhere, main worktree
 *   included, because an archived design artifact is immutable once written and
 *   the observed clobber landed in the main workspace.
 *
 * @param staged - Staged changes, e.g. from {@link parseNameStatus}.
 * @param repoRoot - Output of `git rev-parse --show-toplevel`.
 * @param env - Environment dictionary (typically `process.env`).
 * @returns Every refused path with its reason; empty means the commit may proceed.
 */
export function evaluate(
  staged: readonly StagedChange[],
  repoRoot: string,
  env: Record<string, string | undefined>,
): readonly Violation[] {
  const inWorktree = repoRoot.includes('/.worktrees/');
  const penAllowed = env[PEN_OVERRIDE] === '1';
  const sharedAllowed = !inWorktree || env.NOLDOR_ALLOW_SHARED === '1';

  const violations: Violation[] = [];
  for (const entry of staged) {
    if (
      !sharedAllowed &&
      BLOCK_LIST.some((e) => (typeof e === 'string' ? e === entry.path : e.test(entry.path)))
    ) {
      violations.push({ path: entry.path, reason: 'shared-root' });
      continue;
    }
    if (penAllowed || !isPen(entry.path)) continue;
    if (entry.path.includes(ARCHIVE_SEGMENT) && entry.change !== 'add') {
      violations.push({ path: entry.path, reason: 'pen-archive' });
      continue;
    }
    if (inWorktree && entry.path.startsWith(BASELINE_PREFIX)) {
      violations.push({ path: entry.path, reason: 'pen-baseline' });
    }
  }
  return violations;
}

const REMEDIATION: Readonly<Record<BlockReason, string>> = {
  'shared-root':
    'Shared root file(s) edited from a feature worktree.\n' +
    'Move these edits to the main worktree, or set NOLDOR_ALLOW_SHARED=1 to override.',
  'pen-baseline':
    'UI baseline .pen edited from a feature worktree.\n' +
    "The only sanctioned baseline write is the gate's Step 4 write-back — re-run that commit with " +
    `${PEN_OVERRIDE}=1 if this is it.\n` +
    'Otherwise pencil MCP wrote to the wrong canvas (it ignores filePath and edits whatever the app has open):\n' +
    'assert the active canvas with get_app_state before writing, and restore with `git restore --staged --worktree -- <path>`.',
  'pen-archive':
    'Archived .pen modified or removed.\n' +
    "An archived design artifact is immutable once written — this is another feature's record.\n" +
    'Almost always a pencil MCP write against the wrong open canvas: assert with get_app_state, then\n' +
    '`git restore --staged --worktree -- <path>`.',
};

/**
 * Driver: collect git inputs, evaluate, exit 0 or 1 with a clear message.
 *
 * @returns Exit code — `0` means the commit may proceed, `1` means it is blocked.
 */
export function main(): number {
  let repoRoot = '';
  try {
    repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim();
  } catch {
    return 0; // not in a git repo — let other hooks fail loudly
  }
  const stagedRaw = execFileSync('git', ['diff', '--cached', '--name-status', '-z'], {
    encoding: 'utf-8',
  });
  const violations = evaluate(parseNameStatus(stagedRaw), repoRoot, process.env);
  if (violations.length === 0) return 0;

  for (const reason of ['shared-root', 'pen-baseline', 'pen-archive'] as const) {
    const paths = violations.filter((v) => v.reason === reason).map((v) => v.path);
    if (paths.length === 0) continue;
    process.stderr.write(`${REMEDIATION[reason]}\n  ${paths.join('\n  ')}\n`);
  }
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
