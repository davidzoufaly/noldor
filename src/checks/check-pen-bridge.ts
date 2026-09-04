// @tests: pendev-ui-design-phase
// Is the pencil bridge wired up? Three questions a stuck UI-design session cannot
// tell apart on its own.
//
// Every pencil MCP call fails with "A file needs to be open in the editor" both
// when the editor genuinely has nothing open AND when the MCP server is pinned to
// a different app than the one holding the file — the server derives its socket
// as ~/.pencil/socket/pencil-<app>.sock from its own `--app` flag, so a mismatch
// talks past a perfectly healthy app forever. That second case reads to an
// operator as a dead bridge, and the usual response is to waive the design step.
// This check names it instead.
//
// The third question is which harness is asking. A perfectly-configured pencil
// entry still yields no bridge when the session runs somewhere the server never
// connects, and that failure looks nothing like the other two — the MCP tools are
// simply absent, so there is no error message to match on and no config edit that
// helps. Config alone cannot answer it, so the harness gets its own row.
//
// Reporting only: nothing here writes configuration, and no commit or push gate
// consumes it.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { runIfDirect } from '../core/cli-entry.js';
import { PENCIL_EXTENSION_ID } from '../core/design-artifact-names.js';
import { listVsCodeExtensions } from '../design/editor-launch.js';

/**
 * The `--app` value the launcher needs, because it opens that editor and no
 * other. The server derives its socket as `~/.pencil/socket/pencil-<app>.sock`,
 * so this string is the whole contract between the two halves.
 */
export const EXPECTED_MCP_APP = 'visual_studio_code';

/** Key of the pencil server under an `mcpServers` object. */
const PENCIL_SERVER_KEY = 'pencil';

/** Env var Claude Code stamps with the harness running the session. */
export const ENTRYPOINT_VAR = 'CLAUDE_CODE_ENTRYPOINT';

/** The entrypoint the terminal CLI stamps — the harness the bridge is known to work under. */
export const WORKING_ENTRYPOINT = 'cli';

/**
 * Entrypoints observed to leave the pencil MCP server unreachable, mapped to the
 * name an operator would recognise.
 *
 * Observed 2026-09-04 in this repo: under `claude-vscode` the pencil server
 * reports `CONNECTION_CLOSED` at session start and none of its tools exist for
 * the rest of the session, while the *same* `~/.claude.json` entry connects from
 * a terminal `claude`. The mechanism is unknown and deliberately not guessed at
 * here; only the observation drives the verdict.
 *
 * An allowlist would be the wrong shape. This file's standing rule is that an
 * unfamiliar configuration reads as indeterminate rather than as a finding, so a
 * harness must be *observed* broken to red — a future `claude-jetbrains` gets a
 * named indeterminate row, not an invented failure.
 */
const BROKEN_ENTRYPOINTS: ReadonlyMap<string, string> = new Map([
  ['claude-vscode', 'the Claude Code VS Code extension'],
]);

export type PenBridgeRow =
  | { kind: 'harness-ok'; entrypoint: string }
  | { kind: 'harness-unsupported'; entrypoint: string; harness: string }
  | { kind: 'harness-indeterminate'; reason: string }
  | { kind: 'mcp-app-ok'; source: string }
  | { kind: 'mcp-app-mismatch'; source: string; found: string }
  | { kind: 'mcp-indeterminate'; reason: string }
  | { kind: 'ext-ok' }
  | { kind: 'ext-missing' }
  | { kind: 'ext-indeterminate'; reason: string }
  | { kind: 'not-applicable'; platform: string };

/** Installed VS Code extension ids, or `undefined` when the list is unreadable. */
export type ExtensionProbe = (cwd: string) => readonly string[] | undefined;

/**
 * Injectable seams. The filesystem is deliberately absent: config files are read
 * for real, and tests build real ones, per the repo's mocking-boundaries rule.
 * Only the platform, the home directory, the subprocess probe and the process
 * environment are faked.
 *
 * `readEnv` is a reader rather than a plain `entrypoint` string because "unset"
 * is a distinct, testable state: a bare `entrypoint?: string` dep could not tell
 * an omitted override from a deliberate absence, so the unset case would fall
 * through to the real `process.env` and pass or fail depending on which harness
 * ran the suite — green in a terminal, red under the very extension this row
 * exists to name.
 */
