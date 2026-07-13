/**
 * Hand-rolled TS/JS scanner for clone detection — NOT a parser. Comments are
 * skipped; each string/template literal collapses to one `LIT` token;
 * identifiers normalize to `ID` and numeric/string literals to `LIT` in the
 * normalized stream (Type-2 clone matching) while keywords stay verbatim.
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

  return tokens;
}
