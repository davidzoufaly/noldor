/**
 * Hand-rolled TS/JS scanner for clone detection — NOT a parser. Comments are
 * skipped; each string/template literal collapses to one `LIT` token;
 * identifiers normalize to `ID` and numeric/string literals to `LIT` in the
 * normalized stream (Type-2 clone matching) while keywords stay verbatim.
 * A declaration-style builder chain (`z.number().int().nonnegative()`) also
 * collapses to one token — see {@link collapseBuilderChains}.
 * Regex literals get no special handling (they degrade to punctuation and
 * identifier runs — bounded imprecision, never a crash). Deterministic, pure,
 * no fs.
 */

export interface Token {
  /** Raw source text (for reporting). */
  readonly text: string;
  /** Normalized comparison form: keyword/punct verbatim, `ID`, or `LIT`. */
  readonly norm: string;
  /** 1-based source line the token starts on. */
  readonly line: number;
  /** 1-based source line the token ends on (> line for multi-line literals). */
  readonly endLine: number;
}

const KEYWORDS = new Set([
  'abstract',
  'any',
  'as',
  'async',
  'await',
  'boolean',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'declare',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'keyof',
  'let',
  'namespace',
  'never',
  'new',
  'null',
  'number',
  'object',
  'of',
  'private',
  'protected',
  'public',
  'readonly',
  'return',
  'satisfies',
  'static',
  'string',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'unknown',
  'var',
  'void',
  'while',
  'yield',
]);

const isIdentStart = (c: string): boolean => /[A-Za-z_$]/.test(c);
const isIdentPart = (c: string): boolean => /[\w$]/.test(c);
const isDigit = (c: string): boolean => c >= '0' && c <= '9';

/** Minimum chained calls before a builder chain is worth collapsing. */
const MIN_CHAIN_CALLS = 2;

/**
 * Fold each declaration-style builder chain into a single token.
 *
 * A schema field like `applied: z.number().int().nonnegative(),` is thirteen
 * tokens, and Type-2 normalization makes it identical to every other field
 * declared with the same validator — so five consecutive fields clear the
 * 50-token clone floor on their own and any schema-heavy file reads as a clone
 * of every other one. Weighing the whole chain as one token puts a field at
 * four tokens, which keeps accidental agreement between a handful of fields
 * under the floor while a genuinely copied schema (dozens of fields, plus its
 * surrounding declarations) still clears it.
 *
 * A chain qualifies only when it is `<ident>` followed by at least
 * {@link MIN_CHAIN_CALLS} calls whose arguments are literal-only (empty, or
 * comma-separated literals). One call taking an identifier, object or callback
 * argument holds real code and disqualifies the entire chain — its literal-only
 * prefix included — so a duplicated pipeline keeps every token of its weight.
 * The head identifier still normalizes to `ID` (`z` vs `zod` must not
 * matter), while method names stay verbatim: `.int()` and `.min()` are distinct
 * operations rather than renamed variables, so a chain differing in its methods
 * should not read as a Type-2 clone.
 */