export interface PenBridgeCheckDeps {
  readonly platform: string;
  readonly home: string;
  readonly probeExtensions: ExtensionProbe;
  readonly readEnv: (name: string) => string | undefined;
}

/**
 * A config source's three outcomes.
 *
 * `missing` and `blocked` are kept apart deliberately, and only `missing` lets
 * scope resolution continue to a lower precedence. A file that EXISTS but cannot
 * be read or parsed must stop the search: falling through would report a lower
 * pin as effective while a higher one — possibly contradicting it — went unread,
 * and the check would exit green on a configuration it never saw.
 */
type JsonSource =
  | { kind: 'found'; value: Record<string, unknown> }
  | { kind: 'missing' }
  | { kind: 'blocked'; reason: string };

/** JSON at `path`, classified per {@link JsonSource}. */
function readJson(path: string): JsonSource {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    // ENOENT is the ordinary "this scope declares nothing" case. Every other
    // errno (EACCES, EISDIR, EIO) means the file is there and the read failed,
    // which is a different fact and earns a different verdict.
    return (e as NodeJS.ErrnoException).code === 'ENOENT'
      ? { kind: 'missing' }
      : { kind: 'blocked', reason: `${path} exists but could not be read (${String(e)})` };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? { kind: 'found', value: parsed as Record<string, unknown> }
      : { kind: 'blocked', reason: `${path} is not a JSON object` };
  } catch (e) {
    return { kind: 'blocked', reason: `${path} is not parseable JSON (${String(e)})` };
  }
}

