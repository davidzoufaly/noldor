# CR Oscillation Detector — Part 1: Locatable Findings Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Make a reviewer finding say *where* it is. After this part merges, a `.noldor/cr/<slug>-<kind>-reviewer.json` sink carries a `locations` array per finding, and the round ledger carries a stable id per blocker — the two inputs every later part reads.
**Architecture:** One new pure module (`src/cr/locations.ts`) plus additive schema fields. Nothing changes an exit code, a sink filename, or an existing digest. The reviewer lane gains a changed-file set for every artifact kind, which is both the confinement boundary and the basename resolver.
**Tech Stack:** TypeScript 7 (native), zod 3, vitest, node:crypto. No new dependencies.

---

## File Structure

- `src/cr/findings-schema.ts` — modify: optional `locations` array on `findingSchema`.
- `src/cr/locations.ts` — create: `extractLocations(message, changedFiles)`; pure, no fs, no git.
- `src/cr/autofix-ledger.ts` — modify: `fingerprintBlocker` for a single finding; optional `blockerIds` and `signals` on `autofixRoundSchema`.
- `src/cr/lanes/subagent.ts` — modify: discover the changed set for every kind; attach `locations` in `mkFinding`.
- `src/cr/lanes/subagent-dispatch.ts` — modify: prompt asks each Critical/Important bullet to name file and line.

---

## Task 1: Per-blocker fingerprint

**Files:** Modify: `src/cr/autofix-ledger.ts` · Test: `src/cr/__tests__/autofix-ledger.test.ts`

- [x] **Step 1: Write the failing test.** Append to `src/cr/__tests__/autofix-ledger.test.ts`, and add `fingerprintBlocker` to the existing import block from `../autofix-ledger.js`:

```ts
describe('fingerprintBlocker', () => {
  const mk = (over: Partial<Finding> = {}): Finding => ({
    severity: 'high',
    file: 'a.md',
    message: 'boom',
    ...over,
  });

  it('is stable for the same finding', () => {
    expect(fingerprintBlocker(mk())).toBe(fingerprintBlocker(mk()));
  });

  it('distinguishes severity, file and message', () => {
    expect(fingerprintBlocker(mk())).not.toBe(fingerprintBlocker(mk({ severity: 'med' })));
    expect(fingerprintBlocker(mk())).not.toBe(fingerprintBlocker(mk({ file: 'b.md' })));
    expect(fingerprintBlocker(mk())).not.toBe(fingerprintBlocker(mk({ message: 'bang' })));
  });

  it('ignores line, matching the set-level digest', () => {
    expect(fingerprintBlocker(mk())).toBe(fingerprintBlocker(mk({ line: 42 })));
  });

  // A plain `severity|file|message` join lets a `|` inside one field masquerade
  // as the delimiter, so two different findings encode identically.
  it('is unambiguous when a field contains the join character', () => {
    const a = mk({ file: 'a|b.md', message: 'c' });
    const b = mk({ file: 'a', message: 'b.md|c' });
    expect(fingerprintBlocker(a)).not.toBe(fingerprintBlocker(b));
  });
});
```

`Finding` is already imported as a type in that file; if not, add `import type { Finding } from '../findings-schema.js';`.

- [x] **Step 2: Run it and watch it fail.**

```bash
pnpm vitest run src/cr/__tests__/autofix-ledger.test.ts -t fingerprintBlocker
```

Expected: the file fails to resolve — `No "fingerprintBlocker" export is defined on the "../autofix-ledger.js" mock` or a TypeScript error `Module '"../autofix-ledger.js"' has no exported member 'fingerprintBlocker'`.

- [x] **Step 3: Implement.** In `src/cr/autofix-ledger.ts`, directly above the existing `fingerprintBlockers`, add:

