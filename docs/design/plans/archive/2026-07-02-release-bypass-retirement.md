# Release Bypass Retirement Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** A clean `pnpm release` (and `NOLDOR_RELEASE_DRY_RUN=1 pnpm release`) passes on this repo with **zero** `RELEASE_SKIP_*` env vars: known-bad historical commits are acknowledged per-SHA in committed config (`release.crGateExemptCommits`), expected self-host override noise is declared per-entry (`garden.overrideAudit.expected`), the last unlogged bypass (`RELEASE_SKIP_GARDEN_GATE`) writes an overrides.log breadcrumb, and the docs stop prescribing the skip-vars.

**Architecture:** Two new optional top-level blocks (`release:`, `garden:`) on `noldorConfigSchema` in `src/cr/config.ts` (zod non-strict, forward/backward compatible). `checkCrGate` gains an injected `exemptions` list and an `exempted` report field (stays pure — `runGit`-injectable). `auditOverrides` computes severity from **unexpected** entries only, via a structural `ExpectedOverrideRule` matcher exported from the detector (no `garden/detectors → cr` import edge). Config is threaded at three call sites: the release flow (`src/release/index.ts`, sync via `loadConfigSync`), garden-detect (`detectGateCompliance` + `detectAll`, async via a fail-open `loadOverrideAuditOptions` helper), and `buildGateComplianceSection` in sdd-report (render-side `(expected)` marker). `ensureGardenFresh`'s skip branch mirrors `src/release/index.ts:179` with `appendOverrideLog`.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), zod v3, vitest (injected `runGit` fake for the CR gate, temp-dir git repos for detectors — existing suites' patterns), node:child_process.

Spec: `docs/design/specs/2026-07-02-release-bypass-retirement-design.md`

Executor notes (read once, apply throughout):

- **Worktree paths:** if executing inside a drain worktree, all Edit/Write paths must be worktree-absolute — never the main-checkout paths — or edits split-brain onto main.
- **Task 8 needs `NOLDOR_ALLOW_SHARED=1`** on its commit: `.claude/skills/**` edits from a worktree trip the shared-files guard (`src/checks/check-shared-files.ts`). Template twins must land byte-identical in the same commit (pre-commit `template-sync`).
- **Run `pnpm fmt` before every commit that stages `.ts`/`.json` files** — pre-commit runs `fmt:check` on staged files and oxfmt's 100-char print width aborts the commit otherwise (markdown is oxfmt-ignored).
- The FD phase flip for `docs/features/release-bypass-retirement.md` is **not** part of this plan — the drain handles it.
- Spec premise re-verification (2026-07-02, plan-writing time): `checkCrGate({from: 'v0.4.0', to: 'HEAD'})` returns exactly one offender `19a74a10e8` and `auditOverrides` is INFO with count 1. If new offenders exist at your build time, add one exemption entry per offender in Task 3 with a real reason.

---

## File Structure

- `src/cr/config.ts` — modify; add `crGateExemptionSchema` + `releaseConfigSchema` (U1) and `expectedOverrideSchema` + `gardenConfigSchema` (U2); `noldorConfigSchema` gains optional `release:` / `garden:` keys
- `src/cr/__tests__/config.test.ts` — modify; parse/reject/default tests for both new blocks
- `src/release/release-cr-gate.ts` — modify; `CrGateInput.exemptions`, `CrGateResult.exempted`, per-SHA-prefix skip inside the commit loop (U1)
- `src/release/__tests__/release-cr-gate.test.ts` — modify; exemption skip/report/no-launder tests against the injected `runGit` fake
- `src/release/index.ts` — modify; load config via `loadConfigSync`, pass `release.crGateExemptCommits` to `checkCrGate`, echo each applied exemption (U1)
- `.noldor/config.json` — modify; seed `release.crGateExemptCommits` with the one live offender `19a74a10…` (U1)
- `src/garden/detectors/override-audit.ts` — modify; `ExpectedOverrideRule` + `matchesExpectedOverride`, `OverrideEntry.expected`, `count` (unexpected) / `expectedCount` split, severity from unexpected only (U2)
- `src/garden/detectors/__tests__/override-audit.test.ts` — modify; expected-by-reason / expected-by-SHA exclusion tests
- `src/garden/garden-detect.ts` — modify; fail-open `loadOverrideAuditOptions` helper, threaded into `detectGateCompliance` (line ~622) and `detectAll` (line ~727) (U2)
- `src/garden/__tests__/garden-detect.test.ts` — modify; helper extraction + fail-open tests
- `src/garden/sdd-report.ts` — modify; `GateOverrideEntry.expected`, config read in `buildGateComplianceSection` (line ~891), `(expected)` suffix in `renderReportMd` (line ~1050) (U2)
- `src/garden/__tests__/sdd-report.test.ts` — modify; expected-marking tests for `buildGateComplianceSection`
- `src/garden/garden-receipt.ts` — modify; `appendOverrideLog` in the `RELEASE_SKIP_GARDEN_GATE=1` skip branch (line ~125) + JSDoc "no persistent audit ledger" paragraph replaced (U3)
- `src/garden/__tests__/garden-receipt.test.ts` — modify; bypass-appends-log-line test; stale comment on the existing bypass test updated
- `.claude/skills/release-sweep/SKILL.md` — modify; step 9 documents "release runs clean; per-item exemption workflow on a new offender" (U4)
- `templates/.claude/skills/release-sweep/SKILL.md` — modify; byte-identical twin of the above
- `docs/noldor/cr-pipeline.md` — modify; exemption-config paragraph beside the existing skip-var audit-trail paragraph (line ~202) (U4)
- `templates/docs/noldor/cr-pipeline.md` — modify; byte-identical twin
- `docs/noldor/versioning.md` — modify; the two bypass bullets point at the exemption config first, skip-vars demoted to logged break-glass (Goal 5) (U4)
- `templates/docs/noldor/versioning.md` — modify; byte-identical twin

---

## Task 1: `release.crGateExemptCommits` config schema

Extends `noldorConfigSchema` (`src/cr/config.ts:64`) with the optional `release:` block. Pure schema work — no consumers yet.

**Files:**

- Modify: `src/cr/config.ts`
- Test: `src/cr/__tests__/config.test.ts`

- [ ] **Step 1: Write the failing schema tests**

Append to `src/cr/__tests__/config.test.ts` (bottom of file):

