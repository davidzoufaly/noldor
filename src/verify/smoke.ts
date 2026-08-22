// @tests: acceptance-verify-lane
import { execFile } from 'node:child_process';
import { loadVerifyCommands } from '../core/consumer-config.js';
import type { VerifySurface } from '../core/consumer-config.js';
import { bootServer } from './boot.js';

export interface SmokeSurfaceResult {
  name: string;
  ok: boolean;
  evidence: { command: string; observed: string };
}

export interface SmokeReport {
  ok: boolean;
  surfaces: SmokeSurfaceResult[];
  notes: string[];
}

export interface SmokeDeps {
  /** Injected by tests; defaults to the real doctor. */
  doctorCommand?: string;
  fetchImpl?: typeof fetch;
  /** Aggregate wall-clock cap across doctor + all surfaces. */
  totalTimeoutMs?: number;
}

const DEFAULT_DOCTOR = 'pnpm noldor doctor';
const OBSERVED_CAP = 2000;
// Hard ceiling on the whole smoke run: surfaces past the deadline never
// start, and an in-flight surface's own timeout is clamped to the remaining
// budget (overshoot bounded by one probe fetch, not one surface).
const DEFAULT_TOTAL_TIMEOUT_MS = 300_000;
const SHELL_TIMEOUT_MS = 120_000;

function runShell(
  command: string,
  cwd: string,
  budgetMs: number = SHELL_TIMEOUT_MS,
): Promise<{ code: number; output: string }> {
  const timeout = Math.max(1, Math.min(SHELL_TIMEOUT_MS, budgetMs));
  return new Promise((resolve) => {
    execFile('/bin/sh', ['-c', command], { cwd, timeout }, (err, stdout, stderr) => {
      const rawCode = err ? ((err as NodeJS.ErrnoException & { code?: unknown }).code ?? 1) : 0;
      resolve({
        code: typeof rawCode === 'number' ? rawCode : 1,
        output: `${stdout}${stderr}`.trim(),
      });
    });
  });
}

async function probeServer(
  name: string,
  surface: VerifySurface,
  port: number,
  cwd: string,
  fetchImpl: typeof fetch,
  budgetMs: number = Number.MAX_SAFE_INTEGER,
): Promise<SmokeSurfaceResult> {
  // Boot machinery shared with the render-compare lane (verify/boot.ts). Smoke
  // only probes, so a successful boot is killed immediately.
  const boot = await bootServer(surface, port, cwd, fetchImpl, budgetMs);
  if (!boot.ok) {
    return { name, ok: false, evidence: { command: boot.command, observed: boot.observed } };
  }
  boot.kill();
  return { name, ok: true, evidence: { command: boot.command, observed: `GET ${boot.url} → 200` } };
}

/**
 * The smoke floor: `noldor doctor` + boot every `consumer.verifyCommands`
 * surface + probe. Deterministic and agent-free; blocking in BOTH verify
 * modes (stop-the-line semantics — see the spec, Unit 4 step 2). Surfaces are
 * booted sequentially so one port serves all of them.
 */
export async function runSmoke(
  cwd: string,
  port: number,
  deps: SmokeDeps = {},
): Promise<SmokeReport> {
  const doctorCommand = deps.doctorCommand ?? DEFAULT_DOCTOR;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const totalDeadline = Date.now() + (deps.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS);
  const notes: string[] = [];

  const doctor = await runShell(doctorCommand, cwd, totalDeadline - Date.now());
  if (doctor.code !== 0) {
    return {
      ok: false,
      surfaces: [
        {
          name: 'doctor',
          ok: false,
          evidence: { command: doctorCommand, observed: doctor.output.slice(0, OBSERVED_CAP) },
        },
      ],
      notes,
    };
  }
  const surfaces: SmokeSurfaceResult[] = [
    { name: 'doctor', ok: true, evidence: { command: doctorCommand, observed: 'exit 0' } },
  ];

  const commands = loadVerifyCommands(cwd);
  if (Object.keys(commands).length === 0) notes.push('no surfaces configured');
  for (const [name, surface] of Object.entries(commands)) {
    if (Date.now() > totalDeadline) {
      surfaces.push({
        name,
        ok: false,
        evidence: {
          command: surface.command,
          observed: `smoke wall-clock cap exceeded before surface '${name}' ran`,
        },
      });
      continue;
    }
    const remaining = totalDeadline - Date.now();
    if (surface.kind === 'server') {
      surfaces.push(await probeServer(name, surface, port, cwd, fetchImpl, remaining));
    } else {
      const command = surface.command.replaceAll('{port}', String(port));
      const r = await runShell(command, cwd, remaining);
      surfaces.push({
        name,
        ok: r.code === 0,
        evidence: {
          command,
          observed: r.code === 0 ? 'exit 0' : r.output.slice(0, OBSERVED_CAP) || `exit ${r.code}`,
        },
      });
    }
  }
  return { ok: surfaces.every((s) => s.ok), surfaces, notes };
}
