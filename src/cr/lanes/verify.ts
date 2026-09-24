import { execFile } from 'node:child_process';
import { loadLaneMode } from '../lane-mode.js';
import { openLaneSink, type SinkPayload } from '../lane-sink.js';
import { isAbsolute, join, sep } from 'node:path';
import { loadVerifyCommands } from '../../core/consumer-config.js';
import type { Finding } from '../findings-schema.js';
import type { LaneInput, LaneResult } from '../lane-types.js';
import { extractFdAcceptance } from '../read-fd-summary.js';
import { resolvePort } from '../../verify/port.js';
import { runSmoke } from '../../verify/smoke.js';
import type { SmokeReport } from '../../verify/smoke.js';
import type { LaneAnswer } from '../lane-answer.js';
import { dispatchVerify, type VerifyVerdict } from './verify-dispatch.js';

type SmokeRunner = (cwd: string, port: number) => Promise<SmokeReport>;
let smokeRunner: SmokeRunner = (cwd, port) => runSmoke(cwd, port);

/** Test seam — production code never calls this. */
export function setSmokeRunner(impl: SmokeRunner): void {
  smokeRunner = impl;
}

/** Only what this lane decides — `openLaneSink` owns the identity fields. */
function basePayload(input: LaneInput): Omit<SinkPayload, 'summary'> {
  return {
    blockers: [],
    suggestions: [],
    ...(input.baseSha ? { baseSha: input.baseSha } : {}),
    ...(input.fullReview ? { fullReview: true } : {}),
  };
}

function mkFinding(artifact: string, message: string, severity: Finding['severity']): Finding {
  return { file: artifact, severity, message };
}

/**
 * Best-effort reap of anything still listening on the verify port. The
 * verifier agent is told to kill what it boots (prompt rule 3), but prompt
 * text is not enforcement — this is the programmatic backstop so a leaked
 * server can't poison the next run's pre-boot occupancy check.
 */
export function reapPort(port: number): Promise<void> {
  return new Promise((resolve) => {
    // -sTCP:LISTEN is load-bearing: a bare `tcp:<port>` also matches CLIENT
    // sockets (e.g. this process's own keep-alive fetch connections), and
    // kill -9ing those reaps the caller itself.
    execFile(
      '/bin/sh',
      ['-c', `lsof -ti tcp:${port} -sTCP:LISTEN | xargs kill -9 2>/dev/null`],
      { timeout: 10_000 },
      () => resolve(),
    );
  });
}

function git(repoRoot: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: repoRoot, timeout: 30_000 }, (err, stdout, stderr) =>
      resolve(
        err
          ? { ok: false, out: String(stderr || err.message).trim() }
          : { ok: true, out: String(stdout) },
      ),
    );
  });
}

async function commitProse(repoRoot: string, baseSha: string, headSha: string): Promise<string> {
  const r = await git(repoRoot, ['log', `${baseSha}..${headSha}`, '--format=%s%n%b']);
  return r.ok ? r.out.trim() : '';
}

/**
 * Registered worktree paths as git prints them, or `null` when git could not
 * answer. A `null` before-snapshot disables the audit: diffing against an empty
 * list would read every worktree, the main checkout included, as leaked.
 */
async function listWorktrees(repoRoot: string): Promise<string[] | null> {
  const r = await git(repoRoot, ['worktree', 'list', '--porcelain']);
  if (!r.ok) return null;
  return r.out
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
}

/**
 * Programmatic backstop for the worktree half of prompt rule 3, as {@link reapPort}
 * is for its process half: a worktree registered during the dispatch that the child
 * did not remove is removed here. Checkouts under the main clone's `.worktrees/` are
 * exempt — a parallel drain child registers its session there while this lane runs,
 * and that is live work, not a leak. Git lists the main worktree first.
 */
async function pruneLeakedWorktrees(repoRoot: string, before: string[]): Promise<string[]> {
  const after = await listWorktrees(repoRoot);
  if (after === null) return ['worktree audit skipped: git worktree list failed after dispatch'];
  const sessionHome = join(before[0] ?? repoRoot, '.worktrees') + sep;
  const known = new Set(before);
  const notes: string[] = [];
  for (const path of after) {
    if (known.has(path) || path.startsWith(sessionHome)) continue;
    const r = await git(repoRoot, ['worktree', 'remove', '--force', path]);
    notes.push(
      r.ok
        ? `removed leaked worktree ${path}`
        : `leaked worktree ${path} could not be removed: ${r.out}`,
    );
  }
  return notes;
}