```ts
/**
 * Stable id for a SINGLE blocker — what R1 compares, what a signal points at,
 * and what an arbitration disposition keys on.
 *
 * Length-prefixed rather than `|`-joined: a message may itself contain `|`, so
 * a plain join lets two different findings encode identically. (The set-level
 * {@link fingerprintBlockers} below has the same latent ambiguity and is left
 * alone deliberately — changing it would invalidate every digest already
 * written to a ledger.)
 *
 * `line` is excluded for the same reason it is excluded there: an unrelated
 * edit elsewhere in the file shifts it, and an unfixed blocker must not
 * fingerprint as progress.
 *
 * The id identifies a LOGICAL finding, so the same blocker filed by two lanes
 * shares one. That is intended: the operator arbitrates the finding once, not
 * once per lane.
 */
export function fingerprintBlocker(b: Finding): string {
  const parts = [b.severity, b.file, b.message];
  const encoded = parts.map((p) => `${p.length}:${p}`).join('');
  return createHash('sha1').update(encoded).digest('hex');
}
```

- [x] **Step 4: Run it and watch it pass.**

```bash
pnpm vitest run src/cr/__tests__/autofix-ledger.test.ts
```

Expected: all tests in the file pass, including the four new `fingerprintBlocker` cases. The existing `fingerprintBlockers` describe block must still pass unchanged — that is the regression guard on leaving it alone.

- [x] **Step 5: Commit.**

```bash
cat > /tmp/msg-p1t1.txt <<'EOF'
feat(cr): add fingerprintBlocker for single-finding identity

Why — The re-flag detector's R1 rule needs to say "this blocker came back",
but the only digest available is `fingerprintBlockers`, which hashes the whole
blocker SET. Set equality cannot name which finding survived, and a lone
survivor beside an otherwise-changed set produces a different digest and no
signal at all.

How — A sibling `fingerprintBlocker(b)` hashes one finding over the same
severity/file/message tuple, with the same `line`-excluding reasoning. Its
fields are length-prefixed rather than `|`-joined so a `|` inside a message
cannot make two different findings encode identically. The set-level digest is
untouched, so every ledger already on disk keeps its meaning.

What — One exported function in `src/cr/autofix-ledger.ts` plus four cases in
its test file. No caller yet; no behaviour change.

Noldor-FD: cr-re-round-cap-enforcement-and-oscillation-detector
EOF
git add src/cr/autofix-ledger.ts src/cr/__tests__/autofix-ledger.test.ts
git commit -F /tmp/msg-p1t1.txt
```

---

## Task 2: Additive schema fields

**Files:** Modify: `src/cr/findings-schema.ts`, `src/cr/autofix-ledger.ts` · Test: `src/cr/__tests__/findings-schema.test.ts`, `src/cr/__tests__/autofix-ledger.test.ts`

- [x] **Step 1: Write the failing test.** Create or append to `src/cr/__tests__/findings-schema.test.ts`:

```ts
// @tests: specs-cr-gate-multi-reviewer
import { describe, expect, it } from 'vitest';

import { findingSchema, laneFindingsSchema } from '../findings-schema.js';

describe('findingSchema locations', () => {
  it('accepts a finding with no locations key', () => {
    const parsed = findingSchema.parse({ severity: 'high', file: 'a.ts', message: 'boom' });
    expect(parsed.locations).toBeUndefined();
  });

  it('accepts a file-only location and a ranged one', () => {
    const parsed = findingSchema.parse({
      severity: 'med',
      file: 'a.ts',
      message: 'boom',
      locations: [{ file: 'src/a.ts' }, { file: 'src/b.ts', line: 12, endLine: 18 }],
    });
    expect(parsed.locations).toEqual([
      { file: 'src/a.ts' },
      { file: 'src/b.ts', line: 12, endLine: 18 },
    ]);
  });

  it('rejects a location with no file', () => {
    expect(() =>
      findingSchema.parse({ severity: 'low', file: 'a.ts', message: 'x', locations: [{ line: 3 }] }),
    ).toThrow();
  });

  // The whole point of additive: a sink written before this field existed must
  // still parse, and must not grow the key.
  it('parses a pre-existing sink unchanged', () => {
    const legacy = {
      lane: 'reviewer',
      artifact: 'a.md',
      kind: 'code',
      slug: 's',
      blockers: [{ severity: 'high', file: 'a.md', message: 'boom' }],
      suggestions: [],
      summary: 'needs changes',
      startedAt: '2026-09-04T00:00:00.000Z',
    };
    const parsed = laneFindingsSchema.parse(legacy);
    expect(parsed.blockers[0].locations).toBeUndefined();
  });
});
```

