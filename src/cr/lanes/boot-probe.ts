// @tests: ui-design-review-lane
// The per-`verifyCommand` boot-and-route-probe loop both booting design lanes run:
// boot each group once inside one round budget, probe each route with retries,
// and hand the lane a URL only for a 2xx route. Lifted out of `render-compare.ts`.

import type { VerifySurface } from '../../core/consumer-config.js';
import { errMessage } from '../../core/err-message.js';
import type { bootServer } from '../../verify/boot.js';
import type { resolvePort } from '../../verify/port.js';

/** Bounds one route-probe fetch, the same cap the health check's probe fetches use. */
export const ROUTE_PROBE_TIMEOUT_MS = 2000;

/**
 * Whole-loop wall clock, fixed once, so a slow early group shrinks what later
 * groups may spend booting. noldor:cut — enforced at BOOT ADMISSION only: every
 * step inside a group is already bounded (probe ≤ `routeProbeBudgetMs`, capture
 * ≤ 120s), so boot time is the one unbounded quantity; checking mid-group would
 * abandon surfaces whose own caps were about to hold.
 */
export const TOTAL_ROUND_BUDGET_MS = 300_000;

/** The seams a booting lane injects; a lane's own deps object extends this. */
export interface BootProbeDeps {
  boot: typeof bootServer;
  fetchImpl: typeof fetch;
  resolvePort: typeof resolvePort;
  /** Total retry budget for the route probe (cold dev routes compile on demand). */
  routeProbeBudgetMs: number;
}

/** The two recipe fields the loop reads; each lane's job type carries more. */
export interface BootableJob {
  surface: string;
  recipe: { verifyCommand: string; route: string };
}

/** Why a surface never reached its per-surface work. */
export type UnreachableReason = 'boot-failed' | 'route-unreachable';

export interface BootedSurfacesInput<J extends BootableJob> {
  jobs: readonly J[];
  verifyCommands: ReadonlyMap<string, VerifySurface>;
  repoRoot: string;
  deps: BootProbeDeps;
  /** Whole-loop wall clock; {@link TOTAL_ROUND_BUDGET_MS} when omitted. */
  budgetMs?: number;
  /** Record a surface that could not be reached; it gets no `reached` call. */
  unreachable: (job: J, reason: UnreachableReason, detail: string) => void;
  /** The lane's per-surface work, against a booted server whose route answered 2xx. */
  reached: (job: J, url: string) => Promise<void>;
}

/**
 * Walk every job through boot and route probe. A per-group failure lands as that
 * group's rows and the loop continues. The boot is killed on every exit path of
 * its group, including a throwing `reached`.
 */
export async function forEachBootedSurface<J extends BootableJob>(
  input: BootedSurfacesInput<J>,
): Promise<void> {
  const { deps } = input;
  const budgetMs = input.budgetMs ?? TOTAL_ROUND_BUDGET_MS;
  const groups = new Map<string, J[]>();
  for (const job of input.jobs) {
    groups.set(job.recipe.verifyCommand, [...(groups.get(job.recipe.verifyCommand) ?? []), job]);
  }
  const roundDeadline = Date.now() + budgetMs;
  const failGroup = (jobs: readonly J[], detail: string): void => {
    for (const job of jobs) input.unreachable(job, 'boot-failed', detail);
  };
  for (const [cmdName, groupJobs] of groups) {
    const entry = input.verifyCommands.get(cmdName);
    // noldor:cut — unreachable under a schema-valid config; kept so a missing
    // entry degrades to rows instead of throwing.
    if (entry === undefined || entry.kind !== 'server') {
      failGroup(
        groupJobs,
        `verifyCommand '${cmdName}' is ${entry === undefined ? 'missing from consumer.verifyCommands' : `kind "${entry.kind}", not "server"`}`,
      );
      continue;
    }
    let port: number;
    try {
      port = await deps.resolvePort(input.repoRoot);
    } catch (err) {
      failGroup(groupJobs, `no free port: ${errMessage(err)}`);
      continue;
    }
    const remaining = roundDeadline - Date.now();
    if (remaining <= 0) {
      failGroup(groupJobs, `round budget (${budgetMs}ms) exhausted before this group booted`);
      continue;
    }
    let boot: Awaited<ReturnType<typeof deps.boot>>;
    try {
      boot = await deps.boot(entry, port, input.repoRoot, deps.fetchImpl, remaining);
    } catch (err) {
      failGroup(groupJobs, `boot threw: ${errMessage(err)}`);
      continue;
    }
    if (!boot.ok) {
      failGroup(groupJobs, boot.observed);
      continue;
    }
    try {
      for (const job of groupJobs) {
        const url = `http://127.0.0.1:${port}${job.recipe.route}`;
        const probe = await probeRoute(url, deps);
        if (!probe.ok) {
          input.unreachable(job, 'route-unreachable', probe.detail);
          continue;
        }
        await input.reached(job, url);
      }
    } finally {
      // Fire-and-forget SIGKILL: each group boots on its own fresh port.
      boot.kill();
    }
  }
}

/**
 * Keeps a 404/500 route from yielding a confident verdict against an error page;
 * the FINAL status must be 2xx. RETRIED under a small budget because dev servers
 * compile cold routes on demand; any HTTP status ends the loop, only no-response
 * shapes (timeout, refused) retry.
 */
async function probeRoute(
  url: string,
  deps: BootProbeDeps,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  let status: number | null = null;
  let probeErr = '';
  const probeDeadline = Date.now() + deps.routeProbeBudgetMs;
  for (;;) {
    try {
      const res = await deps.fetchImpl(url, {
        signal: AbortSignal.timeout(ROUTE_PROBE_TIMEOUT_MS),
        redirect: 'follow',
      });
      status = res.status;
      // Release the socket; the capture right behind it competes for it.
      await res.body?.cancel().catch(() => {
        /* already consumed or closed */
      });
      break;
    } catch (err) {
      probeErr = errMessage(err);
      if (Date.now() >= probeDeadline) break;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (status === null) {
    return {
      ok: false,
      detail: `GET ${url} got no response within ${deps.routeProbeBudgetMs}ms: ${probeErr}`,
    };
  }
  if (status < 200 || status >= 300) {
    return { ok: false, detail: `GET ${url} → ${status} (want 2xx)` };
  }
  return { ok: true };
}
