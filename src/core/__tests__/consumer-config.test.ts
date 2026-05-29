import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadConsumerConfig,
  ConsumerConfigSchema,
  BoundaryRuleSchema,
} from '../consumer-config.js';

function makeTmpRepo(config: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-consumer-cfg-'));
  mkdirSync(join(dir, '.noldor'), { recursive: true });
  writeFileSync(join(dir, '.noldor', 'config.json'), JSON.stringify(config));
  return dir;
}

describe('loadConsumerConfig', () => {
  it('returns parsed consumer block when present', () => {
    const dir = makeTmpRepo({
      consumer: {
        name: 'charuy',
        repoUrl: 'https://github.com/x/y',
        lockstepPackages: ['apps/web/package.json'],
        scanPaths: ['apps/web/src'],
        boundaries: [],
        deprecatedPackages: [],
        e2ePrefix: 'apps/web/e2e/',
        samplesPath: 'apps/web/public/samples',
        packagePrefix: '@charuy/',
        pnpmStderrPrefix: 'charuy@',
        appPathPrefix: 'apps/web/',
      },
    });
    try {
      const cfg = loadConsumerConfig(dir);
      expect(cfg.name).toBe('charuy');
      expect(cfg.lockstepPackages).toEqual(['apps/web/package.json']);
      expect(cfg.packagePrefix).toBe('@charuy/');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws when consumer block missing', () => {
    const dir = makeTmpRepo({ crLanes: { spec: ['subagent'] } });
    try {
      expect(() => loadConsumerConfig(dir)).toThrow(/consumer/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws when config.json missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-no-cfg-'));
    try {
      expect(() => loadConsumerConfig(dir)).toThrow(/config\.json/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('schema rejects empty lockstepPackages array', () => {
    expect(() =>
      ConsumerConfigSchema.parse({
        name: 'x',
        repoUrl: 'https://example.com',
        lockstepPackages: [],
        scanPaths: [],
        boundaries: [],
        deprecatedPackages: [],
        e2ePrefix: '',
        samplesPath: '',
        packagePrefix: '',
        pnpmStderrPrefix: '',
        appPathPrefix: '',
      }),
    ).toThrow();
  });

  it('accepts dep-cruiser-style boundary rule', () => {
    expect(() =>
      BoundaryRuleSchema.parse({
        name: 'engine-no-viewport',
        severity: 'error',
        from: { path: '^packages/engine/src' },
        to: { path: '^packages/viewport/' },
      }),
    ).not.toThrow();
  });
});