```ts
describe('release.crGateExemptCommits block', () => {
  it('parses a valid exemption list', () => {
    const parsed = noldorConfigSchema.parse({
      release: {
        crGateExemptCommits: [
          {
            sha: '19a74a10e8e844e021b08fe616992eae1b56f977',
            reason: 'pre-rollout-marker CI chore (#117)',
          },
        ],
      },
    });
    expect(parsed.release?.crGateExemptCommits).toHaveLength(1);
    expect(parsed.release?.crGateExemptCommits[0]?.sha).toBe(
      '19a74a10e8e844e021b08fe616992eae1b56f977',
    );
  });

  it('keeps release optional and defaults crGateExemptCommits to []', () => {
    expect(noldorConfigSchema.parse({}).release).toBeUndefined();
    expect(noldorConfigSchema.parse({ release: {} }).release?.crGateExemptCommits).toEqual([]);
  });

  it('rejects a SHA prefix shorter than 7 hex chars', () => {
    expect(() =>
      noldorConfigSchema.parse({
        release: { crGateExemptCommits: [{ sha: '19a74a', reason: 'too short' }] },
      }),
    ).toThrow();
  });

  it('rejects a non-hex SHA and an empty reason', () => {
    expect(() =>
      noldorConfigSchema.parse({
        release: { crGateExemptCommits: [{ sha: 'ZZZZZZZZ', reason: 'x' }] },
      }),
    ).toThrow();
    expect(() =>
      noldorConfigSchema.parse({
        release: { crGateExemptCommits: [{ sha: '19a74a10e8', reason: '' }] },
      }),
    ).toThrow();
  });

  it('strips unknown keys (zod non-strict) so config-schema growth stays compatible', () => {
    const parsed = noldorConfigSchema.parse({
      release: { crGateExemptCommits: [], futureKnob: true },
      unknownTopLevel: 1,
    } as Record<string, unknown>);
    expect(parsed.release?.crGateExemptCommits).toEqual([]);
    expect('futureKnob' in (parsed.release ?? {})).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/cr/__tests__/config.test.ts
```

Expected output: the 5 new `release.crGateExemptCommits` tests fail (`noldorConfigSchema` has no `release` key yet, so zod strips it: `parsed.release` is `undefined`, the reject-cases do not throw). All pre-existing tests stay green.

- [ ] **Step 3: Add the schema to `src/cr/config.ts`**

Insert immediately above `export const noldorConfigSchema` (after `crReviewConfigSchema`):

```ts
/**
 * One acknowledged release-CR-gate offender: a commit that shipped without a
 * review receipt (e.g. pre-rollout-marker history) which `checkCrGate` should
 * wave through per-SHA instead of the whole-check `RELEASE_SKIP_CR_GATE=1`
 * skip. `sha` is a hex prefix of the full commit SHA — min 7 chars so a typo
 * cannot blanket-match — and `reason` is required: the committed config diff
 * is the audit trail.
 */
export const crGateExemptionSchema = z.object({
  sha: z.string().regex(/^[0-9a-f]{7,40}$/),
  reason: z.string().min(1),
});

/** Release-enforcement tuning — the `release:` block of `.noldor/config.json`. */
export const releaseConfigSchema = z.object({
  crGateExemptCommits: z.array(crGateExemptionSchema).default([]),
});

/** One parsed {@link crGateExemptionSchema} entry. */
export type CrGateExemption = z.infer<typeof crGateExemptionSchema>;
/** Parsed `release:` block. */
export type ReleaseConfig = z.infer<typeof releaseConfigSchema>;
```

Then add the key to `noldorConfigSchema`:

```ts
export const noldorConfigSchema = z.object({
  crLanes: crLanesConfigSchema.optional(),
  crReview: crReviewConfigSchema.optional(),
  autonomous: autonomousConfigSchema.optional(),
  gate: gateConfigSchema.optional(),
  agents: agentsConfigSchema.optional(),
  release: releaseConfigSchema.optional(),
});
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/cr/__tests__/config.test.ts
```

Expected output: all tests pass (0 failed).

- [ ] **Step 5: Commit**

```bash
pnpm fmt
git add src/cr/config.ts src/cr/__tests__/config.test.ts
git commit -m "feat(release): add release.crGateExemptCommits config schema" -m "Noldor-FD: release-bypass-retirement
Noldor-Path: specs-only-new"
```

## Task 2: `checkCrGate` per-SHA exemptions

Inside the per-SHA loop (`src/release/release-cr-gate.ts:56`), after the exempt-path check: a commit whose full SHA starts with an exemption's prefix is skipped and collected into `exempted` so the release log can print what was waved through and why.

**Files:**

- Modify: `src/release/release-cr-gate.ts`
- Test: `src/release/__tests__/release-cr-gate.test.ts`

- [ ] **Step 1: Write the failing gate tests**

Append to `src/release/__tests__/release-cr-gate.test.ts` (reuses the module-scope `Commit`, `makeGitFake`, and `trailers` helpers):

```ts
describe('checkCrGate exemptions (release.crGateExemptCommits)', () => {
  const bareCommit: Commit = {
    sha: '19a74a10e8e844e021b08fe616992eae1b56f977',
    tree: 't1',
    message:
      'chore(ci): run pnpm verify on pull requests (#117)' + trailers('Noldor-Path: fast-track'),
    paths: ['.github/workflows/verify.yml'],
  };

  it('skips a commit whose full SHA starts with an exemption prefix and reports it', () => {
    const r = checkCrGate({
      from: 'v0',
      to: 'HEAD',
      cwd: '/tmp',
      runGit: makeGitFake([bareCommit]),
      exemptions: [{ sha: '19a74a10e8', reason: 'pre-rollout-marker CI chore (#117)' }],
    });
    expect(r.ok).toBe(true);
    expect(r.offenders).toEqual([]);
    expect(r.exempted).toEqual([
      {
        sha: '19a74a10e8e844e021b08fe616992eae1b56f977',
        subject: 'chore(ci): run pnpm verify on pull requests (#117)',
        reason: 'pre-rollout-marker CI chore (#117)',
      },
    ]);
  });

  it('still fails when no exemption matches (gate not weakened)', () => {
    const r = checkCrGate({
      from: 'v0',
      to: 'HEAD',
      cwd: '/tmp',
      runGit: makeGitFake([bareCommit]),
      exemptions: [{ sha: 'aaaaaaaa', reason: 'unrelated entry' }],
    });
    expect(r.ok).toBe(false);
    expect(r.offenders[0].sha).toBe('19a74a10e8e844e021b08fe616992eae1b56f977');
    expect(r.exempted).toEqual([]);
  });

  it('does not launder other offenders in the same range', () => {
    const other: Commit = {
      sha: 'faceb00cfaceb00cfaceb00cfaceb00cfaceb00c',
      tree: 't2',
      message: 'feat: bare' + trailers('Noldor-Path: fast-track'),
      paths: ['src/a.ts'],
    };
    const r = checkCrGate({
      from: 'v0',
      to: 'HEAD',
      cwd: '/tmp',
      runGit: makeGitFake([bareCommit, other]),
      exemptions: [{ sha: '19a74a10e8', reason: 'pre-rollout-marker CI chore (#117)' }],
    });
    expect(r.ok).toBe(false);
    expect(r.offenders).toEqual([
      { sha: 'faceb00cfaceb00cfaceb00cfaceb00cfaceb00c', subject: 'feat: bare' },
    ]);
    expect(r.exempted).toHaveLength(1);
  });

  it('returns exempted: [] when no exemptions are configured', () => {
    const r = checkCrGate({
      from: 'v0',
      to: 'HEAD',
      cwd: '/tmp',
      runGit: makeGitFake([bareCommit]),
    });
    expect(r.ok).toBe(false);
    expect(r.exempted).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/release/__tests__/release-cr-gate.test.ts
```

Expected output: the 4 new exemption tests fail (`r.exempted` is `undefined`; the exempted commit is still reported as an offender). The 10 pre-existing `checkCrGate` tests stay green.

- [ ] **Step 3: Implement exemptions in `src/release/release-cr-gate.ts`**

Replace the three interfaces at the top of the file with:

