// @tests: framework-script-test-migration-cleanup
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BoundaryRuleSchema } from '../../core/consumer-config.js';
import { makeBoundariesInvariant } from '../boundaries.js';

// Regex-string rule in dependency-cruiser's forbidden-rule shape — the
// "regex strings, not globs" contract documented in consumer-config.ts.
const RULE = {
  name: 'no-a-to-b',
  severity: 'error' as const,
  from: { path: '^src/a\\.ts$' },
  to: { path: '^src/b\\.ts$' },
};

function writeConsumerConfig(root: string, scanPaths: string[]): void {
  const config = {
    consumer: {
      name: 'fixture',
      repoUrl: 'https://example.com/fixture',
      lockstepPackages: ['package.json'],
      scanPaths,
      boundaries: [RULE],
      deprecatedPackages: [],
      e2ePrefix: 'e2e/',
      samplesPath: 'samples',
      packagePrefix: '@fixture/',
      appPathPrefix: 'src',
    },
  };
  mkdirSync(join(root, '.noldor'), { recursive: true });
  writeFileSync(join(root, '.noldor', 'config.json'), JSON.stringify(config, null, 2));
}

describe('BoundaryRuleSchema', () => {
  it('accepts a dep-cruiser forbidden rule with regex-string paths', () => {
    expect(BoundaryRuleSchema.parse(RULE)).toEqual(RULE);
  });

  it('rejects unknown keys (strict schema)', () => {
    const result = BoundaryRuleSchema.safeParse({ ...RULE, glob: 'src/**' });
    expect(result.success).toBe(false);
  });
});

describe('makeBoundariesInvariant', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'boundaries-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('flags a forbidden import between configured scan paths', async () => {
    writeConsumerConfig(root, ['src']);
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'a.ts'), "import './b';\nexport const a = 1;\n");
    writeFileSync(join(root, 'src', 'b.ts'), 'export const b = 1;\n');
    const result = await makeBoundariesInvariant(root).run();
    expect(result.invariant).toBe('boundaries');
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].file).toBe('src/a.ts');
    expect(result.violations[0].message).toContain('forbidden import (no-a-to-b)');
    expect(result.violations[0].message).toContain('src/b.ts');
  }, 20_000);

  it('returns zero violations when no configured scanPath exists on disk', async () => {
    writeConsumerConfig(root, ['no-such-dir']);
    const result = await makeBoundariesInvariant(root).run();
    expect(result.violations).toEqual([]);
  });
});
