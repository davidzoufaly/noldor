// `noldor autonomous status` — operator-facing liveness + progress report so
// nobody has to read `.noldor/drain-state.json` / `.noldor/drain.lock` by hand.
// Liveness comes from the actual process (lock pid + kill -0 via liveLockPid),
// progress (shipped / skip / in-flight) from the drain-state heartbeat.
import { liveLockPid } from './drain-lock.js';
import { readState, type DrainState } from './drain-state.js';

export interface AutonomousStatus {
  /** True iff `.noldor/drain.lock` names a live process. */
  running: boolean;
  /** The live lock holder's pid, or null when not running. */
  lockPid: number | null;
  /** Latest heartbeat, possibly from a dead run — see {@link stateIsLive}. */
  state: DrainState | null;
  /** True iff the heartbeat was written by the live lock holder. */
  stateIsLive: boolean;
}

export function collectStatus(cwd: string): AutonomousStatus {
  const lockPid = liveLockPid(cwd);
  const state = readState(cwd);
  return {
    running: lockPid !== null,
    lockPid,
    state,
    stateIsLive: lockPid !== null && state !== null && state.pid === lockPid,
  };
}

export function formatStatus(s: AutonomousStatus): string {
  const lines: string[] = [];
  lines.push(s.running ? `runner: live (pid ${s.lockPid})` : 'runner: not running');
  if (s.state === null) {
    lines.push('no drain state (never run, or cleaned)');
    return `${lines.join('\n')}\n`;
  }
  if (!s.stateIsLive) {
    lines.push(`last run: ${s.state.startedAt} (pid ${s.state.pid}, dead)`);
  }
  lines.push(`phase: ${s.state.phase}`);
  const inFlight = s.state.inFlight.map((f) => `${f.slug} (${f.phase})`).join(', ');
  lines.push(`in-flight: ${inFlight || 'none'}`);
  lines.push(`merging: ${s.state.merging ?? 'none'}`);
  lines.push(`shipped: ${s.state.shipped}`);
  lines.push(`skip: ${s.state.skip.join(', ') || 'none'}`);
  const retries = Object.entries(s.state.retries)
    .map(([slug, n]) => `${slug}=${n}`)
    .join(', ');
  if (retries) lines.push(`retries: ${retries}`);
  return `${lines.join('\n')}\n`;
}

function main(): void {
  const s = collectStatus(process.cwd());
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(s)}\n`);
    return;
  }
  process.stdout.write(formatStatus(s));
}

const invokedDirect = /[\\/]status-cli\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) main();
