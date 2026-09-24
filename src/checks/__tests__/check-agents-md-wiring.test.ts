// @tests: scaffold-one-agent-rules-file-not-two
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  agentsMdWiring,
  checkAgentsMdWiring,
  importLines,
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

describe('importLines', () => {
  it('resolves an import against the directory of the file that holds it', () => {
    expect(importLines('CLAUDE.md', '@AGENTS.md\n', 'AGENTS.md')).toEqual([0]);
    expect(importLines('CLAUDE.md', '@./AGENTS.md\n', 'AGENTS.md')).toEqual([0]);
    expect(importLines('.claude/CLAUDE.md', 'x\n@../AGENTS.md\n', 'AGENTS.md')).toEqual([1]);
  });

  it.each([
    ['a .claude file importing the path as if from the root', '.claude/CLAUDE.md', '@AGENTS.md'],
    ['an import inside a fenced code block', 'CLAUDE.md', '```\n@AGENTS.md\n```'],
    ['a mention in a sentence', 'CLAUDE.md', 'Read @AGENTS.md first.'],
    ['a quoted path', 'CLAUDE.md', '`@AGENTS.md`'],
  ])('does not count %s', (_label, file, content) => {
    expect(importLines(file, content, 'AGENTS.md')).toEqual([]);
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
