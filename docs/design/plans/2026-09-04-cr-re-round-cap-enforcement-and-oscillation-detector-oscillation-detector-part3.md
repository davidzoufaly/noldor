# CR Oscillation Detector — Part 3: Cut Scanner and R2 Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Teach the detector the one rule that has to read code. After this part merges, `cr orchestrate` also prints when a blocker sits inside a documented `noldor:cut` scope — the signal that would have caught the Q-0146 review.
**Architecture:** One new pure module (`src/cr/cut-scan.ts`) owning a single lexical pass over a file, one rule added to `src/cr/reflag.ts`, and one widening of the `runReflagRules` seam Part 2 built. Orchestrate stays the only place that touches git or the filesystem.
**Tech Stack:** TypeScript 7 (native), vitest. No new dependencies. Depends on Part 1 (`locations`) and Part 2 (the rule contract, the wiring seam).

---

## File Structure

- `src/cr/cut-scan.ts` — create: the lexical pass, marker discovery, and scope resolution.
- `src/cr/reflag.ts` — modify: add `ruleR2`.
- `src/cr/orchestrate.ts` — modify: resolve marker scopes; widen `runReflagRules`.

---

## Task 1: The lexical pass

**Files:** Create: `src/cr/cut-scan.ts` · Test: `src/cr/__tests__/cut-scan.test.ts`

`tokenize()` in `src/clones/tokenize.ts` cannot serve here: it discards comments (so it cannot find a marker) and its own header says regex literals "degrade to punctuation" (so its brace depth is wrong — measured today it ends at `+1` for `src/core/ui-predicate.ts` and `-1` for `src/invariants/public-api-tsdoc.ts`).

- [ ] **Step 1: Write the failing test.** Create `src/cr/__tests__/cut-scan.test.ts`:

```ts
// @tests: specs-cr-gate-multi-reviewer
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { scanSource } from '../cut-scan.js';

describe('scanSource', () => {
  it('reports balanced depth for ordinary code', () => {
    expect(scanSource('function a() {\n  return 1;\n}\n').ok).toBe(true);
  });

  it('ignores braces inside a string and a template', () => {
    expect(scanSource('const a = "{";\nconst b = `${x}}`;\n').ok).toBe(true);
  });

  it('ignores braces inside a line comment and a block comment', () => {
    expect(scanSource('// {\n/* { */\nconst a = 1;\n').ok).toBe(true);
  });

  it('ignores an unbalanced brace inside a regex literal', () => {
    expect(scanSource('const RE = /[*?[{]/;\nconst a = 1;\n').ok).toBe(true);
  });

  it('treats a slash after a value as division, not a regex', () => {
    expect(scanSource('const a = (1) / 2;\nconst b = x / y;\nconst c = { d: 1 };\n').ok).toBe(true);
  });

  it('re-enters code inside a template substitution', () => {
    expect(scanSource('const a = `x${ { y: 1 } }z`;\n').ok).toBe(true);
  });

  it('marks a file unscannable when depth ends non-zero', () => {
    expect(scanSource('function a() {\n').ok).toBe(false);
  });

  it('marks a file unscannable when depth goes negative', () => {
    expect(scanSource('}\nfunction a() {}\n').ok).toBe(false);
  });

  it('records comment lines', () => {
    const r = scanSource('const a = 1;\n// hi\n/* there\n   friend */\n');
    expect([...r.commentLines].sort((x, y) => x - y)).toEqual([2, 3, 4]);
  });

  // The two files tokenize() gets wrong today. This is the regression the whole
  // custom pass exists for.
  it.each(['src/core/ui-predicate.ts', 'src/invariants/public-api-tsdoc.ts'])(
    'scans %s cleanly',
    (path) => {
      expect(scanSource(readFileSync(path, 'utf8')).ok).toBe(true);
    },
  );
});
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
pnpm vitest run src/cr/__tests__/cut-scan.test.ts
```

Expected: `Failed to resolve import "../cut-scan.js"`.

- [ ] **Step 3: Implement.** Create `src/cr/cut-scan.ts`:

