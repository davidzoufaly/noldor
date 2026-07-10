import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * One fenced code block extracted from a markdown artifact. Line spans point
 * at the fence lines themselves (not the content) so operators can jump
 * directly to either fence in their editor.
 */
export interface FencedBlock {
  readonly index: number;
  readonly lang: string;
  readonly content: string;
  readonly startLine: number;
  readonly endLine: number;
}

const FENCE = '```';

/**
 * Returns the language tag if `line` opens a fenced block, else `null`.
 * Equivalent to the markdown spec for fence-open lines: three backticks
 * immediately followed by an optional non-whitespace info-string, then only
 * whitespace until end of line.
 */
function parseOpenFence(line: string): string | null {
  if (!line.startsWith(FENCE)) return null;
  const rest = line.slice(FENCE.length);
  let split = 0;
  while (split < rest.length && rest[split] !== ' ' && rest[split] !== '\t') {
    split += 1;
  }
  const lang = rest.slice(0, split);
  const tail = rest.slice(split);
  if (tail.trim() !== '') return null;
  return lang;
}

function isCloseFence(line: string): boolean {
  if (!line.startsWith(FENCE)) return false;
  return line.slice(FENCE.length).trim() === '';
}

/**
 * One lint finding produced by scanning a fenced code block. `rule` is the
 * stable identifier (e.g. `R1`) so callers can suppress or group by rule.
 */
export interface Finding {
  readonly rule: string;
  readonly blockIndex: number;
  readonly lang: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly message: string;
}

/**
 * Unclosed open fences (no matching close before EOF) yield no block — the
 * parser does not synthesise a block spanning the orphan open to EOF, which
 * would mask the rest of the document as one giant snippet.
 */
export function extractFencedBlocks(md: string): readonly FencedBlock[] {
  const lines = md.split('\n');
  const blocks: FencedBlock[] = [];
  let i = 0;
  let index = 0;
  while (i < lines.length) {
    const lang = parseOpenFence(lines[i]);
    if (lang === null) {
      i += 1;
      continue;
    }
    const startLine = i + 1;
    let j = i + 1;
    while (j < lines.length && !isCloseFence(lines[j])) {
      j += 1;
    }
    if (j >= lines.length) {
      // Unclosed open fence — advance past the opening line rather than `break`-ing
      // out of the scan. In markdown semantics any later ``` would pair with this
      // open, so reaching here means no bare ``` exists in the remainder — there
      // are no further blocks to recover either way. The advance keeps the loop's
      // termination contract uniform with the closed-block path.
      i += 1;
      continue;
    }
    const content = lines.slice(i + 1, j).join('\n');
    blocks.push({
      index,
      lang,
      content,
      startLine,
      endLine: j + 1,
    });
    index += 1;
    i = j + 1;
  }
  return blocks;
}

/**
 * Match an assignment like `const SHA_RE = /^[...]+$/` or
 * `let ID_REGEX = /[...]/`. Capture group 1 = binding name (must end `_RE`
 * or `_REGEX`); group 2 = the character class including its surrounding
 * brackets.
 */
const R1_BINDING_RE = /\b(?:const|let|var)\s+([A-Z][A-Z0-9_]*_RE(?:GEX)?)\s*=\s*\/\^?(\[[^\]]*\])/g;

/**
 * Returns true iff a regex char-class body admits a literal `-`. Distinguishes
 * range operators (`A-Z`) from literal hyphens (position-literal at start/end,
 * or escaped `\-` anywhere). Receives the body without surrounding brackets.
 *
 * - `-` at index 0 → literal (no left operand for a range).
 * - `-` at the last index, not preceded by `\` → literal (no right operand).
 * - `\-` anywhere → literal (explicitly escaped).
 * - `-` between two characters (e.g. `A-Z`) → range operator, not literal.
 */
function admitsLiteralHyphen(body: string): boolean {
  if (body.length === 0) return false;
  if (body[0] === '-') return true;
  const last = body.length - 1;
  if (body[last] === '-' && body[last - 1] !== '\\') return true;
  for (let i = 0; i < body.length - 1; i += 1) {
    if (body[i] === '\\' && body[i + 1] === '-') return true;
  }
  return false;
}

function r1Lint(block: FencedBlock): Finding[] {
  const out: Finding[] = [];
  // Reset lastIndex defensively in case of stateful /g regex reuse.
  R1_BINDING_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = R1_BINDING_RE.exec(block.content)) !== null) {
    const [, name, charClass] = match;
    const body = charClass.slice(1, -1);
    if (!admitsLiteralHyphen(body)) continue;
    out.push({
      rule: 'R1',
      blockIndex: block.index,
      lang: block.lang,
      startLine: block.startLine,
      endLine: block.endLine,
      message:
        `Regex \`${name}\` admits a literal \`-\` in its character class. The pattern matches strings ` +
        `composed of the admitted alphabet — including strings starting with \`-\` (e.g. \`--unknown\`). ` +
        `If this is meant as a strict validator, tighten the alphabet to the exact set you intend ` +
        `(e.g. \`[A-Fa-f0-9]\` for SHA hex). If \`-\` is intentional, the binding name signals strict ` +
        `validation — consider renaming so future readers do not assume the validator rejects \`-\`.`,
    });
  }
  return out;
}

