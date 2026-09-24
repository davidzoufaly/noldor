// @fd: scaffold-one-agent-rules-file-not-two
//
// Claude Code reads `AGENTS.md` only while no CLAUDE file sits on the path. Once
// one does, it reads the CLAUDE files alone, and `AGENTS.md` reaches it only
// through an import (https://code.claude.com/docs/en/memory.md#agents-md). A repo
// that keeps a `CLAUDE.md` without that import runs Claude with none of the
// framework's rules and nothing says so. Like the lefthook check, this verifies
// and never rewrites: the CLAUDE files belong to the consumer.
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import type { RunnerName } from '../core/agent-runner/types.js';

/** CLAUDE files the whole team loads; an import wires everyone only from one of these. */
export const PROJECT_CLAUDE_FILES = ['CLAUDE.md', '.claude/CLAUDE.md'] as const;
/** One person's uncommitted CLAUDE file. It hides `AGENTS.md` too, but only for them. */
export const LOCAL_CLAUDE_FILE = 'CLAUDE.local.md';
/** The framework's rules file, at the repo root. */
export const RULES_FILE = 'AGENTS.md';

export type ClaudeFile = (typeof PROJECT_CLAUDE_FILES)[number] | typeof LOCAL_CLAUDE_FILE;

/** What the wiring predicate needs to know about one CLAUDE file. */
export interface ClaudeFileView {
  readonly content: string;
  readonly linksToRulesFile: boolean;
}

export type ClaudeFileViews = Partial<Record<ClaudeFile, ClaudeFileView>>;

export type AgentsMdWiring = 'wired' | 'unwired' | 'local-unwired' | 'no-claude-file';

/** One `@path` import in a CLAUDE file: where it sits and the repo-relative file it names. */
export interface ImportToken {
  readonly line: number;
  /** Index of the `@` in its line. */
  readonly start: number;
  /** Index just past the path. */
  readonly end: number;
  readonly target: string;
  /** True when the import is the only thing on its line. */
  readonly wholeLine: boolean;
}

/** Whitespace of any kind, `\r` included, so a CRLF file ends a path where an LF one does. */
const isSpace = (ch: string): boolean => ch.trim() === '';

/**
 * Every import in `content` the way Claude Code reads them: an `@` that starts a
 * word, outside fenced code blocks and inline code spans, anywhere in a line. The
 * path runs to the next whitespace or backtick and resolves against the directory
 * of `file`, not the working directory.
 */
export function importTokens(file: string, content: string): ImportToken[] {
  const tokens: ImportToken[] = [];
  let fenced = false;
  content.split('\n').forEach((line, lineNo) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    let inSpan = false;
    let i = 0;
    while (i < line.length) {
      const startsWord = i === 0 || isSpace(line[i - 1]);
      if (line[i] === '`') inSpan = !inSpan;
      if (inSpan || line[i] !== '@' || !startsWord) {
        i++;
        continue;
      }
      let end = i + 1;
      while (end < line.length && !isSpace(line[end]) && line[end] !== '`') end++;
      const path = line.slice(i + 1, end);
      if (path.length > 0) {
        tokens.push({
          line: lineNo,
          start: i,
          end,
          target: posix.normalize(posix.join(posix.dirname(file), path)),
          wholeLine: trimmed === `@${path}`,
        });
      }
      i = end;
    }
  });
  return tokens;
}

/** The import line `file` needs to reach the root rules file (`@../AGENTS.md` from `.claude/`). */
export function rulesImportFor(file: ClaudeFile): string {
  return `@${posix.relative(posix.dirname(file), RULES_FILE)}`;
}

function wires(file: ClaudeFile, view: ClaudeFileView | undefined): boolean {
  return (
    view !== undefined &&
    (view.linksToRulesFile ||
      importTokens(file, view.content).some((token) => token.target === RULES_FILE))
  );
}

/**
 * The one definition of wired. It reads file contents rather than the disk, so
 * the migration can ask it about files it has changed only in memory.
 */
export function agentsMdWiring(views: ClaudeFileViews): AgentsMdWiring {
  const project = PROJECT_CLAUDE_FILES.filter((f) => views[f] !== undefined);
  if (project.length > 0) return project.some((f) => wires(f, views[f])) ? 'wired' : 'unwired';
  if (views[LOCAL_CLAUDE_FILE] === undefined) return 'no-claude-file';
  return wires(LOCAL_CLAUDE_FILE, views[LOCAL_CLAUDE_FILE]) ? 'wired' : 'local-unwired';
}

function linksTo(path: string, target: string): boolean {
  return lstatSync(path).isSymbolicLink() && resolve(dirname(path), readlinkSync(path)) === target;
}

/** The CLAUDE files present at the repo root `cwd`. */
export function readClaudeFiles(cwd: string): ClaudeFileViews {
  const views: ClaudeFileViews = {};
  const files: readonly ClaudeFile[] = [...PROJECT_CLAUDE_FILES, LOCAL_CLAUDE_FILE];
  for (const file of files) {
    const path = join(cwd, file);
    if (!existsSync(path)) continue;
    views[file] = {
      content: readFileSync(path, 'utf8'),
      linksToRulesFile: linksTo(path, join(cwd, RULES_FILE)),
    };
  }
  return views;
}

export interface AgentsMdWiringResult {
  readonly status: AgentsMdWiring | 'not-targeted';
  /** False only for a finding: `unwired` or `local-unwired`. */
  readonly ok: boolean;
  /**
   * True when the finding must warn, never fail: `CLAUDE.local.md` is one
   * person's uncommitted file and absent in CI.
   */
  readonly advisory: boolean;
  /** Operator-facing sentence: what Claude misses, and the one-line repair. */
  readonly detail: string;
}

/**
 * Verify Claude Code can see `AGENTS.md` in the repo at `cwd`. Read-only by
 * contract: a caller acting on a finding may print and exit non-zero, never
 * rewrite the consumer's CLAUDE files.
 *
 * @param targets - The consumer's `agents.targets`; without `claude` there is nothing to wire.
 */
export function checkAgentsMdWiring(
  cwd: string,
  targets: readonly RunnerName[],
): AgentsMdWiringResult {
  if (!targets.includes('claude')) {
    return {
      status: 'not-targeted',
      ok: true,
      advisory: false,
      detail: 'claude is not an agent target',
    };
  }
  const views = readClaudeFiles(cwd);
  const status = agentsMdWiring(views);
  if (status === 'unwired') {
    const files = PROJECT_CLAUDE_FILES.filter((f) => views[f] !== undefined);
    const [first] = files;
    return {
      status,
      ok: false,
      advisory: false,
      detail: `${files.join(' and ')} import${files.length === 1 ? 's' : ''} no ${RULES_FILE}, so Claude Code reads the CLAUDE files instead of ${RULES_FILE} and never sees the framework rules. Repair: add the line '${rulesImportFor(first)}' at the top of ${first}.`,
    };
  }
  if (status === 'local-unwired') {
    return {
      status,
      ok: false,
      advisory: true,
      detail: `${LOCAL_CLAUDE_FILE} imports no ${RULES_FILE}, so for whoever keeps it Claude Code reads it instead of ${RULES_FILE}. Repair: add the line '${rulesImportFor(LOCAL_CLAUDE_FILE)}' to it.`,
    };
  }
  return {
    status,
    ok: true,
    advisory: false,
    detail:
      status === 'wired'
        ? `Claude Code reaches ${RULES_FILE} through a CLAUDE file import`
        : `no CLAUDE file, so Claude Code reads ${RULES_FILE} directly`,
  };
}