```ts
/**
 * A `noldor:cut` scanner for TypeScript source — the code half of a contract
 * that until now existed only as prose in a review prompt.
 *
 * NOT built on `src/clones/tokenize.ts`, and that is load-bearing rather than
 * duplication for its own sake. That scanner discards comments, so it cannot
 * find a marker at all; and its own header records that regex literals "degrade
 * to punctuation", which is harmless when comparing token streams and fatal
 * when counting braces — measured on this repo it ends at depth +1 for
 * `src/core/ui-predicate.ts` (the `{` in `/[*?[{]/`) and -1 for
 * `src/invariants/public-api-tsdoc.ts`. Teaching it regex literals would change
 * the token stream clone detection depends on, so that fix belongs there.
 *
 * Pure: takes source text, returns data. No fs, no git.
 */
import { CUT_MARKER } from '../core/structural-context-contract.js';

/** A brace block, as 1-based inclusive line numbers. */
interface Block {
  readonly openLine: number;
  readonly closeLine: number;
}

export interface ScanResult {
  /**
   * False when the pass cannot be trusted: depth ended non-zero, or went
   * negative at any point. A mis-lexed `/` desynchronises everything after it,
   * and unlike `tokenize()`'s bounded ±1 that error is unbounded — so the
   * balance property IS the safety net, and a failing file yields no scopes at
   * all rather than scopes computed from a corrupted depth.
   */
  readonly ok: boolean;
  /** 1-based line numbers that sit inside a comment. */
  readonly commentLines: ReadonlySet<number>;
  /** Every brace block that closed, in close order. */
  readonly blocks: readonly Block[];
}

/** Characters that end a value, after which `/` is division rather than a regex. */
const VALUE_END = /[\w$)\]]/;

/**
 * One pass, two outputs: which lines are comment, and where every brace block
 * opens and closes.
 *
 * The `/` rule is the only genuinely ambiguous decision in JavaScript lexing
 * without a parser: a slash starts a regex unless the previous significant
 * character ends a value (identifier, literal, `)`, `]`). `}` is deliberately
 * NOT in that set — it most often closes a block, after which `/` is a regex —
 * which is the standard heuristic, and is why the balance check exists.
 */
export function scanSource(source: string): ScanResult {
  const commentLines = new Set<number>();
  const blocks: Block[] = [];
  const openStack: number[] = [];
  // Each entry records the brace depth to return to: when depth falls back to
  // it, the `}` closed a `${` and we are in template text again.
  const templateStack: number[] = [];
  let depth = 0;
  let line = 1;
  let prevSignificant = '';
  let negative = false;

  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      commentLines.add(line);
      while (i < source.length && source[i] !== '\n') i++;
      line += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      commentLines.add(line);
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line += 1;
        commentLines.add(line);
        i++;
      }
      i += 1; // land on '/', the loop's i++ steps past it
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < source.length && source[i] !== c) {
        if (source[i] === '\\') i++;
        else if (source[i] === '\n') line += 1;
        i++;
      }
      prevSignificant = 'x';
      continue;
    }
    if (c === '`') {
      i++;
      while (i < source.length) {
        if (source[i] === '\\') {
          i++;
        } else if (source[i] === '`') {
          break;
        } else if (source[i] === '$' && source[i + 1] === '{') {
          templateStack.push(depth);
          depth += 1;
          openStack.push(line);
          i += 1;
          break;
        } else if (source[i] === '\n') {
          line += 1;
        }
        i++;
      }
      prevSignificant = 'x';
      continue;
    }
    if (c === '/' && !VALUE_END.test(prevSignificant)) {
      i++;
      let inClass = false;
      while (i < source.length) {
        const r = source[i];
        if (r === '\\') {
          i += 2;
          continue;
        }
        if (r === '[') inClass = true;
        else if (r === ']') inClass = false;
        else if (r === '/' && !inClass) break;
        else if (r === '\n') break; // unterminated — bail rather than run away
        i++;
      }
      prevSignificant = 'x';
      continue;
    }

    if (c === '{') {
      depth += 1;
      openStack.push(line);
    } else if (c === '}') {
      depth -= 1;
      if (depth < 0) negative = true;
      const openLine = openStack.pop();
      if (openLine !== undefined) blocks.push({ openLine, closeLine: line });
      if (templateStack.length > 0 && templateStack.at(-1) === depth) templateStack.pop();
    }

    if (c === '\n') line += 1;
    else if (!/\s/.test(c)) prevSignificant = c;
  }

  return { ok: !negative && depth === 0, commentLines, blocks };
}
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
pnpm vitest run src/cr/__tests__/cut-scan.test.ts
```

Expected: every case passes, both real-file cases included. If a real file fails, do NOT loosen the balance check — that check is the safety net. Find the construct the pass mis-lexes and add it as its own unit case first.

- [ ] **Step 5: Measure the corpus.** Confirm the pass is clean across the tree it will actually run on:

```bash
node --experimental-strip-types -e "
import {scanSource} from './src/cr/cut-scan.ts';
import {readFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
const files = execSync(\"git ls-files 'src/**/*.ts'\", {encoding:'utf8'}).trim().split('\n');
const bad = files.filter(f => !scanSource(readFileSync(f,'utf8')).ok);
console.log('scanned', files.length, 'unscannable', bad.length);
bad.slice(0,10).forEach(f => console.log('  ', f));
"
```

Expected: `unscannable 0`. A handful is tolerable — the omit path exists for it — but investigate each before accepting, because every unscannable file is a file R2 goes quiet on.

- [ ] **Step 6: Commit.**

```bash
cat > /tmp/msg-p3t1.txt <<'EOF'
feat(cr): add a lexical pass for cut-marker scanning

Why — The ~20 `noldor:cut` markers in `src/**` are readable today only by
humans and by a grep in `/noldor-refactor`. R2 needs to know which lines each
marker governs, and neither half of that is answerable with a line regex:
markers live in comments, and a marker's scope is a brace block.

How — One pass classifies code, line comments, block comments, strings,
templates (with `${` re-entry) and regex literals, returning comment lines and
brace blocks together. It is deliberately not built on `src/clones/tokenize.ts`,
which discards comments and — by its own header — mis-lexes regex literals,
leaving brace depth at +1 for `src/core/ui-predicate.ts` and -1 for
`src/invariants/public-api-tsdoc.ts`. Because a mis-lexed slash desynchronises
everything after it, the pass self-checks: a file whose depth ends non-zero or
goes negative is reported unscannable rather than yielding wrong scopes.

What — `src/cr/cut-scan.ts` with `scanSource`, a unit case per construct, and a
regression case over both files tokenize() gets wrong today.

Noldor-FD: cr-re-round-cap-enforcement-and-oscillation-detector
EOF
git add src/cr/cut-scan.ts src/cr/__tests__/cut-scan.test.ts
git commit -F /tmp/msg-p3t1.txt
```

---

## Task 2: Marker discovery

**Files:** Modify: `src/cr/cut-scan.ts` · Test: `src/cr/__tests__/cut-scan.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `src/cr/__tests__/cut-scan.test.ts`:

```ts
describe('findMarkers', () => {
  it('finds a line-comment marker with its reason', () => {
    const src = 'const a = 1;\n// noldor:cut stdout unbounded — cap it later\n';
    expect(findMarkers(src)).toEqual([{ line: 2, reason: 'stdout unbounded — cap it later' }]);
  });

  it('finds a JSDoc marker', () => {
    const src = '/**\n * noldor:cut a RELATIVE scan root — probe git\n */\nfunction a() {}\n';
    expect(findMarkers(src)).toEqual([{ line: 2, reason: 'a RELATIVE scan root — probe git' }]);
  });

  it('does not match noldor:cut-section', () => {
    expect(findMarkers('// noldor:cut-section Architecture — covered elsewhere\n')).toEqual([]);
  });

  it('does not match noldor:cutlery', () => {
    expect(findMarkers('// noldor:cutlery is not a marker\n')).toEqual([]);
  });

  it('does not match a marker inside a string or template', () => {
    expect(findMarkers('const s = "noldor:cut fake";\nconst t = `noldor:cut fake`;\n')).toEqual([]);
  });

  it('finds every marker in document order', () => {
    const src = '// noldor:cut one\nconst a = 1;\n// noldor:cut two\n';
    expect(findMarkers(src).map((m) => m.line)).toEqual([1, 3]);
  });

  it('returns nothing for an unscannable file', () => {
    expect(findMarkers('// noldor:cut one\nfunction a() {\n')).toEqual([]);
  });

  // Spec AC8. The scanner and the prose contract must share one spelling: a
  // rename of CUT_MARKER has to fail the suite rather than silently split the
  // grammar between what authors write and what review lanes are told.
  it('recognises exactly the shared CUT_MARKER token', () => {
    expect(findMarkers(`// ${CUT_MARKER} why\n`)).toEqual([{ line: 1, reason: 'why' }]);
    expect(findMarkers('// noldor-cut why\n')).toEqual([]);
  });
});
```

Add `CUT_MARKER` to the test's imports, from `../../core/structural-context-contract.js`.

Add `findMarkers` to the import block from `../cut-scan.js`.

- [ ] **Step 2: Run it and watch it fail.**

```bash
pnpm vitest run src/cr/__tests__/cut-scan.test.ts -t findMarkers
```

Expected: `Module '"../cut-scan.js"' has no exported member 'findMarkers'`.

- [ ] **Step 3: Implement.** Append to `src/cr/cut-scan.ts`:

```ts
/** A `noldor:cut` marker found in a comment, with the reason its author gave. */
export interface CutMarker {
  /** 1-based line the marker sits on. */
  readonly line: number;
  /** Everything after the marker token, trimmed. May be empty. */
  readonly reason: string;
}

