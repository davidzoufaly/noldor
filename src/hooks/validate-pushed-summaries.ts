import { spawnSync } from 'node:child_process';

import {
  CREATE_COMMAND,
  FILE as SNAPSHOT_FILE,
  isObjectId,
  readSummaryBodyRolloutSnapshot,
} from '../core/summary-body-rollout.js';
import {
  isExemptByHeader,
  summaryBodyTemplate,
  validateSummaryCommit,
} from '../core/validate-summary-body.js';

/**
 * Git's all-zero object ID, meaning "this ref does not exist".
 *
 * Matched by shape rather than against a 40-character constant, so a SHA-256
 * repository (64 hex digits) is recognised too.
 */
const ZERO_SHA_RE = /^0+$/;

/** rev-list over a large history outruns Node's 1 MiB default. */
const MAX_BUFFER = 64 * 1024 * 1024;

export interface GitOutcome<T> {
  status: number | null;
  stdout: T;
  stderr: string;
}

/**
 * The git surface this module needs, injected so tests can drive command
 * failures and odd object shapes without mocking process globals.
 */
export interface GitRunner {
  text(args: readonly string[], stdin?: string): GitOutcome<string>;
}

export function createGitRunner(cwd: string = process.cwd()): GitRunner {
  return {
    text(args, stdin) {
      const r = spawnSync('git', [...args], {
        cwd,
        encoding: 'utf8',
        maxBuffer: MAX_BUFFER,
        ...(stdin === undefined ? {} : { input: stdin }),
      });
      // A spawn-level failure (git not on PATH, EACCES, cwd gone, maxBuffer
      // overrun) leaves `status` null and `stderr` empty, so every diagnostic
      // downstream would render `exit null` and hand the operator a blocked push
      // with no reason in it. Surface `r.error` as the stderr text instead — the
      // same line `defaultRunGit` in `src/core/branch-added.ts` already carries
      // for this exact failure.
      if (r.error !== undefined) return { status: null, stdout: '', stderr: r.error.message };
      return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    },
  };
}

export interface RefUpdate {
  localRef: string;
  localSha: string;
  remoteRef: string;
  remoteSha: string;
}

export interface Violation {
  sha: string;
  subject: string;
  error: string;
}

/** What discovery subtracted, for the diagnostics that report it. */
export interface NegativeSummary {
  activationTips: number;
  trackingTips: number;
  /** Snapshot tips this clone cannot resolve; reported, never warned about. */
  missingTips: number;
  /** A few of those tips, so an operator who wants them can fetch them. */
  missingSample: string[];
  /**
   * True when the presence probe itself failed, so `missingTips` means "could
   * not determine" rather than "absent". Without this the diagnostic would tell
   * an operator to fetch tips that are sitting in their object store.
   */
  resolveFailed: boolean;
}

export type SummaryScanResult =
  | { kind: 'inactive'; notice: string }
  | { kind: 'ok'; negatives: NegativeSummary }
  | { kind: 'violations'; violations: Violation[]; negatives: NegativeSummary }
  | { kind: 'infra'; message: string };

/**
 * Parse pre-push stdin. Per `git help githooks` each line is
 * `<local ref> SP <local sha> SP <remote ref> SP <remote sha>`.
 *
 * Strict: a line with any other field count is an infrastructure failure rather
 * than something to skip, because silently ignoring a ref update is the one
 * error mode that lets an unvalidated commit through.
 */
export function parseRefLines(lines: readonly string[]): RefUpdate[] | { error: string } {
  const updates: RefUpdate[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4) {
      return { error: `malformed pre-push ref line (expected 4 fields): ${JSON.stringify(line)}` };
    }
    const [localRef, localSha, remoteRef, remoteSha] = fields as [string, string, string, string];
    // Both SHA fields must be object IDs before either reaches `rev-list --stdin`,
    // which accepts pseudo-options there: a line carrying `--no-walk` would reduce
    // the candidate set to the tip alone — reinstating the "a valid tip hides an
    // invalid commit beneath it" hole this module exists to close — and `--not`
    // would empty it entirely and report a silent pass. Other garbage makes
    // rev-list error out and fails closed already; only this class fails open,
    // and validation at a trust boundary is never a permitted cut.
    for (const [label, sha] of [
      ['local', localSha],
      ['remote', remoteSha],
    ] as const) {
      if (!isObjectId(sha)) {
        return {
          error: `malformed pre-push ref line (${label} sha is not an object ID): ${JSON.stringify(line)}`,
        };
      }
    }
    updates.push({ localRef, localSha, remoteRef, remoteSha });
  }
  return updates;
}

