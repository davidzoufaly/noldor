// @tests: pendev-ui-design-phase
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  EXPECTED_MCP_APP,
  checkPenBridge,
  penBridgeExitCode,
  type PenBridgeRow,
} from '../check-pen-bridge.js';

/** A pencil server entry with the given `args`, as it appears under `mcpServers`. */
function pencil(args: unknown): Record<string, unknown> {
  return { pencil: { command: '/somewhere/mcp-server', args, type: 'stdio' } };
}

/**
 * A real home + repo pair on disk. The filesystem is a boundary the house rules
 * say to use for real, so every case writes actual JSON rather than scripting a
 * reader.
 */
function fixture(opts: {
  /** Top-level `mcpServers` in ~/.claude.json — the `user` scope. */
  user?: unknown;
  /** `projects[<cwd>].mcpServers` — the `local` scope. */
  local?: unknown;
  /** `projects[<cwd>].enabledMcpjsonServers`. */
  enabled?: readonly string[];
  /** `mcpServers` in <cwd>/.mcp.json — the `project` scope. */
  project?: unknown;
  /** Raw override for ~/.claude.json, for malformed-input cases. */
  rawClaudeJson?: string;
  /** Another project's block, to prove it is never consulted. */
  otherProject?: { path: string; mcpServers: unknown };
  claudeJson?: boolean;
}): { cwd: string; home: string } {
  const home = mkdtempSync(join(tmpdir(), 'pen-bridge-home-'));
  const cwd = mkdtempSync(join(tmpdir(), 'pen-bridge-repo-'));

  if (opts.rawClaudeJson !== undefined) {
    writeFileSync(join(home, '.claude.json'), opts.rawClaudeJson);
  } else if (opts.claudeJson !== false) {
    const projects: Record<string, unknown> = {};
    if (opts.local !== undefined || opts.enabled !== undefined) {
      projects[cwd] = {
        ...(opts.local === undefined ? {} : { mcpServers: opts.local }),
        ...(opts.enabled === undefined ? {} : { enabledMcpjsonServers: opts.enabled }),
      };
    }
    if (opts.otherProject !== undefined) {
      projects[opts.otherProject.path] = { mcpServers: opts.otherProject.mcpServers };
    }
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({
        ...(opts.user === undefined ? {} : { mcpServers: opts.user }),
        ...(Object.keys(projects).length === 0 ? {} : { projects }),
      }),
    );
  }

  if (opts.project !== undefined) {
    writeFileSync(join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: opts.project }));
  }
  return { cwd, home };
}

/** Rows for a fixture, with the app probe pinned so only MCP rows vary. */
function rows(
  f: { cwd: string; home: string },
  probe: 'ok' | 'missing' | 'indeterminate' = 'ok',
): readonly PenBridgeRow[] {
  return checkPenBridge(f.cwd, { platform: 'darwin', home: f.home, probeBundle: () => probe });
}

/** The single MCP row from a run. */
function mcpRow(f: { cwd: string; home: string }): PenBridgeRow {
  const row = rows(f).find((r) => r.kind.startsWith('mcp-'));
  if (row === undefined) throw new Error('no mcp row');
  return row;
}

describe('checkPenBridge — the --app pin', () => {
  it.each([
    ['a separate value', ['--app', 'desktop', '--agent', 'claudeCodeCLI']],
    ['an inline value', ['--app=desktop', '--agent=claudeCodeCLI']],
  ])('accepts %s of desktop', (_label, args) => {
    expect(mcpRow(fixture({ user: pencil(args) }))).toEqual({
      kind: 'mcp-app-ok',
      source: 'user (~/.claude.json)',
    });
  });

  it.each([
    ['the VS Code extension', ['--app', 'visual_studio_code']],
    ['an app nobody has heard of', ['--app', 'emacs']],
  ])('reports %s as a mismatch, naming what it found', (_label, args) => {
    const row = mcpRow(fixture({ user: pencil(args) }));
    expect(row.kind).toBe('mcp-app-mismatch');
    expect(row).toMatchObject({ found: args[1] });
  });

  it('reads the first --app when the flag repeats', () => {
    const row = mcpRow(fixture({ user: pencil(['--app', 'desktop', '--app', 'emacs']) }));
    expect(row.kind).toBe('mcp-app-ok');
  });
});

describe('checkPenBridge — scope precedence', () => {
  // Claude Code resolves local over project over user, so a check that reports a
  // lower scope sends the operator to edit a block that is not in force.
  it('prefers the local project block over the user block', () => {
    const row = mcpRow(
      fixture({
        user: pencil(['--app', 'desktop']),
        local: pencil(['--app', 'visual_studio_code']),
      }),
    );
    expect(row).toMatchObject({ kind: 'mcp-app-mismatch', source: 'local (~/.claude.json)' });
  });

  it('prefers an approved .mcp.json over the user block', () => {
    const row = mcpRow(
      fixture({
        user: pencil(['--app', 'desktop']),
        project: pencil(['--app', 'visual_studio_code']),
        enabled: ['pencil'],
      }),
    );
    expect(row).toMatchObject({ kind: 'mcp-app-mismatch', source: 'project (.mcp.json)' });
  });

  // An unapproved .mcp.json server is not in force, so reporting its pin would
  // name a configuration Claude Code is not using.
  it('ignores an unapproved .mcp.json and falls through to the user block', () => {
    const row = mcpRow(
      fixture({
        user: pencil(['--app', 'desktop']),
        project: pencil(['--app', 'visual_studio_code']),
        enabled: [],
      }),
    );
    expect(row).toEqual({ kind: 'mcp-app-ok', source: 'user (~/.claude.json)' });
  });

  // Measured on a real machine: ~/.claude.json held 23 projects, three with
  // their own mcpServers. A depth-first "first hit wins" scan can return one of
  // those, whose --app says nothing about this repo.
  it('never reads another project’s mcpServers block', () => {
    const row = mcpRow(
      fixture({
        user: pencil(['--app', 'desktop']),
        otherProject: { path: '/somewhere/else', mcpServers: pencil(['--app', 'emacs']) },
      }),
    );
    expect(row).toEqual({ kind: 'mcp-app-ok', source: 'user (~/.claude.json)' });
  });
});

