import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BINARY_PREREQUISITES,
  MATRIX_LINK,
  REQUIRED_CONSUMER_SCRIPTS,
  checkBinaryPrerequisites,
  checkConsumerScripts,
} from '../prerequisites';

describe('BINARY_PREREQUISITES', () => {
  it('declares the documented floor set (node, pnpm, git, gh, lefthook)', () => {
    expect(BINARY_PREREQUISITES.map((p) => p.id).toSorted()).toEqual([
      'gh',
      'git',
      'lefthook',
      'node',
      'pnpm',
    ]);
    for (const p of BINARY_PREREQUISITES) {
      expect(p.floor).toMatch(/^\d+(\.\d+)*$/);
      expect(p.whereAssumed.length).toBeGreaterThan(0);
    }
  });
});

describe('checkBinaryPrerequisites', () => {
  it('ok / missing / below-floor per probe result', () => {
    const versions: Record<string, string | null> = {
      node: '22.1.0',
      pnpm: '9.7.1',
      git: '2.20.0', // below the 2.30 floor
      gh: null, // not on PATH
      lefthook: '1.13.0',
    };
    const checks = checkBinaryPrerequisites((bin) => versions[bin] ?? null);
    const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(byId['node']!.status).toBe('ok');
    expect(byId['pnpm']!.status).toBe('ok');
    expect(byId['git']!.status).toBe('below-floor');
    expect(byId['git']!.detail).toContain('2.20.0');
    expect(byId['gh']!.status).toBe('missing');
    expect(byId['gh']!.detail).toContain('not found on PATH');
    expect(byId['lefthook']!.status).toBe('ok');
  });

  it('names the matrix link so doctor output can point at the adoption guide', () => {
    expect(MATRIX_LINK).toBe('docs/noldor/adoption-guide.md#prerequisites');
  });
});

describe('checkConsumerScripts', () => {
  it('flags scripts the lefthook template invokes but the consumer lacks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-prereq-'));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'consumer', scripts: { lint: 'oxlint', test: 'vitest run' } }),
    );
    const checks = checkConsumerScripts(dir);
    const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(byId['script:lint']!.status).toBe('ok');
    expect(byId['script:test']!.status).toBe('ok');
    expect(byId['script:fmt']!.status).toBe('missing');
    expect(byId['script:fmt:check']!.status).toBe('missing');
    expect(byId['script:fmt:check']!.detail).toContain('lefthook');
  });

  it('reports every required script missing when package.json is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-prereq-empty-'));
    const checks = checkConsumerScripts(dir);
    expect(checks).toHaveLength(REQUIRED_CONSUMER_SCRIPTS.length);
    expect(checks.every((c) => c.status === 'missing')).toBe(true);
  });
});