/**
 * Every commit OID at a tracking tip of a configured remote — **all** of them,
 * with no attempt to identify which one is being pushed to.
 *
 * Scoping these to the destination would be more precise, and four attempts to
 * do it each broke on a git shape the previous one did not model (URL-form hook
 * arguments, `pushurl`, `insteadOf` aliases, alias-versus-rewritten-URL config
 * storage). Rather than keep growing that classifier — the exact failure this
 * whole redesign exists to stop repeating — the destination's identity is simply
 * not used.
 *
 * Be precise about what that costs, because "cost bound, not integrity claim" is
 * too kind: these are negatives in the same `rev-list` that selects candidates,
 * so **a commit reachable from one of these tips is exempt from then on**, not
 * merely cheaper to reach. That is reachable without an adversary. A branch cut
 * before the activation commit does not carry
 * `.noldor/summary-body-rollout.json`, so pushing it reads an absent snapshot,
 * reports `inactive`, and validates nothing; once those commits land on a remote
 * and are fetched they stay exempt on every later push, and the merge that
 * brings them to the mainline is itself exempt by parent count.
 *
 * The namespace is narrowed to configured remotes, but be honest about how
 * little that buys: every clone already has `origin`, so
 * `git update-ref refs/remotes/origin/anything <sha>` still exempts an arbitrary
 * commit and its whole ancestry, offline, in one command. Verified. The
 * narrowing only rules out namespaces of remotes that do not exist, which no
 * real workflow produces either way. It is kept because it costs one `git
 * remote` call and makes the negative source mean what its name says, not
 * because it closes the hole.
 *
 * The real bound is this: **any commit an author can name is one `update-ref`
 * away from exemption.** That is acceptable only because the same author has
 * `--no-verify`, which is shorter — a local hook cannot defend against the
 * person running it, and this one is not trying to. It defends against
 * forgetting. Anything relying on a stronger claim (a server-side check, a
 * required status) must not be built on this function.
 *
 * Both of these ask git which remotes *exist*, never which one is being pushed
 * to, so none of the URL / `insteadOf` / `pushurl` shapes that broke the four
 * scoping attempts come back.
 *
 * What remains exempt is history this clone fetched from a configured remote —
 * commits that crossed the boundary this gate defends before it was watching —
 * and the alternative on the table was subtracting nothing and re-walking the
 * whole post-activation mainline on every new branch. Commits authored after
 * activation on a branch that carries the snapshot are unaffected.
 *
 * The one git call here that is **not** fail-closed. On a non-zero exit the term
 * goes empty and a warning is printed, because fewer negatives can only *enlarge*
 * the candidate set — the worst outcome is a slow push, never a skipped commit.
 */
