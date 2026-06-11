// @tests: make-noldor-agent-agnostic
import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from '../capabilities';
import { CLAUDE_BIN, buildClaudeArgv } from '../runners/claude';
import { CODEX_BIN, buildCodexArgv } from '../runners/codex';
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
    ]);
    expect(CODEX_BIN).toBe('codex');
  });
  it('flips to workspace-write on needsWrite', () => {
    expect(buildCodexArgv({ needsWrite: true })).toEqual([
      'exec',
      '--sandbox',
      'workspace-write',
      '--skip-git-repo-check',
    ]);
  });
});

describe('opencode argv', () => {
  it('builds run argv with permissions skip', () => {
    expect(buildOpencodeArgv('p', {})).toEqual(['run', 'p', '--dangerously-skip-permissions']);
    expect(OPENCODE_BIN).toBe('opencode');
  });
  it('appends provider/model', () => {
    expect(buildOpencodeArgv('p', { model: 'ollama/llama3.2' }).slice(-2)).toEqual([
      '--model',
      'ollama/llama3.2',
    ]);
  });
});
