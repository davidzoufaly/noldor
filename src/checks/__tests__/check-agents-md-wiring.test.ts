// @tests: scaffold-one-agent-rules-file-not-two
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  agentsMdWiring,
  checkAgentsMdWiring,
  importTokens,
  rulesImportFor,
} from '../check-agents-md-wiring.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'noldor-agents-wiring-'));
  writeFileSync(join(dir, 'AGENTS.md'), '# Agent Rules\n');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function write(file: string, content: string): void {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), content);
}

const check = (targets: Parameters<typeof checkAgentsMdWiring>[1] = ['claude']) =>
  checkAgentsMdWiring(dir, targets);

describe('importTokens', () => {
  const targets = (file: string, content: string) =>
    importTokens(file, content).map((t) => t.target);

  it('resolves an import against the directory of the file that holds it', () => {
    expect(targets('CLAUDE.md', '@AGENTS.md\n')).toEqual(['AGENTS.md']);
    expect(targets('CLAUDE.md', '@./AGENTS.md\n')).toEqual(['AGENTS.md']);
    expect(targets('.claude/CLAUDE.md', 'x\n@../AGENTS.md\n')).toEqual(['AGENTS.md']);
    expect(targets('.claude/CLAUDE.md', '@AGENTS.md\n')).toEqual(['.claude/AGENTS.md']);
  });

  it('finds an import in the middle of a sentence, with its position', () => {
    expect(importTokens('CLAUDE.md', 'intro\nFollow the rules in @AGENTS.md now\n')).toEqual([
      { line: 1, start: 20, end: 30, target: 'AGENTS.md', wholeLine: false },
    ]);
  });

  it.each([
    ['inside a fenced code block', '```\n@AGENTS.md\n```'],
    ['inside an inline code span', 'Write `@AGENTS.md` to import it.'],
    ['inside a double-backtick code span', 'Use ``@AGENTS.md`` as an example.'],
    ['inside a span whose delimiters hold a lone backtick', 'Try ``a ` @AGENTS.md`` here.'],
    ['glued to a word, like an email address', 'mail rules@AGENTS.md'],
  ])('does not count an @ %s', (_label, content) => {
    expect(importTokens('CLAUDE.md', content)).toEqual([]);
  });

  it('counts an import after a closed code span, and after a backtick that never closes', () => {
    expect(targets('CLAUDE.md', '``a ` b`` then @AGENTS.md')).toEqual(['AGENTS.md']);
    expect(targets('CLAUDE.md', 'a stray ` then @AGENTS.md')).toEqual(['AGENTS.md']);
  });

  it('ends a path at a CRLF line ending, as at an LF one', () => {
    expect(importTokens('CLAUDE.md', '# P\r\n@AGENTS.md\r\nmore\r\n')).toEqual([
      { line: 1, start: 0, end: 10, target: 'AGENTS.md', wholeLine: true },
    ]);
  });

  it('keeps sentence punctuation in the path, as Claude does, so it names no rules file', () => {
    expect(targets('CLAUDE.md', 'Read @AGENTS.md.')).toEqual(['AGENTS.md.']);
  });
});

describe('rulesImportFor', () => {
  it('writes the import relative to the importing file', () => {
    expect(rulesImportFor('CLAUDE.md')).toBe('@AGENTS.md');
    expect(rulesImportFor('.claude/CLAUDE.md')).toBe('@../AGENTS.md');
    expect(rulesImportFor('CLAUDE.local.md')).toBe('@AGENTS.md');
  });
});

describe('agentsMdWiring', () => {
  const view = (content: string) => ({ content, linksToRulesFile: false });

  it('ignores an import that sits only in CLAUDE.local.md while a project file hides AGENTS.md', () => {
    expect(
      agentsMdWiring({ 'CLAUDE.md': view('# ours\n'), 'CLAUDE.local.md': view('@AGENTS.md\n') }),
    ).toBe('unwired');
  });

  it('counts an import in either project file', () => {
    expect(
      agentsMdWiring({
        'CLAUDE.md': view('# ours\n'),
        '.claude/CLAUDE.md': view('@../AGENTS.md\n'),
      }),
    ).toBe('wired');
  });
});

describe('checkAgentsMdWiring', () => {
  it('passes a repo with no CLAUDE file, where Claude reads AGENTS.md directly', () => {
    expect(check()).toMatchObject({ status: 'no-claude-file', ok: true });
  });

  it('fails a CLAUDE.md that does not import AGENTS.md, naming the line to add', () => {
    write('CLAUDE.md', '# Project\n');
    const result = check();
    expect(result).toMatchObject({ status: 'unwired', ok: false, advisory: false });
    expect(result.detail).toContain("'@AGENTS.md'");
  });

  it('names the file-relative import for a .claude/CLAUDE.md', () => {
    write('.claude/CLAUDE.md', '# Project\n');
    expect(check().detail).toContain("'@../AGENTS.md'");
  });

  it('passes a CLAUDE.md that imports AGENTS.md', () => {
    write('CLAUDE.md', '@AGENTS.md\n\n# Project\n');
    expect(check()).toMatchObject({ status: 'wired', ok: true });
  });

  it('passes a CLAUDE.md that imports AGENTS.md mid-sentence', () => {
    write('CLAUDE.md', '# Project\n\nFollow the rules in @AGENTS.md first.\n');
    expect(check()).toMatchObject({ status: 'wired', ok: true });
  });

  it('passes a CLAUDE.md that is a symlink to AGENTS.md', () => {
    symlinkSync('AGENTS.md', join(dir, 'CLAUDE.md'));
    expect(check()).toMatchObject({ status: 'wired', ok: true });
  });

  it('warns, without failing, when only CLAUDE.local.md hides AGENTS.md', () => {
    write('CLAUDE.local.md', 'my notes\n');
    expect(check()).toMatchObject({ status: 'local-unwired', ok: false, advisory: true });
  });

  it('checks nothing when claude is not an agent target', () => {
    write('CLAUDE.md', '# Project\n');
    expect(check(['codex'])).toMatchObject({ status: 'not-targeted', ok: true });
  });
});