export function collectTrackingTips(git: GitRunner, warn: (msg: string) => void): string[] {
  const remotes = git.text(['remote']);
  if (remotes.status !== 0) {
    warn(
      `summary-body: could not list remotes (${remotes.stderr.trim() || `exit ${remotes.status}`}) — ` +
        `validating more history than usual`,
    );
    return [];
  }
  // Only namespaces of remotes that actually exist. A repository with none
  // subtracts nothing here, which is correct rather than a failure: there is no
  // fetched history to exempt.
  const namespaces = remotes.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((name) => `refs/remotes/${name}/`);
  if (namespaces.length === 0) return [];

  const r = git.text(['for-each-ref', '--format=%(objectname)', ...namespaces]);
  if (r.status !== 0) {
    warn(
      `summary-body: could not list remote-tracking refs (${r.stderr.trim() || `exit ${r.status}`}) — ` +
        `validating more history than usual`,
    );
    return [];
  }
  return [
    ...new Set(
      r.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * Which of `shas` exist in this clone as commits.
 *
 * One `cat-file --batch-check` rather than a `rev-parse` per tip: a snapshot is
 * tracked and shared, so another clone legitimately lacks a machine-local
 * activation tip, and that must cost one spawn rather than one per tip.
 */
export function resolvableCommits(
  git: GitRunner,
  shas: readonly string[],
  warn: (msg: string) => void = () => {},
): { found: Set<string>; failed: boolean } {
  if (shas.length === 0) return { found: new Set(), failed: false };
  const r = git.text(
    ['cat-file', '--batch-check=%(objectname) %(objecttype)'],
    `${shas.map((s) => `${s}^{commit}`).join('\n')}\n`,
  );
  const found = new Set<string>();
  if (r.status !== 0) {
    // Distinguished from "nothing resolved", which is what an empty set alone
    // would say: every tip would then land in `missing`, all grandfathering
    // would silently vanish, and the diagnostic would tell the operator to fetch
    // objects they already have. Every other negative-source failure here warns;
    // this one must too.
    warn(
      `summary-body: could not check which activation tips are present ` +
        `(${r.stderr.trim() || `exit ${r.status}`}) — validating more history than usual`,
    );
    return { found, failed: true };
  }
  const lines = r.stdout.split('\n').filter((l) => l.trim().length > 0);
  lines.forEach((line, i) => {
    const [, type] = line.trim().split(/\s+/);
    if (type === 'commit') found.add(shas[i]!);
  });
  return { found, failed: false };
}

/** One stored commit's header facts, from a single `git log`. */
export interface CommitHeader {
  parentCount: number;
  message: string;
  noldorPath?: string;
}

/**
 * Load parents, message and the final `Noldor-Path` trailer in **one** command.
 *
 * All three are commit-header fields, so splitting them into three spawns would
 * pay two extra processes on every non-merge commit — the common case — to save
 * one cheap read on merges. A commit message cannot contain a NUL byte, so
 * `%x00` is an unambiguous delimiter.
 */
export function loadCommitHeader(git: GitRunner, sha: string): CommitHeader | { error: string } {
  const r = git.text([
    'log',
    '-1',
    '--format=%P%x00%B%x00%(trailers:key=Noldor-Path,valueonly)',
    sha,
  ]);
  if (r.status !== 0) {
    return { error: `could not read commit ${sha} (${r.stderr.trim() || `exit ${r.status}`})` };
  }
  const parts = r.stdout.split('\0');
  if (parts.length < 3) return { error: `unparseable commit header for ${sha}` };

  const parents = parts[0]!.trim();
  const values = parts[2]!
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean);

  // Exactly one value, or no exemption. Zero means the trailer is absent;
  // duplicate or conflicting values are a schema problem the trailer validator
  // reports, and must not resolve to an automation bypass here.
  const header: CommitHeader = {
    parentCount: parents.length === 0 ? 0 : parents.split(/\s+/).length,
    message: parts[1]!,
  };
  if (values.length === 1) header.noldorPath = values[0]!;
  return header;
}

/**
 * The exact paths a commit stored.
 *
 * `-z` on argv is what does the work: without it git renders a non-ASCII or
 * whitespace-bearing path as a quoted C string (`"src/caf\303\251.ts"`), which
 * then matches no glob, so `touchesCode` says false and a real source rewrite is
 * classified as prose. Splitting on NUL rather than newline is the other half —
 * a path may legally contain a newline. `--root` so a root commit reports its own
 * tree rather than nothing.
 *
 * // noldor:cut UTF-8 decoding of paths — a path is bytes, and a genuinely
 * non-UTF-8 one decodes with U+FFFD replacements. Classification still holds,
 * because every glob that decides it keys on ASCII (`src/`, `.ts`), and those
 * bytes are unaffected. Upgrade path: split the raw Buffer on `0x00` and decode
 * each segment as `latin1` if a path's exact bytes ever need to survive.
 */
export function loadCommitFiles(git: GitRunner, sha: string): string[] | { error: string } {
  const r = git.text(['diff-tree', '--root', '-r', '--no-commit-id', '--name-only', '-z', sha]);
  if (r.status !== 0) {
    return { error: `could not read paths for ${sha} (${r.stderr.trim() || `exit ${r.status}`})` };
  }
  return r.stdout.split('\0').filter((p) => p.length > 0);
}

/**
 * Every commit newly reachable through the updated refs, minus the activation
 * snapshot's closure and minus everything already observed on a remote.
 *
 * Revisions travel on stdin, never argv: a repository with a few thousand refs
 * would otherwise push the argument list toward `ARG_MAX`, and that spawn failure
 * is fail-closed — a push blocked by an optimisation.
 */
function discoverCandidates(
  git: GitRunner,
  updates: readonly RefUpdate[],
  negatives: readonly string[],
): string[] | { error: string } {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const u of updates) {
    // A deletion transfers no objects.
    if (ZERO_SHA_RE.test(u.localSha)) continue;

    const revs = [u.localSha, ...negatives.map((n) => `^${n}`)];

    // An existing remote ref whose old value this clone does not have is the
    // routine non-fast-forward case (the remote moved, no fetch yet). Dropping
    // the negative validates strictly more and leaves git's own "Updates were
    // rejected" as the message the operator sees, instead of pre-empting it with
    // an infrastructure failure.
    if (
      !ZERO_SHA_RE.test(u.remoteSha) &&
      resolvableCommits(git, [u.remoteSha]).found.has(u.remoteSha)
    ) {
      revs.push(`^${u.remoteSha}`);
    }

    const r = git.text(
      ['rev-list', '--reverse', '--topo-order', '--stdin'],
      `${revs.join('\n')}\n`,
    );
    if (r.status !== 0) {
      return {
        error: `rev-list failed for ${u.remoteRef} (${r.stderr.trim() || `exit ${r.status}`})`,
      };
    }
    for (const sha of r.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)) {
      if (seen.has(sha)) continue;
      seen.add(sha);
      ordered.push(sha);
    }
  }
  return ordered;
}

