import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { walkRepo } from '../core/fd-load.js';
import { defineInvariant } from './types.js';
import type { Invariant, InvariantViolation } from './types.js';

/**
 * Split a call's argument list on top-level commas.
 *
 * Naive but sufficient for the text-scan invariants: nesting inside quotes,
 * parens or template holes is the only thing that would mis-split. A trailing
 * comma yields a last element that is blank.
 *
 * @param args - The text between a call's parens.
 * @returns One string per argument, untrimmed.
 */
export function splitArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let i = 0; i < args.length; i++) {
    const ch = args[i]!;
    if (quote !== null) {
      if (ch === quote && args[i - 1] !== '\\') quote = null;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
    } else if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

/** {@link maskNonCode}'s output: the masked text, and whether the lex ended in code. */
export interface MaskedSource {
  /** Same length as the input; non-code characters are spaces, newlines kept. */
  readonly masked: string;
  /** False when a literal ran into a newline or the file ended inside one. */
  readonly clean: boolean;
}

const REGEX_AFTER_PUNCT = new Set('([{},;:=!&|?+-*/%<>~^');
const REGEX_AFTER_WORD = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);
// A `)` closing one of these heads is followed by a statement, so a `/` there
// opens a regex (`if (ok) /re/.test(s)`); after any other `)` it divides.
const STATEMENT_HEADS = new Set(['if', 'while', 'for', 'with']);
const WORD_CHAR = /[\w$]/;

/**
 * Blank every character of `text` that is not code: comments, string literals,
 * regex literals and template text. Template holes stay code, nested templates
 * included. Offsets and line numbers survive because only non-newline
 * characters are replaced, one for one, with spaces.
 *
 * A lexer, not a parser: `/` is a regex or a division by the previous code
 * token, the usual heuristic. A lex that loses track of the file almost always
 * runs a literal into a newline or off the end, so `clean: false` is the signal
 * to distrust the mask rather than scan it.
 *
 * @param text - TypeScript source.
 * @returns The masked text and whether the lex ended cleanly.
 */
export function maskNonCode(text: string): MaskedSource {
  const out = text.split('');
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  const holes: number[] = [];
  const parens: boolean[] = [];
  let clean = true;
  let inTemplate = false;
  let regexAllowed = true;
  let prevWord = '';
  let i = 0;

  const endOfQuoted = (start: number, quote: string): number => {
    let j = start + 1;
    for (; j < text.length; j++) {
      const c = text[j];
      if (c === '\\') j++;
      else if (c === quote) return j + 1;
      else if (c === '\n') break;
    }
    clean = false;
    return j;
  };

  const endOfRegex = (start: number): number => {
    let inClass = false;
    for (let j = start + 1; j < text.length; j++) {
      const c = text[j];
      if (c === '\n') break;
      if (c === '\\') j++;
      else if (inClass) inClass = c !== ']';
      else if (c === '[') inClass = true;
      else if (c === '/') {
        let k = j + 1;
        while (k < text.length && /[a-z]/i.test(text[k]!)) k++;
        return k;
      }
    }
    clean = false;
    const nl = text.indexOf('\n', start);
    return nl === -1 ? text.length : nl;
  };

  while (i < text.length) {
    const c = text[i]!;
    if (inTemplate) {
      if (c === '\\') {
        blank(i, i + 2);
        i += 2;
      } else if (c === '`') {
        blank(i, i + 1);
        i++;
        inTemplate = false;
        regexAllowed = false;
      } else if (c === '$' && text[i + 1] === '{') {
        blank(i, i + 2);
        i += 2;
        holes.push(0);
        inTemplate = false;
        regexAllowed = true;
        prevWord = '';
      } else {
        blank(i, i + 1);
        i++;
      }
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (WORD_CHAR.test(c)) {
      let j = i + 1;
      while (j < text.length && WORD_CHAR.test(text[j]!)) j++;
      prevWord = text.slice(i, j);
      regexAllowed = REGEX_AFTER_WORD.has(prevWord);
      i = j;
      continue;
    }
    const word = prevWord;
    prevWord = '';
    if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      const end = nl === -1 ? text.length : nl;
      blank(i, end);
      i = end;
      prevWord = word;
    } else if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      const end = close === -1 ? text.length : close + 2;
      if (close === -1) clean = false;
      blank(i, end);
      i = end;
      prevWord = word;
    } else if (c === '/' && regexAllowed) {
      const end = endOfRegex(i);
      blank(i, end);
      i = end;
      regexAllowed = false;
    } else if (c === "'" || c === '"') {
      const end = endOfQuoted(i, c);
      blank(i, end);
      i = end;
      regexAllowed = false;
    } else if (c === '`') {
      blank(i, i + 1);
      i++;
      inTemplate = true;
    } else if (c === '}' && holes.length > 0 && holes[holes.length - 1] === 0) {
      holes.pop();
      blank(i, i + 1);
      i++;
      inTemplate = true;
    } else {
      if (c === '{' && holes.length > 0) holes[holes.length - 1]!++;
      if (c === '}' && holes.length > 0) holes[holes.length - 1]!--;
      if (c === '(') parens.push(STATEMENT_HEADS.has(word));
      if (c === ')') regexAllowed = parens.pop() ?? false;
      else if (c === ']' || c === '.') regexAllowed = false;
      else if ((c === '+' || c === '-') && text[i + 1] === c) i++;
      // After a value, `!` is TypeScript's non-null assertion, so the value continues.
      else if (c === '!' && !regexAllowed && text[i + 1] !== '=') regexAllowed = false;
      else regexAllowed = REGEX_AFTER_PUNCT.has(c);
      i++;
    }
  }
  if (inTemplate || holes.length > 0) clean = false;
  return { masked: out.join(''), clean };
}

/**
 * Build an invariant that runs a per-file text scan over every `.ts` file
 * under `<repoRoot>/src`.
 *
 * @param name - Invariant id, as reported.
 * @param description - One-line summary for the runner's listing.
 * @param repoRoot - Repository root whose `src/` tree is scanned.
 * @param scan - Violations for one file, given its repo-relative path and text.
 * @returns A plugin instance bound to that root.
 */
export function defineSrcScanInvariant(
  name: string,
  description: string,
  repoRoot: string,
  scan: (relPath: string, text: string) => InvariantViolation[],
): Invariant {
  return defineInvariant(name, description, async () => {
    const violations: InvariantViolation[] = [];
    const files: string[] = [];
    await walkRepo(join(repoRoot, 'src'), files);
    for (const abs of files) {
      if (!abs.endsWith('.ts')) continue;
      violations.push(...scan(relative(repoRoot, abs), await readFile(abs, 'utf8')));
    }
    return violations;
  });
}
