// @tests: single-static-binary-distribution
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { packFileList } from '../pack-list.js';

describe('packFileList', () => {
  it('derives from RUNTIME_ASSETS + templates + package.json, dist-projected', () => {
    const list = packFileList(process.cwd());
    expect(list).toContain('package.json');
    expect(list.some((p) => p.startsWith('templates/'))).toBe(true);
    expect(list).toContain('dist/cr/cr-record.schema.json');
    expect(list).toContain('dist/dashboard/static/dist/agents.js');
    expect(list.every((p) => !p.startsWith('/') && !p.includes('..'))).toBe(true);
  });
});

describe('generate-notices', () => {
  it('lists every production dependency plus the Bun runtime', () => {
    const out = execFileSync('node', ['bin/generate-notices.mjs', '--stdout'], {
      encoding: 'utf8',
    });
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>;
    };
    for (const dep of Object.keys(pkg.dependencies)) expect(out).toContain(`## ${dep}`);
    expect(out).toContain('## Bun runtime');
  });
});
