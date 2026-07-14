# crLanes → Role-Ref Aliasing Migration Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Canonicalize the two role-routed CR lanes to their runner-role names (`subagent`→`reviewer`, `verify`→`verifier`), keep the orphan lanes (`manual`, `codex`, `standalone`) as literals, ship the framework's first config-*value* migration (`0.7.0`) with a legacy-tolerant alias preprocess + sink normalization, and rename the blast radius. Part 3 of 3 — **breaking; the deliberately-deferred piece; independently droppable** if runway runs out.
**Architecture:** `laneSchema` becomes a `z.preprocess` that maps legacy names → canonical then validates the canonical enum, so un-migrated configs still parse. Sink reads check both canonical + legacy filenames. Migration `0.7.0` round-trips the top-level `crLanes` key in raw JSON (crLanes is NOT in the `consumer` sub-object). Internal literals + config/doc/CLI values rename to canonical.
**Tech Stack:** Zod, TypeScript/vitest, the `noldor upgrade` migration chain.

---

## File Structure

- `src/core/lanes.ts` — modify; canonical enum + `LANE_ALIASES` + `LEGACY_BY_CANONICAL` + `z.preprocess`.
- `src/core/config.ts` — modify; `DEFAULT_CR_LANES` values `subagent`→`reviewer`.
- `src/cr/orchestrate.ts` — modify; `LANES` record keys, `verify`→`verifier` guard, sink-candidate normalization in `guardLaneOverwrite`.
- `src/cr/findings-schema.ts` — no change (re-exports `laneSchema`; preprocess flows through).
- `src/migrations/0.7.0.ts` — new; first config-value migration (rewrite `crLanes` values).
- `src/migrations/registry.ts` — modify; register `migration_0_7_0`.
- `src/migrations/__tests__/0.7.0.test.ts` — new; migration unit tests.
- `templates/.noldor/config.json` — modify; `crLanes.code` value rename.
- `docs/noldor/{cr-pipeline,pr-flow,complexity-gating,adoption-guide,script-catalog}.md` + `templates/` twins — modify; contextual value/CLI-flag renames only.
- `.claude/skills/noldor-gate/SKILL.md` + `templates/.claude/skills/noldor-gate/SKILL.md` — modify; lane multi-select prose.
- `src/core/__tests__/config.test.ts`, `src/cr/__tests__/orchestrate.test.ts`, `src/core/__tests__/consumer-config.test.ts`, `src/validate/__tests__/noldor-config.test.ts` — modify; lane-value expectations.

---

## Task 1: canonical lane vocabulary + alias preprocess (TDD)

**Files:**
- Modify: `src/core/lanes.ts`
- Test: `src/core/__tests__/lanes.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test.** Create `src/core/__tests__/lanes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { laneSchema, LANE_ALIASES, LEGACY_BY_CANONICAL } from '../lanes.js';

describe('lane vocabulary (canonical + legacy aliases)', () => {
  it('accepts the canonical role-ref names', () => {
    for (const l of ['manual', 'codex', 'reviewer', 'standalone', 'verifier']) {
      expect(laneSchema.parse(l)).toBe(l);
    }
  });
  it('normalizes legacy names to canonical (back-compat)', () => {
    expect(laneSchema.parse('subagent')).toBe('reviewer');
    expect(laneSchema.parse('verify')).toBe('verifier');
  });
  it('rejects unknown lanes', () => {
    expect(() => laneSchema.parse('bogus')).toThrow();
  });
  it('exposes the alias maps both directions', () => {
    expect(LANE_ALIASES).toEqual({ subagent: 'reviewer', verify: 'verifier' });
    expect(LEGACY_BY_CANONICAL).toEqual({ reviewer: 'subagent', verifier: 'verify' });
  });
});
```

- [ ] **Step 2: Run the test, verify FAIL.**

```bash
cd /Users/davidzoufaly/code/noldor/.worktrees/runner-parity-followups
pnpm vitest run src/core/__tests__/lanes.test.ts
```

Expected output: fails — `reviewer`/`verifier` not in the enum; `LANE_ALIASES`/`LEGACY_BY_CANONICAL` not exported.

- [ ] **Step 3: Rewrite `src/core/lanes.ts`:**

```ts
import { z } from 'zod';

