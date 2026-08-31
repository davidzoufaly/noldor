# Abstraction-Cost Ratchet Implementation Plan — Part 2: Ratchet on It

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Turn the part-1 diagnostic into a gate. Add the persisted baseline, the `check` and `baseline` subcommands, and the `noldor-indirection` pre-push job shipped to consumers, so the excess sum can only be raised deliberately.

**Architecture:** Adds `baseline.ts` beside the part-1 engine, and widens the existing `indirection` command rather than minting a new one. A knob mismatch is stale-not-red, following `src/clones/baseline.ts:113-116`.

**Tech Stack:** TypeScript 7 (ESM, explicit `.js` specifiers), Zod 3 (`.strict()`), Vitest, `dependency-cruiser` + `@swc/core`, lefthook.

**Depends on:** Part 1 (`docs/design/plans/2026-08-30-abstraction-cost-ratchet-part1.md`) — its engine and CLI must be merged first. In particular `measureIndirection` returns the discriminated `IndirectionResult` union, and everything below consumes its `measured` member.

---

## File Structure

- `src/indirection/baseline.ts` — **create.** Zod schema, `buildBaseline`, `readBaseline`, `writeBaseline`, `compareToBaseline`. Owns `BASELINE_FILE` and `ALGORITHM_VERSION`.
- `src/indirection/indirection-cli.ts` — **modify.** Widen the parser; add the `check` / `baseline` verdict paths.
- `src/indirection/__tests__/baseline.test.ts` — **create.** Schema round-trip, comparability, drift direction.
- `src/indirection/__tests__/indirection-cli.test.ts` — **modify.** The full exit-code matrix.
- `src/cli/manifest.ts`, `docs/noldor/script-catalog.md` — **modify.** Widen both descs from `report` to `<report|check|baseline>`.
- `.noldor/rules/abstraction-cost.md`, `templates/.noldor/rules/abstraction-cost.md` — **create.** The `enforce` rule and its byte-identical twin; `check-template-sync` holds parity.
- `lefthook/noldor.yml`, `templates/lefthook/noldor.yml` — **modify.** `noldor-indirection` pre-push job beside `noldor-clones`.
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
  import type { MeasuredIndirection } from '../detect.js';

  const measured = (excessSum: number): MeasuredIndirection => ({
    kind: 'measured',
    threshold: 30,
    excessSum,
    modules: [],
    flagged: [],
    percentiles: { p50: 1, p75: 2, p90: 3, p99: 4, max: 5 },
    unresolvedInScope: [],
  });

  const opts = { threshold: 30, scanRoots: ['src'], includeTests: false };
  const AT = '2026-08-30T00:00:00.000Z';

  const inTmp = (fn: (dir: string) => void): void => {
    const dir = mkdtempSync(join(tmpdir(), 'indirection-'));
    try {
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  describe('baseline persistence', () => {
    it('round-trips through the schema', () => {
      inTmp((dir) => {
        const path = join(dir, 'baseline.json');
        writeBaseline(path, buildBaseline(measured(882), opts, AT));
        const back = readBaseline(path);
        expect(back.kind).toBe('ok');
        if (back.kind !== 'ok') return;
        expect(back.baseline.excessSum).toBe(882);
        expect(back.baseline.algorithmVersion).toBe(ALGORITHM_VERSION);
        expect(back.baseline.percentiles).toEqual({ p50: 1, p75: 2, p90: 3, p99: 4, max: 5 });
      });
    });

    it('is absent — not unreadable — when the file does not exist', () => {
      expect(readBaseline(join(tmpdir(), 'nope-indirection-baseline.json')).kind).toBe('absent');
    });

    it('is unreadable when the file is malformed', () => {
      inTmp((dir) => {
        const path = join(dir, 'baseline.json');
        writeBaseline(path, buildBaseline(measured(1), opts, AT));
        require('node:fs').writeFileSync(path, '{ not json');
        expect(readBaseline(path).kind).toBe('unreadable');
      });
    });

    it('rejects an unknown key rather than accepting it silently', () => {
      inTmp((dir) => {
        const path = join(dir, 'baseline.json');
        const good = buildBaseline(measured(5), opts, AT);
        require('node:fs').writeFileSync(path, JSON.stringify({ ...good, surprise: 1 }));
        expect(readBaseline(path).kind).toBe('unreadable');
      });
    });
  });

  describe('compareToBaseline', () => {
    const base = buildBaseline(measured(882), opts, AT);

    it('reds only when the number rose, and names the signed delta', () => {
      const v = compareToBaseline(measured(951), base, opts);
      expect(v.kind).toBe('red');
      expect(v.message).toContain('882 -> 951');
      expect(v.message).toContain('+69');
    });

    it('names a fall too, rather than passing silently', () => {
      const v = compareToBaseline(measured(813), base, opts);
      expect(v.kind).toBe('green');
      expect(v.message).toContain('882 -> 813');
      expect(v.message).toContain('-69');
    });

    it('says so when the number is unchanged', () => {
      const v = compareToBaseline(measured(882), base, opts);
      expect(v.kind).toBe('green');
      expect(v.message).toContain('unchanged');
    });

    it('is stale, never red, when a consumer-owned knob differs', () => {
      const v = compareToBaseline(measured(9999), base, { ...opts, scanRoots: ['packages'] });
      expect(v.kind).toBe('stale');
    });

    it('is stale when the threshold differs', () => {
      expect(compareToBaseline(measured(9999), base, { ...opts, threshold: 40 }).kind).toBe('stale');
    });

    it('is stale when the algorithm version differs', () => {
      const older = { ...base, algorithmVersion: ALGORITHM_VERSION + 1 };
      expect(compareToBaseline(measured(9999), older, opts).kind).toBe('stale');
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it FAILS.**

  ```bash
  pnpm vitest run src/indirection/__tests__/baseline.test.ts
  ```
  Expected output: failure with `Failed to resolve import "../baseline.js"`.

- [ ] **Step 3: Export the measured-member alias from the engine.**

  Add to `src/indirection/detect.ts`, below the `IndirectionResult` union:
  ```ts
  /** The success member, for callers that have already narrowed the union. */
  export type MeasuredIndirection = Extract<IndirectionResult, { kind: 'measured' }>;
  ```

- [ ] **Step 4: Implement the baseline module.**

  `src/indirection/baseline.ts`:
  ```ts
  /**
   * Whole-corpus indirection ratchet. `.noldor/indirection-baseline.json`
   * records the excess sum a repo already carries; `indirection check` then
   * reds only when that number GROWS.
   *
   * A knob mismatch is `stale` — reported, never red — following
   * `src/clones/baseline.ts:113-116`. `scanRoots` and `includeTests` are
   * consumer-owned, so reding on a mismatch would hard-block every push in a
   * repo that merely edited `scanPaths`, and no framework migration can ship
   * for a knob the framework does not own.
   */
  import { mkdirSync } from 'node:fs';
  import { dirname } from 'node:path';

  import { z } from 'zod';

  import { atomicWriteFileSync } from '../core/atomic-write.js';
  import { readJsonState } from '../core/state-file.js';
  import type { MeasuredIndirection } from './detect.js';

  /** Baseline location, relative to the repo root. Tracked, not transient. */
  export const BASELINE_FILE = '.noldor/indirection-baseline.json';

  /**
   * Bumped whenever the closure traversal changes. `options` alone cannot catch
   * a change in how the number is COMPUTED — a fix to alias handling moves
   * every closure without moving a knob — and silently comparing across that
   * boundary is worse than reporting stale.
   */
  export const ALGORITHM_VERSION = 1;

  const count = z.number().int().nonnegative();

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
      excessSum: count,
      /** Recorded for the human reading the file; never compared. */
      flaggedModules: count,
      modulesScanned: count,
      percentiles: z
        .object({ p50: count, p75: count, p90: count, p99: count, max: count })
        .strict(),
      options: baselineOptionsSchema,
      algorithmVersion: z.number().int().positive(),
      recordedAt: z.string().min(1),
    })
    .strict();
  export type IndirectionBaseline = z.infer<typeof indirectionBaselineSchema>;

  export function buildBaseline(
    result: MeasuredIndirection,
    options: BaselineOptions,
    recordedAt: string,
  ): IndirectionBaseline {
    return {
      excessSum: result.excessSum,
      flaggedModules: result.flagged.length,
      modulesScanned: result.modules.length,
      percentiles: result.percentiles,
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
      // readJsonState throws StateFileCorruptError on unparseable content; the
      // file is an external boundary, so convert rather than propagate.
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
    result: MeasuredIndirection,
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
    const delta = result.excessSum - baseline.excessSum;
    if (delta > 0) {
      return {
        kind: 'red',
        message:
          `indirection excess rose ${baseline.excessSum} -> ${result.excessSum} (+${delta}) ` +
          `above the baseline recorded ${baseline.recordedAt}`,
      };
    }
    return {
      kind: 'green',
      message:
        delta === 0
          ? `indirection excess unchanged at ${result.excessSum}`
          : `indirection excess fell ${baseline.excessSum} -> ${result.excessSum} (${delta})`,
    };
  }
  ```

- [ ] **Step 5: Run the test to verify it PASSES.**

  ```bash
  pnpm vitest run src/indirection/__tests__/baseline.test.ts
  ```
  Expected output: `Tests  10 passed (10)`.

- [ ] **Step 6: Commit.**

  ```bash
  cat > /tmp/indirection-p2t1.txt <<'MSG'
  feat(indirection): add the persisted ratchet baseline

  Records the excess sum at .noldor/indirection-baseline.json behind a strict
  Zod schema, so check reds only when the number grows. A knob or
  algorithmVersion mismatch is reported stale and never red, following
  src/clones/baseline.ts: scanRoots and includeTests are consumer-owned, so
  reding would hard-block every push in a repo that only edited scanPaths, with
  no framework migration possible for a knob the framework does not own.
  algorithmVersion exists because options alone cannot catch a change in how the
  closure is computed. A fall is reported as loudly as a rise, so re-recording
  reads as a ratchet-down move rather than only an unblock.

  Noldor-FD: abstraction-cost-ratchet
  MSG
  git add src/indirection
  git commit -F /tmp/indirection-p2t1.txt
  ```

---

## Task 2: `check` and `baseline` subcommands

**Files:**
- Modify: `src/indirection/indirection-cli.ts`
- Modify: `src/indirection/__tests__/indirection-cli.test.ts`

- [ ] **Step 1: Extend the CLI test with the exit-code matrix.**

  Append to `src/indirection/__tests__/indirection-cli.test.ts`, adding `mkdirSync`, `mkdtempSync`, `readFileSync`, `rmSync`, `writeFileSync` to the `node:fs` imports and `tmpdir` from `node:os`:
  ```ts
  const withTree = async (fn: (dir: string) => Promise<void>): Promise<void> => {
    const dir = mkdtempSync(join(tmpdir(), 'indirection-cli-'));
    try {
      writeFileSync(join(dir, 'a.ts'), "import { b } from './b.js';\nexport const a = b;\n");
      writeFileSync(join(dir, 'b.ts'), 'export const b = 1;\n');
      // scanRoots -> loadConsumerConfig THROWS without this file; a bare
      // mkdtemp dir makes every runIndirection call reject rather than return.
      mkdirSync(join(dir, '.noldor'), { recursive: true });
      writeFileSync(
        join(dir, '.noldor', 'config.json'),
        JSON.stringify({
          consumer: {
            name: 'fixture',
            repoUrl: 'https://example.invalid/fixture',
            lockstepPackages: ['package.json'],
            scanPaths: ['.'],
            e2ePrefix: 'fixture',
            samplesPath: 'samples',
            packagePrefix: '@fixture/',
            appPathPrefix: 'apps/',
          },
        }),
      );
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  /** A tree deep enough to carry excess at threshold 30: 32 chained modules. */
  const withDeepTree = async (fn: (dir: string) => Promise<void>): Promise<void> => {
    const dir = mkdtempSync(join(tmpdir(), 'indirection-deep-'));
    try {
      for (let i = 0; i < 32; i++) {
        const next = i === 31 ? null : `./m${i + 1}.js`;
        writeFileSync(
          join(dir, `m${i}.ts`),
          next === null
            ? `export const m${i} = ${i};\n`
            : `import { m${i + 1} } from '${next}';\nexport const m${i} = m${i + 1};\n`,
        );
      }
      mkdirSync(join(dir, '.noldor'), { recursive: true });
      writeFileSync(
        join(dir, '.noldor', 'config.json'),
        JSON.stringify({
          consumer: {
            name: 'fixture',
            repoUrl: 'https://example.invalid/fixture',
            lockstepPackages: ['package.json'],
            scanPaths: ['.'],
            e2ePrefix: 'fixture',
            samplesPath: 'samples',
            packagePrefix: '@fixture/',
            appPathPrefix: 'apps/',
          },
        }),
      );
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  const baselinePath = (dir: string): string => join(dir, '.noldor', 'indirection-baseline.json');

  describe('runIndirection check and baseline', () => {
    it('check exits 0 and says so when no baseline is recorded', async () => {
      await withTree(async (dir) => {
        const { code, out } = await capture(() => runIndirection(['check'], dir));
        expect(code).toBe(0);
        expect(out).toContain('no baseline recorded');
      });
    });

    it('check exits 0 when unchanged', async () => {
      await withTree(async (dir) => {
        expect(await runIndirection(['baseline'], dir)).toBe(0);
        expect(await runIndirection(['check'], dir)).toBe(0);
      });
    });

    it('check exits 1 when the measured excess exceeds the recorded one', async () => {
      // Needs a corpus that actually carries excess at threshold 30, so the
      // fixture is a 32-deep chain rather than the 2-file tree above.
      await withDeepTree(async (dir) => {
        expect(await runIndirection(['baseline'], dir)).toBe(0);
        expect(await runIndirection(['check'], dir)).toBe(0);
        const rec = JSON.parse(readFileSync(baselinePath(dir), 'utf8')) as { excessSum: number };
        expect(rec.excessSum).toBeGreaterThan(0);
        // Lower the recorded number, same knobs — the next check must red.
        writeFileSync(baselinePath(dir), JSON.stringify({ ...rec, excessSum: rec.excessSum - 1 }));
        const { code, out } = await capture(() => runIndirection(['check'], dir));
        expect(code).toBe(1);
        expect(out).toBe(''); // a red goes to stderr, not stdout
      });
    });

    it('check exits 3 on an unreadable baseline; baseline overwrites it and exits 0', async () => {
      await withTree(async (dir) => {
        expect(await runIndirection(['baseline'], dir)).toBe(0);
        writeFileSync(baselinePath(dir), '{ not json');
        expect(await runIndirection(['check'], dir)).toBe(3);
        expect(await runIndirection(['baseline'], dir)).toBe(0);
        expect(await runIndirection(['check'], dir)).toBe(0);
      });
    });

    it('check exits 0 and reports stale when the recorded knobs differ', async () => {
      await withTree(async (dir) => {
        expect(await runIndirection(['baseline'], dir)).toBe(0);
        const rec = JSON.parse(readFileSync(baselinePath(dir), 'utf8')) as {
          options: { threshold: number };
        };
        rec.options.threshold += 5;
        writeFileSync(baselinePath(dir), JSON.stringify(rec));
        const { code, out } = await capture(() => runIndirection(['check'], dir));
        expect(code).toBe(0);
        expect(out).toContain('not comparable');
      });
    });

    it('baseline names the direction on a re-record', async () => {
      await withTree(async (dir) => {
        expect(await runIndirection(['baseline'], dir)).toBe(0);
        const rec = JSON.parse(readFileSync(baselinePath(dir), 'utf8')) as { excessSum: number };
        writeFileSync(baselinePath(dir), JSON.stringify({ ...rec, excessSum: rec.excessSum + 50 }));
        const { out } = await capture(() => runIndirection(['baseline'], dir));
        expect(out).toContain('lowered from');
      });
    });

    it('check and baseline exit 3 on an unresolved in-scope import; report still exits 0', async () => {
      const dir = treeDir('unresolved');
      expect(await runIndirection(['check'], dir)).toBe(3);
      expect(await runIndirection(['baseline'], dir)).toBe(3);
      expect(await runIndirection(['report'], dir)).toBe(0);
    });

    it('accepts the three subcommands', () => {
      for (const sub of ['report', 'check', 'baseline'] as const) {
        expect(parseIndirectionArgs([sub]).sub).toBe(sub);
      }
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it FAILS.**

  ```bash
  pnpm vitest run src/indirection/__tests__/indirection-cli.test.ts
  ```
  Expected output: failures on the new cases — the parser throws `usage: noldor indirection report [--json]` for `check` and `baseline`.

- [ ] **Step 3: Widen the arg parser.**

  In `src/indirection/indirection-cli.ts`, replace `IndirectionArgs` and `parseIndirectionArgs`:
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

- [ ] **Step 4: Add the baseline imports.**

  Below the existing `./detect.js` imports in `src/indirection/indirection-cli.ts`:
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
  and add `INDIRECTION_CLOSURE_THRESHOLD` to the `./detect.js` value import, plus `join` from `node:path` if part 1 left it unused.

- [ ] **Step 5: Add the two verdict paths.**

  In `runIndirection`, replace the final two lines (the `process.stdout.write(...)` and its `return 0;`) with:
  ```ts
    if (args.sub === 'report') {
      process.stdout.write(args.json ? `${JSON.stringify(result)}\n` : `${renderReport(result)}\n`);
      return 0;
    }

    // An empty corpus has nothing to ratchet and nothing to record.
    if (result.kind === 'empty') {
      process.stdout.write('indirection: no source files under the scan roots\n');
      return 0;
    }

    // An incomplete graph must never be recorded as truth, nor compared as if
    // it were complete.
    if (result.unresolvedInScope.length > 0) {
      process.stderr.write(
        `indirection ${args.sub}: ${result.unresolvedInScope.length} unresolved in-scope ` +
          `import(s) — the measured graph is incomplete\n` +
          result.unresolvedInScope.map((u) => `  ${u}\n`).join(''),
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
      // unreadable or stale file, so refusing here would deadlock. The sibling
      // behaves the same way (clones-cli.ts:158-161).
      const baseline = buildBaseline(result, options, new Date().toISOString());
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
        `indirection check: no baseline recorded (excess sum ${result.excessSum}) - ` +
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

    const verdict = compareToBaseline(result, prior.baseline, options);
    const stream = verdict.kind === 'red' ? process.stderr : process.stdout;
    stream.write(`indirection check: ${verdict.message}\n`);
    return verdict.kind === 'red' ? 1 : 0;
  ```

- [ ] **Step 6: Update the CLI's header comment to the full exit matrix.**

  Replace the file's opening docblock:
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

- [ ] **Step 7: Run the tests to verify they PASS.**

  ```bash
  pnpm vitest run src/indirection && pnpm typecheck
  ```
  Expected output: `Test Files  3 passed (3)`; no type errors.

- [ ] **Step 8: Commit.**

  ```bash
  cat > /tmp/indirection-p2t2.txt <<'MSG'
  feat(indirection): add the check and baseline subcommands

  Completes the exit contract: 0 clean, 1 when the excess sum rose, 3 when the
  gate could not look. baseline writes unconditionally, since re-recording is
  the only repair for an unreadable or stale file and refusing would deadlock,
  but both verdict paths refuse on an unresolved in-scope import so an
  incomplete graph is never recorded as truth or compared as if complete. A bare
  specifier that fails to resolve is deliberately not in scope —
  dependency-cruiser reports couldNotResolve for healthy reasons there, and
  treating it as fatal would hard-block pre-push in consumer repos that are fine.

  Noldor-FD: abstraction-cost-ratchet
  MSG
  git add src/indirection
  git commit -F /tmp/indirection-p2t2.txt
  ```

---

## Task 3: Widen the advertised surface

Part 1 deliberately advertised `report` only, because that is all it accepted. Both subcommands now exist, so the manifest, the catalog and the rule catch up.

**Files:**
- Modify: `src/cli/manifest.ts`, `docs/noldor/script-catalog.md`
- Modify: `.noldor/rules/abstraction-cost.md`, `templates/.noldor/rules/abstraction-cost.md`

- [ ] **Step 1: Widen the manifest desc.**

  In `src/cli/manifest.ts`, in the `indirection` leaf: change `desc: 'indirection report [--json]'` to `desc: 'indirection <report|check|baseline> [--json]'`, and the parent `desc` to `'Transitive-import-closure indirection ratchet'`.

- [ ] **Step 2: Widen the catalog row.**

  In `docs/noldor/script-catalog.md`, change the `pnpm noldor indirection` row's description to `` `indirection <report\|check\|baseline>` transitive-closure indirection ratchet (`--json`). ``

- [ ] **Step 3: Verify the catalog gate.**

  ```bash
  pnpm noldor validate script-catalog
  ```
  Expected output: exit 0. The rule itself lands in Task 3b below.

- [ ] **Step 5: Commit, then check template parity.**

  ```bash
  cat > /tmp/indirection-p2t3.txt <<'MSG'
  docs(indirection): advertise check and baseline now that they exist

  Part 1 named report only, because advertising a subcommand the parser refuses
  would have put a lie in the catalog until this part landed.

  Noldor-FD: abstraction-cost-ratchet
  MSG
  git add src/cli/manifest.ts docs/noldor/script-catalog.md .noldor/rules templates/.noldor/rules
  git commit -F /tmp/indirection-p2t3.txt
  pnpm noldor checks template-sync .noldor/rules/abstraction-cost.md templates/.noldor/rules/abstraction-cost.md
  ```
  Expected output: `template-sync` exits 0. Run it **after** the commit and with both paths as argv — `resolveChangedFiles` (`check-template-sync.ts:57-77`) falls back to `git diff --name-only origin/main..HEAD` when argv is empty, so a bare run over uncommitted files exits 0 vacuously.

---

## Task 3b: The `abstraction-cost` rule

**Files:**
- Create: `.noldor/rules/abstraction-cost.md`
- Create: `templates/.noldor/rules/abstraction-cost.md`

- [ ] **Step 1: Write the rule.**

  `.noldor/rules/abstraction-cost.md`:
  ```markdown
  ---
  id: abstraction-cost
  applies-to: ["src/**/*.{ts,tsx,js,jsx}"]
  stage: [code]
  enforce: true
  links: [docs/noldor/rules.md]
  ---
  Abstraction is priced by file boundaries. Inside one file it is nearly free; across
  files it costs the reader a fetch and an agent a round trip on every crossing. A long
  file of small local helpers is cheap; four files that must be opened in sequence to
  follow one call are not.

  Three reasons to abstract, and if none applies, inline it:

  1. **Hide complexity** behind an interface a caller genuinely should not see.
  2. **Name a thing** — but only where the call site cannot already read the name off the
     expression. `const MAX = 3` used once names nothing the literal did not.
  3. **Reuse** from the third call site, not the second. Two similar lines are fine.

  Anti-patterns this rule names:

  - The single-use constant whose name says no more than its value.
  - The single-consumer translation layer that only renames what it forwards.
  - The factory wrapping a value the type system already constrains.

  Barrel re-exports are deliberately not on that list: a `src/index.ts` style public
  surface legitimately re-exports, and a blanket clause would turn a repo convention into
  a reviewer blocker.

  The glob covers the extensions the mechanical counterpart measures. It cannot cover the
  same roots — rule globs are repo-relative and resolved at rule-resolution time, while
  scan roots come from consumer config at run time — so a consumer whose code lives
  outside `src/` widens this glob in its own copy.
  ```

  `links` points at `docs/noldor/rules.md`, matching every other rule in the store; a rule that links nothing reads as an oversight.

  Append one more paragraph, now that `check` exists:
  ```markdown

  The mechanical counterpart is `pnpm noldor indirection check`, which ratchets the total
  transitive-import-closure excess across the corpus. This rule covers what the counter
  cannot see: whether a given crossing was worth it.
  ```

  The glob stays `src/**`, which under-reaches a consumer whose code lives elsewhere. That is accepted rather than solved: rule globs are repo-relative and resolved at rule-resolution time, while scan roots come from consumer config at run time, so the framework cannot write a glob for a layout it does not know at template time. Under-reaching costs a consumer advice, not enforcement — the ratchet still measures every scan root.

- [ ] **Step 2: Create the byte-identical template twin.**

  ```bash
  cp .noldor/rules/abstraction-cost.md templates/.noldor/rules/abstraction-cost.md
  ```

- [ ] **Step 3: Verify the rule store.**

  ```bash
  pnpm noldor rules validate
  ```
  Expected output: exit 0, no per-rule errors.

- [ ] **Step 4: Verify the rule resolves into the enforce bucket for both extensions.**

  ```bash
  pnpm noldor rules resolve --file src/indirection/detect.ts --stage code
  pnpm noldor rules resolve --file src/dashboard/App.tsx --stage code
  ```
  Expected output: both print JSON whose `enforce` array contains an entry with `"id": "abstraction-cost"`.

- [ ] **Step 5: Commit.**

  ```bash
  cat > /tmp/indirection-t5.txt <<'MSG'
  feat(rules): add the abstraction-cost enforce rule

  States the delta over the baseline principles, which already own YAGNI and the
  DRY-threshold-of-three: that abstraction is priced by file boundaries, and the
  three reasons that justify paying. The naming clause is deliberately narrow,
  since "name a thing" read broadly would justify every single-use constant,
  which is the first anti-pattern the same rule names. Barrel re-exports are not
  listed: src/index.ts style public surfaces legitimately re-export, and a
  blanket clause would turn a repo convention into a reviewer blocker.

  Noldor-FD: abstraction-cost-ratchet
  MSG
  git add .noldor/rules/abstraction-cost.md templates/.noldor/rules/abstraction-cost.md
  git commit -F /tmp/indirection-t5.txt
  ```

- [ ] **Step 6: Verify template parity — after the commit, not before.**

  ```bash
  pnpm noldor checks template-sync .noldor/rules/abstraction-cost.md templates/.noldor/rules/abstraction-cost.md
  ```
  Expected output: exit 0. Run this **after** Step 5 and with both paths as argv: `resolveChangedFiles` (`src/checks/check-template-sync.ts:57-77`) falls back to `git diff --name-only origin/main..HEAD` when argv is empty, so an untracked pair is invisible to it and a bare pre-commit run would exit 0 vacuously.

---


## Task 4: Wire the gate and record the baseline

**Files:**
- Modify: `lefthook/noldor.yml`, `templates/lefthook/noldor.yml`
- Create: `.noldor/indirection-baseline.json`

- [ ] **Step 1: Add the pre-push job.**

  In `lefthook/noldor.yml`, directly after the `noldor-clones` job (`lefthook/noldor.yml:124`), insert at the same indentation:
  ```yaml
      - name: noldor-indirection
        run: pnpm noldor indirection check
  ```

- [ ] **Step 2: Mirror it into the template.**

  Apply the identical insertion to `templates/lefthook/noldor.yml`, so consumers receive the gate.

- [ ] **Step 3: Record the initial baseline.**

  Run this only now — the corpus must include this feature's own modules, or the first push would red on code the baseline never measured.
  ```bash
  pnpm noldor indirection baseline
  ```
  Expected output: `indirection baseline: recorded excess sum <N> across <M> module(s) -> .noldor/indirection-baseline.json`. `<N>` should be at or slightly above 882, the pre-feature measurement; a number near zero means the scan roots resolved wrongly and the baseline must not be committed.

- [ ] **Step 4: Verify the gate is green against its own baseline.**

  ```bash
  pnpm noldor indirection check
  ```
  Expected output: `indirection check: indirection excess unchanged at <N>`, exit 0.

- [ ] **Step 5: Commit, then replay the push gates.**

  ```bash
  cat > /tmp/indirection-p2t4.txt <<'MSG'
  feat(indirection): wire the pre-push gate and record the baseline

  Adds noldor-indirection beside noldor-clones in both the repo hook config and
  the templated copy, so consumers receive the gate. The baseline is recorded
  last, after this feature's own modules exist, so the first push cannot red on
  code the baseline never measured.

  Noldor-FD: abstraction-cost-ratchet
  MSG
  git add lefthook/noldor.yml templates/lefthook/noldor.yml .noldor/indirection-baseline.json
  git commit -F /tmp/indirection-p2t4.txt
  pnpm noldor checks push-gates
  ```
  Expected output: `push-gates` exits 0, with `noldor-indirection` among the jobs it replayed. It replays lefthook itself, so a job added to `lefthook/noldor.yml` is preflighted with no further edit.

---

## Task 5: Link the FD and run the quality gate

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

- [ ] **Step 3: Run the composite verification.**

  ```bash
  pnpm verify
  ```
  Expected output: exit 0 — the repo's single composite gate (`lint && fmt:check && typecheck && test && triage validate --strict-refs`). If `fmt:check` reports drift, run `pnpm fmt` and amend the offending commit rather than adding a formatting-only commit.

- [ ] **Step 4: Confirm the ratchet sees its own feature.**

  ```bash
  pnpm noldor indirection report | head -12
  ```
  Expected output: the excess sum and percentile line, with `src/indirection/indirection-cli.ts` present in the module set. It may or may not be flagged; what matters is that the feature's own modules are measured rather than silently excluded.

- [ ] **Step 5: Commit.**

  ```bash
  cat > /tmp/indirection-p2t5.txt <<'MSG'
  docs(features:abstraction-cost-ratchet): link shipped code and tests

  Populates links.code and links.tests so the sdd-report co-tag detector and the
  garden code-files-without-a-feature check both resolve the new modules.

  Noldor-FD: abstraction-cost-ratchet
  MSG
  git add docs/features/abstraction-cost-ratchet.md
  git commit -F /tmp/indirection-p2t5.txt
  ```