```ts
export interface CrGateOffender {
  sha: string;
  subject: string;
}

/**
 * One configured per-SHA acknowledgment (`release.crGateExemptCommits` in
 * `.noldor/config.json`, schema-validated there — kept structural here so this
 * module needs no `cr/config` import). `sha` is a full-SHA prefix, min 7 hex
 * chars enforced at the schema layer.
 */
export interface CrGateExemption {
  sha: string;
  reason: string;
}

/**
 * A commit waved through by a configured exemption — reported (not silently
 * dropped) so the release log prints what was skipped and why.
 */
export interface CrGateExemptedCommit {
  sha: string;
  subject: string;
  reason: string;
}

export interface CrGateResult {
  ok: boolean;
  offenders: CrGateOffender[];
  /** Commits skipped via {@link CrGateInput.exemptions}; empty when none applied. */
  exempted: CrGateExemptedCommit[];
  reason?: string;
}

export interface CrGateInput {
  from: string;
  to: string;
  cwd: string;
  runGit?: (args: string[]) => string;
  /** Committed per-SHA acknowledgments (`release.crGateExemptCommits`). */
  exemptions?: ReadonlyArray<CrGateExemption>;
}
```

In `checkCrGate`, add the accumulators and the exemption check. After `const offenders: CrGateOffender[] = [];` add:

```ts
  const exemptions = input.exemptions ?? [];
  const exempted: CrGateExemptedCommit[] = [];
```

Inside the loop, immediately after the exempt-path block (`if (paths.length > 0 && paths.every((p) => EXEMPT_PATHS.has(p))) continue;`), insert:

```ts
    // Per-SHA acknowledgment from committed config: a commit whose full SHA
    // starts with an exemption's prefix is waved through — and collected, so
    // the release log prints what was skipped and why. This replaces the
    // whole-check RELEASE_SKIP_CR_GATE=1 skip for known historical offenders.
    const exemption = exemptions.find((e) => sha.startsWith(e.sha));
    if (exemption) {
      const subject = message.split(/\r?\n/, 1)[0]?.trim() ?? '';
      exempted.push({ sha, subject, reason: exemption.reason });
      continue;
    }
```

Replace the two return statements at the end of `checkCrGate` with:

```ts
  if (offenders.length === 0) return { ok: true, offenders: [], exempted };
  return { ok: false, offenders, exempted, reason: formatReason(offenders) };
```

Finally, extend the function's JSDoc "or when the commit is exempt by construction" bullet list with one more line:

```ts
 *   - a configured per-SHA exemption (`input.exemptions`, sourced from
 *     `release.crGateExemptCommits`) — skipped AND reported in `exempted`
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/release/__tests__/release-cr-gate.test.ts src/release/__tests__/release-cr-gate-e2e.test.ts
```

Expected output: all tests pass, including the untouched e2e suite (0 failed).

- [ ] **Step 5: Commit**

```bash
pnpm fmt
git add src/release/release-cr-gate.ts src/release/__tests__/release-cr-gate.test.ts
git commit -m "feat(release): per-SHA CR-gate exemptions with required reason" -m "Noldor-FD: release-bypass-retirement
Noldor-Path: specs-only-new"
```

## Task 3: Wire exemptions into the release flow + seed the live offender

`src/release/index.ts:197` loads the config the same way the pre-commit hook does (`loadConfigSync` from `src/cr/config.ts`) and passes `release.crGateExemptCommits`; each applied exemption is echoed to stdout. Seed `.noldor/config.json` with the one live offender.

**Files:**

- Modify: `src/release/index.ts`
- Modify: `.noldor/config.json`

- [ ] **Step 1: Demonstrate the red state (live gate fails without exemptions)**

```bash
pnpm exec tsx -e "
import { checkCrGate } from './src/release/release-cr-gate.ts';
const r = checkCrGate({ from: 'v0.4.0', to: 'HEAD', cwd: process.cwd() });
console.log(JSON.stringify({ ok: r.ok, offenders: r.offenders.map((o) => o.sha.slice(0, 10)) }));
"
```

Expected output: `{"ok":false,"offenders":["19a74a10e8"]}` — the pre-rollout-marker #117 squash is the sole offender. (If more SHAs print, new offenders landed since the spec was written: seed one exemption entry per offender in Step 3, each with a real reason — or fix the offender properly if it is recent.)

- [ ] **Step 2: Wire the config into `src/release/index.ts`**

Add the import (alphabetically with the other framework imports near the top):

```ts
import { loadConfigSync } from '../cr/config.js';
```

Replace the CR-gate `else` branch (currently lines 196-203):

```ts
      } else {
        const crGate = checkCrGate({ from: previousTag, to: 'HEAD', cwd: process.cwd() });
        if (!crGate.ok) {
          console.error('Release CR gate failed:');
          console.error(crGate.reason ?? '');
          process.exit(1);
        }
      }
```

with:

```ts
      } else {
        const noldorConfig = loadConfigSync();
        const crGate = checkCrGate({
          from: previousTag,
          to: 'HEAD',
          cwd: process.cwd(),
          exemptions: noldorConfig?.release?.crGateExemptCommits ?? [],
        });
        // Committed config is the audit trail for exemptions (reviewable in
        // the PR diff) — echo applications loudly, but no overrides.log spam.
        for (const e of crGate.exempted) {
          console.log(`→ CR gate: exempted ${e.sha.slice(0, 10)} — ${e.reason}`);
        }
        if (!crGate.ok) {
          console.error('Release CR gate failed:');
          console.error(crGate.reason ?? '');
          process.exit(1);
        }
      }
```

- [ ] **Step 3: Seed `.noldor/config.json` with the live offender**

Replace the full file content with (existing blocks unchanged, new `release` block appended):

```json
{
  "consumer": {
    "name": "noldor",
    "repoUrl": "https://github.com/davidzoufaly/noldor",
    "lockstepPackages": ["package.json"],
    "scanPaths": ["src"],
    "boundaries": [],
    "deprecatedPackages": [],
    "e2ePrefix": "e2e/",
    "samplesPath": "samples",
    "packagePrefix": "@noldor/",
    "appPathPrefix": "src",
    "categories": ["Core", "Tooling", "Agents", "Other"],
    "areaCategories": {
      "core": "Core",
      "tooling": "Tooling",
      "docs": "Tooling",
      "testing": "Tooling",
      "cross-cutting": "Tooling",
      "release": "Tooling"
    },
    "scopeAliases": {},
    "verifyCommands": {
      "dashboard": {
        "command": "pnpm noldor dashboard server --port {port}",
        "kind": "server",
        "healthPath": "/"
      },
      "cli": { "command": "pnpm noldor --help", "kind": "cli" }
    }
  },
  "crLanes": {
    "code": ["subagent", "verify"]
  },
  "autonomous": {
    "skipLanePicker": true,
    "onFailure": "abort",
    "requireHumanPrApproval": false
  },
  "release": {
    "crGateExemptCommits": [
      {
        "sha": "19a74a10e8e844e021b08fe616992eae1b56f977",
        "reason": "pre-rollout-marker CI-workflow fast-track (#117); shipped before receipt enforcement armed"
      }
    ]
  }
}
```

- [ ] **Step 4: Run to verify GREEN (seeded exemption satisfies the live gate)**

