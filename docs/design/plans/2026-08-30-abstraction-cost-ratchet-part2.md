# Abstraction-Cost Ratchet Implementation Plan — Part 2: Ratchet on It

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Turn the part-1 diagnostic into a gate. Add the persisted baseline, the `check` and `baseline` subcommands, and the `noldor-indirection` pre-push job shipped to consumers, so the excess sum can only be raised deliberately.

**Architecture:** Adds `baseline.ts` (Zod schema + comparability + verdict) beside the part-1 engine, and widens the existing `indirection` command rather than minting a new one. A knob mismatch is stale-not-red, following `src/clones/baseline.ts`.

**Tech Stack:** TypeScript 7 (ESM, explicit `.js` specifiers), Zod 3 (`.strict()`), Vitest, `dependency-cruiser` + `@swc/core`, lefthook.

**Depends on:** Part 1 (`docs/design/plans/2026-08-30-abstraction-cost-ratchet-part1.md`) — its engine and CLI must be merged first.

---

## File Structure

- `src/indirection/baseline.ts` — **create.** The persisted ratchet: Zod schema, `buildBaseline`, `readBaseline`, `writeBaseline`, `compareToBaseline`. Owns `BASELINE_FILE` and `ALGORITHM_VERSION`.
- `src/indirection/indirection-cli.ts` — **modify.** Widen the arg parser and add the `check` / `baseline` verdict paths.
- `src/indirection/__tests__/baseline.test.ts` — **create.** Schema round-trip, comparability, stale handling.
- `src/indirection/__tests__/indirection-cli.test.ts` — **modify.** The full exit-code matrix.
- `src/indirection/__tests__/trees/unresolved/a.ts` — **create.** Distinguishes an in-scope unresolved import from a bare one.
- `lefthook/noldor.yml` — **modify.** `noldor-indirection` pre-push job beside `noldor-clones`.
- `templates/lefthook/noldor.yml` — **modify.** Same job, shipped to consumers.
- `.noldor/indirection-baseline.json` — **create.** Recorded last, once the whole corpus exists.
- `docs/features/abstraction-cost-ratchet.md` — **modify.** Populate `links.code` / `links.tests`.

---

## Task 1: Persisted baseline

**Files:**
- Create: `src/indirection/baseline.ts`
- Create: `src/indirection/__tests__/baseline.test.ts`