- [x] **Step 2: Run it and watch it fail.**

```bash
pnpm vitest run src/cr/__tests__/findings-schema.test.ts
```

Expected: the ranged-location case fails — zod strips unknown keys, so `parsed.locations` is `undefined` and the `toEqual` assertion reports `undefined` where the array was expected. The rejects-a-location-with-no-file case fails too (nothing throws).

- [x] **Step 3: Implement.** In `src/cr/findings-schema.ts`, above `findingSchema`, add the location schema, then the field:

```ts
/**
 * One place a finding is about. Separate from {@link findingSchema}'s `file` /
 * `line`, which keep their existing meaning — on the reviewer lane `file` is
 * the artifact LABEL orchestrate was invoked with, not a location, and
 * rewriting it would change what every existing sink reader sees.
 *
 * `line` and `endLine` are optional because a reviewer legitimately names a
 * file without a line, and a range without an end is a single line.
 */
export const findingLocationSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});
export type FindingLocation = z.infer<typeof findingLocationSchema>;
```

Then inside `findingSchema`, immediately after the `class` field:

```ts
  // Where the finding actually points, resolved from the bullet text against
  // the round's changed-file set. Optional so every sink written before it
  // existed still parses and no other lane needs migration — the same additive
  // posture `class` above took. An absent key means "no location resolved",
  // never "the whole artifact".
  locations: z.array(findingLocationSchema).optional(),
```

In `src/cr/autofix-ledger.ts`, inside `autofixRoundSchema`, immediately after the `fingerprint` field:

```ts
  /**
   * Every blocker id ({@link fingerprintBlocker}) this round filed, in sorted
   * order. R1 compares against these: the set-level {@link fingerprint} above
   * cannot say WHICH blocker came back.
   *
   * Optional so every ledger written before this field existed still parses.
   */
  blockerIds: z.array(z.string().min(1)).optional(),
  /**
   * The re-flag signals this round produced, as opaque records. Written here
   * rather than recomputed later because lane sinks are overwritten each round
   * and survive only in `archive/` — a signal computed at round 2 is otherwise
   * unrecoverable when the cap fires.
   *
   * Typed as unknown-shaped on purpose: the ledger is a transport for them and
   * must not import the detector, which would invert the dependency direction
   * the pure module depends on.
   */
  signals: z.array(z.record(z.unknown())).optional(),
```

- [x] **Step 4: Run it and watch it pass.**

```bash
pnpm vitest run src/cr/__tests__/findings-schema.test.ts src/cr/__tests__/autofix-ledger.test.ts && pnpm typecheck
```

Expected: both test files pass and `pnpm typecheck` exits 0 with no output.

- [x] **Step 5: Add the ledger back-compat case.** Append to `src/cr/__tests__/autofix-ledger.test.ts`:

```ts
it('parses a ledger written before blockerIds and signals existed', async () => {
  const dir = ledgerDir(cwd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    ledgerPath(cwd, 'slug' as Slug, 'code'),
    JSON.stringify({
      slug: 'slug',
      kind: 'code',
      sessionStartedAt: 'S',
      rounds: [
        {
          round: 1,
          headSha: 'abc1234',
          fingerprint: 'f',
          applied: 0,
          deferred: 0,
          diffStat: '',
        },
      ],
    }),
  );
  const ledger = await readLedger(cwd, 'slug' as Slug, 'code', 'S');
  expect(ledger?.rounds[0].blockerIds).toBeUndefined();
  expect(ledger?.rounds[0].signals).toBeUndefined();
});
```

Place it inside the existing `describe('readLedger', …)` block so it inherits that block's `cwd` fixture and `beforeEach`/`afterEach`.

- [x] **Step 6: Run it and watch it pass.**

```bash
pnpm vitest run src/cr/__tests__/autofix-ledger.test.ts
```

Expected: all tests pass, including the new back-compat case.

- [x] **Step 7: Commit.**