export function collapseBuilderChains(tokens: readonly Token[]): Token[] {
  const out: Token[] = [];
  let i = 0;

  /**
   * A method-name position. Not `norm === 'ID'`: half the zod vocabulary
   * (`.number()`, `.string()`, `.object()`, `.boolean()`) is spelled with a TS
   * keyword, which the scanner keeps verbatim rather than normalizing.
   */
  const isName = (t: Token | undefined): boolean =>
    t !== undefined && /^[A-Za-z_$][\w$]*$/.test(t.text);

  /** End index (exclusive) of a literal-only arg list opening at `(` = `at`. */
  const argListEnd = (at: number): number | null => {
    if (tokens[at]?.norm !== '(') return null;
    let k = at + 1;
    let expectArg = true;
    while (k < tokens.length) {
      const norm = tokens[k]!.norm;
      if (norm === ')') return expectArg && k > at + 1 ? null : k + 1;
      if (expectArg && norm === 'LIT') {
        expectArg = false;
        k++;
        continue;
      }
      if (!expectArg && norm === ',') {
        expectArg = true;
        k++;
        continue;
      }
      return null;
    }
    return null;
  };

  while (i < tokens.length) {
    const head = tokens[i]!;
    if (head.norm !== 'ID') {
      out.push(head);
      i++;
      continue;
    }
    let k = i + 1;
    let calls = 0;
    let norm = 'CHAIN:ID';
    // One real-code call disqualifies the WHOLE chain, prefix included:
    // collapsing `rows.slice().reverse()` out of `.map(fn)` would shrink a
    // duplicated pipeline's token weight, which is exactly what must not happen.
    let realArgs = false;
    while (tokens[k]?.norm === '.' && isName(tokens[k + 1])) {
      // A property access ends the chain (`z.number().int().description`); only
      // a call can carry arguments, so only a call can disqualify.
      if (tokens[k + 2]?.norm !== '(') break;
      const end = argListEnd(k + 2);
      if (end === null) {
        realArgs = true;
        break;
      }
      const args = tokens
        .slice(k + 3, end - 1)
        .map((t) => t.norm)
        .join('');
      norm += `.${tokens[k + 1]!.text}(${args})`;
      calls++;
      k = end;
    }
    if (realArgs || calls < MIN_CHAIN_CALLS) {
      out.push(head);
      i++;
      continue;
    }
    const members = tokens.slice(i, k);
    out.push({
      text: members.map((t) => t.text).join(''),
      norm,
      line: head.line,
      endLine: members[members.length - 1]!.endLine,
    });
    i = k;
  }

  return out;
}

/** Tokenize `source`. Never throws — unknown characters emit punctuation tokens. */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const n = source.length;

  const countLines = (text: string): void => {
    for (let k = 0; k < text.length; k++) if (text[k] === '\n') line++;
  };

  while (i < n) {
    const c = source[i]!;

    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }

    // Line comment
    if (c === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }
    // Block comment
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      countLines(source.slice(i, stop));
      i = stop;
      continue;
    }

    // String literals
    if (c === "'" || c === '"') {
      const startLine = line;
      let j = i + 1;
      while (j < n && source[j] !== c) {
        if (source[j] === '\\') j++;
        j++;
      }
      const stop = Math.min(j + 1, n);
      countLines(source.slice(i, stop));
      tokens.push({ text: source.slice(i, stop), norm: 'LIT', line: startLine, endLine: line });
      i = stop;
      continue;
    }

    // Template literal — whole template (including ${…} interiors) = one LIT.
    // Depth tracks nested backticks inside interpolations coarsely via brace depth.
    if (c === '`') {
      const startLine = line;
      let j = i + 1;
      let braceDepth = 0;
      while (j < n) {
        const t = source[j]!;
        if (t === '\\') {
          j += 2;
          continue;
        }
        if (t === '$' && source[j + 1] === '{') {
          braceDepth++;
          j += 2;
          continue;
        }
        if (t === '}' && braceDepth > 0) {
          braceDepth--;
          j++;
          continue;
        }
        if (t === '`' && braceDepth === 0) break;
        j++;
      }
      const stop = Math.min(j + 1, n);
      countLines(source.slice(i, stop));
      tokens.push({ text: source.slice(i, stop), norm: 'LIT', line: startLine, endLine: line });
      i = stop;
      continue;
    }

    // Identifiers / keywords
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < n && isIdentPart(source[j]!)) j++;
      const text = source.slice(i, j);
      tokens.push({ text, norm: KEYWORDS.has(text) ? text : 'ID', line, endLine: line });
      i = j;
      continue;
    }

    // Numbers (integer/float/hex/bin/underscores — coarse run)
    if (isDigit(c)) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(source[j]!)) j++;
      tokens.push({ text: source.slice(i, j), norm: 'LIT', line, endLine: line });
      i = j;
      continue;
    }

    // Punctuation — single char (multi-char operators split; fine for matching)
    tokens.push({ text: c, norm: c, line, endLine: line });
    i++;
  }

  return collapseBuilderChains(tokens);
}