/**
 * CR review lanes. Two are role-routed and carry their runner-role name:
 * `reviewer` (→ reviewer role, was `subagent`) and `verifier` (→ verifier role,
 * was `verify`). The other three are non-role literals: `manual` (human stdin),
 * `codex` (hard-pinned to the codex runner — role config can't re-route it), and
 * `standalone` (escalate-only iTerm deep-review, not an orchestrate lane).
 * `reviewer` is the only fully-unattended lane — see DEFAULT_CR_LANES in ./config.ts.
 * Lives in core/ because the repo-wide config loader validates `crLanes` against it.
 */
const CANONICAL_LANES = ['manual', 'codex', 'reviewer', 'standalone', 'verifier'] as const;

/** Legacy lane name → canonical role-ref. Consumed by the preprocess + `0.7.0` migration. */
export const LANE_ALIASES: Record<string, string> = { subagent: 'reviewer', verify: 'verifier' };

/** Canonical → legacy, for back-compat sink-filename lookup (orchestrate.ts). */
export const LEGACY_BY_CANONICAL: Record<string, string> = { reviewer: 'subagent', verifier: 'verify' };

/**
 * Preprocess maps a legacy lane name to its canonical role-ref before enum
 * validation, so a pre-0.7.0 `crLanes` block (`subagent`/`verify`) still parses
 * — the `0.7.0` migration rewrites the on-disk values, but validation never
 * breaks in the interim.
 */
export const laneSchema = z.preprocess(
  (v) => (typeof v === 'string' && v in LANE_ALIASES ? LANE_ALIASES[v] : v),
  z.enum(CANONICAL_LANES),
);
export type Lane = z.infer<typeof laneSchema>;

/** Reviewable artifact kinds — the keys of a `crLanes` block. */
export const artifactKindSchema = z.enum(['spec', 'plan', 'code']);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;
```

- [ ] **Step 4: Run the test, verify PASS.**

```bash
pnpm vitest run src/core/__tests__/lanes.test.ts
```

Expected output: all 4 tests pass.

- [ ] **Step 5: Commit.**

```bash
git add src/core/lanes.ts src/core/__tests__/lanes.test.ts
git commit -m "feat(lanes): canonical role-ref lane names (reviewer/verifier) with legacy alias preprocess" -m "Noldor-FD: make-noldor-agent-agnostic"
```

---

## Task 2: orchestrate — LANES record, guard, sink normalization

**Files:**
- Modify: `src/cr/orchestrate.ts`
- Modify: `src/core/config.ts`
- Test: `src/cr/__tests__/orchestrate.test.ts`

- [ ] **Step 1: Rename `DEFAULT_CR_LANES` values** in `src/core/config.ts` (the `subagent` default → `reviewer`). Change the `DEFAULT_CR_LANES` object (currently `{ spec: ['subagent'], plan: ['subagent'], code: ['subagent'] }`) to:

```ts
export const DEFAULT_CR_LANES: Record<ArtifactKind, Lane[]> = {
  spec: ['reviewer'],
  plan: ['reviewer'],
  code: ['reviewer'],
};
```

- [ ] **Step 2: Update the `LANES` dispatch record** in `src/cr/orchestrate.ts` (keys are lane names; the imported functions keep their names). Replace the `const LANES` block (currently lines 37-42) with:

```ts
const LANES: Record<Exclude<Lane, 'standalone'>, (input: LaneInput) => Promise<LaneResult>> = {
  manual: runManual,
  codex: runCodex,
  reviewer: runSubagent,
  verifier: runVerify,
};
```

- [ ] **Step 3: Update the code-only guard** in `run()` (currently line 177) from `requested.includes('verify')` to `requested.includes('verifier')`, and the receipt-amend condition (currently line 261) from `lanesRun.includes('subagent')` to `lanesRun.includes('reviewer')`. Also update the codex-batch branch (line 238) — unchanged (`'codex'` stays literal) — and line 234's `effective.includes('codex')` — unchanged.

- [ ] **Step 4: Add sink-candidate normalization** so a pre-migration sink (`-subagent.json` / `-verify.json`) is still found. Add this helper above `guardLaneOverwrite` (after `LEGACY_BY_CANONICAL` is imported — add `LEGACY_BY_CANONICAL` to the existing `../core/lanes.js` import if present, else import it):

```ts
/** Canonical sink path + any legacy-named path a pre-0.7.0 run may have written. */
function sinkCandidatePaths(cwd: string, slug: string, kind: ArtifactKind, lane: Lane): string[] {
  const names = [lane, ...(lane in LEGACY_BY_CANONICAL ? [LEGACY_BY_CANONICAL[lane]] : [])];
  return names.map((n) => join(cwd, '.noldor', 'cr', `${slug}-${kind}-${n}.json`));
}
```

Then in `guardLaneOverwrite`, replace the single-path existence check (currently lines 118-123) with a scan over candidates (first existing wins as the archive/overwrite target):

```ts
    const candidates = sinkCandidatePaths(ctx.cwd, ctx.slug, ctx.kind, lane);
    let path = candidates[0];
    let exists = false;
    for (const c of candidates) {
      try {
        await readFile(c, 'utf8');
        path = c;
        exists = true;
        break;
      } catch {}
    }