/** A plain nested object at `key`, or undefined. */
function objectAt(
  host: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const value = host?.[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The pencil server entry inside an `mcpServers` object, if present. */
function pencilEntry(
  mcpServers: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  // Key match only: a command-path heuristic would misfire on a renamed binary.
  return objectAt(mcpServers, PENCIL_SERVER_KEY);
}

/**
 * The `--app` value carried by a server entry's `args`, in either accepted form
 * (`["--app", "x"]` or `["--app=x"]`), or why it could not be read.
 *
 * First occurrence wins, matching how an argv parser reads a repeated flag.
 */
function appFlag(
  entry: Record<string, unknown>,
): { ok: true; value: string } | { ok: false; reason: string } {
  const args = entry['args'];
  if (!Array.isArray(args)) return { ok: false, reason: 'the pencil entry has no args array' };
  const valueless = { ok: false, reason: '--app is present with no value' } as const;
  for (const [i, raw] of args.entries()) {
    if (typeof raw !== 'string') continue;
    if (raw.startsWith('--app=')) {
      // `--app=` carries an empty string, which is an unusable pin rather than a
      // wrong one — reporting it as a mismatch would name '' as the found app.
      const value = raw.slice('--app='.length);
      return value.length === 0 ? valueless : { ok: true, value };
    }
    if (raw !== '--app') continue;
    const next = args[i + 1];
    // A following flag is not this flag's value: `["--app", "--agent", "x"]`
    // would otherwise pin the app to '--agent'.
    return typeof next === 'string' && next.length > 0 && !next.startsWith('-')
      ? { ok: true, value: next }
      : valueless;
  }
  return { ok: false, reason: 'the pencil entry declares no --app' };
}

type Scope = { source: string; entry: Record<string, unknown> };

/**
 * The pencil entry actually in force for `cwd`, following Claude Code's own
 * scope precedence: local (this project's block) beats an approved `.mcp.json`
 * beats the user-wide block.
 *
 * Only `projects[cwd]` is ever consulted. A depth-first "any mcpServers, first
 * hit wins" scan — the shape this replaced — can return a DIFFERENT project's
 * server, whose `--app` says nothing about this repo; a real `~/.claude.json`
 * here carried 23 project blocks, three with their own servers.
 *
 * A source that exists but cannot be parsed ends the search rather than falling
 * through, because a lower scope reported as effective while a higher one was
 * unreadable is the same wrong answer the precedence exists to prevent.
 */
function resolveScope(
  cwd: string,
  home: string,
): { ok: true; scope: Scope } | { ok: false; reason: string } {
  const claude = readJson(join(home, '.claude.json'));
  if (claude.kind === 'blocked') return { ok: false, reason: claude.reason };
  const root = claude.kind === 'found' ? claude.value : undefined;
  const project = objectAt(objectAt(root, 'projects'), cwd);

  const local = pencilEntry(objectAt(project, 'mcpServers'));
  if (local !== undefined)
    return { ok: true, scope: { source: 'local (~/.claude.json)', entry: local } };

  const mcpJson = readJson(join(cwd, '.mcp.json'));
  if (mcpJson.kind === 'blocked') return { ok: false, reason: mcpJson.reason };
  if (mcpJson.kind === 'found') {
    const declared = pencilEntry(objectAt(mcpJson.value, 'mcpServers'));
    // An unapproved .mcp.json server is not in force, so naming its pin would
    // send the operator to edit a file Claude Code is not reading.
    const approved = project?.['enabledMcpjsonServers'];
    if (declared !== undefined && Array.isArray(approved) && approved.includes(PENCIL_SERVER_KEY)) {
      return { ok: true, scope: { source: 'project (.mcp.json)', entry: declared } };
    }
  }

  const user = pencilEntry(objectAt(root, 'mcpServers'));
  return user === undefined
    ? { ok: false, reason: 'no pencil MCP server is configured in any scope for this repo' }
    : { ok: true, scope: { source: 'user (~/.claude.json)', entry: user } };
}

/** The MCP row for `cwd`. Indeterminate is never a mismatch. */
function mcpRow(cwd: string, home: string): PenBridgeRow {
  const resolved = resolveScope(cwd, home);
  if (!resolved.ok) return { kind: 'mcp-indeterminate', reason: resolved.reason };
  const flag = appFlag(resolved.scope.entry);
  if (!flag.ok) return { kind: 'mcp-indeterminate', reason: flag.reason };
  return flag.value === EXPECTED_MCP_APP
    ? { kind: 'mcp-app-ok', source: resolved.scope.source }
    : { kind: 'mcp-app-mismatch', source: resolved.scope.source, found: flag.value };
}

/**
 * The harness row. Reads only {@link ENTRYPOINT_VAR}, which Claude Code sets in
 * every session and which survives into spawned processes — so this command sees
 * the harness that would make the MCP call, not the shell it happens to run in.
 *
 * An absent variable means nobody claimed a harness (a plain terminal, another
 * agent runner, CI). That is not evidence of a working bridge, so it reports
 * indeterminate rather than ok.
 */
function harnessRow(readEnv: (name: string) => string | undefined): PenBridgeRow {
  const entrypoint = readEnv(ENTRYPOINT_VAR);
  if (entrypoint === undefined || entrypoint.length === 0) {
    return {
      kind: 'harness-indeterminate',
      reason: `${ENTRYPOINT_VAR} is unset — this is not a Claude Code session, so which harness will call pencil MCP is unknown`,
    };
  }
  const harness = BROKEN_ENTRYPOINTS.get(entrypoint);
  if (harness !== undefined) return { kind: 'harness-unsupported', entrypoint, harness };
  return entrypoint === WORKING_ENTRYPOINT
    ? { kind: 'harness-ok', entrypoint }
    : {
        kind: 'harness-indeterminate',
        reason: `${ENTRYPOINT_VAR} is '${entrypoint}', which has never been checked against pencil MCP`,
      };
}

/**
 * Everything the pen bridge needs from the machine, as rows a caller prints.
 *
 * Off darwin nothing is probed. `.pen` editing itself is not macOS-bound any
 * more — VS Code and its pen.dev extension run everywhere — but the pencil MCP
 * server has only ever been exercised here, so a row claiming a verdict about
 * another operating system would be an assertion this framework has not earned.
 */
export function checkPenBridge(
  cwd: string,
  deps: Partial<PenBridgeCheckDeps> = {},
): readonly PenBridgeRow[] {
  const platform = deps.platform ?? process.platform;
  if (platform !== 'darwin') return [{ kind: 'not-applicable', platform }];

  const home = deps.home ?? homedir();
  const probe = deps.probeExtensions ?? listVsCodeExtensions;
  const readEnv = deps.readEnv ?? ((name: string): string | undefined => process.env[name]);
  const installed = probe(cwd);
  const extRow: PenBridgeRow =
    installed === undefined
      ? {
          kind: 'ext-indeterminate',
          reason: 'could not read the installed VS Code extensions (no `code` on PATH?)',
        }
      : installed.includes(PENCIL_EXTENSION_ID)
        ? { kind: 'ext-ok' }
        : { kind: 'ext-missing' };
  // Harness first: it decides whether the other two rows can matter at all. A
  // correct pin and an installed extension describe a bridge that still will not
  // carry a call from a harness the server never reaches.
  return [harnessRow(readEnv), mcpRow(cwd, home), extRow];
}

/**
 * How serious a row is, as one exhaustive switch beside the taxonomy it grades.
 *
 * Both the exit code and doctor's prefix read this, so adding a `PenBridgeRow`
 * kind is a compile error here rather than a silent `unknown` in one place and a
 * silent 0 in the other. `finding` is the only level that reds anything.
 */
export function penBridgeRowLevel(row: PenBridgeRow): 'finding' | 'healthy' | 'undetermined' {
  switch (row.kind) {
    case 'harness-unsupported':
    case 'mcp-app-mismatch':
    case 'ext-missing':
      return 'finding';
    case 'harness-ok':
    case 'mcp-app-ok':
    case 'ext-ok':
      return 'healthy';
    case 'harness-indeterminate':
    case 'mcp-indeterminate':
    case 'ext-indeterminate':
    case 'not-applicable':
      return 'undetermined';
  }
}

/**
 * Exit code for the standalone command. Only a finding reds; undetermined and
 * not-applicable rows print without changing it, since inventing a finding from
 * an unfamiliar or absent config would be worse than silence for a consumer on
 * another harness.
 */
export function penBridgeExitCode(rows: readonly PenBridgeRow[]): number {
  return rows.some((r) => penBridgeRowLevel(r) === 'finding') ? 1 : 0;
}

/** Operator-facing line per row, including the remedy where there is one. */
export function renderPenBridgeRow(row: PenBridgeRow): string {
  switch (row.kind) {
    case 'harness-ok':
      return `pen-bridge: running under terminal Claude Code (${ENTRYPOINT_VAR}=${row.entrypoint}) — the harness pencil MCP connects from`;
    case 'harness-unsupported':
      return (
        `pen-bridge: running under ${row.harness} (${ENTRYPOINT_VAR}=${row.entrypoint}), where the pencil MCP server does not connect\n` +
        `  → no configuration change fixes this — do the \`.pen\` work from terminal Claude Code, or hand the UI-design step to the operator`
      );
    case 'harness-indeterminate':
      return `pen-bridge: could not determine whether this harness reaches pencil MCP — ${row.reason}`;
    case 'mcp-app-ok':
      return `pen-bridge: pencil MCP is pinned to '${EXPECTED_MCP_APP}' — ${row.source}`;
    case 'mcp-app-mismatch':
      return (
        `pen-bridge: pencil MCP is pinned to '${row.found}', not '${EXPECTED_MCP_APP}' — ${row.source}\n` +
        `  → set the pencil server's --app to '${EXPECTED_MCP_APP}' in that block, then restart Claude Code (the server reads it once, at startup)`
      );
    case 'mcp-indeterminate':
      return `pen-bridge: could not determine the pencil MCP pin — ${row.reason}`;
    case 'ext-ok':
      return `pen-bridge: the pen.dev VS Code extension is installed (${PENCIL_EXTENSION_ID})`;
    case 'ext-missing':
      return (
        `pen-bridge: the pen.dev VS Code extension (${PENCIL_EXTENSION_ID}) is not installed\n` +
        `  → install it. Without it VS Code opens a \`.pen\` in the text editor and shows the design's raw JSON — a launch that looks fine and wakes no bridge`
      );
    case 'ext-indeterminate':
      return `pen-bridge: could not determine whether the pen.dev VS Code extension is installed — ${row.reason}`;
    case 'not-applicable':
      return `pen-bridge: not applicable on ${row.platform} — the pencil MCP server has only been exercised on macOS`;
  }
}

export async function main(cwd: string = process.cwd()): Promise<number> {
  const rows = checkPenBridge(cwd);
  for (const row of rows) console.log(renderPenBridgeRow(row));
  return penBridgeExitCode(rows);
}

runIfDirect('check-pen-bridge', 'checks pen-bridge', async () => main());
