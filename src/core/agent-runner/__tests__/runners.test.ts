// @tests: make-noldor-agent-agnostic, portable-gate-entrypoint-for-non-claude-runners
import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from '../capabilities';
import { CLAUDE_BIN, buildClaudeArgv } from '../runners/claude';
import { CODEX_BIN, CODEX_PROMPT_VIA, buildCodexArgv } from '../runners/codex';
import { OPENCODE_BIN, buildOpencodeArgv } from '../runners/opencode';

describe('capability matrix', () => {
  it('encodes the spec table', () => {
    expect(CAPABILITIES.claude.structuredOutput).toBe('prose');
    expect(CAPABILITIES.codex.structuredOutput).toBe('schema');
    expect(CAPABILITIES.opencode.structuredOutput).toBe('events');
    expect(CAPABILITIES.opencode.supportsLocalModels).toBe(true);
    expect(CAPABILITIES.claude.supportsLocalModels).toBe(false);
    expect(CAPABILITIES.codex.rulesFile).toBe('AGENTS.md');
  });

  it('declares promptDispatch for every runner (portable gate entry, spec Unit 1)', () => {
    expect(CAPABILITIES.claude.promptDispatch).toBe('slash-command');
    expect(CAPABILITIES.codex.promptDispatch).toBe('prose');
    expect(CAPABILITIES.opencode.promptDispatch).toBe('prose');
    // stub mirrors claude: the consumer-contract CI drain e2e replays canned
    // work against today's prompt shapes — keeping stub on the claude shape
    // leaves those fixtures byte-identical (spec D5).
    expect(CAPABILITIES.stub.promptDispatch).toBe('slash-command');
  });
});

describe('claude argv (canonical shape — byte-identical to drain/prep pre-refit)', () => {
  it('builds the canonical headless argv', () => {
    expect(buildClaudeArgv('do x', {})).toEqual([
      '--print',
      'do x',
      '--disallowed-tools',
      'AskUserQuestion',
      '--permission-mode',
      'bypassPermissions',
    ]);
    expect(CLAUDE_BIN).toBe('claude');
  });
  it('appends --model when set', () => {
    expect(buildClaudeArgv('p', { model: 'opus' }).slice(-2)).toEqual(['--model', 'opus']);
  });
});

describe('codex argv (extracted from run-codex.ts)', () => {
  it('read-only sandbox by default, with output schema', () => {
    expect(buildCodexArgv({ schemaPath: '/s.json' })).toEqual([
      'exec',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--output-schema',
      '/s.json',
      '-',
    ]);
    expect(CODEX_BIN).toBe('codex');
  });
  it('flips to workspace-write on needsWrite', () => {
    expect(buildCodexArgv({ needsWrite: true })).toEqual([
      'exec',
      '--sandbox',
      'workspace-write',
      '--skip-git-repo-check',
      '-',
    ]);
  });
  it('always ends with the `-` prompt positional, so stdin delivery is explicit', () => {
    // `codex exec [OPTIONS] [PROMPT]` reads the prompt from stdin when PROMPT is absent
    // OR is `-`. Every consumer already delivers via stdin (CODEX_PROMPT_VIA), so this is
    // behaviour-preserving; it just makes the contract legible at the argv level instead
    // of relying on a reader knowing what an absent positional implies.
    for (const opts of [{}, { needsWrite: true }, { schemaPath: '/s.json' }, { model: 'o3' }]) {
      expect(buildCodexArgv(opts).at(-1)).toBe('-');
    }
    expect(CODEX_PROMPT_VIA).toBe('stdin');
  });
});

describe('opencode argv', () => {
  it('builds run argv with --auto (1.17 replaces --dangerously-skip-permissions)', () => {
    expect(buildOpencodeArgv('p', {})).toEqual(['run', 'p', '--auto']);
    expect(OPENCODE_BIN).toBe('opencode');
  });
  it('appends --format json only when jsonEvents is set', () => {
    expect(buildOpencodeArgv('p', { jsonEvents: true })).toEqual([
      'run',
      'p',
      '--auto',
      '--format',
      'json',
    ]);
    expect(buildOpencodeArgv('p', { jsonEvents: false })).toEqual(['run', 'p', '--auto']);
  });
  it('appends provider/model', () => {
    expect(buildOpencodeArgv('p', { model: 'ollama/llama3.2' }).slice(-2)).toEqual([
      '--model',
      'ollama/llama3.2',
    ]);
  });
});