```bash
pnpm exec tsx -e "
import { loadConfigSync } from './src/cr/config.ts';
import { checkCrGate } from './src/release/release-cr-gate.ts';
const cfg = loadConfigSync();
const r = checkCrGate({ from: 'v0.4.0', to: 'HEAD', cwd: process.cwd(), exemptions: cfg?.release?.crGateExemptCommits ?? [] });
console.log(JSON.stringify({ ok: r.ok, exempted: r.exempted.map((e) => e.sha.slice(0, 10)) }));
"
```

Expected output: `{"ok":true,"exempted":["19a74a10e8"]}`.

- [ ] **Step 5: Verify the gate is not weakened (empty exemptions still fail)**

```bash
pnpm exec tsx -e "
import { checkCrGate } from './src/release/release-cr-gate.ts';
const r = checkCrGate({ from: 'v0.4.0', to: 'HEAD', cwd: process.cwd(), exemptions: [] });
console.log(JSON.stringify({ ok: r.ok }));
"
```

Expected output: `{"ok":false}` — removing the seeded exemption makes the same range fail again (acceptance criterion 3).

- [ ] **Step 6: Commit**

```bash
pnpm fmt
git add src/release/index.ts .noldor/config.json
git commit -m "feat(release): wire CR-gate exemptions into pnpm release; seed #117 acknowledgment" -m "Noldor-FD: release-bypass-retirement
Noldor-Path: specs-only-new"
```

## Task 4: `garden.overrideAudit` config schema

The second config block (U2): optional `threshold` plus `expected` rules, each requiring `shaPrefix` and/or `reasonIncludes` and a documentation `note`.

**Files:**

- Modify: `src/cr/config.ts`
- Test: `src/cr/__tests__/config.test.ts`

- [ ] **Step 1: Write the failing schema tests**

Append to `src/cr/__tests__/config.test.ts`:

```ts
describe('garden.overrideAudit block', () => {
  it('parses expected rules and an optional threshold', () => {
    const parsed = noldorConfigSchema.parse({
      garden: {
        overrideAudit: {
          threshold: 5,
          expected: [
            {
              reasonIncludes: 'cr-red override acceptance-verify-lane',
              note: 'operator-accepted residual risk, 2026-06',
            },
            { shaPrefix: 'ec7bf0b7c52', note: 'same acknowledgment, keyed by SHA' },
          ],
        },
      },
    });
    expect(parsed.garden?.overrideAudit?.threshold).toBe(5);
    expect(parsed.garden?.overrideAudit?.expected).toHaveLength(2);
  });

  it('keeps garden optional and defaults expected to []', () => {
    expect(noldorConfigSchema.parse({}).garden).toBeUndefined();
    expect(
      noldorConfigSchema.parse({ garden: { overrideAudit: {} } }).garden?.overrideAudit?.expected,
    ).toEqual([]);
  });

  it('rejects a rule with neither shaPrefix nor reasonIncludes', () => {
    expect(() =>
      noldorConfigSchema.parse({
        garden: { overrideAudit: { expected: [{ note: 'matches nothing' }] } },
      }),
    ).toThrow();
  });

  it('rejects a non-positive threshold and a rule without a note', () => {
    expect(() =>
      noldorConfigSchema.parse({ garden: { overrideAudit: { threshold: 0 } } }),
    ).toThrow();
    expect(() =>
      noldorConfigSchema.parse({
        garden: { overrideAudit: { expected: [{ reasonIncludes: 'x' }] } },
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/cr/__tests__/config.test.ts
```

Expected output: the 4 new `garden.overrideAudit` tests fail (no `garden` key on the schema yet); everything else — including Task 1's tests — stays green.

- [ ] **Step 3: Add the schema to `src/cr/config.ts`**

Insert below the `releaseConfigSchema` block from Task 1:

```ts
/**
 * One expected-override declaration for the override-audit detector. Matches
 * collected `Noldor-Path-Override` commits by SHA prefix and/or reason
 * substring; when BOTH fields are set, both must match (narrower is safer — a
 * broad `reasonIncludes` must not silently absorb unrelated overrides). At
 * least one matching field is required. `note` documents why the noise is
 * expected; the committed config diff is the audit trail.
 */
export const expectedOverrideSchema = z
  .object({
    shaPrefix: z
      .string()
      .regex(/^[0-9a-f]{7,40}$/)
      .optional(),
    reasonIncludes: z.string().min(1).optional(),
    note: z.string().min(1),
  })
  .refine(
    (e) => e.shaPrefix !== undefined || e.reasonIncludes !== undefined,
    'need shaPrefix or reasonIncludes',
  );

/** Garden-detector tuning — the `garden:` block of `.noldor/config.json`. */
export const gardenConfigSchema = z.object({
  overrideAudit: z
    .object({
      threshold: z.number().int().positive().optional(),
      expected: z.array(expectedOverrideSchema).default([]),
    })
    .optional(),
});

/** One parsed {@link expectedOverrideSchema} rule. */
export type ExpectedOverride = z.infer<typeof expectedOverrideSchema>;
/** Parsed `garden:` block. */
export type GardenConfig = z.infer<typeof gardenConfigSchema>;
```

Add the key to `noldorConfigSchema` (final shape):

```ts
export const noldorConfigSchema = z.object({
  crLanes: crLanesConfigSchema.optional(),
  crReview: crReviewConfigSchema.optional(),
  autonomous: autonomousConfigSchema.optional(),
  gate: gateConfigSchema.optional(),
  agents: agentsConfigSchema.optional(),
  release: releaseConfigSchema.optional(),
  garden: gardenConfigSchema.optional(),
});
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/cr/__tests__/config.test.ts
```

Expected output: all tests pass (0 failed).

- [ ] **Step 5: Commit**

```bash
pnpm fmt
git add src/cr/config.ts src/cr/__tests__/config.test.ts
git commit -m "feat(garden): add garden.overrideAudit config schema (threshold + expected rules)" -m "Noldor-FD: release-bypass-retirement
Noldor-Path: specs-only-new"
```

## Task 5: `auditOverrides` expected-noise exclusion

`auditOverrides` (`src/garden/detectors/override-audit.ts:60`) marks each entry `expected: boolean`; severity and `count` are computed from **unexpected** entries only, `expectedCount` reports the rest, and all entries stay in `overrides` so `/garden` and the SDD report keep surfacing them.

**Files:**

- Modify: `src/garden/detectors/override-audit.ts`
- Test: `src/garden/detectors/__tests__/override-audit.test.ts`

- [ ] **Step 1: Write the failing detector tests**