describe('checkPenBridge — indeterminate never becomes a finding', () => {
  it.each([
    ['unparseable JSON', { rawClaudeJson: '{ not json' }],
    ['no config at all', { claudeJson: false }],
    ['no pencil entry in any scope', { user: { other: { command: 'x', args: [] } } }],
    ['a pencil entry with no args', { user: { pencil: { command: 'x' } } }],
    ['a non-array args', { user: pencil('--app desktop') }],
    ['args carrying no --app', { user: pencil(['--agent', 'claudeCodeCLI']) }],
    ['--app with nothing after it', { user: pencil(['--agent', 'x', '--app']) }],
    ['an inline --app with an empty value', { user: pencil(['--app=']) }],
    ['--app followed by another flag', { user: pencil(['--app', '--agent', 'x']) }],
  ])('reports %s as indeterminate with a reason', (_label, opts) => {
    const row = mcpRow(fixture(opts));
    expect(row.kind).toBe('mcp-indeterminate');
    expect(row).toMatchObject({ reason: expect.stringMatching(/\S/) as unknown as string });
  });

  // Falling through would report a lower-precedence pin as effective while a
  // higher one existed but could not be read.
  it('stops the search on a malformed higher-precedence source', () => {
    const home = mkdtempSync(join(tmpdir(), 'pen-bridge-home-'));
    const cwd = mkdtempSync(join(tmpdir(), 'pen-bridge-repo-'));
    writeFileSync(join(home, '.claude.json'), '{ broken');
    writeFileSync(join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: pencil(['--app', 'x']) }));
    expect(mcpRow({ cwd, home }).kind).toBe('mcp-indeterminate');
  });

  // An unreadable file is not an absent one. Treating the two alike lets a
  // higher-precedence source that EXISTS fall through, so a lower pin gets
  // reported as effective and the check exits green on a config it never read.
  it('stops the search on an unreadable higher-precedence source', () => {
    const home = mkdtempSync(join(tmpdir(), 'pen-bridge-home-'));
    const cwd = mkdtempSync(join(tmpdir(), 'pen-bridge-repo-'));
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({ mcpServers: pencil(['--app', 'desktop']) }),
    );
    // A directory where a file is expected: readFileSync throws EISDIR, not ENOENT.
    mkdirSync(join(cwd, '.mcp.json'));
    const row = mcpRow({ cwd, home });
    expect(row.kind).toBe('mcp-indeterminate');
  });
});

describe('checkPenBridge — the app row', () => {
  it.each([
    ['ok', 'app-ok'],
    ['missing', 'app-missing'],
    ['indeterminate', 'app-indeterminate'],
  ] as const)('maps a %s probe to %s', (probe, kind) => {
    const found = rows(fixture({ user: pencil(['--app', 'desktop']) }), probe);
    expect(found.some((r) => r.kind === kind)).toBe(true);
  });
});

describe('checkPenBridge — platform gating', () => {
  it.each(['linux', 'win32'])(
    'returns one not-applicable row on %s, probing nothing',
    (platform) => {
      let probed = false;
      const f = fixture({ user: pencil(['--app', 'visual_studio_code']) });
      const found = checkPenBridge(f.cwd, {
        platform,
        home: f.home,
        probeBundle: () => {
          probed = true;
          return 'ok';
        },
      });
      expect(found).toEqual([{ kind: 'not-applicable', platform }]);
      expect(probed).toBe(false);
    },
  );
});

describe('penBridgeExitCode', () => {
  it('reds only on a mismatch or a missing app', () => {
    expect(penBridgeExitCode([{ kind: 'mcp-app-mismatch', source: 's', found: 'x' }])).toBe(1);
    expect(penBridgeExitCode([{ kind: 'app-missing' }])).toBe(1);
  });

  it.each([
    ['a clean machine', [{ kind: 'mcp-app-ok', source: 's' }, { kind: 'app-ok' }]],
    ['indeterminate rows', [{ kind: 'mcp-indeterminate', reason: 'r' }]],
    ['an unsupported platform', [{ kind: 'not-applicable', platform: 'linux' }]],
  ] as [string, PenBridgeRow[]][])('stays green on %s', (_label, given) => {
    expect(penBridgeExitCode(given)).toBe(0);
  });
});

describe('EXPECTED_MCP_APP', () => {
  it('is the pen.dev desktop app', () => {
    expect(EXPECTED_MCP_APP).toBe('desktop');
  });
});
