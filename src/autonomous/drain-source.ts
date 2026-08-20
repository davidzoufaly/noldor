import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { relative } from 'node:path';

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
import {
  buildDrainGatePrompt,
  buildFinishGatePrompt,
  buildResumeGatePrompt,
  type PromptDispatch,
} from './gate-prompt.js';

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
  /**
   * Raw `- size:` of the source entry, verbatim (`'XS'`, `'S'`, …). Present only on a
   * source whose items carry a size axis — `roadmapSource` does; `plansSource` does not,
   * since an in-progress FD is selected by committed-design presence, not by size.
   * Carried on the candidate so {@link selectionReason} can filter without a second parse.
   */
  size?: string;
}

/**
 * Operator-supplied selection narrowing from `--size` / `--only`. An absent member means
 * "no constraint on that axis"; an entry must satisfy every member that IS present.
 *
 * This is the lever Q-0121 names: `--max-features` takes top-N in priority ORDER, and
 * fast-track eligibility is XS **or** S, so "ship only the XS ones" is inexpressible when
 * XS entries sit below S entries in the queue. Narrowing selection is a different axis
 * from bounding it.
 */
export interface SelectionFilter {
  /** Upper-cased sizes to admit, e.g. `{'XS'}`. */
  sizes?: ReadonlySet<string>;
  /** Slugs to admit. */
  only?: ReadonlySet<string>;
}

/**
 * Why `filter` excludes this entry, or `undefined` when it admits it (including when
 * there is no filter at all). Pure so both the source and its tests read the same
 * decision; the returned string lands in the drain's skip log verbatim.
 *
 * A size-less entry is excluded by any `sizes` constraint rather than admitted: an
 * unsized roadmap block routes to no gate path, so admitting it would spawn a child
 * for work the size→path policy cannot place.
 */
export function selectionReason(
  entry: { slug: string; size?: string },
  filter: SelectionFilter | undefined,
): string | undefined {
  if (filter === undefined) return undefined;
  if (filter.only !== undefined && !filter.only.has(entry.slug)) return 'not in --only selection';
  if (filter.sizes !== undefined && !filter.sizes.has((entry.size ?? '').toUpperCase())) {
    return `size ${entry.size ?? '(none)'} not in --size selection (${[...filter.sizes].join(', ')})`;
  }
  return undefined;
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
  /**
   * Delivery-only entry prompt: the branch already carries committed work, so the child must
   * reuse it and run end-of-flow rather than rebuild (see `buildFinishGatePrompt`). Optional —
   * a source that omits it opts out of finish-mode and keeps today's retry-from-scratch. Only
   * `roadmapSource` implements it; `plansSource` deliberately does not (its end-of-flow carries
   * FD seams — Usage refresh, design archive, phase-flip — whose partial state a delivery-only
   * child cannot infer from the branch, so a rebuild is the honest recovery there).
   */
  finishPrompt?(slug: string): string;
  /** branch the shipped PR lives on, for `openPrExistsFor` */
  branchFor(slug: string): string;
  /**
   * Slugs present in this source's document **at a git ref** — the queue as the spawned
   * children will read it, since they branch from `origin/main` rather than from the
   * supervisor's working tree. `null` means "cannot answer": the ref or the path is
   * unreadable there. Optional, and only a source backed by a single tracked document can
   * implement it — `roadmapSource` does; `plansSource`, whose universe is a directory of
   * feature docs, deliberately omits it and {@link selectionNotAtRef} then no-ops.
   */
  parseAllAtRef?(ref: string): string[] | null;
}

/**
 * Stable marker in {@link formatNotAtRef}'s message. Both entrypoints classify on it —
 * `watch` treats it like a divergence (a persistent operator condition that will not clear
 * itself on the next cycle), so it must not drift with the surrounding prose.
 */
export const NOT_AT_REF_MARKER = 'uncommitted or unpushed triage';

/** The abort/warn text for a {@link selectionNotAtRef} finding. One phrasing, both callers. */
export function formatNotAtRef(missing: readonly string[], ref: string): string {
  const plural = missing.length === 1 ? 'entry is' : 'entries are';
  return (
    `drain: ${NOT_AT_REF_MARKER} — ${missing.length} selected ${plural} not present at ${ref}; ` +
    `commit and push before draining:\n${missing.map((s) => `  - ${s}`).join('\n')}`
  );
}