Append to `src/garden/detectors/__tests__/override-audit.test.ts` (reuses the file's `makeRepo` / `addCommit` helpers):

```ts
describe('auditOverrides — expected-noise exclusion', () => {
  let repo: string;

  beforeEach(() => {
    repo = makeRepo();
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('4 overrides with 2 expected → INFO not WARN; count/expectedCount split', () => {
    addCommit(repo, 'fix(a): o1\n\nNoldor-Path-Override: drain sprint batch alpha');
    addCommit(repo, 'fix(b): o2\n\nNoldor-Path-Override: drain sprint batch alpha again');
    addCommit(repo, 'fix(c): o3\n\nNoldor-Path-Override: unrelated hotfix');
    addCommit(repo, 'fix(d): o4\n\nNoldor-Path-Override: another unrelated');

    const result = auditOverrides({
      cwd: repo,
      threshold: 3,
      expected: [
        { reasonIncludes: 'drain sprint batch alpha', note: 'operator-accepted 2026-06 sprint' },
      ],
    });
    expect(result.severity).toBe('INFO');
    expect(result.count).toBe(2);
    expect(result.expectedCount).toBe(2);
    expect(result.overrides).toHaveLength(4);
  });

  it('matches by SHA prefix and keeps the entry listed with expected: true', () => {
    const sha = addCommit(repo, 'fix(e): sha-matched\n\nNoldor-Path-Override: some reason');

    const result = auditOverrides({
      cwd: repo,
      expected: [{ shaPrefix: sha.slice(0, 10), note: 'known one-off' }],
    });
    expect(result.count).toBe(0);
    expect(result.expectedCount).toBe(1);
    expect(result.severity).toBe('INFO');
    expect(result.overrides[0]).toMatchObject({ sha, expected: true });
  });

  it('unexpected overrides above threshold still WARN even when others are expected', () => {
    for (let i = 0; i < 4; i++) {
      addCommit(repo, `fix: u${i}\n\nNoldor-Path-Override: new noise ${i}`);
    }
    addCommit(repo, 'fix: e1\n\nNoldor-Path-Override: declared noise');

    const result = auditOverrides({
      cwd: repo,
      threshold: 3,
      expected: [{ reasonIncludes: 'declared noise', note: 'declared' }],
    });
    expect(result.severity).toBe('WARN');
    expect(result.count).toBe(4);
    expect(result.expectedCount).toBe(1);
  });

  it('marks expected: false on every entry when no rules are passed (back-compat)', () => {
    addCommit(repo, 'fix: o\n\nNoldor-Path-Override: reason');

    const result = auditOverrides({ cwd: repo });
    expect(result.overrides[0]!.expected).toBe(false);
    expect(result.expectedCount).toBe(0);
    expect(result.count).toBe(1);
  });

  it('a dual-field rule requires both fields to match', () => {
    const sha = addCommit(repo, 'fix: dual\n\nNoldor-Path-Override: alpha noise');

    const both = auditOverrides({
      cwd: repo,
      expected: [{ shaPrefix: sha.slice(0, 10), reasonIncludes: 'alpha noise', note: 'both' }],
    });
    expect(both.expectedCount).toBe(1);

    const reasonMismatch = auditOverrides({
      cwd: repo,
      expected: [
        { shaPrefix: sha.slice(0, 10), reasonIncludes: 'DOES NOT APPEAR', note: 'mismatch' },
      ],
    });
    expect(reasonMismatch.expectedCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/garden/detectors/__tests__/override-audit.test.ts
```

Expected output: the 5 new exclusion tests fail (`expected` / `expectedCount` are `undefined`; the 4-override case reports `WARN` with `count: 4`). All pre-existing tests stay green.

- [ ] **Step 3: Implement the matcher + result split in `src/garden/detectors/override-audit.ts`**

Replace the `OverrideEntry` / `OverrideAuditResult` interfaces with:

```ts
export interface OverrideEntry {
  readonly sha: string;
  readonly reason: string;
  /** True when a configured `garden.overrideAudit.expected` rule matched. */
  readonly expected: boolean;
}

export interface OverrideAuditResult {
  readonly severity: 'OK' | 'INFO' | 'WARN';
  /** Count of UNEXPECTED overrides — the only input to severity. */
  readonly count: number;
  /** Count of overrides absorbed by an `expected` rule (still listed below). */
  readonly expectedCount: number;
  readonly overrides: readonly OverrideEntry[];
}

/**
 * One `garden.overrideAudit.expected` rule (schema-validated by
 * `gardenConfigSchema` in `src/cr/config.ts`; kept structural here so the
 * detector layer has no cr-module import). A rule matches when EVERY field it
 * defines matches: `shaPrefix` as a prefix of the full commit SHA,
 * `reasonIncludes` as a substring of the override reason. `note` is
 * documentation-only.
 */
export interface ExpectedOverrideRule {
  readonly shaPrefix?: string;
  readonly reasonIncludes?: string;
  readonly note: string;
}

/**
 * True when any rule matches `entry`. A rule defining no matching field
 * matches nothing (the config schema forbids that shape; this guard keeps the
 * function safe for hand-built inputs).
 */
export function matchesExpectedOverride(
  entry: { readonly sha: string; readonly reason: string },
  rules: readonly ExpectedOverrideRule[],
): boolean {
  return rules.some((rule) => {
    if (rule.shaPrefix === undefined && rule.reasonIncludes === undefined) return false;
    if (rule.shaPrefix !== undefined && !entry.sha.startsWith(rule.shaPrefix)) return false;
    if (rule.reasonIncludes !== undefined && !entry.reason.includes(rule.reasonIncludes)) {
      return false;
    }
    return true;
  });
}
```

In `auditOverrides`: extend the options object and JSDoc —

```ts
export function auditOverrides(opts: {
  cwd: string;
  threshold?: number;
  daysBack?: number;
  /** Declared expected-noise rules (`garden.overrideAudit.expected`). */
  expected?: readonly ExpectedOverrideRule[];
}): OverrideAuditResult {
```

(add `@param opts.expected - Expected-noise rules; matched entries are listed but excluded from severity.` to the JSDoc). After `const daysBack = ...` add:

```ts
  const expectedRules = opts.expected ?? [];
```

Replace the entry push:

```ts
    const overrideReason = trailers['Noldor-Path-Override'];
    if (overrideReason && !commitOnlyTouchesReport(sha, opts.cwd)) {
      overrides.push({
        sha,
        reason: overrideReason,
        expected: matchesExpectedOverride({ sha, reason: overrideReason }, expectedRules),
      });
    }
```

Replace the severity computation and return:

```ts
  // Severity from UNEXPECTED entries only — declared noise never pushes the
  // audit to WARN, but any override keeps it INFO-visible (never disappears).
  const unexpectedCount = overrides.filter((o) => !o.expected).length;
  const severity: 'OK' | 'INFO' | 'WARN' =
    unexpectedCount > threshold ? 'WARN' : overrides.length > 0 ? 'INFO' : 'OK';

  return {
    severity,
    count: unexpectedCount,
    expectedCount: overrides.length - unexpectedCount,
    overrides,
  };
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/garden/detectors/__tests__/override-audit.test.ts
```

Expected output: all tests pass — the pre-existing suite (which passes no `expected` rules) is unaffected because `count` equals `overrides.length` when every entry is unexpected.

- [ ] **Step 5: Commit**

```bash
pnpm fmt
git add src/garden/detectors/override-audit.ts src/garden/detectors/__tests__/override-audit.test.ts
git commit -m "feat(garden): exclude declared expected overrides from override-audit severity" -m "Noldor-FD: release-bypass-retirement
Noldor-Path: specs-only-new"
```

## Task 6: Thread the config through garden-detect + sdd-report

`detectGateCompliance` (`src/garden/garden-detect.ts:622`) and `detectAll` (line ~727) load the config once (fail-open) and pass `threshold` + `expected` into `auditOverrides`. `buildGateComplianceSection` (`src/garden/sdd-report.ts:891`) marks its independently-collected entries the same way, and `renderReportMd` (line ~1050) renders the `(expected)` suffix. `hasBlockingFindings` is untouched.

**Files:**

- Modify: `src/garden/garden-detect.ts`
- Modify: `src/garden/sdd-report.ts`
- Test: `src/garden/__tests__/garden-detect.test.ts`
- Test: `src/garden/__tests__/sdd-report.test.ts`

- [ ] **Step 1: Write the failing helper tests**

In `src/garden/__tests__/garden-detect.test.ts`, add `loadOverrideAuditOptions` to the existing `../garden-detect.js` import list, then append:

```ts
describe('loadOverrideAuditOptions', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await makeRepo();
  });

  afterEach(async () => {
    await rm(repo, { force: true, recursive: true });
  });

  it('returns no rules and no threshold when the config file is absent', async () => {
    const opts = await loadOverrideAuditOptions(repo);
    expect(opts.expected).toEqual([]);
    expect(opts.threshold).toBeUndefined();
  });

  it('extracts threshold and expected rules from garden.overrideAudit', async () => {
    await mkdir(join(repo, '.noldor'), { recursive: true });
    await writeFile(
      join(repo, '.noldor/config.json'),
      JSON.stringify({
        garden: {
          overrideAudit: {
            threshold: 6,
            expected: [{ reasonIncludes: 'declared noise', note: 'operator-accepted' }],
          },
        },
      }),
      'utf8',
    );
    const opts = await loadOverrideAuditOptions(repo);
    expect(opts.threshold).toBe(6);
    expect(opts.expected).toEqual([
      { reasonIncludes: 'declared noise', note: 'operator-accepted' },
    ]);
  });

  it('fails open on a malformed config (no crash, no rules)', async () => {
    await mkdir(join(repo, '.noldor'), { recursive: true });
    await writeFile(join(repo, '.noldor/config.json'), '{ not json', 'utf8');
    const opts = await loadOverrideAuditOptions(repo);
    expect(opts.expected).toEqual([]);
  });
});
```

- [ ] **Step 2: Write the failing sdd-report tests**

In `src/garden/__tests__/sdd-report.test.ts`, append inside the existing `describe('buildGateComplianceSection', …)` block (after the last `it`; the file already imports `mkdirSync`, `writeFileSync`, and `join`):

```ts
  it('marks overrides matched by garden.overrideAudit.expected with expected: true', () => {
    commit(repo, 'fix(x): noisy\n\nNoldor-Path-Override: drain sprint batch alpha');
    mkdirSync(join(repo, '.noldor'), { recursive: true });
    writeFileSync(
      join(repo, '.noldor', 'config.json'),
      JSON.stringify({
        garden: {
          overrideAudit: {
            expected: [
              { reasonIncludes: 'drain sprint batch alpha', note: 'declared self-host noise' },
            ],
          },
        },
      }),
      'utf8',
    );
    const result = buildGateComplianceSection([], repo);
    expect(result.overrides).toHaveLength(1);
    expect(result.overrides[0]!.expected).toBe(true);
  });

  it('marks overrides expected: false when no config declares them', () => {
    commit(repo, 'fix(y): plain\n\nNoldor-Path-Override: some new noise');
    const result = buildGateComplianceSection([], repo);
    expect(result.overrides[0]!.expected).toBe(false);
  });
```

- [ ] **Step 3: Run to verify FAIL**

```bash
pnpm vitest run src/garden/__tests__/garden-detect.test.ts src/garden/__tests__/sdd-report.test.ts
```

Expected output: the garden-detect suite fails to import `loadOverrideAuditOptions` (not exported yet), and the two new sdd-report tests fail (`expected` is `undefined`).

- [ ] **Step 4: Implement the wiring in `src/garden/garden-detect.ts`**

Add imports (beside the existing `auditOverrides` import and type imports):

```ts
import { loadConfig } from '../cr/config.js';
import type { ExpectedOverrideRule } from './detectors/override-audit.js';
```

Add the helper above `detectGateCompliance`:

```ts
/**
 * Resolve `garden.overrideAudit` tuning from `<repo>/.noldor/config.json`.
 * Fail-open: a missing or malformed config yields no expected rules and the
 * detector's built-in threshold (mirrors `resolveGardenScanPaths`) — a config
 * typo must not crash `/garden` or the release gate-compliance check.
 */
export async function loadOverrideAuditOptions(
  repo: string,
): Promise<{ threshold?: number; expected: readonly ExpectedOverrideRule[] }> {
  try {
    const config = await loadConfig(join(repo, '.noldor', 'config.json'));
    return {
      threshold: config?.garden?.overrideAudit?.threshold,
      expected: config?.garden?.overrideAudit?.expected ?? [],
    };
  } catch {
    return { expected: [] };
  }
}
```

In `detectGateCompliance`, replace `const overrideAudit = auditOverrides({ cwd: repo });` with:

```ts
  const overrideAudit = auditOverrides({ cwd: repo, ...(await loadOverrideAuditOptions(repo)) });
```

In `detectAll`, replace its `const overrideAudit = auditOverrides({ cwd: repo });` line with the same expression.

- [ ] **Step 5: Implement the marker in `src/garden/sdd-report.ts`**

Extend the existing detector import (line ~17) and add the config import:

```ts
import { commitOnlyTouchesReport, matchesExpectedOverride } from './detectors/override-audit.js';
import type { ExpectedOverrideRule } from './detectors/override-audit.js';
import { loadConfigSync } from '../cr/config.js';
```

Extend `GateOverrideEntry`:

```ts
export interface GateOverrideEntry {
  readonly sha: string;
  readonly reason: string;
  /** True when a `garden.overrideAudit.expected` rule matched this entry. */
  readonly expected: boolean;
}
```

In `buildGateComplianceSection`, after `let reviewSkipCount = 0;` insert:

```ts
  // Expected-noise rules from `garden.overrideAudit.expected` — render-side
  // marking only; severity stays auditOverrides' concern. Fail-open on a
  // missing/malformed config: worst case entries render without the marker.
  let expectedRules: readonly ExpectedOverrideRule[] = [];
  try {
    expectedRules =
      loadConfigSync(join(cwd, '.noldor', 'config.json'))?.garden?.overrideAudit?.expected ?? [];
  } catch {
    expectedRules = [];
  }
```

Replace the override push in the same function:

```ts
    const overrideReason = trailers['Noldor-Path-Override'];
    if (overrideReason && !commitOnlyTouchesReport(sha, cwd)) {
      overrides.push({
        sha,
        reason: overrideReason,
        expected: matchesExpectedOverride({ sha, reason: overrideReason }, expectedRules),
      });
    }
```

In `renderReportMd`, replace the override render line:

```ts
      for (const o of gateCompliance.overrides) {
        lines.push(`- \`${o.sha.slice(0, 7)}\` — ${o.reason}${o.expected ? ' (expected)' : ''}`);
      }