```bash
cat > /tmp/msg-p1t2.txt <<'EOF'
feat(cr): add optional locations, blockerIds and signals to the CR schemas

Three additive fields, no reader changed yet: `locations` on a Finding,
`blockerIds` and `signals` on an AutofixRound. Every one is optional, so every
lane sink and every round ledger already on disk parses unchanged and yields no
new key — asserted by a back-compat case in each test file.

`signals` is typed as unknown-shaped records rather than the detector's own
type: the ledger transports them, and importing the detector here would invert
the dependency direction that keeps the detector pure.

Noldor-FD: cr-re-round-cap-enforcement-and-oscillation-detector
EOF
git add src/cr/findings-schema.ts src/cr/autofix-ledger.ts src/cr/__tests__/findings-schema.test.ts src/cr/__tests__/autofix-ledger.test.ts
git commit -F /tmp/msg-p1t2.txt
```

---

## Task 3: Location extraction

**Files:** Create: `src/cr/locations.ts` · Test: `src/cr/__tests__/locations.test.ts`

- [x] **Step 1: Write the failing test.** Create `src/cr/__tests__/locations.test.ts`:

```ts
// @tests: specs-cr-gate-multi-reviewer
import { describe, expect, it } from 'vitest';

import { extractLocations } from '../locations.js';

const CHANGED = ['src/cr/orchestrate.ts', 'src/cr/lanes/subagent.ts', 'docs/roadmap.md'];

describe('extractLocations', () => {
  it('resolves a directory-qualified path with a line', () => {
    expect(extractLocations('`src/cr/orchestrate.ts:475` returns early', CHANGED)).toEqual([
      { file: 'src/cr/orchestrate.ts', line: 475 },
    ]);
  });

  it('resolves a bare basename against the changed set', () => {
    expect(extractLocations('`subagent.ts:94` never runs', CHANGED)).toEqual([
      { file: 'src/cr/lanes/subagent.ts', line: 94 },
    ]);
  });

  it('resolves a range to endLine', () => {
    expect(extractLocations('see orchestrate.ts:475-479', CHANGED)).toEqual([
      { file: 'src/cr/orchestrate.ts', line: 475, endLine: 479 },
    ]);
  });

  it('is extension-agnostic — markdown counts', () => {
    expect(extractLocations('docs/roadmap.md:12 is stale', CHANGED)).toEqual([
      { file: 'docs/roadmap.md', line: 12 },
    ]);
  });

  it('returns every distinct mention, deduplicated, in first-seen order', () => {
    const msg = 'orchestrate.ts:475 and subagent.ts:94 and orchestrate.ts:475 again';
    expect(extractLocations(msg, CHANGED)).toEqual([
      { file: 'src/cr/orchestrate.ts', line: 475 },
      { file: 'src/cr/lanes/subagent.ts', line: 94 },
    ]);
  });

  it('yields nothing for a path outside the changed set', () => {
    expect(extractLocations('src/core/session.ts:10 is wrong', CHANGED)).toEqual([]);
  });

  it('yields nothing for an absolute path or a traversal', () => {
    expect(extractLocations('/etc/passwd:1', CHANGED)).toEqual([]);
    expect(extractLocations('../../orchestrate.ts:1', CHANGED)).toEqual([]);
  });

  it('yields nothing for an ambiguous bare basename', () => {
    const changed = ['a/dup.ts', 'b/dup.ts'];
    expect(extractLocations('dup.ts:3 broke', changed)).toEqual([]);
  });

  it('yields nothing when the message names no location', () => {
    expect(extractLocations('this is simply wrong', CHANGED)).toEqual([]);
  });

  it('yields nothing when the changed set is empty', () => {
    expect(extractLocations('orchestrate.ts:475', [])).toEqual([]);
  });
});
```

- [x] **Step 2: Run it and watch it fail.**

```bash
pnpm vitest run src/cr/__tests__/locations.test.ts
```

Expected: `Failed to resolve import "../locations.js"` — the module does not exist yet.

- [x] **Step 3: Implement.** Create `src/cr/locations.ts`:

```ts
import type { FindingLocation } from './findings-schema.js';

/**
 * A `path:NN` or `path:NN-MM` mention inside reviewer prose.
 *
 * Extension-agnostic by design: the reviewer lane reviews markdown at spec and
 * plan stage and TypeScript at code stage, so a `.ts`-only pattern would make
 * the whole feature silent on two of the three kinds. The path run excludes
 * whitespace and backticks so a fenced mention (`` `a/b.ts:3` ``) yields the
 * path without its fence.
 *
 * A leading `/` or `.` is NOT matched: an absolute path and a `../` traversal
 * are never repo-relative changed files, and refusing them here means the
 * resolver never even considers a path it could not have been given honestly.
 */
const MENTION_RE = /(?<![\w/.-])([\w-]+(?:[/][\w.-]+)*\.[A-Za-z][\w]*):(\d+)(?:-(\d+))?/g;

/**
 * Every location a reviewer bullet names, confined to `changedFiles`.
 *
 * Pure — no fs, no git. The caller supplies the changed set, which is both the
 * confinement boundary (a `locations.file` originates in LLM output and is
 * later opened, so an unrecognised path must never reach a read) and the
 * resolver for a bare basename.
 *
 * Returns `[]` rather than throwing on anything unresolvable: an absent
 * location means "no signal from this finding", which is the honest outcome and
 * the one every downstream rule already handles.
 *
 * Deduplicated in first-seen order so a message that repeats a location does
 * not weight it twice, and so the array is stable for a digest.
 */
export function extractLocations(
  message: string,
  changedFiles: readonly string[],
): FindingLocation[] {
  if (changedFiles.length === 0) return [];
  const byPath = new Set(changedFiles);
  const byBasename = new Map<string, string[]>();
  for (const f of changedFiles) {
    const base = f.slice(f.lastIndexOf('/') + 1);
    const list = byBasename.get(base) ?? [];
    list.push(f);
    byBasename.set(base, list);
  }

  const out: FindingLocation[] = [];
  const seen = new Set<string>();
  for (const m of message.matchAll(MENTION_RE)) {
    const [, raw, lineText, endText] = m;
    // Exact repo-relative path first; a bare basename only when it names
    // exactly one changed file. Two candidates is ambiguity, and a guess about
    // which file a finding is in would produce a confident wrong signal.
    let file: string | undefined;
    if (byPath.has(raw)) file = raw;
    else if (!raw.includes('/')) {
      const candidates = byBasename.get(raw);
      if (candidates?.length === 1) file = candidates[0];
    }
    if (file === undefined) continue;

    const line = Number(lineText);
    const endLine = endText === undefined ? undefined : Number(endText);
    const key = `${file}:${line}:${endLine ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // An end at or below the start is a malformed range, not a one-line one —
    // drop the end rather than emitting a backwards span.
    out.push({
      file,
      line,
      ...(endLine !== undefined && endLine > line ? { endLine } : {}),
    });
  }
  return out;
}
```

- [x] **Step 4: Run it and watch it pass.**

```bash
pnpm vitest run src/cr/__tests__/locations.test.ts
```

Expected: all ten cases pass.

- [x] **Step 5: Commit.**

```bash
cat > /tmp/msg-p1t3.txt <<'EOF'
feat(cr): extract finding locations from reviewer prose

`extractLocations(message, changedFiles)` reads every `path:NN` (or
`path:NN-MM`) mention out of a bullet and resolves it against the round's
changed files. A probe over this repo's reviewer sinks found 36% of findings
already carrying such a mention unprompted, so this has retroactive coverage
and mints no new bullet grammar.

The changed set is a security boundary, not a convenience: a location
originates in LLM output and is later opened to resolve cut-marker scopes, so
an absolute path, a `../` traversal, a path outside the set, and an ambiguous
bare basename all resolve to nothing rather than to a guess. The module is pure
— the caller fetches the set.