export async function runVerify(input: LaneInput): Promise<LaneResult> {
  const { write } = openLaneSink(input, 'verifier');
  const mode = await loadLaneMode(input.repoRoot, 'verifyMode');

  // 1. Smoke floor — blocking in BOTH modes (stop-the-line; spec Unit 4 step 2).
  const port = await resolvePort(input.repoRoot);
  const smoke = await smokeRunner(input.repoRoot, port);
  if (!smoke.ok) {
    const failed = smoke.surfaces.filter((s) => !s.ok);
    return write(
      {
        ...basePayload(input),
        blockers: failed.map((s) =>
          mkFinding(
            input.artifact,
            `smoke floor: surface '${s.name}' failed — ${s.evidence.observed}`,
            'high',
          ),
        ),
        summary: 'smoke floor failed',
        verdict: 'fail',
        evidence: failed.map((s) => s.evidence),
        mismatches: failed.map((s) => `surface '${s.name}' not healthy`),
      },
      false,
    );
  }

  // 2. Acceptance text: FD Summary+Usage → commit prose → cannot-verify.
  // A missing FD (fast-track) and a present-but-sectionless FD are the same
  // situation — no FD acceptance text — so BOTH fall through to commit prose;
  // a sink is always written (a rethrow here would leave no sink for
  // aggregate to read). Only unexpected I/O errors (EACCES…) rethrow.
  const baseShaForRange = input.baseSha ?? `${input.artifactSha}~1`;
  const fdAbs = isAbsolute(input.fdPath) ? input.fdPath : join(input.repoRoot, input.fdPath);
  let acceptance = await extractFdAcceptance(fdAbs).catch((err) => {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT' || /no ## Summary or ## Usage/.test(e.message)) return '';
    throw e;
  });
  if (!acceptance) {
    acceptance = await commitProse(input.repoRoot, baseShaForRange, input.artifactSha);
  }
  if (!acceptance) {
    return write(
      {
        ...basePayload(input),
        summary: 'cannot-verify: no acceptance text (no FD, empty commit prose)',
        verdict: 'cannot-verify',
        notes: ['no acceptance text available — no FD and empty commit prose for the range'],
      },
      true,
    );
  }

  // 3. Agent judgment. The verdict arrives in the child's answer file, with at most one
  // repair round inside the seam (Q-0250) — nothing the child prints is parsed.
  const surfaces = Object.entries(loadVerifyCommands(input.repoRoot)).map(([name, s]) => ({
    ...s,
    name,
  }));
  let answer: LaneAnswer<VerifyVerdict> | null = null;
  let dispatchErr = '';
  let leakNotes: string[] = [];
  const worktreesBefore = await listWorktrees(input.repoRoot);
  // Pre-dispatch reap: smoke SIGKILLs its boots but teardown is async — make
  // sure the port is actually free before the agent boots the same surface.
  await reapPort(port);
  try {
    answer = await dispatchVerify(
      {
        acceptance,
        baseSha: baseShaForRange,
        headSha: input.artifactSha,
        surfaces,
        port,
        ...(input.dispatchTimeoutMs !== undefined ? { timeoutMs: input.dispatchTimeoutMs } : {}),
      },
      input,
    );
  } catch (err) {
    dispatchErr = (err as Error).message;
  } finally {
    // Covers the repair round too: its prompt forbids booting anything, but prompt
    // text is not enforcement.
    await reapPort(port);
    leakNotes =
      worktreesBefore === null
        ? ['worktree audit skipped: git worktree list failed before dispatch']
        : await pruneLeakedWorktrees(input.repoRoot, worktreesBefore);
  }
  const parsed = answer?.ok === true ? answer.answer : null;
  const answerNotes = [...(answer?.notes ?? []), ...leakNotes];

  /** Carry the seam's notes (a recovery, the kept raw answer) onto the sink. */
  const withNotes = (payload: SinkPayload): SinkPayload =>
    answerNotes.length > 0
      ? { ...payload, notes: [...(payload.notes ?? []), ...answerNotes] }
      : payload;

  // 4. No trustworthy verdict (spawn fail, timeout, an answer the repair round could
  // not recover) — one class. There is no prose fallback: only an answer file counts.
  if (parsed === null) {
    const detail =
      dispatchErr ||
      `malformed verifier output: ${answer !== null && !answer.ok ? answer.detail : 'no answer'}`;
    const notes = [`no trustworthy verdict — ${detail}`, ...answerNotes];
    const reason = dispatchErr ? ('dispatch-failed' as const) : ('malformed-output' as const);
    if (mode === 'blocking') {
      return write(
        {
          ...basePayload(input),
          blockers: [mkFinding(input.artifact, `verify lane errored: ${detail}`, 'high')],
          summary: 'verify lane errored (fail-closed in blocking mode)',
          verdict: 'fail',
          reason,
          notes,
        },
        false,
      );
    }
    return write(
      {
        ...basePayload(input),
        summary: 'cannot-verify: no trustworthy verdict',
        verdict: 'cannot-verify',
        reason,
        notes,
      },
      true,
    );
  }

  // 5. Honest agent verdicts × mode.
  if (parsed.verdict === 'pass') {
    return write(
      withNotes({
        ...basePayload(input),
        summary: 'verified: observed behavior matches acceptance text',
        verdict: 'pass',
        evidence: parsed.evidence,
      }),
      true,
    );
  }
  if (parsed.verdict === 'cannot-verify') {
    return write(
      withNotes({
        ...basePayload(input),
        summary: `cannot-verify: ${parsed.reason ?? 'no reason given'}`,
        verdict: 'cannot-verify',
        evidence: parsed.evidence,
        notes: [parsed.reason ?? 'cannot-verify with no reason given'],
      }),
      true,
    );
  }
  // verdict === 'fail'
  const findings = parsed.mismatches.map((m) => mkFinding(input.artifact, m, 'high'));
  if (mode === 'blocking') {
    return write(
      withNotes({
        ...basePayload(input),
        blockers: findings,
        summary: 'verify FAIL: observed behavior mismatches acceptance text',
        verdict: 'fail',
        evidence: parsed.evidence,
        mismatches: parsed.mismatches,
      }),
      false,
    );
  }
  return write(
    withNotes({
      ...basePayload(input),
      suggestions: findings.map((f) => ({ ...f, severity: 'low' as const })),
      summary: 'ADVISORY FAIL: observed behavior mismatches acceptance text (advisory mode)',
      verdict: 'fail',
      evidence: parsed.evidence,
      mismatches: parsed.mismatches,
    }),
    true,
  );
}
