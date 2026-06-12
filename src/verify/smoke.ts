// @tests: acceptance-verify-lane
import { execFile, spawn } from 'node:child_process';
import { loadVerifyCommands } from '../core/consumer-config.js';
import type { VerifySurface } from '../core/consumer-config.js';

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
}

const DEFAULT_DOCTOR = 'pnpm noldor doctor';
const OBSERVED_CAP = 2000;
// Bounds every probe fetch — a half-open stale server (accepts the
// connection, never responds) must not hang the lane past its caps.
const PROBE_FETCH_TIMEOUT_MS = 2000;

function runShell(command: string, cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile('/bin/sh', ['-c', command], { cwd, timeout: 120_000 }, (err, stdout, stderr) => {
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
): Promise<SmokeSurfaceResult> {
  const command = surface.command.replaceAll('{port}', String(port));
  const url = `http://127.0.0.1:${port}${surface.healthPath}`;
  // Pre-boot occupancy check: a fixed .env.local PORT may already carry a
  // stale or concurrent server. Booting anyway would EADDRINUSE-kill our
  // child while the probe false-greens against the pre-existing process (and
  // cleanup would never touch it). Fail the surface honestly instead.
  const occupied = await fetchImpl(url, {
    signal: AbortSignal.timeout(PROBE_FETCH_TIMEOUT_MS),
  }).then(
    () => true,
    () => false,
  );
  if (occupied) {
    return {
      name,
      ok: false,
      evidence: {
        command,
        observed: `port ${port} already in use before boot — stale process or concurrent dev server; free it or fix the per-tree PORT`,
      },
    };
  }
  // Own process group so cleanup kills the whole boot tree (pnpm → node → …).
  const child = spawn('/bin/sh', ['-c', command], { cwd, detached: true, stdio: 'ignore' });
  const deadline = Date.now() + surface.readyTimeoutMs;
  try {
    while (Date.now() < deadline) {
      try {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(PROBE_FETCH_TIMEOUT_MS) });
        if (res.status === 200) {
          return { name, ok: true, evidence: { command, observed: `GET ${url} → 200` } };
        }
      } catch {
        /* not accepting connections yet */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return {
      name,
      ok: false,
      evidence: {
        command,
        observed: `GET ${url} → no HTTP 200 within ${surface.readyTimeoutMs}ms`,
      },
    };
  } finally {
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already exited */
      }
    }
  }
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
  const notes: string[] = [];

  const doctor = await runShell(doctorCommand, cwd);
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
    if (surface.kind === 'server') {
      surfaces.push(await probeServer(name, surface, port, cwd, fetchImpl));
    } else {
      const command = surface.command.replaceAll('{port}', String(port));
      const r = await runShell(command, cwd);
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
