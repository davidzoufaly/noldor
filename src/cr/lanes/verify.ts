import { execFile } from 'node:child_process';
import { loadLaneMode } from '../lane-mode.js';
import { openLaneSink, type SinkPayload } from '../lane-sink.js';
import { isAbsolute, join } from 'node:path';
import { loadVerifyCommands } from '../../core/consumer-config.js';
import type { Finding } from '../findings-schema.js';
import type { LaneInput, LaneResult } from '../lane-types.js';
import { extractFdAcceptance } from '../read-fd-summary.js';
import { resolvePort } from '../../verify/port.js';
import { runSmoke } from '../../verify/smoke.js';
import type { SmokeReport } from '../../verify/smoke.js';
import { dispatchVerify, parseVerifyVerdict } from './verify-dispatch.js';

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
 * How much unparseable child prose the sink keeps verbatim. The payload IS the
 * evidence for telling a real failure from a serialization one, so the default
 * is "all of it"; the bound only stops a runaway child from writing a sink that
 * every later `cr aggregate` has to re-parse.
 */
const RAW_KEEP_CHARS = 20_000;

function keepRaw(raw: string): string {
  return raw.length <= RAW_KEEP_CHARS
    ? raw
    : `${raw.slice(0, RAW_KEEP_CHARS)}… [truncated, ${raw.length} chars total]`;
}

/**
 * True when unparseable verifier prose plainly reports a successful
 * verification and says nothing that reads as a failure.
 *
 * Deliberately asymmetric: the success half is a narrow allowlist of the
 * phrasings a verifier actually opens with ("Verified all clauses through real
 * CLI/HTTP/API", "Verified end-to-end"), while ANY failure-shaped word vetoes.
 * A false negative costs nothing — the round falls back to the fail-closed
 * blocker — whereas a false positive would wave a payload that was hiding a
 * mismatch through as non-blocking. So the veto half matches STEMS (`fail\w*`
 * catches `failing`, `error\w*` catches `errored`) rather than a list of exact
 * inflections, and a 4xx/5xx status anywhere in the prose vetoes on its own.
 *
 * This predicate is the safety valve, not the recovery path: the repair round
 * above is what actually rescues a green verification, and anything the valve
 * misses still lands on `cannot-verify`, never on `pass`.
 */
const PROSE_SUCCESS_RE =
  /\bverifi(?:ed|cation (?:passed|succeeded|is green))\b|\ball (?:acceptance )?(?:clauses|criteria|checks) (?:pass|passed|verified)\b/i;
const PROSE_FAILURE_RE =
  /\b(?:fail\w*|error\w*|mismatch\w*|regress\w*|broke|broken|missing|unverified|unable|cannot|can't|could\s?n[o']?t|did\s?n[o']?t|does\s?n[o']?t|time[ds]?\s?out\w*|crash\w*|hang\w*|reject\w*|refus\w*|wrong|unexpected)\b|\b[45]\d\d\b/i;

export function proseReportsSuccess(raw: string): boolean {
  return PROSE_SUCCESS_RE.test(raw) && !PROSE_FAILURE_RE.test(raw);
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

function commitProse(repoRoot: string, baseSha: string, headSha: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['log', `${baseSha}..${headSha}`, '--format=%s%n%b'],
      { cwd: repoRoot },
      (err, stdout) => resolve(err ? '' : String(stdout).trim()),
    );
  });
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

  // 3. Agent judgment.
  const surfaces = Object.entries(loadVerifyCommands(input.repoRoot)).map(([name, s]) => ({
    ...s,
    name,
  }));
  let raw: string | null = null;
  let dispatchErr = '';
  // Pre-dispatch reap: smoke SIGKILLs its boots but teardown is async — make
  // sure the port is actually free before the agent boots the same surface.
  await reapPort(port);
  try {
    raw = await dispatchVerify({
      acceptance,
      baseSha: baseShaForRange,
      headSha: input.artifactSha,
      surfaces,
      port,
      ...(input.dispatchTimeoutMs !== undefined ? { timeoutMs: input.dispatchTimeoutMs } : {}),
    });
  } catch (err) {
    dispatchErr = (err as Error).message;
  } finally {
    await reapPort(port);
  }
  let parsed = raw === null ? null : parseVerifyVerdict(raw);
  const rawText = raw ?? '';

  // 4. Repair round — ONE re-request when the child answered but its verdict did
  // not parse. The verification itself already ran; only the serialization broke,
  // so asking for the JSON again recovers a real verdict for the price of one
  // cheap transcription dispatch. Skipped when the dispatch failed or timed out
  // (no prose to transcribe) and when the child said nothing at all.
  let repairErr = '';
  const repairAttempted = parsed === null && dispatchErr === '' && rawText.trim() !== '';
  if (repairAttempted) {
    try {
      const retry = await dispatchVerify({
        acceptance,
        baseSha: baseShaForRange,
        headSha: input.artifactSha,
        surfaces,
        port,
        repairOf: rawText,
        ...(input.dispatchTimeoutMs !== undefined ? { timeoutMs: input.dispatchTimeoutMs } : {}),
      });
      parsed = parseVerifyVerdict(retry);
      if (parsed === null) repairErr = 'repair round emitted no parseable verdict either';
    } catch (err) {
      // A failed repair is not a new failure class — the round falls through to
      // the same no-trustworthy-verdict handling an unrepaired one gets. The
      // message is kept rather than swallowed: it is the sink's only record that
      // the recovery attempt happened and why it did not land.
      repairErr = (err as Error).message;
    } finally {
      // The prompt forbids booting anything, but prompt text is not enforcement.
      await reapPort(port);
    }
  }
  const repaired = parsed !== null && repairAttempted;

  /** Stamp the recovery on whatever payload the honest-verdict branches build. */
  const withRepair = (payload: SinkPayload): SinkPayload =>
    repaired
      ? {
          ...payload,
          notes: [
            ...(payload.notes ?? []),
            "verdict recovered by a repair round — the child's first answer carried no parseable fenced JSON",
          ],
        }
      : payload;

  // 5. No trustworthy verdict (spawn fail, timeout, malformed output the repair
  // round could not recover) — one class.
  if (parsed === null) {
    const detail = dispatchErr || `malformed verifier output: ${rawText.slice(0, 200)}`;
    const notes = [
      `no trustworthy verdict — ${detail}`,
      ...(repairAttempted ? [`repair round ran — ${repairErr}`] : []),
      ...(rawText.trim() === ''
        ? []
        : [`verifier raw output (unparseable, kept verbatim): ${keepRaw(rawText)}`]),
    ];
    const reason = dispatchErr ? ('dispatch-failed' as const) : ('malformed-output' as const);
    // Prose that plainly reports success is not the fail-closed case: the
    // verification passed and only its serialization broke, and a green
    // verification must never block a ship on a formatting failure. It is still
    // not a `pass` — nothing parsed — so it degrades to `cannot-verify`, which
    // never blocks in either mode.
    const proseGreen = dispatchErr === '' && proseReportsSuccess(rawText);
    if (mode === 'blocking' && !proseGreen) {
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
        summary: proseGreen
          ? 'cannot-verify: verifier prose reports success but emitted no parseable verdict'
          : 'cannot-verify: no trustworthy verdict',
        verdict: 'cannot-verify',
        reason,
        notes,
      },
      true,
    );
  }

  // 6. Honest agent verdicts × mode.
  if (parsed.verdict === 'pass') {
    return write(
      withRepair({
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
      withRepair({
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
      withRepair({
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
    withRepair({
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
