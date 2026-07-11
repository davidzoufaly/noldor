import { existsSync, readdirSync, readFileSync } from 'node:fs';

import {
  getSuggestions,
  loadInProgressFds,
  loadMilestoneGate,
  type InProgressFd,
} from '../core/next-priority.js';
import { loadDocRoots } from '../core/doc-roots.js';
import { parseBacklog, parseRoadmap } from '../utils/parse-blocks.js';
import { resolveEntryRef } from '../triage/entry-id.js';
import { isDrainEligible } from './drain-eligibility.js';
import { CAPABILITIES } from '../core/agent-runner/capabilities.js';
import { loadAgentsConfig, resolveRunner } from '../core/agent-runner/registry.js';
import { buildDrainGatePrompt, buildResumeGatePrompt, type PromptDispatch } from './gate-prompt.js';

export type SourceId = 'roadmap' | 'plans' | 'specs';

/**
 * One drainable item. `eligible` replaces the fast-track literal that used to
 * live in `decideNext`: the source decides eligibility, the loop only reads it.
 * `reason` (when ineligible) feeds the dry-run / skip log.
 */
export interface DrainCandidate {
  slug: string;
  /** body used by eligibility; '' when N/A */
  description: string;
  /** may this slug be spawned? (replaces the fast-track literal) */
  eligible: boolean;
  /** why not, for the skip log */
  reason?: string;
}

/**
 * The injected source seam. `runDrain` is pure of source knowledge — every
 * `'fast-track'` / `'roadmap'` / `'feat/'` / `'fast/'` literal lives in an
 * implementation here.
 */
export interface DrainSource {
  id: SourceId;
  /** next candidate not in `skip`, or null when none remain */
  nextItem(skip: ReadonlySet<string>): DrainCandidate | null;
  /** success-oracle universe: ALL items (unfiltered); absence === shipped */
  parseAll(): string[];
  /** gate entry prompt for this slug (shape follows the implementer runner's promptDispatch) */
  gatePrompt(slug: string): string;
  /** branch the shipped PR lives on, for `openPrExistsFor` */
  branchFor(slug: string): string;
}

/** Escape a slug for safe embedding in a RegExp (slugs are kebab-case, but be defensive). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve the gate-prompt dispatch ONCE at source construction (spec D2): the
 * implementer runner's `promptDispatch` capability picks slash-command vs
 * prose. The drain spawn path never pins `opts.runner` (`spawnGate` passes
 * only `role: 'implementer'`), so construction-time and spawn-time resolution
 * cannot diverge. A malformed `agents:` block throws loudly here — same
 * posture as the registry.
 */
function implementerDispatch(cwd: string): PromptDispatch {
  return CAPABILITIES[resolveRunner('implementer', loadAgentsConfig(cwd)).runner].promptDispatch;
}

/**
 * Reproduces queue-drain selection behavior: `nextItem` is today's
 * `getSuggestions(...).topPriority[0]` with `eligible = fast-track && isDrainEligible`;
 * `parseAll` is the full roadmap slug list (the success oracle); the gate prompt comes from
 * `buildDrainGatePrompt` with the dispatch resolved once at construction from the implementer
 * runner (claude/stub → `/noldor-gate --drain <slug>` verbatim, codex/opencode → self-contained prose
 * directive — see src/autonomous/gate-prompt.ts); the branch is `fast/<slug>`.
 */
export function roadmapSource(cwd: string): DrainSource {
  const read = (): string => readFileSync(loadDocRoots(cwd).roadmap, 'utf8');
  const dispatch = implementerDispatch(cwd);
  return {
    id: 'roadmap',
    nextItem(skip) {
      const sugg = getSuggestions(
        read(),
        { inProgressFds: loadInProgressFds(cwd), milestoneGate: loadMilestoneGate(cwd) },
        skip,
      );
      const top = sugg.topPriority[0];
      if (top === undefined) return null;
      const description = top.description ?? '';
      const fastTrack = top.suggestedPath === 'fast-track';
      const drainOk = isDrainEligible(description);
      // An entry whose `deps:` still names a slug present in the queue is not
      // shippable in isolation — spawning it lets the gate child fail deliberately
      // and burns `--max-retries`. A dep still in `parseAll()` === unshipped, so
      // mark the entry ineligible upfront. (Self-reference is excluded defensively.)
      const queued = new Set(parseRoadmap(read()).map((e) => e.slug));
      const unmetDeps = (top.deps ?? []).filter((d) => d !== top.slug && queued.has(d));
      const depsBlocked = unmetDeps.length > 0;
      const eligible = fastTrack && drainOk && !depsBlocked;
      // Distinguish the ineligibility causes (a non-fast-track size, an unmet dep,
      // or a Touches/multi-scope residue) so the skip log is accurate.
      const reason = !fastTrack
        ? 'not a fast-track XS/S entry (roadmap source ships fast-track only)'
        : depsBlocked
          ? `blocked by unshipped dep(s) still in queue: ${unmetDeps.join(', ')}`
          : !drainOk
            ? 'multi-scope or Touches-bearing entry — needs human /noldor-promote residue disposition'
            : undefined;
      return {
        slug: top.slug,
        description,
        eligible,
        ...(reason !== undefined ? { reason } : {}),
      };
    },
    parseAll() {
      return parseRoadmap(read()).map((e) => e.slug);
    },
    gatePrompt(slug) {
      return buildDrainGatePrompt(slug, dispatch);
    },
    branchFor(slug) {
      return `fast/${slug}`;
    },
  };
}

