// @tests: make-noldor-agent-agnostic, outcome-telemetry-and-effectiveness-metrics
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeUsage, claudeProjectDirName } from '../claude';
import { codexUsage } from '../codex';
import { opencodeUsage } from '../opencode';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'noldor-usage-'));
}

describe('claudeUsage', () => {
  it('sums usage from assistant records of the session started after spawn', () => {
    const home = tmp();
    const cwd = '/Users/x/code/repo';
    const dir = join(home, '.claude', 'projects', claudeProjectDirName(cwd));
    mkdirSync(dir, { recursive: true });
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: { usage: { input_tokens: 100, output_tokens: 20 } },
      }),
      JSON.stringify({ type: 'user' }),
      JSON.stringify({
        type: 'assistant',
        message: { usage: { input_tokens: 50, output_tokens: 5 } },
      }),
    ].join('\n');
    writeFileSync(join(dir, 'sess.jsonl'), lines, 'utf8');
    const usage = claudeUsage({ cwd, startedAtMs: Date.now() - 60_000, homeDir: home });
    expect(usage).toEqual({ input: 150, output: 25, total: 175, source: 'claude-jsonl' });
  });
  it('returns null when no session file is newer than spawn start', () => {
    const home = tmp();
    const cwd = '/Users/x/code/repo';
    const dir = join(home, '.claude', 'projects', claudeProjectDirName(cwd));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'old.jsonl'), '{}', 'utf8');
    const past = (Date.now() - 3_600_000) / 1000;
    utimesSync(join(dir, 'old.jsonl'), past, past);
    expect(claudeUsage({ cwd, startedAtMs: Date.now(), homeDir: home })).toBeNull();
  });
  it('returns null on missing store (never throws)', () => {
    expect(claudeUsage({ cwd: '/none', startedAtMs: Date.now(), homeDir: tmp() })).toBeNull();
  });
});

describe('codexUsage', () => {
  it('reads the last token_count event of a session modified during the spawn window', () => {
    const home = tmp();
    const dir = join(home, '.codex', 'sessions');
    mkdirSync(dir, { recursive: true });
    const lines = [
      JSON.stringify({ type: 'token_count', input_tokens: 10, output_tokens: 1 }),
      JSON.stringify({ type: 'token_count', input_tokens: 900, output_tokens: 80 }),
    ].join('\n');
    writeFileSync(join(dir, 's1.jsonl'), lines, 'utf8');
    const usage = codexUsage({ cwd: '/any', startedAtMs: Date.now() - 60_000, homeDir: home });
    expect(usage).toEqual({ input: 900, output: 80, total: 980, source: 'codex-session' });
  });
  it('returns null when records lack token fields', () => {
    const home = tmp();
    const dir = join(home, '.codex', 'sessions');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 's1.jsonl'), JSON.stringify({ type: 'other' }), 'utf8');
    expect(codexUsage({ cwd: '/any', startedAtMs: Date.now() - 60_000, homeDir: home })).toBeNull();
  });
});

describe('opencodeUsage', () => {
  it('sums tokens from message-store records modified during the spawn window', () => {
    const home = tmp();
    const dir = join(home, '.local', 'share', 'opencode', 'storage', 'message');
    mkdirSync(join(dir, 'ses1'), { recursive: true });
    writeFileSync(
      join(dir, 'ses1', 'm1.json'),
      JSON.stringify({ role: 'assistant', tokens: { input: 40, output: 9 } }),
      'utf8',
    );
    const usage = opencodeUsage({ cwd: '/any', startedAtMs: Date.now() - 60_000, homeDir: home });
    expect(usage).toEqual({ input: 40, output: 9, total: 49, source: 'opencode-session' });
  });
  it('returns null when store absent', () => {
    expect(opencodeUsage({ cwd: '/any', startedAtMs: Date.now(), homeDir: tmp() })).toBeNull();
  });
});