/**
 * The marker must be its OWN token. `markdown-section-scan.ts:331` records what
 * a bare `startsWith` cost there — `noldor:cutlery` suppressed a section, with
 * `lery …` counting as the reason — and `noldor:cut-section` is a genuinely
 * different marker owned by `src/docs/architecture-form.ts`. So the character
 * after the token must be whitespace or end-of-line: both `-` and a word
 * character fail.
 *
 * Built from {@link CUT_MARKER} through `RegExp.escape`, exactly as
 * `markdown-section-scan.ts:55` does, so a future edit to the constant cannot
 * silently turn this into a metacharacter bug.
 */
const MARKER_RE = new RegExp(`(?:^|[^\\w:-])${RegExp.escape(CUT_MARKER)}(?:\\s+(.*))?$`);

/**
 * Every `noldor:cut` marker in `source`, in document order.
 *
 * Comment-aware, which a raw-text regex could not be: a marker is recognised
 * only on a line the lexical pass classified as comment, so the literal
 * `noldor:cut` inside a string or template — which this repo's own prompt
 * strings and test fixtures contain — is not a marker.
 *
 * An unscannable file yields `[]`. Markers might still be findable there, but a
 * marker with no trustworthy scope is useless to R2, and reporting one would
 * imply a scope that was never computed.
 */
