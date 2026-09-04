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

  /**
   * Consume template TEXT from `at` up to the closing backtick or the next
   * `${`, returning the index of the last consumed character so the caller's
   * `i++` steps past it.
   *
   * A helper rather than inline code because there are TWO entry points into
   * template text: the opening backtick, and the `}` that closes a `${`. Only
   * handling the first leaves the text after a substitution being lexed as
   * code, so `` `${x}}` `` reads its second `}` as a real close and the depth
   * goes negative on a perfectly balanced file.
   */
  const runTemplate = (at: number): number => {
    let i = at;
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
    return i;
  };

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
      i = runTemplate(i + 1);
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
      if (templateStack.length > 0 && templateStack.at(-1) === depth) {
        templateStack.pop();
        prevSignificant = 'x';
        i = runTemplate(i + 1);
        continue;
      }
    }

    if (c === '\n') line += 1;
    else if (c !== undefined && !/\s/.test(c)) prevSignificant = c;
  }

  return { ok: !negative && depth === 0, commentLines, blocks };
}
