// @tests: rules-cascade-v1
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRulesFromDir } from '../load.js';

function makeRulesDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-rules-'));
  const rulesDir = join(dir, '.noldor', 'rules');
  mkdirSync(rulesDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(rulesDir, name), content);
  }
  return dir;
}

const RULE_A = `---\nid: rule-a\napplies-to: ["src/**/*.ts"]\nstage: [code]\n---\nNamed exports only.\n`;
const RULE_B = `---\nid: rule-b\n---\nStage-agnostic guidance.\n`;

describe('loadRulesFromDir', () => {
  it('loads + normalizes all rule files', () => {
    const dir = makeRulesDir({ 'rule-a.md': RULE_A, 'rule-b.md': RULE_B });
    try {
      const { rules, errors } = loadRulesFromDir(dir);
      expect(errors).toEqual([]);
      expect(rules.map((r) => r.id).sort()).toEqual(['rule-a', 'rule-b']);
      expect(rules.find((r) => r.id === 'rule-a')?.appliesTo).toEqual(['src/**/*.ts']);
      expect(rules.find((r) => r.id === 'rule-b')?.body).toBe('Stage-agnostic guidance.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports filename/id mismatch and skips the file', () => {
    // RULE_A declares `id: rule-a`; neither filename matches it.
    const dir = makeRulesDir({ 'one.md': RULE_A, 'two.md': RULE_A });
    try {
      const { rules, errors } = loadRulesFromDir(dir);
      expect(rules).toEqual([]);
      expect(errors).toHaveLength(2);
      expect(errors.every((e) => e.includes('must match filename'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts a rule whose id equals its filename', () => {
    const dir = makeRulesDir({ 'rule-a.md': RULE_A });
    try {
      const { rules, errors } = loadRulesFromDir(dir);
      expect(errors).toEqual([]);
      expect(rules.map((r) => r.id)).toEqual(['rule-a']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports malformed frontmatter and skips the file', () => {
    const dir = makeRulesDir({ 'bad.md': `---\nid: Bad Id\n---\nx\n`, 'rule-b.md': RULE_B });
    try {
      const { rules, errors } = loadRulesFromDir(dir);
      expect(rules.map((r) => r.id)).toEqual(['rule-b']);
      expect(errors.some((e) => e.includes('bad.md'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not throw on an unreadable entry and collects an error', () => {
    const dir = makeRulesDir({ 'rule-b.md': RULE_B });
    // A subdirectory ending in .md makes readFileSync throw EISDIR.
    mkdirSync(join(dir, '.noldor', 'rules', 'weird.md'));
    try {
      let result!: ReturnType<typeof loadRulesFromDir>;
      expect(() => {
        result = loadRulesFromDir(dir);
      }).not.toThrow();
      expect(result.rules.map((r) => r.id)).toEqual(['rule-b']);
      expect(result.errors.some((e) => e.includes('weird.md'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty for a missing rules dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-norules-'));
    try {
      const { rules, errors } = loadRulesFromDir(dir);
      expect(rules).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