export function findMarkers(source: string): CutMarker[] {
  const scan = scanSource(source);
  if (!scan.ok) return [];
  const out: CutMarker[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    if (!scan.commentLines.has(lineNo)) continue;
    const m = MARKER_RE.exec(lines[i]);
    if (!m) continue;
    out.push({ line: lineNo, reason: (m[1] ?? '').trim() });
  }
  return out;
}
```

If the repo's TypeScript lib does not expose `RegExp.escape`, mirror whatever `src/core/markdown-section-scan.ts` does rather than inlining a second escape helper.

- [ ] **Step 4: Run it and watch it pass.**

```bash
pnpm vitest run src/cr/__tests__/cut-scan.test.ts
```

Expected: all cases pass.

- [ ] **Step 5: Verify against the real corpus.**

```bash
node --experimental-strip-types -e "
import {findMarkers} from './src/cr/cut-scan.ts';
import {readFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
const files = execSync(\"git ls-files 'src/**/*.ts'\", {encoding:'utf8'}).trim().split('\n');
let n = 0;
for (const f of files) {
  const ms = findMarkers(readFileSync(f,'utf8'));
  if (ms.length) { n += ms.length; console.log(f, ms.map(m => m.line).join(',')); }
}
console.log('markers found:', n);
"
```

Expected: at least 15 markers, across files the spec names (`core/agent-runner/registry.ts`, `core/repo-paths.ts`, `core/config.ts`, `checks/*`, `cr/lanes/render-compare.ts`, …), and **no** hit in `src/docs/architecture-form.ts` for its `noldor:cut-section` token. A count near zero means the comment classification is wrong — debug `scanSource` before touching the marker regex.

- [ ] **Step 6: Commit.**

```bash
cat > /tmp/msg-p3t2.txt <<'EOF'
feat(cr): find noldor:cut markers in TypeScript comments

`findMarkers` reads the marker and its reason from every comment line the
lexical pass identified. Comment-awareness is the point: a raw-text regex would
treat the literal `noldor:cut` inside a string or template as a marker, and this
repo's own prompt strings and fixtures contain it.

The token must stand alone. `markdown-section-scan.ts` already records what a
bare prefix match cost there — `noldor:cutlery` suppressed a section — and
`noldor:cut-section` is a different marker owned by `docs/architecture-form.ts`,
so both are excluded by a boundary the tests pin. The pattern is built from the
shared `CUT_MARKER` constant, so a rename cannot split the grammar.

Noldor-FD: cr-re-round-cap-enforcement-and-oscillation-detector
EOF
git add src/cr/cut-scan.ts src/cr/__tests__/cut-scan.test.ts
git commit -F /tmp/msg-p3t2.txt
```

---

## Task 3: Scope resolution

**Files:** Modify: `src/cr/cut-scan.ts` · Test: `src/cr/__tests__/cut-scan.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `src/cr/__tests__/cut-scan.test.ts`:

```ts
describe('markerScopes', () => {
  it('scopes to the innermost enclosing block', () => {
    const src = [
      'function outer() {',    // 1
      '  function inner() {',  // 2
      '    // noldor:cut why', // 3
      '    return 1;',         // 4
      '  }',                   // 5
      '  return inner;',       // 6
      '}',                     // 7
    ].join('\n');
    expect(markerScopes(src)).toEqual([{ line: 3, reason: 'why', startLine: 3, endLine: 5 }]);
  });

  it('scopes a module-scope marker to the next block that opens', () => {
    const src = [
      '/**',               // 1
      ' * noldor:cut why', // 2
      ' */',               // 3
      'function a() {',    // 4
      '  return 1;',       // 5
      '}',                 // 6
    ].join('\n');
    expect(markerScopes(src)[0]).toMatchObject({ line: 2, startLine: 2, endLine: 6 });
  });

  it('falls back to the comment block plus the next non-blank line', () => {
    const src = ['// noldor:cut why', '// more context', '', 'const a = 1;'].join('\n');
    expect(markerScopes(src)[0]).toMatchObject({ line: 1, startLine: 1, endLine: 4 });
  });

  it('never runs to EOF when nothing follows', () => {
    const src = ['const a = 1;', '// noldor:cut why', '', '', ''].join('\n');
    expect(markerScopes(src)[0].endLine).toBeLessThan(5);
  });

  it('yields nothing for an unscannable file', () => {
    expect(markerScopes('// noldor:cut why\nfunction a() {\n')).toEqual([]);
  });
});
```

Add `markerScopes` to the import block.

- [ ] **Step 2: Run it and watch it fail.**

```bash
pnpm vitest run src/cr/__tests__/cut-scan.test.ts -t markerScopes
```

Expected: `Module '"../cut-scan.js"' has no exported member 'markerScopes'`.

- [ ] **Step 3: Implement.** Append to `src/cr/cut-scan.ts`:

```ts
/** A marker plus the inclusive 1-based line span it governs. */
export interface CutScope extends CutMarker {
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * Every marker in `source`, with the lines it governs.
 *
 * The scope runs from the marker's own line to the end of the innermost brace
 * block containing it — which reaches the function BODY, where a re-flagged
 * finding actually lands. A comment-block-only scope was rejected for exactly
 * that reason: it goes silent on most real re-flags.
 *
 * Two fallbacks cover the module-scope case, which is the common JSDoc shape.
 * With no enclosing block, the scope is the next block that OPENS after the
 * marker — the declaration the comment documents. With no such block either, it
 * is the marker's contiguous comment block plus the following non-blank line.
 * Neither ever reaches EOF, so a marker near the end of a file cannot claim the
 * rest of it.
 */
export function markerScopes(source: string): CutScope[] {
  const scan = scanSource(source);
  if (!scan.ok) return [];
  const markers = findMarkers(source);
  if (markers.length === 0) return [];
  const lines = source.split('\n');

  return markers.map((m) => {
    // Innermost enclosing block = the containing one with the smallest span.
    // Blocks are recorded on close, so several may enclose a given line.
    const enclosing = scan.blocks
      .filter((b) => b.openLine <= m.line && b.closeLine >= m.line)
      .sort((a, b) => a.closeLine - a.openLine - (b.closeLine - b.openLine))[0];
    if (enclosing) return { ...m, startLine: m.line, endLine: enclosing.closeLine };

    const following = scan.blocks
      .filter((b) => b.openLine > m.line)
      .sort((a, b) => a.openLine - b.openLine)[0];
    if (following) return { ...m, startLine: m.line, endLine: following.closeLine };

    let end = m.line;
    while (end < lines.length && scan.commentLines.has(end + 1)) end += 1;
    let after = end + 1;
    while (after <= lines.length && lines[after - 1].trim() === '') after += 1;
    return { ...m, startLine: m.line, endLine: after <= lines.length ? after : end };
  });
}
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
pnpm vitest run src/cr/__tests__/cut-scan.test.ts && pnpm typecheck
```

Expected: every case passes and `pnpm typecheck` exits 0.

- [ ] **Step 5: Commit.**

```bash
cat > /tmp/msg-p3t3.txt <<'EOF'
feat(cr): resolve the line span each noldor:cut marker governs

A marker's scope runs from its own line to the end of the innermost enclosing
brace block, so it reaches the function body where a re-flagged finding lands.
Scoping to the comment block alone was rejected for the opposite reason: it goes
silent on most real re-flags.

Two fallbacks handle the module-scope JSDoc shape — the next block that opens,
then the comment block plus the following non-blank line. Neither reaches EOF,
so a marker near the end of a file cannot claim the rest of it.

Noldor-FD: cr-re-round-cap-enforcement-and-oscillation-detector
EOF
git add src/cr/cut-scan.ts src/cr/__tests__/cut-scan.test.ts
git commit -F /tmp/msg-p3t3.txt
```

---

## Task 4: R2 — cut-site

**Files:** Modify: `src/cr/reflag.ts` · Test: `src/cr/__tests__/reflag.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `src/cr/__tests__/reflag.test.ts`:

```ts
describe('ruleR2', () => {
  const b = {
    id: 'a',
    severity: 'med' as const,
    message: 'simplify this',
    locations: [{ file: 'src/x.ts', line: 12 }],
  };
  const scopes = new Map([['src/x.ts', [{ line: 10, reason: 'why', startLine: 10, endLine: 20 }]]]);

  it('fires for a location inside a marker scope', () => {
    const r = ruleR2([b], scopes, []);
    expect(r.outcome).toBe('fired');
    if (r.outcome === 'fired') expect(r.signals[0].message).toContain('src/x.ts:10');
  });

  it('is clear for a location outside every scope', () => {
    expect(ruleR2([{ ...b, locations: [{ file: 'src/x.ts', line: 40 }] }], scopes, []).outcome).toBe(
      'clear',
    );
  });

  it('is clear for a blocker with no locations', () => {
    expect(ruleR2([{ id: 'a', severity: 'low', message: 'x' }], scopes, []).outcome).toBe('clear');
  });

  it('is clear for a location with a file but no line', () => {
    expect(ruleR2([{ ...b, locations: [{ file: 'src/x.ts' }] }], scopes, []).outcome).toBe('clear');
  });

  // "We could not look" must never read the same as "we looked and found nothing".
  it('is omitted when the located file was unscannable', () => {
    const r = ruleR2([b], new Map(), ['src/x.ts']);
    expect(r.outcome).toBe('omitted');
    if (r.outcome === 'omitted') expect(r.reason).toContain('src/x.ts');
  });
});
```

Add `ruleR2` to the import block from `../reflag.js`.

- [ ] **Step 2: Run it and watch it fail.**

```bash
pnpm vitest run src/cr/__tests__/reflag.test.ts -t ruleR2
```

Expected: `Module '"../reflag.js"' has no exported member 'ruleR2'`.

- [ ] **Step 3: Implement.** Append to `src/cr/reflag.ts`, adding `import type { CutScope } from './cut-scan.js';` at the top:

```ts
/**
 * R2 — cut-site. A blocker located inside a documented cut marker's scope.
 *
 * This is the signal that would have caught the Q-0146 case: codex re-flagged
 * documented cut sites five times in a single review.
 *
 * `scopesByFile` and `unscannable` both arrive as data — the module opens
 * nothing. A blocker whose file could not be scanned yields `omitted` naming
 * that file, never `clear`.
 */
export function ruleR2(
  blockers: readonly RuleBlocker[],
  scopesByFile: ReadonlyMap<string, readonly CutScope[]>,
  unscannable: readonly string[],
): RuleResult {
  const signals: ReflagSignal[] = [];
  const blocked = new Set(unscannable);
  const blockedHit = new Set<string>();
  for (const b of blockers) {
    for (const loc of b.locations ?? []) {
      if (blocked.has(loc.file)) {
        blockedHit.add(loc.file);
        continue;
      }
      if (loc.line === undefined) continue;
      const hit = (scopesByFile.get(loc.file) ?? []).find(
        (s) => loc.line! >= s.startLine && loc.line! <= s.endLine,
      );
      if (hit) {
        signals.push({
          rule: 'R2',
          blockerId: b.id,
          message:
            `blocker at ${loc.file}:${loc.line} sits inside a noldor:cut scope ` +
            `declared at ${loc.file}:${hit.line} — "${hit.reason}"`,
        });
        break;
      }
    }
  }
  if (signals.length === 0 && blockedHit.size > 0)
    return {
      outcome: 'omitted',
      reason: `could not scan ${[...blockedHit].sort().join(', ')} — brace depth did not balance`,
    };
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
cat > /tmp/msg-p3t4.txt <<'EOF'
feat(cr): add R2, the cut-site re-flag rule

R2 fires when a blocker's location falls inside a documented `noldor:cut`
scope — the signal that would have caught the Q-0146 review, where codex
re-flagged documented cut sites five times in a row.

Scopes and the unscannable-file list both arrive as data; the module opens
nothing. A blocker whose file could not be scanned yields `omitted` naming that
file rather than `clear`: "we could not look" and "we looked and found nothing"
must not read the same.

Noldor-FD: cr-re-round-cap-enforcement-and-oscillation-detector
EOF
git add src/cr/reflag.ts src/cr/__tests__/reflag.test.ts
git commit -F /tmp/msg-p3t4.txt
```

---

## Task 5: Widen the wiring with R2

**Files:** Modify: `src/cr/orchestrate.ts` · Test: `src/cr/__tests__/orchestrate.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `src/cr/__tests__/orchestrate.test.ts`:

```ts
it('renders R2 alongside R1 and R3', () => {
  const b = {
    id: 'a',
    severity: 'high' as const,
    message: 'boom',
    locations: [{ file: 'src/x.ts', line: 12 }],
  };
  const out = runReflagRules(
    [b],
    [['a']],
    new Map([['src/x.ts', new Set([12])]]),
    new Map([['src/x.ts', [{ line: 10, reason: 'why', startLine: 10, endLine: 20 }]]]),
    [],
  );
  expect(out.lines.map((l) => l.slice(0, 4))).toEqual(['[R1]', '[R2]', '[R3]']);
  expect(out.signals).toHaveLength(3);
});
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
pnpm vitest run src/cr/__tests__/orchestrate.test.ts -t "renders R2 alongside"
```

Expected: `Expected 3 arguments, but got 5` on the `runReflagRules` call.

- [ ] **Step 3: Implement.** Widen `runReflagRules` in `src/cr/orchestrate.ts` — signature and rule list only; the rendering loop below it is unchanged. The two new parameters go LAST so every Part 2 call site keeps its argument order:

```ts
export function runReflagRules(
  blockers: readonly RuleBlocker[],
  priorRounds: readonly (readonly string[])[] | undefined,
  introducedByFile: ReadonlyMap<string, ReadonlySet<number>> | undefined,
  scopesByFile: ReadonlyMap<string, readonly CutScope[]>,
  unscannable: readonly string[],
): { lines: string[]; signals: Record<string, unknown>[] } {
  const results = [
    ruleR1(blockers, priorRounds),
    ruleR2(blockers, scopesByFile, unscannable),
    ruleR3(blockers, introducedByFile),
  ];
```

The rule ORDER in that array is what fixes the printed order to R1, R2, R3, which the test above pins. Update the existing Part 2 tests for `runReflagRules` to pass `new Map(), []` for the two new trailing arguments — every R1 and R3 case must keep asserting exactly what it asserts today.

- [ ] **Step 4: Resolve the scopes at the call site.** In `run()`, directly before the `runReflagRules` call added in Part 2:

```ts
      const located = [
        ...new Set(ruleBlockers.flatMap((b) => (b.locations ?? []).map((l) => l.file))),
      ];
      const scopesByFile = new Map<string, readonly CutScope[]>();
      const unscannable: string[] = [];
      for (const f of located) {
        try {
          // readFileNoFollow, not readFileSync: `f` came from a changed-file
          // match, and a tracked changed path can still be a symlink whose
          // target is outside the checkout.
          const src = readFileNoFollow(join(cwd, f));
          if (scanSource(src).ok) scopesByFile.set(f, markerScopes(src));
          else unscannable.push(f);
        } catch {
          unscannable.push(f);
        }
      }
```

and extend the call Part 2 wrote, appending the two new arguments:

```ts
      const reflag = runReflagRules(
        ruleBlockers,
        priorBlockerIds(ledger?.rounds ?? []),
        resolveIntroducedLines(cwd, firstHead, gitRun),
        scopesByFile,
        unscannable,
      );
```

`firstHead` and `gitRun` already exist here — Part 2 introduced both. Add only the new imports: `markerScopes` / `scanSource` / `type CutScope` from `./cut-scan.js`, `ruleR2` from `./reflag.js`, `readFileNoFollow` from `../core/slug-paths.js`, and `join` from `node:path`.

- [ ] **Step 5: Assert the symlink boundary.** Spec AC4. Append to `src/cr/__tests__/orchestrate.test.ts` a case that creates a tracked-looking path which is a symlink to a file outside the fixture root, puts a location on it, and asserts the round produces no R2 signal for it and reads nothing through the link — `readFileNoFollow` throws `ELOOP`, so the file lands in `unscannable` and R2 reports `omitted`. Build the fixture with `symlinkSync` in a `mkdtempSync` root and reuse the file's existing cleanup helpers; do not point the link at a real repo file.

- [ ] **Step 6: Run everything.**

```bash
pnpm typecheck && pnpm test && pnpm noldor checks push-gates
```

Expected: typecheck exits 0, the suite is green, `checks push-gates` exits 0. The Part 2 assertion that a signalling round matches a silent one on exit code and sink set must still pass — that is the regression guard on "advisory".

- [ ] **Step 7: Verify end to end.**

```bash
pnpm noldor cr orchestrate --slug cr-re-round-cap-enforcement-and-oscillation-detector \
  --artifact src/cr/cut-scan.ts --kind code --lanes reviewer --base-sha origin/main --autonomous
node -e "const j=require('./.noldor/cr/autofix/cr-re-round-cap-enforcement-and-oscillation-detector-code.json');console.log(JSON.stringify(j.rounds.at(-1).signals,null,2))"
```

Expected: the round's `signals` array holds entries whose `rule` is one of `R1` / `R2` / `R3` / `omitted`. An all-`omitted` first round is the contract working, not a failure.

- [ ] **Step 8: Commit.**

```bash
cat > /tmp/msg-p3t5.txt <<'EOF'
feat(cr): wire R2 into the re-flag round

`runReflagRules` gains the two inputs the cut-site rule needs — marker scopes
and the unscannable-file list — appended after Part 2's parameters so no
existing call site changes argument order. The call site resolves them by
scanning only the files this round's blockers actually point at.

Those files are read through `readFileNoFollow`: a location's path came from a
changed-file match, and a tracked changed path can still be a symlink whose
target is outside the checkout.

The rendering loop is untouched, so an omitted rule still produces both a
printed line and a stored record, and the Part 2 assertion that a signalling
round matches a silent one on exit code and sink set still holds.

Noldor-FD: cr-re-round-cap-enforcement-and-oscillation-detector
EOF
git add src/cr/orchestrate.ts src/cr/__tests__/orchestrate.test.ts
git commit -F /tmp/msg-p3t5.txt
```
