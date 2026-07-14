# Plan-Runner — Autonomous Plan Executor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Note on autonomous gate mode:** when this plan is executed via `/gate` autonomous mode (the controller runs it inline, not via subagents), follow the same task order and commit at each task's Commit step.

**Goal:** Generalize the shipped queue-drain supervisor with an injected `DrainSource` seam so it can drain a second source — already-designed in-progress FDs (`--source plans`) — autonomously, one auto-merged `feat/<slug>` PR at a time, while `--source roadmap` preserves queue-drain behavior (output additively extended with dry-run `planned` + `skipReasons`).

**Architecture:** A new `src/autonomous/drain-source.ts` defines a `DrainSource` interface and three constructors: `roadmapSource` (preserves today's fast-track-only behavior), `plansSource` (the new capability), and `specsSource` (throws — phase 2). `decideNext` and `runDrain` lose all source/path literals and drive the injected source. `drain-io.ts` threads a gate prompt and branch through `spawnGate`/`openPrExistsFor`. The CLI gains `--source` and a `run` command (with `queue-drain` kept as a `--source roadmap` alias). The gate skill gains a drain-only branch that resumes a fully-designed FD straight into autonomous implementation.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, Zod (existing FD schema), gray-matter (existing FD frontmatter parse). No new dependencies.

**Spec:** [docs/design/specs/2026-06-10-plan-runner-design.md](../specs/2026-06-10-plan-runner-design.md)

---

## File Structure

**New:**
- `src/autonomous/drain-source.ts` — `SourceId`, `DrainCandidate`, `DrainSource`, `roadmapSource`, `plansSource`, `specsSource`.
- `src/autonomous/__tests__/drain-source.test.ts` — unit tests for all three sources (temp-dir fixtures).

**Modified:**
- `src/autonomous/drain-loop.ts` — `decideNext` consumes `DrainCandidate.eligible`; `DrainDeps` swaps `nextPriority`+`parseAll` for `source: DrainSource` and re-signs `spawnGate`/`openPrExistsFor`; `runDrain` drives the source; `DrainResult` gains optional `skipReasons`.
- `src/autonomous/drain-io.ts` — `spawnGate(cwd, env, timeoutMs, prompt='/gate')`; `openPrExistsFor(cwd, slug, branch)`.
- `src/autonomous/queue-drain.ts` — `parseArgs` gains `source`; `main` builds the source and wires the new dep signatures; dry-run/JSON output surfaces `skipReasons`.
- `src/autonomous/__tests__/decide-next.test.ts` — rewired to `DrainCandidate` (eligibility cases migrate to drain-source.test.ts).
- `src/autonomous/__tests__/run-drain.test.ts` — harness rewired to a mock `DrainSource`; assertions unchanged.
- `src/autonomous/__tests__/queue-drain-cli.test.ts` — `--source` parse tests added.
- `src/cli/manifest.ts` — register `autonomous run`; retain `queue-drain` alias.
- `.claude/skills/gate/SKILL.md` — drain-resume autonomous-from-plan branch in `## --resume mode`.

---

### Task 1: `drain-source.ts` — types + `specsSource`

Additive — nothing imports this yet, so the build stays green.

**Files:**
- Create: `src/autonomous/drain-source.ts`
- Test: `src/autonomous/__tests__/drain-source.test.ts`

- [ ] **Step 1: Write the failing test for `specsSource`**

Create `src/autonomous/__tests__/drain-source.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { specsSource } from '../drain-source.js';

describe('specsSource', () => {
  it('throws a clear phase-2 message (not yet implemented)', () => {
    expect(() => specsSource('/x')).toThrow(/not yet implemented|phase 2/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/autonomous/__tests__/drain-source.test.ts`
Expected: FAIL — `specsSource` is not exported / module missing.

- [ ] **Step 3: Create `drain-source.ts` with types + `specsSource`**

Create `src/autonomous/drain-source.ts`:

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';

import { getSuggestions, loadInProgressFds, loadMilestoneGate } from '../core/next-priority.js';
import { loadDocRoots } from '../core/doc-roots.js';
import { parseRoadmap } from '../utils/parse-blocks.js';
import { isDrainEligible } from './drain-eligibility.js';

export type SourceId = 'roadmap' | 'plans' | 'specs';

/**
 * One drainable item. `eligible` replaces the fast-track literal that used to
 * live in `decideNext`: the source decides eligibility, the loop only reads it.
 * `reason` (when ineligible) feeds the dry-run / skip log.
 */
export interface DrainCandidate {
  slug: string;
  description: string; // body used by eligibility; '' when N/A
  eligible: boolean;
  reason?: string;
}

/**
 * The injected source seam. `runDrain` is pure of source knowledge — every
 * `'fast-track'` / `'roadmap'` / `'feat/'` / `'fast/'` literal lives in an
 * implementation here.
 */
export interface DrainSource {
  id: SourceId;
  /** Next candidate not in `skip`, or null when none remain. */
  nextItem(skip: ReadonlySet<string>): DrainCandidate | null;
  /** Success-oracle universe: ALL items (unfiltered). Absence === shipped. */
  parseAll(): string[];
  /** Prompt handed to `claude --print` for this slug. */
  gatePrompt(slug: string): string;
  /** Branch the shipped PR lives on, for `openPrExistsFor`. */
  branchFor(slug: string): string;
}

/** Escape a slug for safe embedding in a RegExp (slugs are kebab-case, but be defensive). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// roadmapSource + plansSource added in Tasks 2 and 3.

/**
 * Phase-2 placeholder. Specs-source needs an autonomous `writing-plans` step —
 * the risky design stage the queue-drain MVP deliberately omitted — so it errors
 * until a separate FD takes it on.
 */
export function specsSource(_cwd: string): DrainSource {
  throw new Error('--source specs is not yet implemented (phase 2: needs an autonomous writing-plans step)');
}
```

> The imports for `getSuggestions`/`loadInProgressFds`/`parseRoadmap`/`isDrainEligible`/`escapeRe` are used by Tasks 2–3. TypeScript will flag unused imports under the project's lint; to keep Task 1 green on its own, add the `roadmapSource` skeleton from Task 2 Step 3 now if `pnpm typecheck` complains about unused imports. Otherwise land Tasks 1–3 before running the full lint (they are one cohesive additive unit).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/autonomous/__tests__/drain-source.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/autonomous/drain-source.ts src/autonomous/__tests__/drain-source.test.ts
git commit -m "feat(autonomous): DrainSource types + specsSource phase-2 stub" -m "Noldor-FD: plan-runner"
```

---

### Task 2: `roadmapSource` — preserve queue-drain behavior exactly

**Files:**
- Modify: `src/autonomous/drain-source.ts`
- Test: `src/autonomous/__tests__/drain-source.test.ts`

- [ ] **Step 1: Write failing tests for `roadmapSource`** (append to the test file)

These migrate the eligibility cases that used to live in `decide-next.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { roadmapSource } from '../drain-source.js';

function tmpRepo(roadmap: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'drain-src-'));
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'roadmap.md'), roadmap, 'utf8');
  return dir;
}

// A real roadmap entry: `### Name` + `- key: value` bullets + free-text body.
// `parseRoadmap` derives the slug from the heading via slugify and sets priority
// from source order — there is NO `slug:`/`priority:` field. Use lowercase
// single-word names so `slug === name`. `size: XS` → suggestedPath 'fast-track'
// (sizeToPath); `size: L` → an attach path (not fast-track).
function block(name: string, size: string, body = ''): string {
  return [`### ${name}`, '', `- area: tooling`, `- size: ${size}`, `- impact: high`, '', body, ''].join(
    '\n',
  );
}

describe('roadmapSource', () => {
  it('nextItem returns the top entry as an eligible fast-track candidate', () => {
    const dir = tmpRepo(block('alpha', 'XS', 'do one small thing'));
    try {
      const c = roadmapSource(dir).nextItem(new Set());
      expect(c).not.toBeNull();
      expect(c!.slug).toBe('alpha');
      expect(c!.eligible).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('marks a non-fast-track (L) entry ineligible', () => {
    const dir = tmpRepo(block('big', 'L', 'a large feature'));
    try {
      const c = roadmapSource(dir).nextItem(new Set());
      expect(c!.eligible).toBe(false);
      expect(c!.reason).toMatch(/fast-track/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('marks a Touches-bearing entry ineligible', () => {
    const dir = tmpRepo(block('touch', 'XS', 'do it\nTouches: a.ts'));
    try {
      expect(roadmapSource(dir).nextItem(new Set())!.eligible).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('respects the skip set and returns null when nothing remains', () => {
    const dir = tmpRepo(block('alpha', 'XS'));
    try {
      expect(roadmapSource(dir).nextItem(new Set(['alpha']))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parseAll returns every roadmap slug; gatePrompt is /gate; branchFor is fast/<slug>', () => {
    const dir = tmpRepo(block('alpha', 'XS') + block('beta', 'L'));
    try {
      const s = roadmapSource(dir);
      expect(s.parseAll().sort()).toEqual(['alpha', 'beta']);
      expect(s.gatePrompt('alpha')).toBe('/gate');
      expect(s.branchFor('alpha')).toBe('fast/alpha');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

> Format verified against `src/utils/parse-blocks.ts:parseRoadmap`: an H3 `### Name` with a `- area:` bullet is a direct (level-3) entry; the slug is `slugify(name)` (single-word lowercase names keep `slug === name`); `size`/`impact`/`area` are `- key: value` bullets; the rest is free-text body. There is no `slug:` or `priority:` field — priority is source order.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/autonomous/__tests__/drain-source.test.ts -t roadmapSource`
Expected: FAIL — `roadmapSource` not exported.

- [ ] **Step 3: Implement `roadmapSource`** (insert into `drain-source.ts`, replacing the `// roadmapSource + plansSource added...` comment)

```ts
/**
 * Reproduces queue-drain behavior exactly: `nextItem` is today's
 * `getSuggestions(...).topPriority[0]` with `eligible = fast-track && isDrainEligible`;
 * `parseAll` is the full roadmap slug list (the D2 oracle); the gate prompt is
 * bare `/gate` (drain Step 0 auto-selects topPriority[0]); the branch is `fast/<slug>`.
 */
export function roadmapSource(cwd: string): DrainSource {
  const read = (): string => readFileSync(loadDocRoots(cwd).roadmap, 'utf8');
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
      const eligible = fastTrack && drainOk;
      // Distinguish the two ineligibility causes (a non-fast-track size vs a
      // Touches/multi-scope residue that fails isDrainEligible) so the skip log is accurate.
      const reason = !fastTrack
        ? 'not a fast-track XS/S entry (roadmap source ships fast-track only)'
        : !drainOk
          ? 'multi-scope or Touches-bearing entry — needs human /promote residue disposition'
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
    gatePrompt() {
      return '/gate';
    },
    branchFor(slug) {
      return `fast/${slug}`;
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/autonomous/__tests__/drain-source.test.ts -t roadmapSource`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/autonomous/drain-source.ts src/autonomous/__tests__/drain-source.test.ts
git commit -m "feat(autonomous): roadmapSource preserves fast-track drain behavior" -m "Noldor-FD: plan-runner"
```

---

### Task 3: `plansSource` — drain designed in-progress FDs

**Files:**
- Modify: `src/autonomous/drain-source.ts`
- Test: `src/autonomous/__tests__/drain-source.test.ts`

- [ ] **Step 1: Write failing tests for `plansSource`** (append)

```ts
import { plansSource } from '../drain-source.js';

/** Seed an in-progress FD + optional spec/plan files under a temp repo. */
function tmpPlansRepo(
  fds: Array<{ slug: string; spec?: boolean; planDate?: string | null }>,
): string {
  const dir = mkdtempSync(join(tmpdir(), 'drain-plans-'));
  mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'superpowers', 'specs'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true });
  for (const fd of fds) {
    const fm = [
      '---',
      `name: ${fd.slug}`,
      'area: tooling',
      'category: Tooling',
      'packages:',
      '  - scripts',
      'phase: in-progress',
      'noldor-tier: full',
      '---',
      '',
      '## Summary',
      '',
      'x',
      '',
    ].join('\n');
    writeFileSync(join(dir, 'docs', 'features', `${fd.slug}.md`), fm, 'utf8');
    if (fd.spec !== false) {
      writeFileSync(
        join(dir, 'docs', 'superpowers', 'specs', `2026-06-01-${fd.slug}-design.md`),
        '# spec',
        'utf8',
      );
    }
    if (fd.planDate !== null) {
      const d = fd.planDate ?? '2026-06-05';
      writeFileSync(join(dir, 'docs', 'superpowers', 'plans', `${d}-${fd.slug}.md`), '# plan', 'utf8');
    }
  }
  return dir;
}

describe('plansSource', () => {
  it('returns an in-progress FD with spec+plan as an eligible candidate', () => {
    const dir = tmpPlansRepo([{ slug: 'designed' }]);
    try {
      const c = plansSource(dir).nextItem(new Set());
      expect(c).not.toBeNull();
      expect(c!.slug).toBe('designed');
      expect(c!.eligible).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('orders eligible FDs by ascending plan-file date (FIFO oldest-first)', () => {
    const dir = tmpPlansRepo([
      { slug: 'newer', planDate: '2026-06-09' },
      { slug: 'older', planDate: '2026-06-02' },
    ]);
    try {
      expect(plansSource(dir).nextItem(new Set())!.slug).toBe('older');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('surfaces an in-progress FD lacking a plan as ineligible with the phase-2 reason', () => {
    const dir = tmpPlansRepo([{ slug: 'noplan', planDate: null }]);
    try {
      const c = plansSource(dir).nextItem(new Set());
      expect(c!.slug).toBe('noplan');
      expect(c!.eligible).toBe(false);
      expect(c!.reason).toMatch(/no plan/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('surfaces a plan-but-no-spec FD as ineligible with a no-spec reason (never silently dropped)', () => {
    const dir = tmpPlansRepo([{ slug: 'nospec', spec: false }]);
    try {
      const c = plansSource(dir).nextItem(new Set());
      expect(c!.slug).toBe('nospec');
      expect(c!.eligible).toBe(false);
      expect(c!.reason).toMatch(/no spec/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prefers an eligible FD over a no-plan FD', () => {
    const dir = tmpPlansRepo([{ slug: 'noplan', planDate: null }, { slug: 'designed' }]);
    try {
      expect(plansSource(dir).nextItem(new Set())!.slug).toBe('designed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parseAll returns all in-progress slugs; gatePrompt resumes; branchFor is feat/<slug>', () => {
    const dir = tmpPlansRepo([{ slug: 'designed' }, { slug: 'noplan', planDate: null }]);
    try {
      const s = plansSource(dir);
      expect(s.parseAll().sort()).toEqual(['designed', 'noplan']);
      expect(s.gatePrompt('designed')).toBe('/gate --resume designed');
      expect(s.branchFor('designed')).toBe('feat/designed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('honours the skip set', () => {
    const dir = tmpPlansRepo([{ slug: 'designed' }]);
    try {
      expect(plansSource(dir).nextItem(new Set(['designed']))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/autonomous/__tests__/drain-source.test.ts -t plansSource`
Expected: FAIL — `plansSource` not exported.

- [ ] **Step 3: Implement `plansSource`** (insert into `drain-source.ts`, after `roadmapSource`)

```ts
/**
 * Drains already-designed in-progress FDs. Eligible iff the FD has BOTH a
 * committed spec (`docs/design/specs/*-<slug>-design.md`) and a plan
 * (`docs/design/plans/<date>-<slug>.md`). Eligible FDs are ordered by
 * ascending plan-file date (FIFO — oldest-designed-first, D2). An in-progress FD
 * with no plan is surfaced as ineligible (reason: phase-2) so dry-run logs it and
 * the loop skips — never fails — it (D3). `parseAll` is the full in-progress slug
 * set: a slug is shipped iff absent on the post-spawn re-read (absence === shipped).
 */
export function plansSource(cwd: string): DrainSource {
  const roots = loadDocRoots(cwd);
  const inProgressSlugs = (): string[] => loadInProgressFds(cwd).map((f) => f.slug);

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
  // slug `runner` does NOT false-match `2026-06-10-plan-runner-design.md`. Trade-off:
  // an attach-enhancement spec (`<date>-<parent>-<enh>-design.md`) won't match a
  // parent-slug lookup; plan-runner's MVP targets full-new designed FDs whose spec
  // is `<date>-<slug>-design.md` (the prep-pipeline output). Documented, acceptable.
  const hasSpec = (slug: string): boolean => {
    if (!existsSync(roots.specs)) return false;
    const re = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escapeRe(slug)}-design\\.md$`);
    return readdirSync(roots.specs).some((f) => re.test(f));
  };

  return {
    id: 'plans',
    nextItem(skip) {
      const rows = inProgressSlugs()
        .filter((slug) => !skip.has(slug))
        .toSorted((a, b) => a.localeCompare(b)) // deterministic blocked-pick order
        .map((slug) => ({ slug, date: planDate(slug), spec: hasSpec(slug) }));

      const eligible = rows
        .filter((r) => r.date !== null && r.spec)
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
            : 'no spec — not eligible (plan present, spec missing)';
        return { slug: blocked.slug, description: '', eligible: false, reason };
      }
      return null;
    },
    parseAll() {
      return inProgressSlugs();
    },
    gatePrompt(slug) {
      return `/gate --resume ${slug}`;
    },
    branchFor(slug) {
      return `feat/${slug}`;
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/autonomous/__tests__/drain-source.test.ts`
Expected: PASS (all three source describe-blocks).

- [ ] **Step 5: Commit**

```bash
git add src/autonomous/drain-source.ts src/autonomous/__tests__/drain-source.test.ts
git commit -m "feat(autonomous): plansSource drains designed in-progress FDs (FIFO by plan age)" -m "Noldor-FD: plan-runner"
```

---

### Task 4: Source-agnostic loop, IO, and CLI wiring

The atomic refactor — `decideNext`, `runDrain`/`DrainDeps`, `drain-io.ts`, and `queue-drain.ts` change together so the project compiles. Existing test files are rewired (assertions unchanged) in the same commit.

**Files:**
- Modify: `src/autonomous/drain-loop.ts`, `src/autonomous/drain-io.ts`, `src/autonomous/queue-drain.ts`
- Test: `src/autonomous/__tests__/decide-next.test.ts`, `src/autonomous/__tests__/run-drain.test.ts`, `src/autonomous/__tests__/queue-drain-cli.test.ts`

- [ ] **Step 1: Rewire `decide-next.test.ts` to `DrainCandidate`**

Replace the whole file:

```ts
import { describe, expect, it } from 'vitest';
import { decideNext } from '../drain-loop.js';
import type { DrainCandidate } from '../drain-source.js';

function cand(over: Partial<DrainCandidate> = {}): DrainCandidate {
  return { slug: 'x', description: 'small thing', eligible: true, ...over };
}
const caps = { shipped: 0, maxFeatures: 20, spawns: 0, maxSpawns: 40 };

describe('decideNext', () => {
  it('spawns an eligible candidate', () => {
    expect(decideNext({ candidate: cand(), ...caps }).action).toBe('spawn');
  });
  it('skips an ineligible candidate', () => {
    expect(decideNext({ candidate: cand({ eligible: false }), ...caps }).action).toBe(
      'skip-out-of-scope',
    );
  });
  it('done when shipped >= maxFeatures', () => {
    expect(decideNext({ candidate: cand(), ...caps, shipped: 20 }).action).toBe('done');
  });
  it('done when spawns >= maxSpawns', () => {
    expect(decideNext({ candidate: cand(), ...caps, spawns: 40 }).action).toBe('done');
  });
});
```

> The migrated cases (non-fast-track / Touches / multi-scope) now live in `drain-source.test.ts` (roadmapSource), Task 2 — eligibility is a source concern, not a loop concern.

- [ ] **Step 2: Rewire `run-drain.test.ts` harness to a mock `DrainSource`**

Replace lines 1–68 (imports + `entryOf` + `harness`) with:

```ts
import { describe, expect, it, vi } from 'vitest';
import { runDrain } from '../drain-loop.js';
import type { DrainSource } from '../drain-source.js';

/**
 * Mutable-roadmap harness. The mock source's `nextItem(skip)` returns the live
 * list minus `skip` (so the loop's skip filter terminates it); `parseAll()`
 * returns the live list (the D2 oracle); a "shipping" spawn removes the
 * just-targeted slug (simulating a merged PR). Every test terminates for the
 * RIGHT reason — not via the maxSpawns backstop.
 */
function harness(
  initial: string[],
  opts: {
    ships?: (slug: string) => boolean;
    spawnImpl?: () => number;
    openPr?: () => boolean;
    stop?: () => boolean;
    eligibleFor?: (slug: string) => boolean;
    nextItemImpl?: (skip: ReadonlySet<string>) => ReturnType<DrainSource['nextItem']>;
    parseAllImpl?: () => string[];
  } = {},
) {
  let roadmap = [...initial];
  let lastTarget: string | null = null;
  const ships = opts.ships ?? (() => true);
  const eligibleFor = opts.eligibleFor ?? (() => true);
  const nextItem = vi.fn(
    opts.nextItemImpl ??
      ((skip: ReadonlySet<string>) => {
        const visible = roadmap.filter((s) => !skip.has(s));
        lastTarget = visible[0] ?? null;
        if (lastTarget === null) return null;
        return { slug: lastTarget, description: 'x', eligible: eligibleFor(lastTarget) };
      }),
  );
  const spawnGate = vi.fn((_env: Record<string, string>, _timeoutMs: number, _prompt: string) => {
    const code = (opts.spawnImpl ?? (() => 0))(); // may throw (timeout) → no removal
    if (lastTarget !== null && ships(lastTarget)) roadmap = roadmap.filter((s) => s !== lastTarget);
    return code;
  });
  const source: DrainSource = {
    id: 'roadmap',
    nextItem,
    parseAll: vi.fn(opts.parseAllImpl ?? (() => [...roadmap])),
    gatePrompt: () => '/gate',
    branchFor: (s) => `fast/${s}`,
  };
  return {
    deps: {
      source,
      spawnGate,
      syncMainCleanState: vi.fn(),
      openPrExistsFor: vi.fn(opts.openPr ?? (() => false)),
      writeState: vi.fn(),
      stopRequested: vi.fn(opts.stop ?? (() => false)),
    },
    spawnGate,
    nextItem,
  };
}
```

Then update the three tests that depended on the old dep names (assertions stay the same):

- Test **(b)** "aborts when nextPriority throws" → replace its `nextPriorityImpl` with:
  ```ts
  const h = harness(['a'], { nextItemImpl: () => { throw new Error('parse boom'); } });
  ```
- Test **(g)** "out-of-scope entry skipped" → replace its `entryOver` with:
  ```ts
  const h = harness(['a'], { eligibleFor: () => false });
  ```
- Test **(l)** "parseAll failure" → unchanged shape (`parseAllImpl` still exists):
  ```ts
  const h = harness(['a'], { ships: () => false, parseAllImpl: () => { throw new Error('parse'); } });
  ```

All other tests ((a),(c),(d),(e),(f),(i),(j),(k),(m)) keep their bodies — they only reference `h.deps`, `h.spawnGate`, `opts`, none of which changed name.

- [ ] **Step 3: Run the loop tests to verify they fail (compile error / red)**

Run: `pnpm vitest run src/autonomous/__tests__/decide-next.test.ts src/autonomous/__tests__/run-drain.test.ts`
Expected: FAIL — `drain-loop.ts` still exports the old `decideNext({entry})` / `DrainDeps{nextPriority,parseAll}`.

- [ ] **Step 4: Refactor `drain-loop.ts`**

Replace the imports + `decideNext` + `DrainDeps` + `DrainResult` + `runDrain` (the eligibility import is gone — it moved to drain-source):

```ts
import type { DrainSource, DrainCandidate } from './drain-source.js';

export type DrainAction = 'spawn' | 'skip-out-of-scope' | 'done';

export interface DecideInput {
  candidate: DrainCandidate;
  shipped: number;
  maxFeatures: number;
  spawns: number;
  maxSpawns: number;
}

/**
 * Pure per-iteration decision. Retry-agnostic — {@link runDrain} owns retry
 * counting. `done` caps fire first (backstops), then the source's eligibility
 * verdict, else `spawn`. No source/path literals here (they live in the source).
 */
export function decideNext(input: DecideInput): { action: DrainAction; slug: string } {
  const { candidate, shipped, maxFeatures, spawns, maxSpawns } = input;
  const slug = candidate.slug;
  if (shipped >= maxFeatures || spawns >= maxSpawns) return { action: 'done', slug };
  if (!candidate.eligible) return { action: 'skip-out-of-scope', slug };
  return { action: 'spawn', slug };
}

export interface DrainDeps {
  /** Injected source — owns next-item selection, the success oracle, prompt, and branch. */
  source: DrainSource;
  /** Spawn a headless gate run with the source's prompt; returns the child exit code. May throw('iteration-timeout'). */
  spawnGate: (env: Record<string, string>, timeoutMs: number, prompt: string) => number;
  /** Sync local main to origin + clean leftover worktrees/branches. May throw → abort (ff-only reject). */
  syncMainCleanState: () => void;
  /** True when an open PR exists for the source's branch. May throw → abort (fail-closed). */
  openPrExistsFor: (slug: string, branch: string) => boolean;
  /** Best-effort heartbeat write (never throws). */
  writeState: (s: {
    phase: 'spawning' | 'awaiting-merge' | 'idle';
    currentSlug: string | null;
    shipped: number;
    skip: string[];
    retries: Record<string, number>;
  }) => void;
  /** True when a stop has been requested (SIGINT / sentinel). */
  stopRequested: () => boolean;
}

export interface DrainOpts {
  maxFeatures: number;
  maxRetries: number;
  maxSpawns: number;
  timeoutMs: number;
  dryRun: boolean;
  cwd: string;
}

export interface DrainResult {
  shipped: number;
  skipped: string[];
  /** Per-slug skip reasons (e.g. ineligible). Present only when at least one reason was recorded. */
  skipReasons?: Record<string, string>;
  /** Dry-run only: eligible candidates that WOULD ship, in FIFO order. Present only in --dry-run with ≥1 eligible. */
  planned?: string[];
  exitCode: 0 | 1 | 130;
  /** Set only on an abort (exitCode 1) — the message of the dep that threw. */
  error?: string;
}

/**
 * The drain loop. Pure of IO except through injected {@link DrainDeps}. Success
 * === the target slug is absent from the source's freshly-synced `parseAll()`
 * universe (absence === shipped). Failure → retry up to `maxRetries`, then skip.
 * Termination on a null `nextItem` (D4), the `done` caps, or a stop request
 * (exit 130). Any thrown dep (source.nextItem / source.parseAll / openPrExistsFor
 * / syncMainCleanState) aborts the whole drain (exit 1) — never loop blind.
 */
export function runDrain(deps: DrainDeps, opts: DrainOpts): DrainResult {
  const skip = new Set<string>();
  const retries = new Map<string, number>();
  const skipReasons: Record<string, string> = {};
  const planned: string[] = [];
  let shipped = 0;
  let spawns = 0;
  const result = (exitCode: 0 | 1 | 130, error?: string): DrainResult => ({
    shipped,
    skipped: [...skip],
    ...(Object.keys(skipReasons).length > 0 ? { skipReasons } : {}),
    ...(planned.length > 0 ? { planned } : {}),
    exitCode,
    ...(error !== undefined ? { error } : {}),
  });

  try {
    deps.syncMainCleanState();
    for (;;) {
      if (deps.stopRequested()) return result(130);
      const candidate = deps.source.nextItem(skip);
      if (candidate === null) return result(0); // D4 — done
      const d = decideNext({
        candidate,
        shipped,
        maxFeatures: opts.maxFeatures,
        spawns,
        maxSpawns: opts.maxSpawns,
      });
      if (d.action === 'done') return result(0);
      if (d.action === 'skip-out-of-scope') {
        skip.add(candidate.slug);
        if (candidate.reason !== undefined) skipReasons[candidate.slug] = candidate.reason;
        continue;
      }

      const branch = deps.source.branchFor(candidate.slug);
      if (deps.openPrExistsFor(candidate.slug, branch)) {
        skip.add(candidate.slug); // restart-safety: a prior run's PR is in-flight
        continue;
      }
      if (opts.dryRun) {
        planned.push(candidate.slug); // eligible — would ship (dry-run diagnostic, FIFO order)
        skip.add(candidate.slug); // plan only — never spawn / merge
        continue;
      }

      spawns += 1;
      deps.writeState({
        phase: 'spawning',
        currentSlug: candidate.slug,
        shipped,
        skip: [...skip],
        retries: Object.fromEntries(retries),
      });
      try {
        deps.spawnGate(
          { NOLDOR_DRAIN: '1', NOLDOR_DRAIN_SKIP: [...skip].join(',') },
          opts.timeoutMs,
          deps.source.gatePrompt(candidate.slug),
        );
      } catch (e) {
        // A per-iteration timeout is recoverable (retry/skip below). Any other spawn error
        // (e.g. `claude` not on PATH) is systemic — re-throw so the outer catch aborts.
        if (!(e instanceof Error && e.message === 'iteration-timeout')) throw e;
      }
      deps.syncMainCleanState(); // make the read authoritative
      const stillPresent = deps.source.parseAll().includes(candidate.slug);
      if (!stillPresent) {
        shipped += 1;
        retries.delete(candidate.slug);
        continue;
      }
      if (deps.openPrExistsFor(candidate.slug, branch)) {
        skip.add(candidate.slug); // PR landed in-flight; never re-spawn a duplicate
        continue;
      }
      const n = (retries.get(candidate.slug) ?? 0) + 1;
      retries.set(candidate.slug, n);
      if (n > opts.maxRetries) skip.add(candidate.slug);
    }
  } catch (err) {
    return result(1, err instanceof Error ? err.message : String(err));
  }
}
```

- [ ] **Step 5: Refactor `drain-io.ts` signatures**

In `openPrExistsFor`, accept `branch`:

```ts
export function openPrExistsFor(cwd: string, slug: string, branch: string): boolean {
  const out = execFileSync(
    'gh',
    ['pr', 'list', '--state', 'open', '--head', branch, '--json', 'number'],
    { cwd, encoding: 'utf8' },
  );
  return (JSON.parse(out) as unknown[]).length > 0;
}
```

> `slug` stays in the signature (callers pass it, it scopes log/error context) even though `branch` now drives the query. The doc-comment's "fast/<slug>" reference should be reworded to "the source's branch".

In `spawnGate`, accept `prompt`:

```ts
export function spawnGate(
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
  prompt = '/gate',
): number {
  const res = spawnSync(
    'claude',
    ['--print', prompt, '--disallowed-tools', 'AskUserQuestion', '--permission-mode', 'bypassPermissions'],
    { cwd, env: { ...process.env, ...env }, stdio: 'inherit', timeout: timeoutMs, killSignal: 'SIGKILL' },
  );
  if (res.error) {
    const code = (res.error as NodeJS.ErrnoException).code;
    if (code === 'ETIMEDOUT') throw new Error('iteration-timeout');
    throw new Error(`spawn-failed: ${res.error.message}`);
  }
  return res.status ?? 1;
}
```

- [ ] **Step 6: Wire `queue-drain.ts` — `--source` parse + source builder + new dep signatures**

Update imports (drop `getSuggestions`/`loadInProgressFds`/`loadMilestoneGate`/`parseRoadmap`/`loadDocRoots`/`readFileSync` if now unused by `main`; keep `existsSync`/`unlinkSync`/`join` for the stop-sentinel):

```ts
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { loadConfigSync, type NoldorConfig } from '../cr/config.js';
import { runDrain, type DrainDeps, type DrainResult } from './drain-loop.js';
import { roadmapSource, plansSource, specsSource, type SourceId, type DrainSource } from './drain-source.js';
import { acquireLock, releaseLock } from './drain-lock.js';
import { writeState, type DrainState } from './drain-state.js';
import { syncMainCleanState, openPrExistsFor, spawnGate } from './drain-io.js';
```

Add `source` to `ParsedArgs` and a parser:

```ts
export interface ParsedArgs {
  maxFeatures: number;
  maxRetries: number;
  maxSpawns: number;
  timeoutMs: number;
  dryRun: boolean;
  json: boolean;
  source: SourceId;
}

function parseSource(args: readonly string[]): SourceId {
  const i = args.indexOf('--source');
  if (i === -1) return 'roadmap';
  const v = args[i + 1];
  if (v !== 'roadmap' && v !== 'plans' && v !== 'specs') {
    throw new Error('--source must be one of: roadmap, plans, specs');
  }
  return v;
}
```

In `parseArgs`, add `source: parseSource(args)` to the returned object.

Add a source builder and use it in `main` (inside the initial try so `specsSource`'s throw → exit 1):

```ts
function buildSource(id: SourceId, cwd: string): DrainSource {
  if (id === 'roadmap') return roadmapSource(cwd);
  if (id === 'plans') return plansSource(cwd);
  return specsSource(cwd); // throws — phase 2
}
```

Rewrite `main`'s try-block + deps:

```ts
  const cwd = process.cwd();
  let parsed: ParsedArgs;
  let source: DrainSource;
  try {
    parsed = parseArgs(args);
    assertConfig(loadConfigSync() ?? {});
    source = buildSource(parsed.source, cwd); // --source specs throws here → exit 1
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  }
```

(Remove the old standalone `const cwd = process.cwd();` further down — it's hoisted above now.)

Then the deps object:

```ts
  const deps: DrainDeps = {
    source,
    spawnGate: (env, timeoutMs, prompt) => spawnGate(cwd, env, timeoutMs, prompt),
    syncMainCleanState: () => syncMainCleanState(cwd),
    openPrExistsFor: (slug, branch) => openPrExistsFor(cwd, slug, branch),
    writeState: (s) => {
      const state: DrainState = {
        pid: process.pid,
        startedAt,
        phase: s.phase,
        currentSlug: s.currentSlug,
        shipped: s.shipped,
        skip: s.skip,
        retries: s.retries,
      };
      writeState(cwd, state);
    },
    stopRequested: () => stop || existsSync(join(cwd, '.noldor/drain-stop')),
  };
```

And surface `skipReasons` in the output (after the existing stdout write):

```ts
  process.stdout.write(
    parsed.json
      ? `${JSON.stringify(res)}\n`
      : `drain: shipped ${res.shipped}, skipped ${res.skipped.length} [${res.skipped.join(', ')}]\n`,
  );
  if (!parsed.json && res.planned !== undefined) {
    process.stdout.write(`  would ship (FIFO plan-age): ${res.planned.join(', ')}\n`);
  }
  if (!parsed.json && res.skipReasons !== undefined) {
    for (const [slug, reason] of Object.entries(res.skipReasons)) {
      process.stdout.write(`  skip ${slug}: ${reason}\n`);
    }
  }
```

(`JSON.stringify(res)` already includes `skipReasons` when present, so the JSON branch needs no change.)

- [ ] **Step 7: Add `--source` parse tests to `queue-drain-cli.test.ts`**

Append inside the existing `describe('queue-drain CLI helpers', ...)`:

```ts
  it('defaults --source to roadmap', () => {
    expect(parseArgs([]).source).toBe('roadmap');
  });
  it('reads --source plans', () => {
    expect(parseArgs(['--source', 'plans']).source).toBe('plans');
  });
  it('rejects an invalid --source', () => {
    expect(() => parseArgs(['--source', 'bogus'])).toThrow(/source/);
  });
```

- [ ] **Step 8: Run the full autonomous suite + typecheck**

Run: `pnpm vitest run src/autonomous && pnpm typecheck`
Expected: PASS — decide-next (4), run-drain (all original cases), queue-drain-cli (original + 3 new), drain-source (all), and no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/autonomous/drain-loop.ts src/autonomous/drain-io.ts src/autonomous/queue-drain.ts src/autonomous/__tests__/decide-next.test.ts src/autonomous/__tests__/run-drain.test.ts src/autonomous/__tests__/queue-drain-cli.test.ts
git commit -m "refactor(autonomous): drive runDrain via injected DrainSource; thread prompt+branch" -m "Noldor-FD: plan-runner"
```

---

### Task 5: Register `autonomous run` in the CLI manifest

**Files:**
- Modify: `src/cli/manifest.ts`

- [ ] **Step 1: Write a failing smoke assertion**

Check whether a manifest test exists: `ls src/cli/__tests__/ 2>/dev/null`. If `manifest.test.ts` (or similar) exists, add:

```ts
it('registers autonomous run + keeps queue-drain alias', () => {
  expect(MANIFEST.autonomous.subs.run?.src).toBe('autonomous/queue-drain.ts');
  expect(MANIFEST.autonomous.subs['queue-drain']?.src).toBe('autonomous/queue-drain.ts');
});
```

If no manifest test file exists, skip the unit assertion (the CLI smoke in Task 7 covers it) and go straight to Step 2.

- [ ] **Step 2: Register the `run` command** (in `src/cli/manifest.ts`, the `autonomous` group)

```ts
  autonomous: {
    desc: 'Autonomous runners (queue-drain / plan-runner)',
    subs: {
      run: {
        src: 'autonomous/queue-drain.ts',
        desc: 'Drain a source autonomously (--source roadmap|plans)',
      },
      'queue-drain': {
        src: 'autonomous/queue-drain.ts',
        desc: 'Fast-track roadmap drain (same entrypoint as `run`; defaults --source roadmap)',
      },
    },
  },
```

- [ ] **Step 3: Verify the CLI dispatches both**

Run:
```bash
pnpm noldor autonomous run --help 2>&1 | head -5 || true
pnpm noldor autonomous queue-drain --dry-run --source roadmap --json 2>&1 | tail -3 || true
```
Expected: `run` resolves to the queue-drain entrypoint (config precondition may abort with the `autonomous` block message if `.noldor/config.json` lacks the triple — that is the *correct* assertConfig path, not a routing failure). A routing failure would instead say `Unknown subcommand`.

- [ ] **Step 4: Commit**

```bash
git add src/cli/manifest.ts src/cli/__tests__/ 2>/dev/null
git commit -m "feat(cli): register \`autonomous run\`; keep queue-drain as roadmap alias" -m "Noldor-FD: plan-runner"
```

---

### Task 6: Gate skill — drain-resume autonomous-from-plan branch

The one gate-skill addition (D5). Prose-only; the supervisor + sources carry the rest.

**Files:**
- Modify: `.claude/skills/gate/SKILL.md`

> **Watch-item:** `.claude/skills/gate/SKILL.md` may be a shared/templated file. If the pre-commit shared-files guard blocks the commit, set `NOLDOR_ALLOW_SHARED=1` for the commit (see the attach-flow gotchas) and check whether a template twin under `docs/noldor/` or a templates dir must change in lockstep.

- [ ] **Step 1: Read the current `## --resume mode` section**

Run: `grep -n "## --resume mode" .claude/skills/gate/SKILL.md` and read the section.

- [ ] **Step 2: Append the drain branch to `## --resume mode`**

Insert after the existing `--resume mode` paragraph:

```markdown
### Drain mode (`NOLDOR_DRAIN=1`)

When `--resume <slug>` runs under the drain supervisor (env `NOLDOR_DRAIN=1`, set by the `runDrain` loop on every spawn — source-independent, not source-specific), behaviour changes **only under that env var** — the interactive `--resume` path (env unset) is unchanged.

After re-establishing the session marker and creating/force-recreating the `feat/<slug>` worktree:

1. **Detect committed design.** Confirm the FD carries BOTH a spec and a plan in the worktree (they are committed on the feature branch — `plansSource` already gated on this, so this is a defensive re-check):
   - spec: `ls docs/design/specs/*-<slug>-design.md` resolves to ≥1 file.
   - plan: `ls docs/design/plans/*-<slug>.md` resolves to ≥1 file.

   (These globs are a coarse defensive existence re-check only — `plansSource.nextItem` already applied the date-anchored `<date>-<slug>-design.md` / `<date>-<slug>.md` match before spawning. A `runner`-vs-`plan-runner` suffix false-match here would at worst let an already-vetted FD through, never block one, so exact anchoring is unnecessary for a re-check that errs toward proceeding.)
2. **Both present →** run `pnpm noldor noldor set-autonomous` to set `session.autonomous = true`, then advance **directly to inline implementation** (gate autonomous-mode rules: read the plan MD, execute task-by-task, commit at each boundary, tick `- [x]`). Do **NOT** invoke `superpowers:brainstorming` or `superpowers:writing-plans`, and do **NOT** pause at any Step 2.5 continue-dialog. Zero `AskUserQuestion` — the `--disallowed-tools AskUserQuestion` backstop would otherwise hang the iteration until the per-iteration timeout.
3. **Either missing →** this is specs-source territory (phase 2); the drain should not have spawned it. Print the missing-artifact path to stderr and exit non-zero so the supervisor's retry-then-skip handles it. Do NOT enter a design stage under drain.

Step 4 autonomous end-of-flow then ships the PR on `feat/<slug>` and Step 5 exits clean, exactly as the queue-drain fast-track path does.
```

- [ ] **Step 3: Sanity-check the edit reads coherently**

Run: `grep -n "Drain mode" .claude/skills/gate/SKILL.md` and re-read the section in context.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/gate/SKILL.md
git commit -m "docs(gate): drain-resume autonomous-from-plan branch under NOLDOR_DRAIN" -m "Noldor-FD: plan-runner"
# If the shared-files guard blocks: NOLDOR_ALLOW_SHARED=1 git commit ...
```

---

### Task 7: Verification + FD refresh

**Files:**
- Modify: `docs/features/plan-runner.md` (via `/draft-feature-md --refresh`)

> **Verification stance:** the unit tests (Tasks 1–4) are the AUTHORITATIVE check for source behavior. The live `autonomous run` smokes below are NOT safe from the `feat/plan-runner` worktree: `runDrain` calls `syncMainCleanState()` (`git checkout main` + ff-only merge) BEFORE the loop, even under `--dry-run` — that abandons the feature branch and reads `main`'s FDs (where the in-progress plan-runner FD/spec/plan don't exist until merge). Treat live `--source plans`/`--source roadmap` runs as OPTIONAL post-merge checks from a clean `main`. Only the specs-source guard (Step 2) is safe in-worktree, because `specsSource` throws at build time, before `runDrain`/`syncMainCleanState`.

- [ ] **Step 1: Full typecheck + test + lint (authoritative)**

Run: `pnpm typecheck && pnpm test && pnpm lint`
Expected: all green — `drain-source.test.ts` (roadmap + plans + specs incl. plan-but-no-spec), `decide-next.test.ts` (4), `run-drain.test.ts` (all original cases), `queue-drain-cli.test.ts` (original + 3 new). If lint flags unused imports in `queue-drain.ts` (helpers that moved into `drain-source.ts`), remove them.

- [ ] **Step 2: Specs-source guard (safe in-worktree)**

Run: `pnpm noldor autonomous run --source specs --dry-run; echo "exit=$?"`
Expected: stderr "not yet implemented (phase 2...)", `exit=1` (AC 6). Safe to run from the worktree — `specsSource(cwd)` throws at `buildSource`, before any `git checkout`.

- [ ] **Step 3 (OPTIONAL — post-merge, from clean main only): plans + roadmap dry-run smoke**

> Run ONLY after this branch is merged, on a clean `main` with the autonomous config triple set. From the feature worktree these abort at `assertConfig` (no triple) or, worse, check out `main` mid-implementation — do NOT run them in-flight. The unit tests already cover the behavior; this is a confidence check on the real CLI.

Run (post-merge): `pnpm noldor autonomous run --source plans --dry-run --json`
Expected: exit 0; JSON `shipped: 0`. When ≥1 eligible in-progress FD exists, a `planned: [...]` array lists them in FIFO plan-age order; when none are eligible (e.g. right after this merge, once plan-runner's own FD has flipped to done), `planned` is legitimately **absent** (emitted only with ≥1 eligible). A `skipReasons` map appears for any in-progress FD missing a spec or plan. (Read `planned` for "would ship" — eligible slugs are *also* added to `skipped` internally as the loop's termination mechanism, so a slug may appear in both lists. That dual-listing is why `planned` exists; AC2's "lists eligible in FIFO order" is satisfied by `planned`, not `skipped`.)

Run (post-merge): `pnpm noldor autonomous queue-drain --dry-run --json` and `pnpm noldor autonomous run --source roadmap --dry-run --json`
Expected: identical output between the two (both route through `roadmapSource`). Behavior matches shipped queue-drain; output is additively extended (`planned`/`skipReasons` keys) — behavior-preserved, not byte-identical (AC1 as amended).

- [ ] **Step 4: Refresh the FD body against shipped reality**

Run `/draft-feature-md plan-runner --refresh`. Surfaces any drift between the spec-derived User Story/Usage and what shipped. Apply/keep per the diffs. (Do NOT flip `phase` here — gate Step 4 owns the `in-progress → done` flip in the shipping commit.)

- [ ] **Step 5: Commit the refresh (if changed)**

```bash
git add docs/features/plan-runner.md
git commit -m "docs(features:plan-runner): refresh User Story + Usage against shipped runner" -m "Noldor-FD: plan-runner"
```

---

## Self-Review

**1. Spec coverage** (spec §Acceptance criteria):
- AC1 (roadmap behavior preserved; existing test assertions pass) → Task 2 (roadmapSource) + Task 4 (rewired run-drain.test.ts keeps all assertions). Output is additively extended (`planned`/`skipReasons`), NOT byte-identical — behavior-preserved per the amended AC (see Goal + Deviations).
- AC2 (`--source plans --dry-run` lists eligible in FIFO order + per-FD skip reasons) → Task 3 (plansSource FIFO ordering + reasons incl. plan-but-no-spec) + Task 4 (`planned` + `skipReasons` threading) + Task 3 unit tests (authoritative); Task 7 Step 3 is an optional post-merge smoke. The FIFO eligible list is `planned`, not `skipped`.
- AC3 (`--source plans` live: spawn `/gate --resume`, ship on `feat/<slug>`, absence===shipped) → Task 3 (gatePrompt/branchFor/parseAll) + Task 4 (loop drives them) + Task 6 (gate resume implements).
- AC4 (retry/lock/timeout/kill-switch identical across sources) → Task 4 (loop logic unchanged except source seam; lock/state/io untouched).
- AC5 (NOLDOR_DRAIN resume implements, no brainstorm/writing-plans, zero AskUserQuestion) → Task 6.
- AC6 (`--source specs` exits 1) → Task 1 (specsSource throws) + Task 4 (buildSource in try → exit 1) + Task 7 Step 2 (safe in-worktree).
- AC7 (no source/path literals in decideNext/runDrain) → Task 4 (`'fast-track'`/`'roadmap'`/`'feat/'`/`'fast/'` all live in drain-source.ts).

**2. Placeholder scan:** every code step ships complete code. The one judgement call — the roadmap block shape in Task 2 Step 1 — is stated as verified against `src/utils/parse-blocks.ts:parseRoadmap` (H3 `### Name` + `- key: value` bullets, slug from slugify, priority from source order), not deferred to a runtime grep.

**3. Type consistency:** `DrainCandidate` ({slug, description, eligible, reason?}) is defined once (Task 1) and consumed identically in `decideNext` (Task 4), the mock source (Task 4 run-drain harness), and both real sources (Tasks 2–3). `DrainSource` methods (`nextItem`/`parseAll`/`gatePrompt`/`branchFor`) match between the interface (Task 1), the mock (Task 4), and `queue-drain.ts`'s `buildSource` (Task 4). `spawnGate(env, timeoutMs, prompt)` and `openPrExistsFor(slug, branch)` signatures match between `drain-loop.ts` DrainDeps (Task 4), `drain-io.ts` (Task 4 Step 5), and the `queue-drain.ts` wiring (Task 4 Step 6).

## Deviations from the spec (documented)

- **Spec §Files-touched lists "an integration test for gate drain-resume on a seeded in-progress FD."** A faithful end-to-end test of that branch would spawn `claude --print "/gate --resume <slug>"`, which is non-deterministic and expensive — the same reason `drain-io.ts` carries no unit tests ("exercised by the manual integration run"). This plan covers the deterministic seam exhaustively: `plansSource` eligibility/ordering/oracle (Task 3) and the loop driving it (Task 4). The full claude-spawn resume is a **manual verification** (Task 7 Step 3 post-merge dry-run + a live single-FD `--max-features 1` run the operator can do once `.noldor/config.json` has the triple). Flagged here so the reviewer can veto if a heavier integration harness is wanted.
- **Spec §2 / AC1 said `--source roadmap` "reproduces queue-drain byte-for-byte."** This plan relaxes that to **behavior-preserved with additively-extended output**: a roadmap drain now emits the optional `planned` (dry-run only) and `skipReasons` (when a candidate is skipped with a reason) keys the original lacked. Rationale: those keys are pure additions, they regress no existing test assertion (no test asserts exact JSON/stdout shape), and they give roadmap dry-runs the same diagnostics plans-source needs. The spec's line-67 wording is amended to match (same commit as the FD/plan).
- **Spec AC2's single literal reason `no plan — specs source (phase 2)`** is now one of a small superset: a plan-present/spec-missing FD reports `no spec — not eligible (plan present, spec missing)`, and a both-missing FD reports `no spec or plan — not designed yet`. More precise than the spec's single string; the phase-2 literal is preserved verbatim for the spec-present/plan-missing case the spec described.
