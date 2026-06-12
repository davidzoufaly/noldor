import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { writeJsonAtomic } from '../atomic-write.js';
import { loadConfig } from '../config.js';
import { loadVerifyCommands } from '../../core/consumer-config.js';
import type { Finding, LaneFindings } from '../findings-schema.js';
import type { LaneInput, LaneResult } from '../lane-types.js';
import { extractFdAcceptance } from '../read-fd-summary.js';
import { resolvePort } from '../../verify/port.js';
import { runSmoke } from '../../verify/smoke.js';
import type { SmokeReport } from '../../verify/smoke.js';
import { dispatchVerify, parseVerifyVerdict } from './verify-dispatch.js';

type VerifyMode = 'blocking' | 'advisory';

type SmokeRunner = (cwd: string, port: number) => Promise<SmokeReport>;
let smokeRunner: SmokeRunner = (cwd, port) => runSmoke(cwd, port);

/** Test seam — production code never calls this. */
export function setSmokeRunner(impl: SmokeRunner): void {
  smokeRunner = impl;
}

function sinkPathFor(input: LaneInput): string {
  return join(input.repoRoot, '.noldor', 'cr', `${input.slug}-${input.kind}-verify.json`);
}

function basePayload(input: LaneInput, startedAt: string): Omit<LaneFindings, 'summary'> {
  return {
    lane: 'verify',
    artifact: input.artifact,
    kind: input.kind,
    slug: input.slug,
    blockers: [],
    suggestions: [],
    startedAt,
    finishedAt: new Date().toISOString(),
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
  const sinkPath = sinkPathFor(input);
  const startedAt = new Date().toISOString();
  const cfg = await loadConfig(join(input.repoRoot, '.noldor', 'config.json')).catch(() => null);
  const mode: VerifyMode = cfg?.autonomous?.verifyMode ?? 'advisory';

  const write = async (payload: LaneFindings, ok: boolean): Promise<LaneResult> => {
    // Orchestrate pre-creates .noldor/cr/, but the lane stays self-sufficient
    // for direct callers and unit tests.
    await mkdir(dirname(sinkPath), { recursive: true });
    await writeJsonAtomic(sinkPath, payload);
    return { lane: 'verify', sinkPath, ok };
  };

  // 1. Smoke floor — blocking in BOTH modes (stop-the-line; spec Unit 4 step 2).
  const port = await resolvePort(input.repoRoot);
  const smoke = await smokeRunner(input.repoRoot, port);
  if (!smoke.ok) {
    const failed = smoke.surfaces.filter((s) => !s.ok);
    return write(
      {
        ...basePayload(input, startedAt),
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
        ...basePayload(input, startedAt),
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
    });
  } catch (err) {
    dispatchErr = (err as Error).message;
  } finally {
    await reapPort(port);
  }
  const parsed = raw === null ? null : parseVerifyVerdict(raw);

  // 4. No trustworthy verdict (spawn fail, timeout, malformed output) — one class.
  if (parsed === null) {
    const detail = dispatchErr || `malformed verifier output: ${(raw ?? '').slice(0, 200)}`;
    if (mode === 'blocking') {
      return write(
        {
          ...basePayload(input, startedAt),
          blockers: [mkFinding(input.artifact, `verify lane errored: ${detail}`, 'high')],
          summary: 'verify lane errored (fail-closed in blocking mode)',
          verdict: 'fail',
        },
        false,
      );
    }
    return write(
      {
        ...basePayload(input, startedAt),
        summary: 'cannot-verify: no trustworthy verdict',
        verdict: 'cannot-verify',
        notes: [`no trustworthy verdict — ${detail}`],
      },
      true,
    );
  }

  // 5. Honest agent verdicts × mode.
  if (parsed.verdict === 'pass') {
    return write(
      {
        ...basePayload(input, startedAt),
        summary: 'verified: observed behavior matches acceptance text',
        verdict: 'pass',
        evidence: parsed.evidence,
      },
      true,
    );
  }
  if (parsed.verdict === 'cannot-verify') {
    return write(
      {
        ...basePayload(input, startedAt),
        summary: `cannot-verify: ${parsed.reason ?? 'no reason given'}`,
        verdict: 'cannot-verify',
        evidence: parsed.evidence,
        notes: [parsed.reason ?? 'cannot-verify with no reason given'],
      },
      true,
    );
  }
  // verdict === 'fail'
  const findings = parsed.mismatches.map((m) => mkFinding(input.artifact, m, 'high'));
  if (mode === 'blocking') {
    return write(
      {
        ...basePayload(input, startedAt),
        blockers: findings,
        summary: 'verify FAIL: observed behavior mismatches acceptance text',
        verdict: 'fail',
        evidence: parsed.evidence,
        mismatches: parsed.mismatches,
      },
      false,
    );
  }
  return write(
    {
      ...basePayload(input, startedAt),
      suggestions: findings.map((f) => ({ ...f, severity: 'low' as const })),
      summary: 'ADVISORY FAIL: observed behavior mismatches acceptance text (advisory mode)',
      verdict: 'fail',
      evidence: parsed.evidence,
      mismatches: parsed.mismatches,
    },
    true,
  );
}