```

(The rest of `guardLaneOverwrite` — archive/overwrite using `path` — is unchanged; new sinks always write the canonical name via the `lane` var in the lane modules + `writeSyntheticOk`.)

- [ ] **Step 5: Update the orchestrate test expectations.** In `src/cr/__tests__/orchestrate.test.ts`, change lane literals used as inputs/expectations from `subagent`→`reviewer` and `verify`→`verifier` (the resolveLanes default test, the LANES dispatch test, the guard test). Add one test that a legacy-named sink is detected:

```ts
  it('guardLaneOverwrite finds a pre-0.7.0 legacy-named sink for a canonical lane', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cr-'));
    mkdirSync(join(dir, '.noldor', 'cr'), { recursive: true });
    writeFileSync(join(dir, '.noldor', 'cr', 'x-code-subagent.json'), '{}'); // legacy name
    const keep = await guardLaneOverwrite(['reviewer'], { slug: 'x', kind: 'code', cwd: dir }, { autonomous: true });
    expect(keep).toEqual(['reviewer']); // detected + archived, not treated as fresh
  });
```

(Add the `node:fs` / `node:os` imports the test needs if absent.)

- [ ] **Step 6: Run the CR + config suites, verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/orchestrate.test.ts src/core/__tests__/config.test.ts
```

Expected output: all pass (after the value renames in Task 4's test files too — if config.test.ts still asserts `subagent`, update those literals to `reviewer`).

- [ ] **Step 7: Commit.**

```bash
git add src/cr/orchestrate.ts src/core/config.ts src/cr/__tests__/orchestrate.test.ts src/core/__tests__/config.test.ts
git commit -m "feat(cr): route reviewer/verifier lanes + normalize legacy sink names" -m "Noldor-FD: make-noldor-agent-agnostic"
```

---

## Task 3: the `0.7.0` config-value migration (TDD)

**Files:**
- Create: `src/migrations/0.7.0.ts`
- Modify: `src/migrations/registry.ts`
- Test: `src/migrations/__tests__/0.7.0.test.ts`

- [ ] **Step 1: Write the failing migration test.** Create `src/migrations/__tests__/0.7.0.test.ts` (mirrors `0.6.0.test.ts` structure — fake consumer tree, apply, dryRun-no-write, idempotency). Tag it with the FD slug:

```ts
// @tests: make-noldor-agent-agnostic
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migration_0_7_0 } from '../0.7.0.js';

function fakeConsumer(crLanes: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'mig070-'));
  mkdirSync(join(dir, '.noldor'), { recursive: true });
  writeFileSync(join(dir, '.noldor', 'config.json'), JSON.stringify({ crLanes, other: 1 }, null, 2));
  return dir;
}
const readCfg = (dir: string) => JSON.parse(readFileSync(join(dir, '.noldor', 'config.json'), 'utf8'));

describe('migration 0.7.0 — crLanes values → role-refs', () => {
  it('rewrites subagent->reviewer and verify->verifier, preserving other keys', () => {
    const dir = fakeConsumer({ code: ['subagent', 'verify'], spec: ['subagent'] });
    migration_0_7_0.migrate(dir, {} as never);
    const c = readCfg(dir);
    expect(c.crLanes).toEqual({ code: ['reviewer', 'verifier'], spec: ['reviewer'] });
    expect(c.other).toBe(1);
  });
  it('dryRun reports the step without writing', () => {
    const dir = fakeConsumer({ code: ['subagent'] });
    const steps = migration_0_7_0.dryRun(dir, {} as never);
    expect(steps.length).toBe(1);
    expect(readCfg(dir).crLanes).toEqual({ code: ['subagent'] }); // untouched
  });
  it('is idempotent — a second migrate is a no-op (already canonical)', () => {
    const dir = fakeConsumer({ code: ['subagent'] });
    migration_0_7_0.migrate(dir, {} as never);
    const steps = migration_0_7_0.migrate(dir, {} as never);
    expect(steps.length).toBe(0);
    expect(readCfg(dir).crLanes).toEqual({ code: ['reviewer'] });
  });
  it('no-op when there is no crLanes block', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig070-'));
    mkdirSync(join(dir, '.noldor'), { recursive: true });
    writeFileSync(join(dir, '.noldor', 'config.json'), JSON.stringify({ other: 1 }));
    expect(migration_0_7_0.migrate(dir, {} as never)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test, verify FAIL.**

```bash
pnpm vitest run src/migrations/__tests__/0.7.0.test.ts
```

Expected output: fails — `../0.7.0.js` does not exist.

- [ ] **Step 3: Implement the migration.** Create `src/migrations/0.7.0.ts` (first config-value migration — round-trips the top-level `crLanes` key in raw JSON; `crLanes` is NOT in the `consumer` sub-object, so it does not use the typed `config` arg):

```ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LANE_ALIASES } from '../core/lanes.js';
import type { Migration, MigrationStep } from './types.js';