Noldor-FD: cr-re-round-cap-enforcement-and-oscillation-detector
EOF
git add src/cr/locations.ts src/cr/__tests__/locations.test.ts
git commit -F /tmp/msg-p1t3.txt
```

---

## Task 4: Changed-set discovery for every artifact kind

**Files:** Modify: `src/cr/lanes/subagent.ts` · Test: `src/cr/__tests__/lanes/subagent.test.ts`

The existing `discoverChangedFiles` call sits *inside* `resolveBindingRules`, which returns at `src/cr/lanes/subagent.ts:91` for every `kind !== 'code'`. Reusing it would leave spec and plan reviews with no set to confine against.

- [x] **Step 1: Write the failing test.** Append to `src/cr/__tests__/lanes/subagent.test.ts`:

```ts
describe('resolveChangedFiles', () => {
  it('returns the changed set for a spec kind, not only code', () => {
    const calls: string[][] = [];
    const run = (args: string[]) => {
      calls.push(args);
      return 'docs/design/specs/a-design.md\n';
    };
    expect(resolveChangedFiles({ repoRoot: '/r', base: 'BASE', head: 'HEAD', run })).toEqual([
      'docs/design/specs/a-design.md',
    ]);
    expect(calls).toHaveLength(1);
  });

  // Git failing here must degrade the feature, never turn a review into a lane
  // error — the same posture resolveBindingRules already takes.
  it('returns an empty set when git fails', () => {
    const run = () => {
      throw new Error('not a repository');
    };
    expect(resolveChangedFiles({ repoRoot: '/r', base: 'BASE', head: 'HEAD', run })).toEqual([]);
  });
});
```

Add `resolveChangedFiles` to the file's import block from `../../lanes/subagent.js` (match the existing relative path used by that test file's other imports).

- [x] **Step 2: Run it and watch it fail.**

```bash
pnpm vitest run src/cr/__tests__/lanes/subagent.test.ts -t resolveChangedFiles
```

Expected: `Module '"../../lanes/subagent.js"' has no exported member 'resolveChangedFiles'`.

- [x] **Step 3: Implement.** In `src/cr/lanes/subagent.ts`, add above `resolveBindingRules`:

```ts
/**
 * The files the round's range changed — the confinement boundary and basename
 * resolver for {@link extractLocations}.
 *
 * Deliberately NOT reused from `resolveBindingRules` below, which returns at
 * its first line for every `kind !== 'code'`: rules are code-only, locations
 * are not, and folding the two would leave spec and plan reviews with no set to
 * match against at all.
 *
 * Best-effort — a git failure yields `[]`, which costs locations for the round
 * and nothing else. Turning a review into a lane error over a git hiccup is the
 * one outcome worth avoiding here.
 */
export function resolveChangedFiles(opts: {
  repoRoot: string;
  base: string;
  head: string;
  run?: (args: string[]) => string;
}): string[] {
  try {
    return discoverChangedFiles({
      cwd: opts.repoRoot,
      base: opts.base,
      head: opts.head,
      ...(opts.run ? { run: opts.run } : {}),
    });
  } catch {
    return [];
  }
}
```

If `DiscoverChangedFilesOptions` does not expose a `run` seam, drop the `run` parameter from both the test and this function and inject via the existing seam that `discoverChangedFiles` provides — check `src/core/branch-added.ts` and match it exactly rather than adding a new one.

- [x] **Step 4: Run it and watch it pass.**

```bash
pnpm vitest run src/cr/__tests__/lanes/subagent.test.ts && pnpm typecheck
```

Expected: the file's tests pass and `pnpm typecheck` exits 0.

- [x] **Step 5: Commit.**

```bash
cat > /tmp/msg-p1t4.txt <<'EOF'
feat(cr): resolve the changed-file set for every artifact kind

`resolveChangedFiles` lifts changed-set discovery out of
`resolveBindingRules`, which returns at its first line for every
`kind !== 'code'`. Rules are code-only; locations are not, and leaving the two
folded together would give spec and plan reviews no set to confine a location
against — silently disabling the feature on two of the three kinds.

A git failure yields an empty set rather than a lane error: losing locations
for a round is recoverable, turning a review into an error is not.

