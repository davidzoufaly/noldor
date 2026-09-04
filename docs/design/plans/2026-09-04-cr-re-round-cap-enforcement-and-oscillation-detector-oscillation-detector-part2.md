# CR Oscillation Detector — Part 2: The Detector, R1 and R3 Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Make `cr orchestrate` say when a finding survived a fix, and when a finding is about a line this series itself wrote. After this part merges, a round prints `[R1] …` and `[R3] …`, and records its blocker ids and signals on the ledger so later rounds can compare.
**Architecture:** One pure module (`src/cr/reflag.ts`) with the three-arm rule contract and the two rules that need no file access, plus the orchestrate wiring that resolves inputs, prints, and persists. R2 lands in Part 3 on the same seam — it is the only rule that has to read code, which is why it waits for the scanner.
**Tech Stack:** TypeScript 7 (native), vitest. No new dependencies. Depends on Part 1 (`locations`, `fingerprintBlocker`, `blockerIds`, `signals`).

---

## File Structure

- `src/cr/reflag.ts` — create: the rule contract, R1 and R3; pure, no I/O, no clock.
- `src/cr/orchestrate.ts` — modify: resolve rule inputs, run rules, print signals, persist `blockerIds` + `signals`.

---

## Task 1: The rule contract and R1

**Files:** Create: `src/cr/reflag.ts` · Test: `src/cr/__tests__/reflag.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/cr/__tests__/reflag.test.ts`:

```ts
// @tests: specs-cr-gate-multi-reviewer
import { describe, expect, it } from 'vitest';

import { ruleR1 } from '../reflag.js';

const blocker = (id: string) => ({ id, severity: 'high' as const, message: 'boom' });

describe('ruleR1', () => {
  it('fires for an id that appeared in a prior round', () => {
    const r = ruleR1([blocker('a'), blocker('b')], [['a', 'z']]);
    expect(r.outcome).toBe('fired');
    if (r.outcome === 'fired') expect(r.signals.map((s) => s.blockerId)).toEqual(['a']);
  });

  // The whole reason a per-blocker id exists: a lone survivor beside an
  // otherwise-changed set has a different SET digest and would never fire.
  it('fires for a lone survivor beside an otherwise-changed set', () => {
    const r = ruleR1([blocker('a'), blocker('new')], [['a', 'gone1', 'gone2']]);
    expect(r.outcome).toBe('fired');
  });

  it('is clear when nothing repeats', () => {
    expect(ruleR1([blocker('x')], [['a', 'b']]).outcome).toBe('clear');
  });

  // An empty array is a real answer — a first round has no history.
  it('is clear on the first round', () => {
    expect(ruleR1([blocker('x')], []).outcome).toBe('clear');
  });

  // undefined is NOT the same as empty: the rule could not run at all.
  it('is omitted when the ledger recorded no ids', () => {
    const r = ruleR1([blocker('x')], undefined);
    expect(r.outcome).toBe('omitted');
    if (r.outcome === 'omitted') expect(r.reason).toMatch(/no recorded blocker ids/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
pnpm vitest run src/cr/__tests__/reflag.test.ts
```

Expected: `Failed to resolve import "../reflag.js"`.

- [ ] **Step 3: Implement.** Create `src/cr/reflag.ts`:

