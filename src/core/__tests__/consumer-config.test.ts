// @tests: acceptance-verify-lane, version-aware-upgrade-and-migration-chain
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadConsumerConfig,
  loadScopeAliases,
  loadVerifyCommands,
  ConsumerConfigSchema,
  BoundaryRuleSchema,
} from '../consumer-config.js';

const MINIMAL_CONSUMER = {
  name: 'acme',
  repoUrl: 'https://github.com/x/y',
  lockstepPackages: ['package.json'],
  scanPaths: [],
  boundaries: [],
  deprecatedPackages: [],
  e2ePrefix: '',
  samplesPath: '',
  packagePrefix: '',
  pnpmStderrPrefix: '',
  appPathPrefix: '',
};

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
        name: 'acme',
        repoUrl: 'https://github.com/x/y',
        lockstepPackages: ['apps/web/package.json'],
        scanPaths: ['apps/web/src'],
        boundaries: [],
        deprecatedPackages: [],
        e2ePrefix: 'apps/web/e2e/',
        samplesPath: 'apps/web/public/samples',
        packagePrefix: '@acme/',
        pnpmStderrPrefix: 'acme@',
        appPathPrefix: 'apps/web/',
      },
    });
    try {
      const cfg = loadConsumerConfig(dir);
      expect(cfg.name).toBe('acme');
      expect(cfg.lockstepPackages).toEqual(['apps/web/package.json']);
      expect(cfg.packagePrefix).toBe('@acme/');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws when consumer block missing', () => {
    const dir = makeTmpRepo({ crLanes: { spec: ['reviewer'] } });
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

  it('schema defaults scopeAliases to an empty map', () => {
    const cfg = ConsumerConfigSchema.parse(MINIMAL_CONSUMER);
    expect(cfg.scopeAliases).toEqual({});
  });

  it('schema accepts a scopeAliases map of token -> slug arrays', () => {
    const cfg = ConsumerConfigSchema.parse({
      ...MINIMAL_CONSUMER,
      scopeAliases: { cr: ['noldor'], sdd: ['sdd-co-tag-detector'] },
    });
    expect(cfg.scopeAliases).toEqual({ cr: ['noldor'], sdd: ['sdd-co-tag-detector'] });
  });

  it('schema rejects a scopeAliases value with an empty slug string', () => {
    expect(() =>
      ConsumerConfigSchema.parse({ ...MINIMAL_CONSUMER, scopeAliases: { cr: [''] } }),
    ).toThrow();
  });
});

describe('loadScopeAliases', () => {
  it('returns the parsed scopeAliases map when present', () => {
    const dir = makeTmpRepo({
      consumer: { ...MINIMAL_CONSUMER, scopeAliases: { cr: ['noldor'] } },
    });
    try {
      expect(loadScopeAliases(dir)).toEqual({ cr: ['noldor'] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns {} when scopeAliases is absent from the config', () => {
    const dir = makeTmpRepo({ consumer: MINIMAL_CONSUMER });
    try {
      expect(loadScopeAliases(dir)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns {} when no config file exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-no-cfg-aliases-'));
    try {
      expect(loadScopeAliases(dir)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('verifyCommands', () => {
  it('parses server and cli surfaces with defaults', () => {
    const dir = makeTmpRepo({
      consumer: {
        ...MINIMAL_CONSUMER,
        verifyCommands: {
          dashboard: { command: 'pnpm dev --port {port}', kind: 'server' },
          cli: { command: 'pnpm noldor --help', kind: 'cli' },
        },
      },
    });
    try {
      const cfg = loadConsumerConfig(dir);
      expect(cfg.verifyCommands.dashboard).toEqual({
        command: 'pnpm dev --port {port}',
        kind: 'server',
        healthPath: '/',
        readyTimeoutMs: 30_000,
      });
      expect(cfg.verifyCommands.cli.kind).toBe('cli');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('defaults to empty record when absent', () => {
    const dir = makeTmpRepo({ consumer: MINIMAL_CONSUMER });
    try {
      expect(loadConsumerConfig(dir).verifyCommands).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loadVerifyCommands is tolerant: {} on missing config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-no-cfg-verify-'));
    try {
      expect(loadVerifyCommands(dir)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { DevSurfaceSchema, DevConfigSchema, loadDevSurfaces } from '../consumer-config.js';

describe('dev config', () => {
  it('parses a surface with offset + rejects unknown keys', () => {
    const s = DevSurfaceSchema.parse({ command: 'pnpm dev --port {port}', portOffset: 100 });
    expect(s.healthPath).toBe('/');
    expect(s.readyTimeoutMs).toBe(30_000);
    expect(s.portOffset).toBe(100);
    expect(() => DevSurfaceSchema.parse({ command: 'x', bogus: 1 })).toThrow();
  });
  it('defaults portOffset to 0 and surfaces to {}', () => {
    expect(DevSurfaceSchema.parse({ command: 'x' }).portOffset).toBe(0);
    expect(DevConfigSchema.parse({}).surfaces).toEqual({});
  });
  it('loadDevSurfaces returns {} when consumer.dev absent', () => {
    // config.json has no dev block by default in this repo at test time
    expect(loadDevSurfaces(process.cwd())).toEqual({});
  });
});