Noldor-FD: cr-re-round-cap-enforcement-and-oscillation-detector
EOF
git add src/cr/lanes/subagent.ts src/cr/__tests__/lanes/subagent.test.ts
git commit -F /tmp/msg-p1t4.txt
```

---

## Task 5: Attach locations to reviewer findings

**Files:** Modify: `src/cr/lanes/subagent.ts` · Test: `src/cr/__tests__/lanes/subagent.test.ts`

- [x] **Step 1: Write the failing test.** Append to `src/cr/__tests__/lanes/subagent.test.ts`:

```ts
describe('mkFinding locations', () => {
  const changed = ['src/cr/orchestrate.ts'];

  it('attaches a resolved location and leaves the message intact', () => {
    const f = mkFindingFor('high', changed)('[design] `orchestrate.ts:475` returns early');
    expect(f.locations).toEqual([{ file: 'src/cr/orchestrate.ts', line: 475 }]);
    expect(f.message).toBe('`orchestrate.ts:475` returns early');
    expect(f.class).toBe('design');
  });

  it('omits the key when the bullet names no location', () => {
    const f = mkFindingFor('med', changed)('this is simply wrong');
    expect(f).not.toHaveProperty('locations');
  });

  it('omits the key when nothing resolves', () => {
    const f = mkFindingFor('med', changed)('`src/core/session.ts:10` is wrong');
    expect(f).not.toHaveProperty('locations');
  });
});
```

Add `mkFindingFor` to the import block from `../../lanes/subagent.js`.

- [x] **Step 2: Run it and watch it fail.**

```bash
pnpm vitest run src/cr/__tests__/lanes/subagent.test.ts -t "mkFinding locations"
```

Expected: `Module '"../../lanes/subagent.js"' has no exported member 'mkFindingFor'`.

- [x] **Step 3: Implement.** In `src/cr/lanes/subagent.ts`, add the import `import { extractLocations } from '../locations.js';`, then lift the existing inline `mkFinding` out of `runSubagent` into an exported factory directly above it:

```ts
/**
 * Bullet text -> {@link Finding}, curried on severity and the round's changed
 * files. Exported so the location and class parsing is testable without a
 * dispatch.
 *
 * `file` keeps its existing meaning — the artifact LABEL, not a location.
 * Rewriting it to the first resolved location would change what every existing
 * sink reader sees, and `fingerprintBlockers` hashes it, so the change would
 * silently invalidate every digest already in a ledger.
 */
export const mkFindingFor =
  (severity: 'high' | 'med' | 'low', artifact: string, changedFiles: readonly string[]) =>
  (bullet: string): Finding => {
    const { class: cls, message } = splitClassTag(bullet);
    const locations = extractLocations(message, changedFiles);
    return {
      file: artifact,
      severity,
      message,
      ...(cls ? { class: cls } : {}),
      ...(locations.length > 0 ? { locations } : {}),
    };
  };
```

The test above calls `mkFindingFor(severity, changed)`; make the test match this three-argument signature by passing the artifact label: `mkFindingFor('high', 'a.md', changed)`. Update all three test cases accordingly.

Then in `runSubagent`, replace the inline `mkFinding` definition with:

```ts
  const changedFiles = resolveChangedFiles({
    repoRoot: input.repoRoot,
    base: rulesBaseSha,
    head: input.artifactSha,
  });
  const mkFinding = (severity: 'high' | 'med' | 'low') =>
    mkFindingFor(severity, input.artifact, changedFiles);
```

Place the `resolveChangedFiles` call beside the existing `rulesBaseSha` computation near the top of `runSubagent`, so the two error paths above it (dispatch failure, parse failure) are unaffected — those write findings with no location, which is correct.

- [x] **Step 4: Run it and watch it pass.**

```bash
pnpm vitest run src/cr/__tests__/lanes/subagent.test.ts && pnpm typecheck
```

Expected: the file's tests pass and `pnpm typecheck` exits 0.

- [ ] **Step 5: Verify end to end against a real sink.** (SKIPPED — a live reviewer dispatch would write a ledger round into this session and move the CR cap; run it deliberately at CR time) Run the reviewer lane over this branch and confirm at least one finding carries a location:

```bash
pnpm noldor cr orchestrate --slug cr-re-round-cap-enforcement-and-oscillation-detector \
  --artifact src/cr/locations.ts --kind code --lanes reviewer --base-sha origin/main --autonomous