/**
 * Validate every outgoing commit object for this push.
 *
 * Policy violations aggregate — an operator rewording history wants the whole
 * list in one run. Infrastructure failures stop immediately: a partial scan
 * cannot truthfully report whether the remaining objects pass.
 */
export function validatePushedSummaries(opts: {
  git: GitRunner;
  refLines: readonly string[];
  cwd?: string;
  warn?: (msg: string) => void;
}): SummaryScanResult {
  const { git } = opts;
  const warn = opts.warn ?? ((msg: string) => process.stderr.write(`${msg}\n`));

  const read = readSummaryBodyRolloutSnapshot(opts.cwd ?? process.cwd());
  if (read.kind === 'absent') {
    return {
      kind: 'inactive',
      notice:
        `summary-body: gate inactive — ${SNAPSHOT_FILE} is missing. ` +
        `Run \`${CREATE_COMMAND}\` and commit the result to activate it.`,
    };
  }
  if (read.kind === 'invalid') {
    return {
      kind: 'infra',
      message:
        `summary-body: ${SNAPSHOT_FILE} is corrupt (${read.reason}).\n` +
        `Repair or delete it — a corrupt activation snapshot blocks the push rather ` +
        `than silently widening what counts as already-grandfathered.`,
    };
  }

  const parsed = parseRefLines(opts.refLines);
  if ('error' in parsed) return { kind: 'infra', message: `summary-body: ${parsed.error}` };

  // A snapshot is tracked and shared, so it can name a tip this clone never had,
  // or one since garbage-collected. Omitting an unresolvable tip can only cause
  // MORE validation, never an exemption — so it warns and continues.
  const declared = read.snapshot.grandfatherTips;
  const resolvable = resolvableCommits(git, declared, warn);
  const activationTips = declared.filter((t) => resolvable.found.has(t));
  const missing = declared.filter((t) => !resolvable.found.has(t));

  // Deliberately NOT warned about. The snapshot is tracked and shared while it
  // records the arming machine's *local* branches and tags, so every other clone
  // legitimately lacks most of those objects — this repo's own snapshot carries
  // 122 tips of which 109 are unreachable from its single published head. A
  // warning would therefore fire on every push, forever, in every clone but one,
  // on the same stderr channel that carries the rejection list: the exact "a line
  // printed every time is a line trained away" failure `describeNegatives`
  // exists to avoid. And there is nothing to act on — an unresolvable tip can
  // only cause MORE validation, never an exemption. So it is reported alongside
  // the other negative sources, in the diagnostics an operator is already
  // reading, and is silent on a green push.

  // noldor:cut no write-time pruning — ancestors of another recorded tip are
  // stored anyway. That is a pure reduction with no semantic change (an ancestor
  // adds nothing once its descendant is a negative), so the ceiling is snapshot
  // file size alone. Upgrade path: prune in `ensureSummaryBodyRolloutSnapshot`,
  // where it is a one-time cost, if a consumer's snapshot grows past a few
  // hundred tips. Pruning to only remote-reachable tips is NOT the same cut — it
  // would change which local-only history stays grandfathered.

  const trackingTips = collectTrackingTips(git, warn);
  const negatives = [...new Set([...activationTips, ...trackingTips])];
  const summary: NegativeSummary = {
    activationTips: activationTips.length,
    trackingTips: trackingTips.length,
    missingTips: missing.length,
    missingSample: missing.slice(0, 3),
    resolveFailed: resolvable.failed,
  };

  const candidates = discoverCandidates(git, parsed, negatives);
  if ('error' in candidates) return { kind: 'infra', message: `summary-body: ${candidates.error}` };

  const violations: Violation[] = [];
  for (const sha of candidates) {
    const header = loadCommitHeader(git, sha);
    if ('error' in header) return { kind: 'infra', message: `summary-body: ${header.error}` };

    // A merge costs one command: parent count is the only exemption decidable
    // without the path set. Everything else — including the automation trailer,
    // which must be corroborated by the commit's own subject or paths — needs
    // diff-tree. Never pass an empty file list to the full check as a shortcut:
    // `touchesCode([])` is false, so that reads as "carries no code" and exempts
    // every object.
    if (isExemptByHeader(header)) continue;

    const files = loadCommitFiles(git, sha);
    if ('error' in files) return { kind: 'infra', message: `summary-body: ${files.error}` };

    const result = validateSummaryCommit({ sha, files, ...header });
    if (!result.success) {
      violations.push({ sha, subject: result.subject, error: result.error ?? 'invalid body' });
    }
  }

  return violations.length === 0
    ? { kind: 'ok', negatives: summary }
    : { kind: 'violations', violations, negatives: summary };
}