const MESSAGE_FLAG_TOKENS = ['-F', '--file', '-m', '--message'] as const;

interface TokenMatch {
  readonly token: string;
  readonly displayName: string;
}

/**
 * Returns true iff `line` contains `flag` as a whole token (exact match) or
 * as the key portion of a `flag=value` token. Splits on whitespace, so the
 * check is immune to partial-word false positives (e.g. `--file` does not
 * match inside `--filename`).
 */
function lineContainsFlag(line: string, flag: string): boolean {
  // /\s+/ rather than ' ' so tab-separated tokens in shell snippets still split.
  for (const token of line.split(/\s+/)) {
    if (token === flag) return true;
    if (token.startsWith(`${flag}=`)) return true;
  }
  return false;
}

/**
 * Returns the first message-providing flag found in `line`, or `null` if none
 * are present. The returned `displayName` is the flag token itself, so it
 * appears verbatim in diagnostic messages.
 */
function findMessageFlag(line: string): TokenMatch | null {
  for (const token of MESSAGE_FLAG_TOKENS) {
    if (lineContainsFlag(line, token)) return { token, displayName: token };
  }
  return null;
}

/**
 * Returns true iff `line` contains a `git commit` invocation. Skips shell
 * comments (lines whose first non-whitespace character is `#`). Uses token
 * adjacency rather than regex so partial matches like `git-commit` or
 * `gitcommit` are not treated as invocations.
 */
function isGitCommitLine(line: string): boolean {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('#')) return false;
  // /\s+/ rather than ' ' so tab-separated tokens in shell snippets still split.
  const tokens = trimmed.split(/\s+/);
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (tokens[i] === 'git' && tokens[i + 1] === 'commit') return true;
  }
  return false;
}

function r2Lint(block: FencedBlock): Finding[] {
  const out: Finding[] = [];
  for (const line of block.content.split('\n')) {
    if (!isGitCommitLine(line)) continue;
    if (!lineContainsFlag(line, '--amend')) continue;
    if (!lineContainsFlag(line, '--no-edit')) continue;
    const messageFlag = findMessageFlag(line);
    if (messageFlag === null) continue;
    out.push({
      rule: 'R2',
      blockIndex: block.index,
      lang: block.lang,
      startLine: block.startLine,
      endLine: block.endLine,
      message:
        `\`git commit --amend --no-edit\` is mutually exclusive with \`${messageFlag.displayName}\`. ` +
        `\`--no-edit\` keeps the existing commit message; the message-providing flag is silently ignored ` +
        `or errors depending on git version. Drop \`--no-edit\` if you mean to replace the message, ` +
        `or drop \`${messageFlag.displayName}\` if you mean to keep it.`,
    });
  }
  return out;
}

/**
 * Run every static rule against every fenced block in a markdown artifact.
 * Pure function — no I/O, no process.exit. The CLI wrapper composes this
 * with file reading and exit-code handling.
 */
export function lintSnippets(md: string): readonly Finding[] {
  const blocks = extractFencedBlocks(md);
  const findings: Finding[] = [];
  for (const block of blocks) {
    findings.push(...r1Lint(block));
    findings.push(...r2Lint(block));
  }
  return findings;
}

function formatFindingHuman(f: Finding): string {
  const langTag = f.lang.length === 0 ? '' : `, ${f.lang}`;
  return `[${f.rule}] block #${f.blockIndex} (lines ${f.startLine}-${f.endLine}${langTag}): ${f.message}`;
}

function main(argv: readonly string[]): number {
  const args = argv.slice(2);
  const json = args.includes('--json');
  const positional = args.filter((a) => !a.startsWith('--'));
  const path = positional[0];
  if (path === undefined) {
    // Errors emit on stdout (not stderr) so /noldor-gate Step 2.5 surfaces them in the
    // review-handoff prompt; the CLI's only consumer captures stdout.
    process.stdout.write('usage: pnpm lint:plan-snippets <artifact-path> [--json]\n');
    return 1;
  }
  let md: string;
  try {
    md = readFileSync(path, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(
      `usage: pnpm lint:plan-snippets <artifact-path> [--json]\nerror: ${message}\n`,
    );
    return 1;
  }
  const findings = lintSnippets(md);
  if (json) {
    process.stdout.write(JSON.stringify(findings, null, 2));
    return findings.length === 0 ? 0 : 2;
  }
  if (findings.length === 0) return 0;
  for (const f of findings) {
    process.stdout.write(`${formatFindingHuman(f)}\n`);
  }
  return 2;
}

const invokedDirect =
  typeof process.argv[1] === 'string' && basename(process.argv[1]).startsWith('lint-plan-snippets');
if (invokedDirect) {
  process.exit(main(process.argv));
}
