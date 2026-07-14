import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// @tests: make-noldor-agent-agnostic

const ROOT = join(__dirname, '..', '..', '..');

const skills = (): string[] =>
  readdirSync(join(ROOT, '.claude', 'skills'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

const opencodeCmds = (): string[] =>
  readdirSync(join(ROOT, 'templates', '.opencode', 'command'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort();

const docNum = (label: RegExp): number => {
  const doc = readFileSync(join(ROOT, 'docs', 'noldor', 'agent-runtimes.md'), 'utf8');
  const m = doc.match(label);
  return m ? Number(m[1]) : Number.NaN;
};

const CATALOG_POINTER = 'noldor'; // .opencode/command/noldor.md maps to no skill

describe('interactive shim inventory (drift guard)', () => {
  it('every opencode command shim (except the catalog pointer) names a real skill', () => {
    const skillSet = new Set(skills());
    for (const cmd of opencodeCmds()) {
      if (cmd === CATALOG_POINTER) continue;
      expect(skillSet.has(cmd), `shim ${cmd}.md has no matching .claude/skills/${cmd}`).toBe(true);
    }
  });

  it('agent-runtimes.md Claude-skill count matches .claude/skills/', () => {
    expect(docNum(/\*\*(\d+) Claude skills\*\*/)).toBe(skills().length);
  });

  it('agent-runtimes.md opencode-shim count matches skill-mapped command files', () => {
    const mapped = opencodeCmds().filter((c) => c !== CATALOG_POINTER).length;
    expect(docNum(/\*\*(\d+) opencode command shims\*\*/)).toBe(mapped);
  });

  it('agent-runtimes.md states 0 codex command files (none exist)', () => {
    expect(docNum(/\*\*(\d+) codex command files\*\*/)).toBe(0);
  });
});
