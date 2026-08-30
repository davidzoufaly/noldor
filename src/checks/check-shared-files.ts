import { execFileSync } from 'node:child_process';

import {
  ARCHIVE_DIR,
  penSlugFromFilename,
  UI_BASELINE_DIR,
  UI_DESIGN_DIR,
} from '../core/design-artifact-names.js';
import { isSlug } from '../core/slug.js';
import {
  APPROVAL_DIR_SEGMENTS,
  approvalRelPath,
  parseApprovalBytes,
} from '../design/design-approval.js';

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

/** Git's all-zero "no content" oid, as `--raw` prints it for the absent side. */
const ZERO_OID_RE = /^0+$/;

/** One staged path with the change that produced it and its destination blob. */
export interface StagedChange {
  readonly path: string;
  readonly change: ChangeKind;
  /**
   * The index-side object id (`--no-abbrev`, full width). All zeros for a
   * delete or an unmerged entry — never a content id, never equal to any
   * stored `penBlob`.
   */
  readonly blob: string;
}

/** Why a staged path is refused. */
export type BlockReason =
  | 'shared-root'
  | 'pen-baseline'
  | 'pen-archive'
  | 'pen-unapproved'
  | 'pen-approval-mismatch';

/** One refused path with its reason. */
export interface Violation {
  readonly path: string;
  readonly reason: BlockReason;
}

/**
 * Parse `git diff --cached --raw -z --no-abbrev` output into staged changes.
 *
 * `--raw` rather than `--name-status` because the record carries the
 * destination object id, which the design-approval rule compares against the
 * record's stored `penBlob` — and `--no-abbrev` because the raw format
 * abbreviates by default, and an abbreviated oid can never equal a full one,
 * which would refuse every correctly-approved `.pen`. `-z` because the plain
 * form quotes and escapes paths containing spaces or non-ASCII, which no
 * downstream prefix test would match.
 *
 * Rename and copy records carry two paths; a rename expands to
 * `delete(old) + add(new)` so that "moved into `archive/`" reads as an add
 * (sanctioned by `design archive`) while "moved out of `archive/`" reads as a
 * delete (never sanctioned) — and so a `.pen` renamed or copied into the
 * feature directory is an add the approval rule sees.
 *
 * @param raw - Raw stdout of the `--raw -z --no-abbrev` diff.
 * @returns One {@link StagedChange} per affected path, in git's order.
 */
export function parseRawDiff(raw: string): readonly StagedChange[] {
  const fields = raw.split('\0').filter((f) => f.length > 0);
  const out: StagedChange[] = [];
  let i = 0;
  while (i < fields.length) {
    // `:<old mode> <new mode> <old oid> <new oid> <status>` — space-separated.
    const header = fields[i] ?? '';
    const tokens = header.split(' ');
    const dstOid = tokens[3] ?? '';
    const status = tokens[4] ?? '';
    const code = status.charAt(0);
    if (!header.startsWith(':') || code === '') break; // truncated record — nothing trustworthy follows
    if (code === 'R' || code === 'C') {
      const from = fields[i + 1];
      const to = fields[i + 2];
      if (from === undefined || to === undefined) break;
      if (code === 'R') out.push({ path: from, change: 'delete', blob: '0' });
      out.push({ path: to, change: 'add', blob: dstOid });
      i += 3;
      continue;
    }
    const path = fields[i + 1];
    if (path === undefined) break;
    out.push({
      path,
      change: code === 'A' ? 'add' : code === 'D' ? 'delete' : 'modify',
      blob: dstOid,
    });
    i += 2;
  }
  return out;
}

function isPen(path: string): boolean {
  return path.endsWith('.pen');
}

const FEATURE_PEN_PREFIX = `${UI_DESIGN_DIR}/`;

/**
 * A FEATURE `.pen`: under `docs/design/ui/`, `archive/` included — an add into
 * `archive/` is usually `design archive`'s sanctioned move of a file whose
 * record (keyed by the unchanged stem, bound to the unchanged blob) is already
 * committed, and that satisfies the approval rules for free; a `.pen` added
 * DIRECTLY into `archive/` with no record would otherwise be the guard's
 * bypass. Baseline pens are excluded: undated (unkeyable by design), covered
 * by their own rule, and never verdict targets.
 */
