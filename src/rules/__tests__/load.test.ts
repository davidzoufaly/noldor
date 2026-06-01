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
    const { rules, errors } = loadRulesFromDir(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(errors).toEqual([]);
    expect(rules.map((r) => r.id).sort()).toEqual(['rule-a', 'rule-b']);
    expect(rules.find((r) => r.id === 'rule-a')?.appliesTo).toEqual(['src/**/*.ts']);
    expect(rules.find((r) => r.id === 'rule-b')?.body).toBe('Stage-agnostic guidance.');
  });

  it('reports duplicate ids as errors, not throws', () => {
    const dir = makeRulesDir({ 'one.md': RULE_A, 'two.md': RULE_A });
    const { rules, errors } = loadRulesFromDir(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(rules).toHaveLength(1);
    expect(errors.some((e) => e.includes('duplicate id'))).toBe(true);
  });

  it('reports malformed frontmatter and skips the file', () => {
    const dir = makeRulesDir({ 'bad.md': `---\nid: Bad Id\n---\nx\n`, 'ok.md': RULE_B });
    const { rules, errors } = loadRulesFromDir(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(rules.map((r) => r.id)).toEqual(['rule-b']);
    expect(errors.some((e) => e.includes('bad.md'))).toBe(true);
  });

  it('returns empty for a missing rules dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-norules-'));
    const { rules, errors } = loadRulesFromDir(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(rules).toEqual([]);
    expect(errors).toEqual([]);
  });
});