```ts
/**
 * Re-flag rules — why a review loop looks like it is oscillating.
 *
 * Shaped after `src/core/split-suggestion.ts`: exported constants, one function
 * per rule, no I/O, no clock. The caller fetches; this module reasons. That is
 * what makes every rule testable from literals with no fixture repo, and it
 * keeps I/O failure handling out of a module whose whole contract is that it
 * cannot fail.
 *
 * ADVISORY WITH TEETH. A signal never suppresses a finding, never edits a sink,
 * and never moves an exit code. It is reported; the operator decides.
 */
import type { FindingLocation } from './findings-schema.js';

/** A blocker reduced to what the rules need. */
export interface RuleBlocker {
  readonly id: string;
  readonly severity: 'high' | 'med' | 'low';
  readonly message: string;
  readonly locations?: readonly FindingLocation[];
}

/** One reason a blocker looks like a re-flag. */
export interface ReflagSignal {
  readonly rule: 'R1' | 'R2' | 'R3';
  readonly blockerId: string;
  readonly message: string;
}

/**
 * A rule reports one of THREE outcomes, not two.
 *
 * `split-suggestion.ts` emits only fired/clear because its input is always
 * available. Here an input can be missing — a file that would not scan, a range
 * that is not a fast-forward, a git call that failed — and a two-arm shape
 * would encode "could not tell" as silence, which is the one reading a detector
 * must never produce.
 */
export type RuleResult =
  | { readonly outcome: 'fired'; readonly signals: readonly ReflagSignal[] }
  | { readonly outcome: 'clear' }
  | { readonly outcome: 'omitted'; readonly reason: string };

const CLEAR: RuleResult = { outcome: 'clear' };

/** Shared by every rule: no signals is `clear`, never an empty `fired`. */
export function fired(signals: readonly ReflagSignal[]): RuleResult {
  return signals.length > 0 ? { outcome: 'fired', signals } : CLEAR;
}

/**
 * R1 — repeat. A blocker whose id appeared in a prior round.
 *
 * `priorRounds` is one id list per prior round. `undefined` means the ledger
 * recorded no ids (every round written before that field existed), which is
 * `omitted` rather than `clear`: the rule genuinely could not run. An EMPTY
 * array is different and IS clear — a first round has no history, and "nothing
 * repeated because nothing came before" is a real answer.
 */
export function ruleR1(
  blockers: readonly RuleBlocker[],
  priorRounds: readonly (readonly string[])[] | undefined,
): RuleResult {
  if (priorRounds === undefined)
    return { outcome: 'omitted', reason: 'no recorded blocker ids in the ledger' };
  const prior = new Set(priorRounds.flat());
  return fired(
    blockers
      .filter((b) => prior.has(b.id))
      .map((b) => ({
        rule: 'R1' as const,
        blockerId: b.id,
        message: `blocker repeats a prior round — the same finding survived a fix: ${b.message}`,
      })),
  );
}
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
pnpm vitest run src/cr/__tests__/reflag.test.ts && pnpm typecheck
```

Expected: all five cases pass and `pnpm typecheck` exits 0.

- [ ] **Step 5: Commit.**

```bash
cat > /tmp/msg-p2t1.txt <<'EOF'
feat(cr): add the re-flag rule contract and R1

R1 fires when a blocker's per-blocker id reappears in a later round. That id is
what makes the rule decidable at all: `AutofixRound.fingerprint` hashes the
whole blocker SET, so a lone survivor beside an otherwise-changed set produces a
different digest and no signal — a case the tests pin explicitly.

A rule reports fired, clear, or omitted-with-a-reason. `split-suggestion.ts`,
the shape this module mirrors, needs only two arms because its input is always
there; here an input can be missing, and a two-arm shape would encode "could not
tell" as silence, which is the one reading a detector must never produce. The
distinction between an empty prior-round list (clear — a first round) and an
absent one (omitted — the ledger predates the field) is pinned by two tests.

Noldor-FD: cr-re-round-cap-enforcement-and-oscillation-detector
EOF
git add src/cr/reflag.ts src/cr/__tests__/reflag.test.ts
git commit -F /tmp/msg-p2t1.txt
```

---

## Task 2: Resolve rule inputs in orchestrate