function isFeaturePen(path: string): boolean {
  return isPen(path) && path.startsWith(FEATURE_PEN_PREFIX) && !path.startsWith(BASELINE_PREFIX);
}

/**
 * The record bytes the resulting tree will hold for a record path, or `null`
 * when it will hold none. Injected into {@link evaluate} so the decision stays
 * a pure function over data; {@link stagedAwareRecordLookup} is the production
 * shape.
 */
export type RecordLookup = (recordRelPath: string) => string | null;

/**
 * The blob the resulting tree will hold for a stem's `.pen` (feature path or
 * its `archive/`), or `null` when neither survives the commit. Injected for
 * the record-tamper rule below; {@link stagedAwarePenLookup} is the production
 * shape.
 */
export type PenBlobLookup = (stem: string) => string | null;

const APPROVAL_PREFIX = `${APPROVAL_DIR_SEGMENTS.join('/')}/`;

/**
 * Production {@link PenBlobLookup}: staged entry first (a staged delete or a
 * zero oid means that path does not survive), `HEAD` for a path the commit
 * does not touch. Checks the feature path, then its `archive/` twin.
 */
export function stagedAwarePenLookup(
  staged: readonly StagedChange[],
  headBlob: (relPath: string) => string | null,
): PenBlobLookup {
  return (stem) => {
    for (const rel of [
      `${FEATURE_PEN_PREFIX}${stem}.pen`,
      `${FEATURE_PEN_PREFIX}${ARCHIVE_DIR}/${stem}.pen`,
    ]) {
      const entry = staged.findLast((s) => s.path === rel);
      if (entry !== undefined) {
        if (entry.change === 'delete' || ZERO_OID_RE.test(entry.blob)) continue;
        return entry.blob;
      }
      const head = headBlob(rel);
      if (head !== null) return head;
    }
    return null;
  };
}

/**
 * Production {@link RecordLookup}, delete-aware: a staged **delete** of the
 * record path resolves to `null` outright — never a fall-through to `HEAD`,
 * where the doomed copy still exists and would fail open; a staged add or
 * modify supplies the staged blob's bytes; only a path absent from the staged
 * set entirely reads the `HEAD` copy (`git add` on an unchanged tracked file
 * stages nothing, so "in this commit's diff" would leave split commits with no
 * legal exit).
 */
export function stagedAwareRecordLookup(
  staged: readonly StagedChange[],
  readBlob: (spec: string) => string | null,
): RecordLookup {
  return (recordRelPath) => {
    const entry = staged.findLast((s) => s.path === recordRelPath);
    if (entry !== undefined) {
      if (entry.change === 'delete') return null;
      return ZERO_OID_RE.test(entry.blob) ? null : readBlob(entry.blob);
    }
    return readBlob(`HEAD:${recordRelPath}`);
  };
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
 * @param staged - Staged changes, e.g. from {@link parseRawDiff}.
 * @param repoRoot - Output of `git rev-parse --show-toplevel`.
 * @param env - Environment dictionary (typically `process.env`).
 * @param records - What the resulting tree holds per record path (see
 *   {@link RecordLookup}); the design-approval rules read records only through
 *   this seam so the decision stays pure over its arguments.
 * @param penBlobs - What the resulting tree holds per stem's `.pen` (see
 *   {@link PenBlobLookup}); the record-tamper rule's seam.
 * @returns Every refused path with its reason; empty means the commit may proceed.
 */