/** Rewrite legacy lane values in a crLanes array; returns null if unchanged. */
function rewriteLanes(arr: unknown): string[] | null {
  if (!Array.isArray(arr)) return null;
  let changed = false;
  const out = arr.map((v) => {
    if (typeof v === 'string' && v in LANE_ALIASES) {
      changed = true;
      return LANE_ALIASES[v];
    }
    return v as string;
  });
  return changed ? out : null;
}

function computeSteps(cwd: string, apply: boolean): MigrationStep[] {
  const path = join(cwd, '.noldor', 'config.json');
  if (!existsSync(path)) return [];
  const before = readFileSync(path, 'utf8');
  let cfg: { crLanes?: Record<string, unknown> };
  try {
    cfg = JSON.parse(before);
  } catch {
    return []; // unparseable config — leave it; loud failure surfaces elsewhere
  }
  const crLanes = cfg.crLanes;
  if (!crLanes || typeof crLanes !== 'object') return [];
  let changed = false;
  for (const kind of Object.keys(crLanes)) {
    const rewritten = rewriteLanes(crLanes[kind]);
    if (rewritten) {
      crLanes[kind] = rewritten;
      changed = true;
    }
  }
  if (!changed) return [];
  const after = `${JSON.stringify(cfg, null, 2)}\n`;
  if (apply) writeFileSync(path, after);
  return [{ path: '.noldor/config.json', before, after }];
}