**Files:** Modify: `src/cr/orchestrate.ts` · Test: `src/cr/__tests__/orchestrate.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `src/cr/__tests__/orchestrate.test.ts`:

```ts
describe('priorBlockerIds', () => {
  const round = (over: Record<string, unknown> = {}) => ({
    round: 1,
    headSha: 'a',
    fingerprint: 'f',
    applied: 0,
    deferred: 0,
    diffStat: '',
    ...over,
  });

  it('returns one list per round when every round recorded ids', () => {
    expect(priorBlockerIds([round({ blockerIds: ['x'] }), round({ blockerIds: ['y'] })])).toEqual([
      ['x'],
      ['y'],
    ]);
  });

  it('returns an empty array for an empty series', () => {
    expect(priorBlockerIds([])).toEqual([]);
  });

  // A pre-field round means the history is INCOMPLETE, so R1 cannot honestly
  // say a blocker is new — the whole series degrades to `omitted`.
  it('returns undefined when any round predates the field', () => {
    expect(priorBlockerIds([round(), round({ blockerIds: ['y'] })])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
pnpm vitest run src/cr/__tests__/orchestrate.test.ts -t priorBlockerIds
```

Expected: `Module '"../orchestrate.js"' has no exported member 'priorBlockerIds'`.

- [ ] **Step 3: Implement.** In `src/cr/orchestrate.ts`, add beside the other exported helpers (near `capVerdict`):

```ts
/**
 * R1's history input: one blocker-id list per prior round, or `undefined`.
 *
 * `undefined` whenever ANY round in the series predates the `blockerIds` field.
 * Partial history is worse than none here: R1 would report a genuinely repeated
 * blocker as new because the round that first filed it recorded no ids, and a
 * false "clear" from a detector is exactly the reading the three-arm outcome
 * exists to prevent.
 */
export function priorBlockerIds(
  rounds: readonly AutofixRound[],
): readonly (readonly string[])[] | undefined {
  const lists = rounds.map((r) => r.blockerIds);
  return lists.every((l) => l !== undefined) ? (lists as readonly (readonly string[])[]) : undefined;
}
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
pnpm vitest run src/cr/__tests__/orchestrate.test.ts -t priorBlockerIds && pnpm typecheck
```

Expected: all three cases pass and `pnpm typecheck` exits 0.

- [ ] **Step 5: Commit.**

```bash
cat > /tmp/msg-p2t2.txt <<'EOF'
feat(cr): resolve R1's prior-round history from the ledger

`priorBlockerIds` returns one id list per prior round, or undefined when any
round in the series predates the field. Partial history is worse than none: R1
would report a genuinely repeated blocker as new because the round that first
filed it recorded no ids, and a false "clear" from a detector is precisely what
the three-arm outcome exists to prevent.

Noldor-FD: cr-re-round-cap-enforcement-and-oscillation-detector
EOF
git add src/cr/orchestrate.ts src/cr/__tests__/orchestrate.test.ts
git commit -F /tmp/msg-p2t2.txt
```

---

## Task 3: R3 — contradiction

**Files:** Modify: `src/cr/reflag.ts` · Test: `src/cr/__tests__/reflag.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `src/cr/__tests__/reflag.test.ts`:

```ts
describe('ruleR3', () => {
  const b = {
    id: 'a',
    severity: 'high' as const,
    message: 'wrong',
    locations: [{ file: 'src/x.ts', line: 12 }],
  };

  it('fires for a location on an introduced line', () => {
    const r = ruleR3([b], new Map([['src/x.ts', new Set([11, 12, 13])]]));
    expect(r.outcome).toBe('fired');
    if (r.outcome === 'fired') expect(r.signals[0].message).toContain('src/x.ts:12');
  });

  it('is clear for a location on an untouched line', () => {
    expect(ruleR3([b], new Map([['src/x.ts', new Set([40])]])).outcome).toBe('clear');
  });

  it('is clear for a file the range never touched', () => {
    expect(ruleR3([b], new Map()).outcome).toBe('clear');
  });

  // The caller withholds the map when the range is not a fast-forward.
  it('is omitted when the introduced-line map is unavailable', () => {
    const r = ruleR3([b], undefined);
    expect(r.outcome).toBe('omitted');
    if (r.outcome === 'omitted') expect(r.reason).toMatch(/fast-forward|unavailable/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
pnpm vitest run src/cr/__tests__/reflag.test.ts -t ruleR3
```

Expected: `Module '"../reflag.js"' has no exported member 'ruleR3'`.

- [ ] **Step 3: Implement.** Append to `src/cr/reflag.ts`:

```ts
/**
 * R3 — contradiction. A blocker located on a line the series introduced.
 *
 * `introducedByFile` is measured CUMULATIVELY by the caller, from the series'
 * first round's `headSha` to current `HEAD`. A single prior round's range is
 * expressed in that fix's coordinates and every later fix shifts them, so from
 * round 3 on a per-round range both misses and misfires; one cumulative range
 * keeps introduced lines in the same coordinate space as a finding's location.
 *
 * `undefined` means the caller could not produce a trustworthy range — most
 * often because the series is not a fast-forward (a rebase onto a moved
 * `origin/main` puts every upstream-added line inside it). That is `omitted`,
 * never `clear`.
 */
export function ruleR3(
  blockers: readonly RuleBlocker[],
  introducedByFile: ReadonlyMap<string, ReadonlySet<number>> | undefined,
): RuleResult {
  if (introducedByFile === undefined)
    return {
      outcome: 'omitted',
      reason: 'introduced-line range unavailable — the series is not a fast-forward',
    };
  const signals: ReflagSignal[] = [];
  for (const b of blockers) {
    for (const loc of b.locations ?? []) {
      if (loc.line === undefined) continue;
      if (introducedByFile.get(loc.file)?.has(loc.line)) {
        signals.push({
          rule: 'R3',
          blockerId: b.id,
          message: `blocker at ${loc.file}:${loc.line} is about a line this series introduced`,
        });
        break;
      }
    }
  }
  return fired(signals);
}
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
pnpm vitest run src/cr/__tests__/reflag.test.ts && pnpm typecheck
```

Expected: all cases pass and `pnpm typecheck` exits 0.

- [ ] **Step 5: Commit.**

```bash
cat > /tmp/msg-p2t3.txt <<'EOF'
feat(cr): add R3, the contradiction re-flag rule

R3 fires when a blocker is located on a line the series itself introduced — the
shape of a review arguing with the previous round's fix.

Introduced lines are measured cumulatively by the caller, from the series' first
reviewed head to current HEAD. A single prior round's diff range is in that
fix's coordinates and every later fix shifts them, so from round 3 on a
per-round range both misses and misfires; one cumulative range keeps the lines
in the same coordinate space as a finding's location.

An unavailable range is `omitted`, not `clear` — a rebase onto a moved
origin/main makes the cumulative range untrustworthy, and the caller withholds
it there rather than reporting confident nonsense.

Noldor-FD: cr-re-round-cap-enforcement-and-oscillation-detector
EOF
git add src/cr/reflag.ts src/cr/__tests__/reflag.test.ts
git commit -F /tmp/msg-p2t3.txt
```

---

## Task 4: Resolve the introduced-line map

**Files:** Modify: `src/cr/orchestrate.ts` · Test: `src/cr/__tests__/orchestrate.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `src/cr/__tests__/orchestrate.test.ts`:

```ts
describe('resolveIntroducedLines', () => {
  it('returns undefined when the series is not a fast-forward', () => {
    const run = (args: string[]) => {
      if (args[0] === 'merge-base') throw new Error('not an ancestor');
      return '';
    };
    expect(resolveIntroducedLines('/r', 'FIRST', run)).toBeUndefined();
  });

  it('returns undefined with no first head', () => {
    expect(resolveIntroducedLines('/r', '', () => '')).toBeUndefined();
  });

  it('maps added lines per file from a --unified=0 diff', () => {
    const diff = [
      'diff --git a/src/x.ts b/src/x.ts',
      '--- a/src/x.ts',
      '+++ b/src/x.ts',
      '@@ -10,0 +11,2 @@',
      '+added',
      '+added2',
    ].join('\n');
    const run = (args: string[]) => (args[0] === 'merge-base' ? '' : diff);
    const map = resolveIntroducedLines('/r', 'FIRST', run);
    expect([...(map?.get('src/x.ts') ?? [])].sort((a, b) => a - b)).toEqual([11, 12]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
pnpm vitest run src/cr/__tests__/orchestrate.test.ts -t resolveIntroducedLines
```

Expected: `Module '"../orchestrate.js"' has no exported member 'resolveIntroducedLines'`.

- [ ] **Step 3: Implement.** In `src/cr/orchestrate.ts`, beside `priorBlockerIds`:

```ts
/**
 * Lines this series ADDED, per file, in current coordinates — R3's input.
 *
 * The fast-forward guard is the whole reason this returns `undefined` rather
 * than an empty map. The cumulative range is a tree diff and nothing inside it
 * distinguishes this series' commits from anyone else's: an amend-only rewrite
 * is harmless, but a rebase onto a moved `origin/main` puts every upstream-added
 * line inside `firstHeadSha..HEAD`, and R3 would then fire on any location in a
 * file upstream happened to touch. That range does not FAIL, so an error path
 * would never catch it — only the ancestry check does.
 */
export function resolveIntroducedLines(
  cwd: string,
  firstHeadSha: string,
  run: (args: string[]) => string,
): Map<string, Set<number>> | undefined {
  if (firstHeadSha === '') return undefined;
  let diff: string;
  try {
    run(['merge-base', '--is-ancestor', `${firstHeadSha}^`, 'HEAD']);
    diff = run(['diff', '--unified=0', '--diff-filter=d', '-M', `${firstHeadSha}^`, 'HEAD']);
  } catch {
    return undefined;
  }
  const out = new Map<string, Set<number>>();
  let file = '';
  let next = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      file = line.slice('+++ b/'.length);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      next = Number(hunk[1]);
      continue;
    }
    if (file !== '' && line.startsWith('+') && !line.startsWith('+++')) {
      const set = out.get(file) ?? new Set<number>();
      set.add(next);
      out.set(file, set);
      next += 1;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
pnpm vitest run src/cr/__tests__/orchestrate.test.ts -t resolveIntroducedLines && pnpm typecheck
```

Expected: all three cases pass and `pnpm typecheck` exits 0.

- [ ] **Step 5: Commit.**

```bash
cat > /tmp/msg-p2t4.txt <<'EOF'
feat(cr): resolve the cumulative introduced-line map for R3

`resolveIntroducedLines` diffs the series' first reviewed head against HEAD at
`--unified=0` and maps added lines per file, in current coordinates.

It refuses to answer at all unless the range is a fast-forward. The cumulative
range is a tree diff and nothing inside it separates this series' commits from
anyone else's: an amend-only rewrite is harmless, but a rebase onto a moved
origin/main puts every upstream-added line inside it, and R3 would fire on any
location in a file upstream touched. That range does not fail, so no error path
would catch it — only the ancestry check does.

Noldor-FD: cr-re-round-cap-enforcement-and-oscillation-detector
EOF
git add src/cr/orchestrate.ts src/cr/__tests__/orchestrate.test.ts
git commit -F /tmp/msg-p2t4.txt
```

---

## Task 5: Run the rules, print and persist

**Files:** Modify: `src/cr/orchestrate.ts` · Test: `src/cr/__tests__/orchestrate.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `src/cr/__tests__/orchestrate.test.ts`:

```ts
describe('runReflagRules', () => {
  const b = { id: 'a', severity: 'high' as const, message: 'boom' };
  const located = { ...b, locations: [{ file: 'src/x.ts', line: 12 }] };

  it('renders a fired signal and a persisted record', () => {
    const out = runReflagRules([b], [['a']], new Map());
    expect(out.lines).toEqual([expect.stringContaining('[R1]')]);
    expect(out.signals).toEqual([
      { rule: 'R1', blockerId: 'a', message: expect.stringContaining('survived a fix') },
    ]);
  });

  it('renders an omitted rule as a reason, not silence', () => {
    const out = runReflagRules([b], undefined, new Map());
    expect(out.lines).toEqual([expect.stringContaining('[omitted]')]);
    expect(out.signals).toEqual([
      { rule: 'omitted', reason: expect.stringContaining('no recorded blocker ids') },
    ]);
  });

  it('renders nothing when every rule is clear', () => {
    const out = runReflagRules([b], [['other']], new Map());
    expect(out.lines).toEqual([]);
    expect(out.signals).toEqual([]);
  });

  it('renders R1 before R3', () => {
    const out = runReflagRules(
      [located],
      [['a']],
      new Map([['src/x.ts', new Set([12])]]),
    );
    expect(out.lines.map((l) => l.slice(0, 4))).toEqual(['[R1]', '[R3]']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
pnpm vitest run src/cr/__tests__/orchestrate.test.ts -t runReflagRules
```

Expected: `Module '"../orchestrate.js"' has no exported member 'runReflagRules'`.

- [ ] **Step 3: Implement.** In `src/cr/orchestrate.ts`, add beside `priorBlockerIds`:

```ts
/**
 * Run every re-flag rule and render both halves: the lines a human reads and
 * the records the ledger stores.
 *
 * Split out of the round-recording block so the rendering is testable without a
 * dispatch, and so Part 3's R2 slots in here rather than in the middle of
 * `run()`.
 *
 * The rule ORDER in the array below is what fixes the printed order, which the
 * tests pin. R2 is appended between R1 and R3 in Part 3, so the two parameters
 * it needs are added AFTER these — no existing call site changes shape.
 *
 * An `omitted` rule produces BOTH a line and a record. Dropping either would
 * turn "could not tell" back into silence — the failure the three-arm outcome
 * exists to prevent, one layer up.
 */
export function runReflagRules(
  blockers: readonly RuleBlocker[],
  priorRounds: readonly (readonly string[])[] | undefined,
  introducedByFile: ReadonlyMap<string, ReadonlySet<number>> | undefined,
): { lines: string[]; signals: Record<string, unknown>[] } {
  const results = [ruleR1(blockers, priorRounds), ruleR3(blockers, introducedByFile)];
  const lines: string[] = [];
  const signals: Record<string, unknown>[] = [];
  for (const r of results) {
    if (r.outcome === 'fired') {
      for (const s of r.signals) {
        lines.push(`[${s.rule}] ${s.message}`);
        signals.push({ ...s });
      }
    } else if (r.outcome === 'omitted') {
      lines.push(`[omitted] ${r.reason}`);
      signals.push({ rule: 'omitted', reason: r.reason });
    }
  }
  return { lines, signals };
}
```

Add the imports: `ruleR1`, `ruleR3` and `type RuleBlocker` from `./reflag.js`, `fingerprintBlocker` from `./autofix-ledger.js`.

- [ ] **Step 4: Run it and watch it pass.**

```bash
pnpm vitest run src/cr/__tests__/orchestrate.test.ts -t runReflagRules
```

Expected: all four cases pass.

- [ ] **Step 5: Wire it into the round record.** In `run()`, inside the existing `try` block that calls `appendRound`, directly before the `await appendRound(...)` call, add:

```ts
      const ruleBlockers: RuleBlocker[] = filed.map((b) => ({
        id: fingerprintBlocker(b),
        severity: b.severity,
        message: b.message,
        ...(b.locations ? { locations: b.locations } : {}),
      }));
      // The series' FIRST reviewed head, not this round's — R3 measures
      // cumulatively. Falls back to this round's head on an empty ledger, where
      // the range is empty and R3 is correctly clear.
      const firstHead = (ledger?.rounds ?? [])[0]?.headSha ?? headSha;
      const reflag = runReflagRules(
        ruleBlockers,
        priorBlockerIds(ledger?.rounds ?? []),
        resolveIntroducedLines(cwd, firstHead, gitRun),
      );
      for (const line of reflag.lines) console.error(line);
```

Reuse whatever git runner `orchestrate.ts` already holds for `headSha` as `gitRun` rather than adding a second one; if it calls `execFileSync` inline, extract it to a local in this commit.

Then extend the `appendRound` payload with exactly two new fields, leaving every existing field untouched:

```ts
        blockerIds: ruleBlockers.map((b) => b.id).sort(),
        signals: reflag.signals,
```

`console.error`, not `console.log`: the round summary already goes to stderr, and stdout carries the `lanes run:` line the gate parses.

- [ ] **Step 6: Assert the exit code and sinks are untouched.** Append to `src/cr/__tests__/orchestrate.test.ts` a case asserting a round that produces signals returns the same `exitCode` and writes the same sink set as an identical round that produces none. Model it on the file's existing `run()` integration cases and reuse their fixture helpers — do not build a second harness.

- [ ] **Step 7: Run everything.**

```bash
pnpm typecheck && pnpm test && pnpm noldor checks push-gates
```

Expected: typecheck exits 0, the suite is green, `checks push-gates` exits 0.

- [ ] **Step 8: Verify end to end.**

```bash
pnpm noldor cr orchestrate --slug cr-re-round-cap-enforcement-and-oscillation-detector \
  --artifact src/cr/reflag.ts --kind code --lanes reviewer --base-sha origin/main --autonomous
node -e "const j=require('./.noldor/cr/autofix/cr-re-round-cap-enforcement-and-oscillation-detector-code.json');console.log(JSON.stringify(j.rounds.at(-1),null,2))"
```

Expected: the printed round carries a `blockerIds` array and a `signals` array. On a first round `signals` legitimately holds only an `omitted` entry — that is the contract working, not a failure.

- [ ] **Step 9: Commit.**

```bash
cat > /tmp/msg-p2t5.txt <<'EOF'
feat(cr): run the re-flag rules and record their signals on the round

Orchestrate now builds per-blocker ids from the round's filed blockers, resolves
the cumulative introduced-line map, runs R1 and R3, prints what fired, and
persists `blockerIds` and `signals` in the `appendRound` call that already
writes the round verdict. R3's range starts at the SERIES' first reviewed head,
not this round's — a per-round range is in that fix's coordinates and every
later fix shifts them.

Persisting matters because lane sinks are overwritten each round and survive
only in `archive/`: a signal computed at round 2 is otherwise unrecoverable when
the cap fires and the arbitration record needs it.

An omitted rule produces both a printed line and a stored record. Dropping
either would turn "could not tell" back into silence one layer above the rule
contract that exists to prevent exactly that.

Exit codes and sink filenames are unchanged, asserted by a test comparing a
signalling round against an identical silent one.

Noldor-FD: cr-re-round-cap-enforcement-and-oscillation-detector
EOF
git add src/cr/orchestrate.ts src/cr/__tests__/orchestrate.test.ts
git commit -F /tmp/msg-p2t5.txt
```