/**
 * The slugs this run would actually attempt that are MISSING from the source document at
 * `ref` — the staleness guard Q-0121 asks for. Children branch from `origin/main`, so a
 * block that exists only in the supervisor's working tree is invisible to them while the
 * supervisor's own eligibility read (the local tree) lists it happily: the child finds no
 * block to implement, its `remove-block` no-ops, and a full agent run burns on nothing.
 *
 * Complements {@link assertQueueSourceSynced} rather than repeating it: that guard counts
 * commits on `origin/main..HEAD`, so it catches an unpushed triage commit but is blind to
 * an **uncommitted** one — which is the case the entry was filed for.
 *
 * Only `eligible` candidates count (an entry the run will skip anyway — wrong size, unmet
 * dep, `--size` narrowing — cannot waste a spawn), and only the first `cap` of them, so a
 * stale block far down the queue cannot abort a run whose head is clean.
 *
 * `cap` is deliberately an approximation, not a bound the loop guarantees: callers pass
 * `--max-features`, which bounds *ships*, and a skipped or failed entry pushes the
 * attempt frontier deeper than that. So the guard is not exhaustive — an entry beyond the
 * cap that is only in the working tree still burns one run before its own `remove-block`
 * no-ops. Checking the whole queue instead would trade that bounded miss for a false
 * abort on every clean-headed run, which is the worse failure: it ships nothing at all.
 *
 * Returns `[]` when the source cannot answer for `ref` — a guard that cannot judge must
 * never abort. Terminates on `cap` or on queue exhaustion, whichever comes first (each
 * answered slug enters `skip`, so `nextItem` eventually returns `null`).
 */
export function selectionNotAtRef(source: DrainSource, ref: string, cap: number): string[] {
  const atRef = source.parseAllAtRef?.(ref);
  if (atRef === undefined || atRef === null) return [];
  const present = new Set(atRef);
  const bound = source.parseAll().length + 1;
  const missing: string[] = [];
  const skip = new Set<string>();
  let considered = 0;
  for (let i = 0; i < bound && considered < cap; i++) {
    const next = source.nextItem(skip);
    if (next === null) break;
    skip.add(next.slug);
    if (!next.eligible) continue;
    considered++;
    if (!present.has(next.slug)) missing.push(next.slug);
  }
  return missing;
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
export function roadmapSource(cwd: string, selection?: SelectionFilter): DrainSource {
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
      // Operator narrowing is reported FIRST: when a run is explicitly scoped, "you asked
      // for XS only" explains the absence better than a property of the entry itself.
      const narrowed = selectionReason(top, selection);
      const eligible = narrowed === undefined && fastTrack && drainOk && !depsBlocked;
      // Distinguish the ineligibility causes (the operator's own narrowing, a non-fast-track
      // size, an unmet dep, or a Touches/multi-scope residue) so the skip log is accurate.
      const reason =
        narrowed ??
        (!fastTrack
          ? 'not a fast-track XS/S entry (roadmap source ships fast-track only)'
          : depsBlocked
            ? `blocked by unshipped dep(s) still in queue: ${unmetDeps.join(', ')}`
            : !drainOk
              ? 'multi-scope or Touches-bearing entry — needs human /noldor-promote residue disposition'
              : undefined);
      return {
        slug: top.slug,
        description,
        eligible,
        ...(top.size !== undefined ? { size: top.size } : {}),
        ...(reason !== undefined ? { reason } : {}),
      };
    },
    parseAll() {
      // Deliberately NOT narrowed by `selection`: this is the success oracle's universe
      // (absence === shipped) and the reconcile prune's in-flight set. A filtered universe
      // would read every out-of-selection entry as already shipped and prune live worktrees.
      return parseRoadmap(read()).map((e) => e.slug);
    },
    parseAllAtRef(ref) {
      const rel = relative(cwd, loadDocRoots(cwd).roadmap);
      const r = spawnSync('git', ['show', `${ref}:${rel}`], { cwd, encoding: 'utf8' });
      if (r.status !== 0 || typeof r.stdout !== 'string') return null; // ref/path unreadable — cannot judge
      return parseRoadmap(r.stdout).map((e) => e.slug);
    },
    gatePrompt(slug) {
      return buildDrainGatePrompt(slug, dispatch);
    },
    finishPrompt(slug) {
      return buildFinishGatePrompt(slug, dispatch);
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