export function evaluate(
  staged: readonly StagedChange[],
  repoRoot: string,
  env: Record<string, string | undefined>,
  records: RecordLookup,
  penBlobs: PenBlobLookup,
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
    // Design-approval rules (Q-0196) sit BEFORE the `penAllowed` short-circuit:
    // NOLDOR_ALLOW_PEN_WRITE authorises the gate's baseline write-back, and a
    // baseline override must not waive an approval requirement it has nothing
    // to do with. Add-only: a design ENTERING the repo must carry its verdict;
    // drift after that is the ui-reviewer lane's `design-approval-stale`.
    if (entry.change === 'add' && isFeaturePen(entry.path)) {
      const base = entry.path.split('/').at(-1) ?? entry.path;
      const key = penSlugFromFilename(base);
      // An unkeyable filename refuses rather than passes: a file the naming
      // scheme cannot identify is one no record can name. The SECOND test is
      // the writable-key requirement — `PEN_FILE_RE`'s key grammar is wider
      // than the record store's slug grammar (`2026-08-30-My-Feature.pen`
      // parses a key `writeApproval` refuses), and demanding a record the CLI
      // can never write would be a dead-end loop, not a remedy.
      if (key === null || !isSlug(base.slice(0, -'.pen'.length))) {
        violations.push({ path: entry.path, reason: 'pen-unapproved' });
        continue;
      }
      const record = records(approvalRelPath(base));
      const parsed = record === null ? null : parseApprovalBytes(record);
      if (parsed === null) {
        violations.push({ path: entry.path, reason: 'pen-unapproved' });
        continue;
      }
      if (parsed.penBlob !== entry.blob) {
        violations.push({ path: entry.path, reason: 'pen-approval-mismatch' });
        continue;
      }
    }
    // Record-tamper rule: the add-only rule above never sees an AMEND that
    // deletes or degrades a record while its `.pen` stays in the tree — the
    // pen is unchanged vs HEAD, so only the record appears in the staged set.
    // Any staged change to a record whose pen survives the commit must leave a
    // usable, matching record behind, or the amended commit would introduce a
    // pen with no valid record — the exact state the invariant forbids.
    if (entry.path.startsWith(APPROVAL_PREFIX) && entry.path.endsWith('.json')) {
      const stem = (entry.path.split('/').at(-1) ?? '').slice(0, -'.json'.length);
      const penBlob = penBlobs(stem);
      if (penBlob !== null) {
        const resulting = records(entry.path);
        const parsed = resulting === null ? null : parseApprovalBytes(resulting);
        if (parsed === null) {
          violations.push({ path: entry.path, reason: 'pen-unapproved' });
          continue;
        }
        if (parsed.penBlob !== penBlob) {
          violations.push({ path: entry.path, reason: 'pen-approval-mismatch' });
          continue;
        }
      }
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
  'pen-unapproved':
    'Feature .pen added with no usable design-approval record in the resulting tree.\n' +
    'Take the verdict, then stage the record it writes alongside the .pen:\n' +
    '  pnpm noldor design verdict --pen <path> --approve --surface <s> [--surface <s>...]\n' +
    '  pnpm noldor design verdict --pen <path> --waive --reason "<why>"\n' +
    'A .pen whose basename does not match <date>-<key>.pen cannot be keyed — rename it to the scheme first.',
  'pen-approval-mismatch':
    'Feature .pen added whose design-approval record names a DIFFERENT version of the design.\n' +
    'The design changed after its verdict — re-take the verdict on the file as it now stands:\n' +
    '  pnpm noldor design verdict --pen <path> --approve|--waive ... (overwrites the record)',
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
  const stagedRaw = execFileSync('git', ['diff', '--cached', '--raw', '-z', '--no-abbrev'], {
    encoding: 'utf-8',
  });
  const staged = parseRawDiff(stagedRaw);
  // Boundary read for the pure evaluate: blob bytes by oid (staged content) or
  // by `HEAD:<path>`. A failed read is `null` — "no usable record", refused.
  const readBlob = (spec: string): string | null => {
    try {
      return execFileSync('git', ['cat-file', 'blob', spec], { encoding: 'utf-8' });
    } catch {
      return null;
    }
  };
  const violations = evaluate(
    staged,
    repoRoot,
    process.env,
    stagedAwareRecordLookup(staged, readBlob),
    stagedAwarePenLookup(staged, (rel) => {
      try {
        return execFileSync('git', ['rev-parse', `HEAD:${rel}`], {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      } catch {
        return null;
      }
    }),
  );
  if (violations.length === 0) return 0;

  for (const reason of [
    'shared-root',
    'pen-unapproved',
    'pen-approval-mismatch',
    'pen-baseline',
    'pen-archive',
  ] as const) {
    const paths = violations.filter((v) => v.reason === reason).map((v) => v.path);
    if (paths.length === 0) continue;
    process.stderr.write(`${REMEDIATION[reason]}\n  ${paths.join('\n  ')}\n`);
  }
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