/** First config-*value* migration: crLanes lane values → canonical role-refs. */
export const migration_0_7_0: Migration = {
  from: '0.6.0',
  to: '0.7.0',
  description: 'rewrite crLanes lane values subagent->reviewer, verify->verifier',
  dryRun: (cwd) => computeSteps(cwd, false),
  migrate: (cwd) => computeSteps(cwd, true),
};
```

- [ ] **Step 4: Register it** in `src/migrations/registry.ts` — add the import and append to `MIGRATIONS`:

```ts
import { migration_0_7_0 } from './0.7.0.js';
```

and change the array to:

```ts
export const MIGRATIONS: readonly Migration[] = [
  migration_0_4_0,
  migration_0_5_0,
  migration_0_6_0,
  migration_0_7_0,
];
```

- [ ] **Step 5: Run the migration suite, verify PASS.**

```bash
pnpm vitest run src/migrations
```

Expected output: all migration tests pass, including the new `0.7.0` cases and the chain-contiguity test (0.4→0.5→0.6→0.7 has no gap).

- [ ] **Step 6: Commit.**

```bash
git add src/migrations/0.7.0.ts src/migrations/registry.ts src/migrations/__tests__/0.7.0.test.ts
git commit -m "feat(migrations): 0.7.0 rewrites crLanes values to role-refs (first config-value migration)" -m "Noldor-FD: make-noldor-agent-agnostic"
```

---

## Task 4: blast-radius rename (config + docs + SKILL + remaining tests)

**Files:** template config, 5 live docs + 5 template twins, `noldor-gate` SKILL + twin, remaining test files.

- [ ] **Step 1: Template config value.** In `templates/.noldor/config.json`, change `"crLanes": { "code": ["subagent"] }` to `"crLanes": { "code": ["reviewer"] }`.

- [ ] **Step 2: List every remaining occurrence** to rename — only *config-value* and `--lanes <name>` / crLanes-key contexts, NOT conceptual prose about "the reviewer subagent":

```bash
grep -rn -e '\bsubagent\b' -e '\bverify\b' docs/noldor templates/docs/noldor .claude/skills/noldor-gate templates/.claude/skills/noldor-gate src/core/__tests__/consumer-config.test.ts src/validate/__tests__/noldor-config.test.ts | grep -iE 'crLanes|--lanes|lanes:|\["|code-|spec-|plan-' 
```

Expected output: a reviewable list of crLanes/`--lanes` occurrences (roughly the hits the crLanes research enumerated). Work the list by hand.

- [ ] **Step 3: Rename each listed occurrence** where the token is a *lane value*: `subagent`→`reviewer`, `verify`→`verifier`. Leave prose that describes the mechanism conceptually (e.g. "the subagent lane runs a reviewer") — reword to the new name only when it names the config value / CLI arg. In the `noldor-gate` SKILL Step 2.5 lane multi-select, rename the `subagent` / `verify` option values to `reviewer` / `verifier` (keep the human descriptions). Keep the live doc + its `templates/` twin byte-identical (edit both, or edit live then `cp`).

- [ ] **Step 4: Update remaining test literals.** In `src/core/__tests__/consumer-config.test.ts` and `src/validate/__tests__/noldor-config.test.ts`, change any `crLanes` value literals `subagent`/`verify` → `reviewer`/`verifier`. (A legacy literal will still *parse* via the alias preprocess, but tests should assert the canonical post-parse value.)

- [ ] **Step 5: Verify no stray legacy lane *values* remain** (allow prose mentions; forbid config/CLI values):

```bash
grep -rn -e 'crLanes' -e '--lanes' docs/noldor templates .claude/skills/noldor-gate | grep -iE '\bsubagent\b|\bverify\b' || echo "no legacy lane values remain"
```

Expected output: `no legacy lane values remain`.

- [ ] **Step 6: Verify doc twins are identical.**

```bash
for p in cr-pipeline pr-flow complexity-gating adoption-guide script-catalog; do diff docs/noldor/$p.md templates/docs/noldor/$p.md >/dev/null && echo "$p OK" || echo "$p DRIFT"; done
diff .claude/skills/noldor-gate/SKILL.md templates/.claude/skills/noldor-gate/SKILL.md >/dev/null && echo "SKILL OK" || echo "SKILL DRIFT"
```

Expected output: all `OK`, no `DRIFT`.

- [ ] **Step 7: Full verify.**

```bash
pnpm verify
```

Expected output: typecheck + tests + lint all pass. (If `check-template-sync` flags a `docs/noldor` twin or the SKILL twin, re-sync it. A `docs/noldor` doc commit needs the `Noldor-Sibling-Scope: noldor` trailer if it rides a code commit — here it is its own commit, so the subject scope suffices.)

- [ ] **Step 8: Commit.** (Editing the root `.claude/skills/noldor-gate/SKILL.md` twin from a `.worktrees/` tree trips the shared-files guard; pass the override.)

```bash
git add templates/.noldor/config.json docs/noldor templates/docs/noldor .claude/skills/noldor-gate templates/.claude/skills/noldor-gate src/core/__tests__/consumer-config.test.ts src/validate/__tests__/noldor-config.test.ts
NOLDOR_ALLOW_SHARED=1 git commit -m "refactor(cr): rename crLanes values subagent->reviewer, verify->verifier across docs/config/tests" -m "Noldor-FD: make-noldor-agent-agnostic" -m "Noldor-Sibling-Scope: noldor"
```

---

## Task 5: upgrade smoke + consumer verification

**Files:** none (verification only)

- [ ] **Step 1: Dry-run the migration against a real consumer config** to confirm the chain resolves and the rewrite is correct. Charuy consumer is at `/Users/davidzoufaly/code/charuy/.noldor`:

```bash
grep -n 'crLanes' /Users/davidzoufaly/code/charuy/.noldor/config.json || echo "no crLanes in charuy config"
```

Expected output: either the charuy `crLanes` block (which the migration would rewrite) or `no crLanes in charuy config`. (Informational — do not modify the external consumer here; the migration runs on their `noldor upgrade`.)

- [ ] **Step 2: Confirm this repo's own config validates + orchestrate still resolves lanes.**

```bash
node bin/noldor.mjs cr orchestrate --slug make-noldor-agent-agnostic --artifact docs/superpowers/specs/2026-07-14-make-noldor-agent-agnostic-runner-parity-followups-design.md --kind spec --autonomous --full-review 2>&1 | tail -5
```

Expected output: `lanes run: reviewer` (the default spec lane is now `reviewer`), exit reflects the review. (This overwrites the spec sink — expected; it re-confirms the renamed lane routes.)

- [ ] **Step 3: Final full verify.**

```bash
pnpm verify
```

Expected output: all green. Part 3 complete — `crLanes` vocabulary is canonicalized, legacy configs still validate, the migration ships, and the blast radius is renamed.