node -e "const j=require('./.noldor/cr/cr-re-round-cap-enforcement-and-oscillation-detector-code-reviewer.json');console.log(JSON.stringify(j.blockers.map(b=>b.locations),null,2))"
```

Expected: the printed array contains at least one non-`null` entry. If every entry is `null`, the reviewer named no resolvable location this round — re-read the sink's `message` fields before assuming a bug, since the feature degrades to silence by design.

- [x] **Step 6: Commit.**

```bash
cat > /tmp/msg-p1t5.txt <<'EOF'
feat(cr): attach resolved locations to reviewer findings

`mkFindingFor` is the old inline `mkFinding` lifted out of `runSubagent` and
curried on the round's changed files, so the class-tag and location parsing is
testable without a dispatch. A bullet naming a resolvable `path:NN` gains a
`locations` array; one naming none, or naming something outside the changed
set, gains no key at all.

The `file` field keeps its existing meaning — the artifact label, not a
location. Rewriting it would change what every sink reader sees and, because
`fingerprintBlockers` hashes it, would silently invalidate every digest already
written to a ledger.

Noldor-FD: cr-re-round-cap-enforcement-and-oscillation-detector
EOF
git add src/cr/lanes/subagent.ts src/cr/__tests__/lanes/subagent.test.ts
git commit -F /tmp/msg-p1t5.txt
```

---

## Task 6: Ask the reviewer for a location

**Files:** Modify: `src/cr/lanes/subagent-dispatch.ts` · Test: `src/cr/__tests__/lanes/subagent-dispatch.test.ts`

- [x] **Step 1: Write the failing test.** Append to `src/cr/__tests__/lanes/subagent-dispatch.test.ts`:

```ts
it('asks every Critical and Important bullet to name a file and line', () => {
  const prompt = buildPrompt({
    artifact: 'a.md',
    fdSummary: 'summary',
    baseSha: 'BASE',
    headSha: 'HEAD',
    description: 'code for FD s',
  });
  expect(prompt).toContain('path/to/file.ts:123');
  expect(prompt).toMatch(/name the file and line/i);
});
```

- [x] **Step 2: Run it and watch it fail.**

```bash
pnpm vitest run src/cr/__tests__/lanes/subagent-dispatch.test.ts -t "name a file and line"
```

Expected: `expected '…' to contain 'path/to/file.ts:123'`.

- [x] **Step 3: Implement.** In `src/cr/lanes/subagent-dispatch.ts`, inside `buildPrompt`'s returned template, insert this paragraph immediately after the `Tag by what the FIX needs…` paragraph and before `Emit your review in this exact format`:

```
In every Critical and Important bullet, name the file and line the finding is about, as \`path/to/file.ts:123\` (or \`path/to/file.ts:123-130\` for a range). Repo-relative paths are preferred; a bare filename is accepted when it is unambiguous. Write it inline in the sentence — there is no separate field, and the surrounding prose is unchanged. Omit it only when the finding genuinely has no single location.
```

- [x] **Step 4: Run it and watch it pass.**

```bash
pnpm vitest run src/cr/__tests__/lanes/subagent-dispatch.test.ts
```

Expected: every test in the file passes. If a snapshot-style test pins the whole prompt, update that expectation in the same commit — the prompt is deliberately changing.

- [x] **Step 5: Run the full suite and the gates.**

```bash
pnpm typecheck && pnpm test && pnpm noldor checks push-gates
```

Expected: typecheck exits 0, the suite is green, and `checks push-gates` exits 0.

- [x] **Step 6: Commit.**

```bash
cat > /tmp/msg-p1t6.txt <<'EOF'
feat(cr): ask reviewer bullets to name a file and line

One paragraph in the reviewer prompt, asking each Critical and Important bullet
to name its location inline as `path/to/file.ts:123`. This raises the rate
rather than creating the capability: 36% of findings in this repo's existing
sinks already do it unprompted, which is why the extractor reads the message
instead of demanding a new bullet grammar.

The prose contract is otherwise untouched, so `parseSubagentMarkdown` needs no
change and every existing sink still parses.

Noldor-FD: cr-re-round-cap-enforcement-and-oscillation-detector
EOF
git add src/cr/lanes/subagent-dispatch.ts src/cr/__tests__/lanes/subagent-dispatch.test.ts
git commit -F /tmp/msg-p1t6.txt
```