/**
 * Escape control characters so a crafted stored subject cannot forge extra
 * entries in the rejection list.
 */
function oneLine(text: string): string {
  // Code-point test rather than a regex: a control-character class is a lint
  // error here (and a literal control byte in source is worse). C0 plus DEL — a
  // raw newline in a stored subject would otherwise open a line that reads like
  // another entry in the rejection list.
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? `\\x${code.toString(16).padStart(2, '0')}` : ch;
  }
  return out;
}

/** Render every violation as one actionable rejection. */
export function renderViolations(
  violations: readonly Violation[],
  negatives: NegativeSummary,
): string {
  const lines = ['pre-push: outgoing commits do not explain themselves', ''];
  for (const v of violations) {
    lines.push(`  ${v.sha.slice(0, 8)} ${oneLine(v.subject)}`, `    ${oneLine(v.error)}`);
  }
  lines.push(
    '',
    describeNegatives(negatives),
    '',
    summaryBodyTemplate(),
    '',
    'These commits are already stored, so amend or rebase them before pushing.',
    'Bookkeeping-only and prose-only commits are exempt; merges are recognised by parent count.',
  );
  return lines.join('\n');
}

/**
 * Name what discovery subtracted.
 *
 * Reported only in diagnostics the operator is already reading, never on an
 * ordinary push: a line printed every time is a line trained away, and the
 * absent-snapshot notice is reserved for the case where the gate checks nothing
 * at all rather than merely less.
 */
export function describeNegatives(n: NegativeSummary): string {
  const tracking =
    n.trackingTips === 0 ? 'no remote-tracking tips' : `${n.trackingTips} remote-tracking tip(s)`;
  const base = `Skipped history reachable from ${n.activationTips} activation tip(s) and ${tracking}.`;
  if (n.missingTips === 0) return base;
  if (n.resolveFailed) {
    // Do not say "not in this clone" — the probe failed, so their presence is
    // simply unknown and telling the operator to fetch them points at the wrong
    // cause.
    return (
      `${base} The activation-tip presence check failed, so none of the ${n.missingTips} ` +
      `snapshot tip(s) could be applied and their history was validated instead.`
    );
  }
  const sample = n.missingSample.join(', ');
  const rest = n.missingTips > n.missingSample.length ? ', …' : '';
  return (
    `${base} ${n.missingTips} snapshot tip(s) are not in this clone (${sample}${rest}), so their ` +
    `history was validated rather than grandfathered — fetch them to restore that boundary.`
  );
}