- [ ] **Step 1: Write the failing baseline test.**

  `src/indirection/__tests__/baseline.test.ts`:
  ```ts
  import { mkdtempSync, rmSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';

  import { describe, expect, it } from 'vitest';

  import {
    ALGORITHM_VERSION,
    buildBaseline,
    compareToBaseline,
    readBaseline,
    writeBaseline,
  } from '../baseline.js';
  import type { IndirectionReport } from '../detect.js';

  const report = (excessSum: number): IndirectionReport => ({
    kind: 'measured',
    excessSum,
    modules: [],
    flagged: [],
    percentiles: { p50: 1, p75: 2, p90: 3, p99: 4, max: 5 },
    modulesScanned: 7,
    unresolvedInScope: [],
  });

  const opts = { threshold: 30, scanRoots: ['src'], includeTests: false };

  describe('baseline', () => {
    it('round-trips through the schema', () => {
      const dir = mkdtempSync(join(tmpdir(), 'indirection-'));
      try {
        const path = join(dir, 'baseline.json');
        const built = buildBaseline(report(882), opts, '2026-08-30T00:00:00.000Z');
        writeBaseline(path, built);
        const back = readBaseline(path);
        expect(back.kind).toBe('ok');
        if (back.kind === 'ok') {
          expect(back.baseline.excessSum).toBe(882);
          expect(back.baseline.algorithmVersion).toBe(ALGORITHM_VERSION);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('is absent-green when the file does not exist', () => {
      expect(readBaseline(join(tmpdir(), 'definitely-not-here-baseline.json')).kind).toBe('absent');
    });

    it('reds only when the number rose', () => {
      const base = buildBaseline(report(882), opts, '2026-08-30T00:00:00.000Z');
      expect(compareToBaseline(report(883), base, opts).kind).toBe('red');
      expect(compareToBaseline(report(882), base, opts).kind).toBe('green');
      expect(compareToBaseline(report(800), base, opts).kind).toBe('green');
    });

    it('reports stale rather than red when the knobs differ', () => {
      const base = buildBaseline(report(882), opts, '2026-08-30T00:00:00.000Z');
      const verdict = compareToBaseline(report(9999), base, { ...opts, threshold: 40 });
      expect(verdict.kind).toBe('stale');
    });

    it('reports stale when the algorithm version differs', () => {
      const base = {
        ...buildBaseline(report(882), opts, '2026-08-30T00:00:00.000Z'),
        algorithmVersion: ALGORITHM_VERSION + 1,
      };
      expect(compareToBaseline(report(9999), base, opts).kind).toBe('stale');
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it FAILS.**

  ```bash
  pnpm vitest run src/indirection/__tests__/baseline.test.ts
  ```
  Expected output: failure with `Failed to resolve import "../baseline.js"`.

- [ ] **Step 3: Implement the baseline module.**

  `src/indirection/baseline.ts`:
  ```ts
  /**
   * Whole-corpus indirection ratchet. `.noldor/indirection-baseline.json`
   * records the excess sum a repo already carries; `indirection check` then
   * reds only when that number GROWS.
   *
   * A knob mismatch is `stale` — reported, never red — following
   * `src/clones/baseline.ts`. `scanRoots` and `includeTests` are consumer-owned,
   * so reding on a mismatch would hard-block every push in a repo that merely
   * edited `scanPaths`, and no framework migration can ship for a knob the
   * framework does not own.
   */
  import { mkdirSync } from 'node:fs';
  import { dirname } from 'node:path';

  import { z } from 'zod';

  import { atomicWriteFileSync } from '../core/atomic-write.js';
  import { readJsonState } from '../core/state-file.js';
  import type { IndirectionReport } from './detect.js';

  /** Baseline location, relative to the repo root. Tracked, not transient. */
  export const BASELINE_FILE = '.noldor/indirection-baseline.json';

  /**
   * Bumped whenever the closure traversal changes. `options` alone cannot catch
   * a change in how the number is COMPUTED — a fix to alias handling moves
   * every closure without moving a knob — and silently comparing across that
   * boundary is worse than reporting stale.
   */
  export const ALGORITHM_VERSION = 1;

  const measured = z.number().int().nonnegative();

  export const baselineOptionsSchema = z
    .object({
      threshold: z.number().int().positive(),
      scanRoots: z.array(z.string().min(1)),
      includeTests: z.boolean(),
    })
    .strict();
  export type BaselineOptions = z.infer<typeof baselineOptionsSchema>;

  export const indirectionBaselineSchema = z
    .object({
      /** The ratchet number: total closure above the threshold. */
      excessSum: measured,
      /** Recorded for the human reading the file; never compared. */
      flaggedModules: measured,
      modulesScanned: measured,
      percentiles: z
        .object({ p50: measured, p75: measured, p90: measured, p99: measured, max: measured })
        .strict()
        .nullable(),
      options: baselineOptionsSchema,
      algorithmVersion: z.number().int().positive(),
      recordedAt: z.string().min(1),
    })
    .strict();
  export type IndirectionBaseline = z.infer<typeof indirectionBaselineSchema>;

  export function buildBaseline(
    report: IndirectionReport,
    options: BaselineOptions,
    recordedAt: string,
  ): IndirectionBaseline {
    return {
      excessSum: report.excessSum,
      flaggedModules: report.flagged.length,
      modulesScanned: report.modulesScanned,
      percentiles: report.percentiles,
      options,
      algorithmVersion: ALGORITHM_VERSION,
      recordedAt,
    };
  }

  export type BaselineRead =
    | { readonly kind: 'ok'; readonly baseline: IndirectionBaseline }
    | { readonly kind: 'absent' }
    | { readonly kind: 'unreadable'; readonly message: string };

  export function readBaseline(path: string): BaselineRead {
    let raw: unknown;
    try {
      raw = readJsonState(path);
    } catch (e) {
      return { kind: 'unreadable', message: e instanceof Error ? e.message : String(e) };
    }
    if (raw === undefined) return { kind: 'absent' };
    const parsed = indirectionBaselineSchema.safeParse(raw);
    return parsed.success
      ? { kind: 'ok', baseline: parsed.data }
      : { kind: 'unreadable', message: parsed.error.message };
  }

  export function writeBaseline(path: string, baseline: IndirectionBaseline): void {
    mkdirSync(dirname(path), { recursive: true });
    atomicWriteFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);
  }

  export type RatchetVerdict =
    | { readonly kind: 'red'; readonly message: string }
    | { readonly kind: 'green'; readonly message: string }
    | { readonly kind: 'stale'; readonly message: string };

  function describeOptions(o: BaselineOptions): string {
    return `threshold=${o.threshold} roots=${o.scanRoots.join(',')} includeTests=${o.includeTests}`;
  }

  function sameOptions(a: BaselineOptions, b: BaselineOptions): boolean {
    return (
      a.threshold === b.threshold &&
      a.includeTests === b.includeTests &&
      a.scanRoots.length === b.scanRoots.length &&
      a.scanRoots.every((r, i) => r === b.scanRoots[i])
    );
  }

  export function compareToBaseline(
    report: IndirectionReport,
    baseline: IndirectionBaseline,
    options: BaselineOptions,
  ): RatchetVerdict {
    if (baseline.algorithmVersion !== ALGORITHM_VERSION) {
      return {
        kind: 'stale',
        message:
          `baseline recorded under algorithm version ${baseline.algorithmVersion}, this run is ` +
          `${ALGORITHM_VERSION} - not comparable, skipped\n` +
          `  re-record with 'noldor indirection baseline'`,
      };
    }
    if (!sameOptions(baseline.options, options)) {
      return {
        kind: 'stale',
        message:
          `baseline recorded under different options (${describeOptions(baseline.options)}) ` +
          `than this run (${describeOptions(options)}) - not comparable, skipped\n` +
          `  re-record with 'noldor indirection baseline'`,
      };
    }
    const delta = report.excessSum - baseline.excessSum;
    if (delta > 0) {
      return {
        kind: 'red',
        message:
          `indirection excess rose ${baseline.excessSum} -> ${report.excessSum} (+${delta}) ` +
          `above the baseline recorded ${baseline.recordedAt}`,
      };
    }
    return {
      kind: 'green',
      message:
        delta === 0
          ? `indirection excess unchanged at ${report.excessSum}`
          : `indirection excess fell ${baseline.excessSum} -> ${report.excessSum} (${delta})`,
    };
  }
  ```

- [ ] **Step 4: Run the test to verify it PASSES.**

  ```bash
  pnpm vitest run src/indirection/__tests__/baseline.test.ts
  ```
  Expected output: `Tests  5 passed (5)`.

- [ ] **Step 5: Commit.**

  ```bash
  cat > /tmp/indirection-t2.txt <<'MSG'
  feat(indirection): add the persisted ratchet baseline

  Records the excess sum at .noldor/indirection-baseline.json behind a strict
  Zod schema, so check reds only when the number grows. A knob mismatch or an
  algorithmVersion mismatch is reported stale and never red, following
  src/clones/baseline.ts: scanRoots and includeTests are consumer-owned, so
  reding would hard-block every push in a repo that only edited scanPaths, with
  no framework migration possible for a knob the framework does not own.
  algorithmVersion exists because options alone cannot catch a change in how the
  closure is computed.

  Noldor-FD: abstraction-cost-ratchet
  MSG
  git add src/indirection
  git commit -F /tmp/indirection-t2.txt
  ```

---

## Task 2: `check` and `baseline` subcommands

**Files:**
- Modify: `src/indirection/indirection-cli.ts`
- Modify: `src/indirection/__tests__/indirection-cli.test.ts`
- Create: `src/indirection/__tests__/trees/unresolved/a.ts`

- [ ] **Step 1: Add the unresolved-import fixture.**

  `src/indirection/__tests__/trees/unresolved/a.ts`:
  ```ts
  // A relative specifier that resolves to nothing — in-scope, therefore fatal.
  import { missing } from './does-not-exist.js';
  // A bare specifier that resolves to nothing — out of scope, therefore ignored,
  // because dependency-cruiser reports couldNotResolve for healthy reasons here.
  import { alsoMissing } from 'no-such-package-anywhere';

  export const a = (): unknown => [missing, alsoMissing];
  ```

- [ ] **Step 2: Extend the CLI test with the exit-code matrix.**

  Append to `src/indirection/__tests__/indirection-cli.test.ts`:
  ```ts
  import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
  import { tmpdir } from 'node:os';

  const unresolved = join(import.meta.dirname, 'trees', 'unresolved');

  const withTree = async (fn: (dir: string) => Promise<void>): Promise<void> => {
    const dir = mkdtempSync(join(tmpdir(), 'indirection-cli-'));
    try {
      writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  describe('runIndirection check and baseline', () => {
    it('check exits 0 when no baseline is recorded', async () => {
      await withTree(async (dir) => {
        expect(await runIndirection(['check'], dir)).toBe(0);
      });
    });

    it('check exits 0 when the number is unchanged, 1 once the baseline is lowered', async () => {
      await withTree(async (dir) => {
        expect(await runIndirection(['baseline'], dir)).toBe(0);
        expect(await runIndirection(['check'], dir)).toBe(0);

        const path = join(dir, '.noldor', 'indirection-baseline.json');
        const recorded = JSON.parse(readFileSync(path, 'utf8')) as { excessSum: number };
        writeFileSync(path, JSON.stringify({ ...recorded, excessSum: -1 + recorded.excessSum }));
        expect(await runIndirection(['check'], dir)).toBe(1);
      });
    });

    it('check exits 3 on an unreadable baseline; baseline overwrites it and exits 0', async () => {
      await withTree(async (dir) => {
        const path = join(dir, '.noldor', 'indirection-baseline.json');
        expect(await runIndirection(['baseline'], dir)).toBe(0);
        writeFileSync(path, '{ not json');
        expect(await runIndirection(['check'], dir)).toBe(3);
        expect(await runIndirection(['baseline'], dir)).toBe(0);
        expect(await runIndirection(['check'], dir)).toBe(0);
      });
    });

    it('check exits 0 and reports stale when the recorded knobs differ', async () => {
      await withTree(async (dir) => {
        const path = join(dir, '.noldor', 'indirection-baseline.json');
        expect(await runIndirection(['baseline'], dir)).toBe(0);
        const recorded = JSON.parse(readFileSync(path, 'utf8')) as {
          options: { threshold: number };
        };
        recorded.options.threshold += 5;
        writeFileSync(path, JSON.stringify(recorded));
        expect(await runIndirection(['check'], dir)).toBe(0);
      });
    });

    it('check exits 3 on an unresolved relative import but not on a bare one', async () => {
      expect(await runIndirection(['check'], unresolved)).toBe(3);
      expect(await runIndirection(['baseline'], unresolved)).toBe(3);
      // report still looks, and lists what it could not resolve
      expect(await runIndirection(['report'], unresolved)).toBe(0);
    });
  });
  ```

  Add `readFileSync` to the existing `node:fs` import at the top of the file.

- [ ] **Step 3: Run the test to verify it FAILS.**

  ```bash
  pnpm vitest run src/indirection/__tests__/indirection-cli.test.ts
  ```
  Expected output: failures on the new cases — `parseIndirectionArgs` throws `usage: noldor indirection report` for `check` and `baseline`.

- [ ] **Step 4: Widen the arg parser.**

  In `src/indirection/indirection-cli.ts`, replace the `IndirectionArgs` interface and `parseIndirectionArgs` with:
  ```ts
  export interface IndirectionArgs {
    sub: 'report' | 'check' | 'baseline';
    json: boolean;
  }

  class UsageError extends Error {}

  export function parseIndirectionArgs(argv: string[]): IndirectionArgs {
    const [sub, ...rest] = argv;
    if (sub !== 'report' && sub !== 'check' && sub !== 'baseline') {
      throw new UsageError('usage: noldor indirection <report|check|baseline> [--json]');
    }
    const args: IndirectionArgs = { sub, json: false };
    for (const flag of rest) {
      if (flag === '--json') args.json = true;
      else throw new UsageError(`unknown flag: ${flag}`);
    }
    return args;
  }
  ```

- [ ] **Step 5: Add the baseline imports.**

  In `src/indirection/indirection-cli.ts`, add below the existing `../core/repo-paths.js` import:
  ```ts
  import {
    BASELINE_FILE,
    buildBaseline,
    compareToBaseline,
    readBaseline,
    writeBaseline,
  } from './baseline.js';
  import type { BaselineOptions } from './baseline.js';
  ```

- [ ] **Step 6: Implement the two verdict paths.**

  In `runIndirection`, replace the final two lines (the `process.stdout.write(...)` and `return 0;` that end the report path) with:
  ```ts
    if (args.sub === 'report') {
      process.stdout.write(args.json ? `${JSON.stringify(report)}\n` : `${renderReport(report)}\n`);
      return 0;
    }

    // An incomplete graph must never be recorded as truth, and never compared
    // as if it were complete.
    if (report.unresolvedInScope.length > 0) {
      process.stderr.write(
        `indirection ${args.sub}: ${report.unresolvedInScope.length} unresolved in-scope ` +
          `import(s) — the measured graph is incomplete\n` +
          report.unresolvedInScope.map((u) => `  ${u}\n`).join(''),
      );
      return 3;
    }

    const options: BaselineOptions = {
      threshold: INDIRECTION_CLOSURE_THRESHOLD,
      scanRoots: scanRoots(cwd),
      includeTests: false,
    };
    const path = join(cwd, BASELINE_FILE);
    const prior = readBaseline(path);

    if (args.sub === 'baseline') {
      // Writes unconditionally: re-recording is the only repair for an
      // unreadable or stale file, so refusing here would be a deadlock. The
      // sibling behaves the same way (clones-cli.ts:158-161).
      const baseline = buildBaseline(report, options, new Date().toISOString());
      writeBaseline(path, baseline);
      const drift =
        prior.kind === 'ok' && prior.baseline.excessSum !== baseline.excessSum
          ? ` (${baseline.excessSum > prior.baseline.excessSum ? 'RAISED' : 'lowered'} from ${prior.baseline.excessSum})`
          : '';
      process.stdout.write(
        args.json
          ? `${JSON.stringify(baseline)}\n`
          : `indirection baseline: recorded excess sum ${baseline.excessSum}${drift} ` +
              `across ${baseline.modulesScanned} module(s) -> ${BASELINE_FILE}\n`,
      );
      return 0;
    }

    if (prior.kind === 'absent') {
      process.stdout.write(
        `indirection check: no baseline recorded (excess sum ${report.excessSum}) - ` +
          `record one with 'noldor indirection baseline'\n`,
      );
      return 0;
    }
    if (prior.kind === 'unreadable') {
      process.stderr.write(
        `indirection check: baseline at ${BASELINE_FILE} is unreadable - ${prior.message}\n` +
          `  re-record with 'noldor indirection baseline'\n`,
      );
      return 3;
    }

    const verdict = compareToBaseline(report, prior.baseline, options);
    const stream = verdict.kind === 'red' ? process.stderr : process.stdout;
    stream.write(`indirection check: ${verdict.message}\n`);
    return verdict.kind === 'red' ? 1 : 0;
  ```

- [ ] **Step 7: Update the CLI's header comment to the full exit matrix.**

  Replace the file's opening docblock with:
  ```ts
  /**
   * `noldor indirection <report|check|baseline> [--json]`
   *
   * Exit contract, per subcommand — 3 stays distinct from 1 for the reason
   * `clones-cli.ts:133` gives: a pre-push consumer acts on the difference
   * between "found something" and "could not look".
   *
   *              report   check   baseline
   *   clean        0        0        0
   *   red          0        1        0   (records, prints direction)
   *   no baseline  0        0        0
   *   stale        0        0        0   (overwrites)
   *   unreadable   0        3        0   (overwrites)
   *   no parser    3        3        3
   *   unresolved   0        3        3
   */
  ```

- [ ] **Step 8: Run the test to verify it PASSES.**

  ```bash
  pnpm vitest run src/indirection
  ```
  Expected output: `Test Files  3 passed (3)`.

- [ ] **Step 9: Typecheck.**

  ```bash
  pnpm typecheck
  ```
  Expected output: no errors (exit 0).

- [ ] **Step 10: Commit.**

  ```bash
  cat > /tmp/indirection-p2t2.txt <<'MSG'
  feat(indirection): add the check and baseline subcommands

  Completes the exit contract: 0 clean, 1 when the excess sum rose, 3 when the
  gate could not look. baseline writes unconditionally, since re-recording is
  the only repair for an unreadable or stale file and refusing would deadlock,
  but both verdict paths refuse on an unresolved in-scope import so an
  incomplete graph is never recorded as truth or compared as if complete. A
  bare specifier that fails to resolve is deliberately not in scope —
  dependency-cruiser reports couldNotResolve for healthy reasons there, and
  treating it as fatal would hard-block pre-push in consumer repos that are fine.

  Noldor-FD: abstraction-cost-ratchet
  MSG
  git add src/indirection
  git commit -F /tmp/indirection-p2t2.txt
  ```

---
## Task 3: Wire the gate and record the baseline

**Files:**
- Modify: `lefthook/noldor.yml`
- Modify: `templates/lefthook/noldor.yml`
- Create: `.noldor/indirection-baseline.json`

- [ ] **Step 1: Add the pre-push job.**

  In `lefthook/noldor.yml`, directly after the `noldor-clones` job, insert (matching the surrounding indentation exactly):
  ```yaml
      - name: noldor-indirection
        run: pnpm noldor indirection check
  ```

- [ ] **Step 2: Mirror it into the template.**

  Apply the identical insertion to `templates/lefthook/noldor.yml`, so consumers receive the gate.

- [ ] **Step 3: Verify template parity.**

  ```bash
  pnpm noldor checks template-sync
  ```
  Expected output: exit 0.

- [ ] **Step 4: Record the initial baseline.**

  Run this only now — the corpus must include this feature's own modules, or the first push would red on code the baseline never saw.
  ```bash
  pnpm noldor indirection baseline
  ```
  Expected output: `indirection baseline: recorded excess sum <N> across <M> module(s) -> .noldor/indirection-baseline.json`, where `<N>` is near 882 (the pre-feature measurement) plus this feature's own modules.

- [ ] **Step 5: Verify the gate is green against its own baseline.**

  ```bash
  pnpm noldor indirection check && pnpm noldor checks push-gates
  ```
  Expected output: `indirection check: indirection excess unchanged at <N>`, then `push-gates` exit 0 with `noldor-indirection` among the jobs it replayed.

- [ ] **Step 6: Commit.**

  ```bash
  cat > /tmp/indirection-t6.txt <<'MSG'
  feat(indirection): wire the pre-push gate and record the baseline

  Adds noldor-indirection beside noldor-clones in both the repo hook config and
  the templated copy, so consumers receive the gate. The baseline is recorded
  last, after this feature's own modules exist, so the first push cannot red on
  code the baseline never measured. checks push-gates replays lefthook itself,
  so the new job is preflighted author-side with no edit to the gate skill.

  Noldor-FD: abstraction-cost-ratchet
  MSG
  git add lefthook/noldor.yml templates/lefthook/noldor.yml .noldor/indirection-baseline.json
  git commit -F /tmp/indirection-t6.txt
  ```

---

## Task 4: Link the FD and close the loop

**Files:**
- Modify: `docs/features/abstraction-cost-ratchet.md`

- [ ] **Step 1: Populate `links.code` and `links.tests`.**

  Set the frontmatter arrays to exactly:
  ```yaml
  links:
    code:
      - src/indirection/detect.ts
      - src/indirection/baseline.ts
      - src/indirection/indirection-cli.ts
      - src/cli/manifest.ts
    tests:
      - src/indirection/__tests__/detect.test.ts
      - src/indirection/__tests__/baseline.test.ts
      - src/indirection/__tests__/indirection-cli.test.ts
    spec: docs/design/specs/2026-08-30-abstraction-cost-ratchet-design.md
  ```

- [ ] **Step 2: Verify the FD.**

  ```bash
  pnpm noldor validate features
  ```
  Expected output: `Validated 85 feature MD(s) — all OK.`

- [ ] **Step 3: Run the full suite once.**

  ```bash
  pnpm typecheck && pnpm test
  ```
  Expected output: no type errors; the whole vitest suite passes.

- [ ] **Step 4: Commit.**

  ```bash
  cat > /tmp/indirection-t7.txt <<'MSG'
  docs(features:abstraction-cost-ratchet): link shipped code and tests

  Populates links.code and links.tests so the sdd-report co-tag detector and the
  garden code-files-without-a-feature check both resolve the new modules.

  Noldor-FD: abstraction-cost-ratchet
  MSG
  git add docs/features/abstraction-cost-ratchet.md
  git commit -F /tmp/indirection-t7.txt
  ```

## Task 5: Drift-direction coverage

Closes acceptance criterion 15 — `check` must name the delta when the number falls, not only when it rises, so re-recording is understood as a ratchet-down move rather than only an unblock move.

**Files:**
- Modify: `src/indirection/__tests__/baseline.test.ts`

- [ ] **Step 1: Add the assertions.**

  Append to `src/indirection/__tests__/baseline.test.ts`:
  ```ts
  describe('drift direction', () => {
    const base = buildBaseline(report(882), opts, '2026-08-30T00:00:00.000Z');

    it('names the rise with a signed delta', () => {
      const v = compareToBaseline(report(951), base, opts);
      expect(v.kind).toBe('red');
      expect(v.message).toContain('882 -> 951');
      expect(v.message).toContain('+69');
    });

    it('names the fall too, rather than passing silently', () => {
      const v = compareToBaseline(report(813), base, opts);
      expect(v.kind).toBe('green');
      expect(v.message).toContain('882 -> 813');
      expect(v.message).toContain('-69');
    });

    it('says so when the number is unchanged', () => {
      expect(compareToBaseline(report(882), base, opts).message).toContain('unchanged');
    });
  });
  ```

- [ ] **Step 2: Run the tests to verify they PASS.**

  ```bash
  pnpm vitest run src/indirection/__tests__/baseline.test.ts
  ```
  Expected output: `Tests  8 passed (8)`.

- [ ] **Step 3: Commit.**

  ```bash
  cat > /tmp/indirection-p2t5.txt <<'MSG'
  test(indirection): assert the drift direction in both directions

  A fall must be reported as loudly as a rise. Reporting only the red half would
  make re-recording read as an unblock move rather than a ratchet-down, which is
  the habit that degrades a ratchet into a rubber stamp.

  Noldor-FD: abstraction-cost-ratchet
  MSG
  git add src/indirection
  git commit -F /tmp/indirection-p2t5.txt
  ```

---