/**
 * Drains already-designed in-progress FDs. Eligible iff the FD has BOTH a
 * committed spec (`<date>-<slug>-design.md`) and a plan (`<date>-<slug>.md`),
 * AND none of its frontmatter `deps:` refs still names a queued/unshipped
 * entry (mirrors roadmapSource's deps-in-queue guard — spawning a dep-blocked
 * FD lets the gate child fail deliberately and burns `--max-retries`).
 * Eligible FDs are ordered by ascending plan-file date (FIFO — oldest-designed-
 * first). A non-eligible in-progress FD is surfaced with a precise reason so
 * dry-run logs it and the loop skips — never fails, never silently drops — it.
 * `parseAll` is the full in-progress slug set: a slug is shipped iff absent on the
 * post-spawn re-read (absence === shipped).
 */
export function plansSource(cwd: string): DrainSource {
  const roots = loadDocRoots(cwd);
  const dispatch = implementerDispatch(cwd);
  const inProgressFds = (): InProgressFd[] => loadInProgressFds(cwd);
  const inProgressSlugs = (): string[] => inProgressFds().map((f) => f.slug);

  const planDate = (slug: string): string | null => {
    if (!existsSync(roots.plans)) return null;
    const re = new RegExp(`^(\\d{4}-\\d{2}-\\d{2})-${escapeRe(slug)}\\.md$`);
    for (const f of readdirSync(roots.plans)) {
      const m = re.exec(f);
      if (m !== null) return m[1]!;
    }
    return null;
  };

  // Anchored to the full stem (`<date>-<slug>-design.md`) — mirrors planDate — so
  // slug `runner` does NOT false-match `2026-06-10-plan-runner-design.md`.
  const hasSpec = (slug: string): boolean => {
    if (!existsSync(roots.specs)) return false;
    const re = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escapeRe(slug)}-design\\.md$`);
    return readdirSync(roots.specs).some((f) => re.test(f));
  };

  return {
    id: 'plans',
    nextItem(skip) {
      const fds = inProgressFds();
      const inProgressSet = new Set(fds.map((f) => f.slug));
      const roadmapRaw = existsSync(roots.roadmap) ? readFileSync(roots.roadmap, 'utf8') : '';
      const backlogRaw = existsSync(roots.backlog) ? readFileSync(roots.backlog, 'utf8') : '';
      const queued = new Set([
        ...parseRoadmap(roadmapRaw).map((e) => e.slug),
        ...parseBacklog(backlogRaw).map((e) => e.slug),
      ]);
      // A dep is unmet only when it positively resolves to a still-queued entry
      // or another in-progress FD. An absent ref reads as shipped — fast-track
      // ships leave no FD behind, so absence must never block. (Self-reference
      // is excluded defensively, matching roadmapSource.)
      const unmetDepsOf = (fd: InProgressFd): string[] =>
        fd.deps
          .map((ref) =>
            resolveEntryRef(ref, { roadmapRaw, backlogRaw, featuresDir: roots.features }),
          )
          .filter((d) => d !== fd.slug && (queued.has(d) || inProgressSet.has(d)));

      const rows = fds
        .filter((f) => !skip.has(f.slug))
        .toSorted((a, b) => a.slug.localeCompare(b.slug)) // deterministic blocked-pick order
        .map((f) => ({
          slug: f.slug,
          date: planDate(f.slug),
          spec: hasSpec(f.slug),
          unmetDeps: unmetDepsOf(f),
        }));

      const eligible = rows
        .filter((r) => r.date !== null && r.spec && r.unmetDeps.length === 0)
        .toSorted((a, b) => a.date!.localeCompare(b.date!)); // FIFO oldest-plan-first
      if (eligible.length > 0) {
        return { slug: eligible[0]!.slug, description: '', eligible: true };
      }

      // No eligible FD left: surface the first non-eligible in-progress FD with a
      // precise reason so dry-run reports it and the loop skips it — never silently
      // drops it. Every row here is non-eligible (eligible were returned above).
      const blocked = rows[0];
      if (blocked !== undefined) {
        const reason =
          blocked.date === null
            ? blocked.spec
              ? 'no plan — specs source (phase 2)'
              : 'no spec or plan — not designed yet'
            : !blocked.spec
              ? 'no spec — not eligible (plan present, spec missing)'
              : `blocked by unshipped dep(s) still in queue: ${blocked.unmetDeps.join(', ')}`;
        return { slug: blocked.slug, description: '', eligible: false, reason };
      }
      return null;
    },
    parseAll() {
      return inProgressSlugs();
    },
    gatePrompt(slug) {
      return buildResumeGatePrompt(slug, dispatch);
    },
    branchFor(slug) {
      return `feat/${slug}`;
    },
  };
}

/**
 * Phase-2 placeholder. Specs-source needs an autonomous `writing-plans` step —
 * the risky design stage the queue-drain MVP deliberately omitted — so it errors
 * until a separate FD takes it on.
 */
export function specsSource(_cwd: string): DrainSource {
  throw new Error(
    '--source specs is not yet implemented (phase 2: needs an autonomous writing-plans step)',
  );
}