```

- [ ] **Step 6: Run to verify PASS**

```bash
pnpm vitest run src/garden/__tests__/garden-detect.test.ts src/garden/__tests__/sdd-report.test.ts
```

Expected output: all tests pass (0 failed).

- [ ] **Step 7: Commit**

```bash
pnpm fmt
git add src/garden/garden-detect.ts src/garden/sdd-report.ts src/garden/__tests__/garden-detect.test.ts src/garden/__tests__/sdd-report.test.ts
git commit -m "feat(garden): thread expected-override config through detect + sdd-report" -m "Noldor-FD: release-bypass-retirement
Noldor-Path: specs-only-new"
```

## Task 7: Log the `RELEASE_SKIP_GARDEN_GATE` bypass (U3)

`ensureGardenFresh`'s skip branch (`src/garden/garden-receipt.ts:125`) gains the same `appendOverrideLog(cwd, …, 'release')` breadcrumb as `src/release/index.ts:179`; the JSDoc's "no persistent audit ledger today" paragraph goes away. `appendOverrideLog` swallows write failures (`src/core/overrides-log.ts:15`), so the fail-open contract holds.

**Files:**

- Modify: `src/garden/garden-receipt.ts`
- Test: `src/garden/__tests__/garden-receipt.test.ts`

- [ ] **Step 1: Write the failing bypass-audit test**

In `src/garden/__tests__/garden-receipt.test.ts`: add `readFileSync` to the `node:fs` import, then append inside the existing `describe(ensureGardenFresh, …)` block:

```ts
  it('appends a (release)-tagged overrides.log line when bypassed', () => {
    process.env.RELEASE_SKIP_GARDEN_GATE = '1';
    const tmp = mkdtempSync(join(tmpdir(), 'garden-fresh-bypass-log-'));
    try {
      // appendOverrideLog does not mkdir — the real repo always has .noldor/.
      mkdirSync(join(tmp, '.noldor'), { recursive: true });
      ensureGardenFresh(tmp);
      const log = readFileSync(join(tmp, '.noldor', 'overrides.log'), 'utf8');
      expect(log).toMatch(/\tRELEASE_SKIP_GARDEN_GATE=1\t\(release\)\n$/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
```

Also update the stale comment in the existing bypass test (same describe block) — replace:

```ts
    // No receipt present, but bypass means we never read it. Pass a non-repo cwd to
    // prove the function returns before touching the filesystem or spawning git.
```

with:

```ts
    // No receipt present, but bypass means we never read it. Pass a non-repo
    // cwd to prove the function never reads the receipt or spawns git (it
    // only appends the overrides.log breadcrumb, which fails open).
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/garden/__tests__/garden-receipt.test.ts
```

Expected output: the new test fails with `ENOENT … overrides.log` (nothing writes the breadcrumb yet); everything else stays green.

- [ ] **Step 3: Implement the breadcrumb in `src/garden/garden-receipt.ts`**

Add the import (after the `loadConsumerConfig` import):

```ts
import { appendOverrideLog } from '../core/overrides-log.js';
```

Replace the skip branch of `ensureGardenFresh`:

```ts
  if (process.env.RELEASE_SKIP_GARDEN_GATE === '1') {
    appendOverrideLog(cwd, 'RELEASE_SKIP_GARDEN_GATE=1', 'release');
    console.log('→ ensureGardenFresh (SKIPPED via RELEASE_SKIP_GARDEN_GATE=1)');
    return;
  }
```

Replace the JSDoc paragraph on `ensureGardenFresh` that reads:

```ts
 * Bypass via `RELEASE_SKIP_GARDEN_GATE=1` for bootstrap commits (commits
 * that predate this gate's existence). The bypass is stdout-loud but has
 * no persistent audit ledger today — operators should treat each usage
 * as exceptional. Persistent override tracking is a candidate follow-up.
```

with:

```ts
 * Bypass via `RELEASE_SKIP_GARDEN_GATE=1` for bootstrap commits (commits
 * that predate this gate's existence). Every bypass is stdout-loud AND
 * appends a `(release)`-tagged breadcrumb to `.noldor/overrides.log` via
 * {@link appendOverrideLog} — the same audit trail as the other release
 * skip-vars (see `src/release/index.ts`).
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/garden/__tests__/garden-receipt.test.ts
```

Expected output: all tests pass (0 failed).

- [ ] **Step 5: Commit**

```bash
pnpm fmt
git add src/garden/garden-receipt.ts src/garden/__tests__/garden-receipt.test.ts
git commit -m "feat(garden): log RELEASE_SKIP_GARDEN_GATE bypass to overrides.log" -m "Noldor-FD: release-bypass-retirement
Noldor-Path: specs-only-new"
```

## Task 8: Retire the skip-vars from the documented recipe (U4)

Doc-only task, no unit tests. Note: the release-sweep skill contains **no** `RELEASE_SKIP_*` mention today (spec premise drift — verified by grep at plan time); the edit therefore *adds* the clean-release + exemption workflow to step 9 rather than replacing a step. The actual skip-var prescription lives in `docs/noldor/versioning.md` — updated here per Goal 5. All four doc files have template twins that must stay byte-identical (pre-commit `template-sync`); `docs/noldor/*.md` pages are template-twinned copies, not build outputs, so edit consumer copy + twin identically and commit with a `noldor` scope (two pages touched → plain `docs(noldor)` per `validate-noldor-scope`).

**Files:**

- Modify: `.claude/skills/release-sweep/SKILL.md`
- Modify: `templates/.claude/skills/release-sweep/SKILL.md`
- Modify: `docs/noldor/cr-pipeline.md`
- Modify: `templates/docs/noldor/cr-pipeline.md`
- Modify: `docs/noldor/versioning.md`
- Modify: `templates/docs/noldor/versioning.md`

- [ ] **Step 1: Document the clean-release workflow in the release-sweep skill (both twins)**

In `.claude/skills/release-sweep/SKILL.md`, section "### 9. EXPLICIT USER CONFIRMATION", replace:

```
If the user types `release now` (exact match, case-insensitive): run `pnpm release` and tail the output.
```

with:

```
If the user types `release now` (exact match, case-insensitive): run `pnpm release` and tail the output.

`pnpm release` runs clean — never prefix it with `RELEASE_SKIP_*` env vars. If the CR gate reports a new receipt-less offender, add a `release.crGateExemptCommits` entry (`{ "sha": "<7-40 hex chars>", "reason": "..." }`) to `.noldor/config.json`; if the override audit WARNs on known self-host noise, declare it under `garden.overrideAudit.expected` (`shaPrefix` / `reasonIncludes` + `note`). Both are committed config, reviewed in the PR diff. The `RELEASE_SKIP_*` vars stay break-glass only — every use appends a `(release)`-tagged line to `.noldor/overrides.log`.
```

Apply the identical edit to `templates/.claude/skills/release-sweep/SKILL.md`.

- [ ] **Step 2: Document the exemption config in cr-pipeline (both twins)**

In `docs/noldor/cr-pipeline.md`, "## Release gate" section, replace:

```
Failures abort the release with a per-commit diagnostic. Skipping via
`RELEASE_SKIP_CR_GATE=1` appends a `(release)`-tagged line to
`.noldor/overrides.log`.
```

with:

```
Failures abort the release with a per-commit diagnostic. Skipping via
`RELEASE_SKIP_CR_GATE=1` appends a `(release)`-tagged line to
`.noldor/overrides.log`.

A known-bad historical commit is acknowledged per-SHA instead of
skipping the whole gate: add a `release.crGateExemptCommits` entry
(`sha` prefix, min 7 hex chars, plus a required `reason`) to
`.noldor/config.json`. `checkCrGate` skips matching commits, reports
them under `exempted`, and the release log echoes each one
(`→ CR gate: exempted <sha> — <reason>`); the committed config diff is
the audit trail. Expected self-host override noise is declared the same
way under `garden.overrideAudit.expected` (matched by `shaPrefix`
and/or `reasonIncludes`, with a required `note`); matched overrides
stop counting toward the override-audit WARN threshold but stay listed
in `/garden` output and the SDD report with an `(expected)` marker.
```

Apply the identical edit to `templates/docs/noldor/cr-pipeline.md`.

- [ ] **Step 3: Demote the skip-vars in versioning (both twins)**

In `docs/noldor/versioning.md`, "## Release flow" step 1, replace:

```
     Bypass with `RELEASE_SKIP_GATE_COMPLIANCE=1 pnpm release` when a
     release cycle ends with known scope-vs-FD-slug drift that can't be
     fixed without rewriting public history. The bypass is loud (printed
     in release output) and is intended as an escape hatch, not the norm.
```

with:

```
     Expected self-host override noise is declared per-entry in
     `garden.overrideAudit.expected` (`.noldor/config.json`) so it stops
     counting toward the override-audit WARN threshold — see
     [`cr-pipeline.md`](cr-pipeline.md). `RELEASE_SKIP_GATE_COMPLIANCE=1
     pnpm release` remains a logged break-glass hatch for findings that
     can't be fixed without rewriting public history, not the norm.
```

and replace:

```
     or a non-empty override trailer, scanned across the whole squash
     commit body. See [`cr-pipeline.md`](cr-pipeline.md). Bypass with
     `RELEASE_SKIP_CR_GATE=1 pnpm release` when shipping a transition
     release where the CR pipeline itself was added during the cycle and
     pre-cycle commits never had a chance to carry the trailers. Same
     escape-hatch discipline as `RELEASE_SKIP_GATE_COMPLIANCE`; both
     skips append a `(release)`-tagged line to `.noldor/overrides.log`.
```

with:

```
     or a non-empty override trailer, scanned across the whole squash
     commit body. See [`cr-pipeline.md`](cr-pipeline.md). Individual
     receipt-less historical commits are acknowledged per-SHA in
     `release.crGateExemptCommits` (`.noldor/config.json`) with a
     required reason, instead of skipping the whole check.
     `RELEASE_SKIP_CR_GATE=1 pnpm release` remains a logged break-glass
     hatch (e.g. a transition release where the CR pipeline itself was
     added mid-cycle). Same escape-hatch discipline as
     `RELEASE_SKIP_GATE_COMPLIANCE`; all three skips — the garden gate
     included — append a `(release)`-tagged line to
     `.noldor/overrides.log`.
```

Apply both identical edits to `templates/docs/noldor/versioning.md`.

- [ ] **Step 4: Verify twin parity and page validity**

```bash
diff .claude/skills/release-sweep/SKILL.md templates/.claude/skills/release-sweep/SKILL.md && diff docs/noldor/cr-pipeline.md templates/docs/noldor/cr-pipeline.md && diff docs/noldor/versioning.md templates/docs/noldor/versioning.md && echo TWINS-IDENTICAL
pnpm noldor validate noldor
grep -rn "RELEASE_SKIP" .claude/skills/release-sweep/SKILL.md | grep -v "break-glass\|never prefix" ; echo "grep-exit=$?"
```

Expected output: `TWINS-IDENTICAL`; the noldor-page validation passes; the final grep prints nothing and `grep-exit=1` (the only skip-var mentions in the skill are the break-glass framing).

- [ ] **Step 5: Commit (shared-files guard needs the env override in a worktree)**

```bash
git add .claude/skills/release-sweep/SKILL.md templates/.claude/skills/release-sweep/SKILL.md docs/noldor/cr-pipeline.md templates/docs/noldor/cr-pipeline.md docs/noldor/versioning.md templates/docs/noldor/versioning.md
NOLDOR_ALLOW_SHARED=1 git commit -m "docs(noldor): document per-item release-gate exemptions; retire skip-var recipe" -m "Noldor-FD: release-bypass-retirement
Noldor-Path: specs-only-new"
```

## Task 9: Acceptance verification (U5)

Verification only — no file changes, no commit. Runs every acceptance criterion that is checkable pre-merge, then the end-to-end dry-run proof.

**Files:**

- Test: `src/release`, `src/garden`, `src/cr` (full suites)

- [ ] **Step 1: Full test sweep over the touched modules**

```bash
pnpm vitest run src/release src/garden src/cr
```

Expected output: all suites green (0 failed) — acceptance criterion "all existing release + garden test suites stay green".

- [ ] **Step 2: Gate-compliance detector exits clean**

```bash
pnpm noldor garden detect --gate-compliance ; echo "exit=$?"
```

Expected output: one JSON line whose `overrideAudit` shows `"severity":"INFO"` (or `"OK"`) with the new `expectedCount` field present, and `exit=0`.

- [ ] **Step 3: Seeded exemption satisfies the live CR gate; removing it fails again**

```bash
pnpm exec tsx -e "
import { loadConfigSync } from './src/cr/config.ts';
import { checkCrGate } from './src/release/release-cr-gate.ts';
const cfg = loadConfigSync();
const withSeed = checkCrGate({ from: 'v0.4.0', to: 'HEAD', cwd: process.cwd(), exemptions: cfg?.release?.crGateExemptCommits ?? [] });
const without = checkCrGate({ from: 'v0.4.0', to: 'HEAD', cwd: process.cwd(), exemptions: [] });
console.log(JSON.stringify({ withSeed: { ok: withSeed.ok, exempted: withSeed.exempted.map((e) => e.sha.slice(0, 10)) }, without: { ok: without.ok } }));
"
```

Expected output: `{"withSeed":{"ok":true,"exempted":["19a74a10e8"]},"without":{"ok":false}}`.

- [ ] **Step 4: Repo-wide verify**

```bash
pnpm verify
```

Expected output: lint, fmt:check, typecheck, and the full test suite all pass.

- [ ] **Step 5: Zero-bypass dry-run release**

This is the end-to-end proof: the dry-run short-circuit (`src/release/index.ts:224`) sits *after* the gate-compliance step (line ~184) and the CR gate (line ~197), so a green dry run demonstrates zero-bypass viability without tagging. It must run on a clean, origin-synced `main` (post-merge) — on the feature branch it aborts at `ensureCleanTreeOnMain` by design. Preconditions also require a fresh graph and garden receipt; refresh them the standard way first (`/graphify` + `pnpm toon` if `graphify-out/graph.json` is stale, then `pnpm noldor garden receipt` — normally the tail of a `/garden` pass):

```bash
env | grep RELEASE_SKIP ; echo "skip-vars-set=$?"
NOLDOR_RELEASE_DRY_RUN=1 pnpm release
```

Expected output: `skip-vars-set=1` (no `RELEASE_SKIP_*` in the environment), then the release check sequence including the line `→ CR gate: exempted 19a74a10e8 — pre-rollout-marker CI-workflow fast-track (#117); shipped before receipt enforcement armed`, ending with `[dry-run] Preconditions + checks passed. Would bump v0.4.0 → v<next> from <N> commit(s). No files written, no tag, no push.` — with zero `RELEASE_SKIP_*` env vars set (acceptance criterion 1).
