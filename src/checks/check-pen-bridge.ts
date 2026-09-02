// @tests: pendev-ui-design-phase
// Is the pencil bridge wired up? Two questions a stuck UI-design session cannot
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
// Reporting only: nothing here writes configuration, and no commit or push gate
// consumes it.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { runIfDirect } from '../core/cli-entry.js';
import { PENCIL_BUNDLE_ID } from '../design/pen-bridge.js';

/** The `--app` value the launcher needs, because it opens that app and no other. */
export const EXPECTED_MCP_APP = 'desktop';

/** Key of the pencil server under an `mcpServers` object. */
const PENCIL_SERVER_KEY = 'pencil';

export type PenBridgeRow =
  | { kind: 'mcp-app-ok'; source: string }
  | { kind: 'mcp-app-mismatch'; source: string; found: string }
  | { kind: 'mcp-indeterminate'; reason: string }
  | { kind: 'app-ok' }
  | { kind: 'app-missing' }
  | { kind: 'app-indeterminate'; reason: string }
  | { kind: 'not-applicable'; platform: string };

export type BundleProbe = (bundleId: string) => 'ok' | 'missing' | 'indeterminate';

/**
 * Injectable seams. The filesystem is deliberately absent: config files are read
 * for real, and tests build real ones, per the repo's mocking-boundaries rule.
 * Only the platform, the home directory and the subprocess probe are faked.
 */
export interface PenBridgeCheckDeps {
  readonly platform: string;
  readonly home: string;
  readonly probeBundle: BundleProbe;
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
 * Does an application claim {@link PENCIL_BUNDLE_ID}?
 *
 * Spotlight, not `open -b`. `open` is the launcher's mechanism and it would
 * START the app — a side effect on a read-only diagnostic, and one that would
 * raise a design canvas every time `doctor` ran.
 */
export function probeBundleViaSpotlight(bundleId: string): 'ok' | 'missing' | 'indeterminate' {
  const run = spawnSync('mdfind', [`kMDItemCFBundleIdentifier == '${bundleId}'`], {
    encoding: 'utf8',
    timeout: 5_000,
  });
  if (run.error !== undefined || run.status !== 0) return 'indeterminate';
  return (run.stdout ?? '').trim().length > 0 ? 'ok' : 'missing';
}

/**
 * Everything the pen bridge needs from the machine, as rows a caller prints.
 *
 * Off darwin nothing is probed: there is no `open`, no bundle id and no
 * Spotlight, so every row this could return would be an answer about a different
 * operating system.
 */
export function checkPenBridge(
  cwd: string,
  deps: Partial<PenBridgeCheckDeps> = {},
): readonly PenBridgeRow[] {
  const platform = deps.platform ?? process.platform;
  if (platform !== 'darwin') return [{ kind: 'not-applicable', platform }];

  const home = deps.home ?? homedir();
  const probe = deps.probeBundle ?? probeBundleViaSpotlight;
  const app = probe(PENCIL_BUNDLE_ID);
  const appRow: PenBridgeRow =
    app === 'ok'
      ? { kind: 'app-ok' }
      : app === 'missing'
        ? { kind: 'app-missing' }
        : { kind: 'app-indeterminate', reason: 'could not ask Spotlight for the pencil bundle' };
  return [mcpRow(cwd, home), appRow];
}

/**
 * Exit code for the standalone command. Only a mismatch or a missing app is a
 * real finding; indeterminate and not-applicable print without reddening, since
 * inventing a finding from an unfamiliar or absent config would be worse than
 * silence for a consumer on another harness.
 */
export function penBridgeExitCode(rows: readonly PenBridgeRow[]): number {
  return rows.some((r) => r.kind === 'mcp-app-mismatch' || r.kind === 'app-missing') ? 1 : 0;
}

/** Operator-facing line per row, including the remedy where there is one. */
export function renderPenBridgeRow(row: PenBridgeRow): string {
  switch (row.kind) {
    case 'mcp-app-ok':
      return `pen-bridge: pencil MCP is pinned to '${EXPECTED_MCP_APP}' — ${row.source}`;
    case 'mcp-app-mismatch':
      return (
        `pen-bridge: pencil MCP is pinned to '${row.found}', not '${EXPECTED_MCP_APP}' — ${row.source}\n` +
        `  → set the pencil server's --app to '${EXPECTED_MCP_APP}' in that block, then restart Claude Code (the server reads it once, at startup)`
      );
    case 'mcp-indeterminate':
      return `pen-bridge: could not determine the pencil MCP pin — ${row.reason}`;
    case 'app-ok':
      return `pen-bridge: the pen.dev desktop app is installed (${PENCIL_BUNDLE_ID})`;
    case 'app-missing':
      return `pen-bridge: no application is registered for ${PENCIL_BUNDLE_ID}\n  → install the pen.dev desktop app`;
    case 'app-indeterminate':
      return `pen-bridge: could not determine whether the pen.dev desktop app is installed — ${row.reason}`;
    case 'not-applicable':
      return `pen-bridge: not applicable on ${row.platform} — the pen.dev desktop app is macOS-only`;
  }
}

export async function main(cwd: string = process.cwd()): Promise<number> {
  const rows = checkPenBridge(cwd);
  for (const row of rows) console.log(renderPenBridgeRow(row));
  return penBridgeExitCode(rows);
}

runIfDirect('check-pen-bridge', 'checks pen-bridge', async () => main());
