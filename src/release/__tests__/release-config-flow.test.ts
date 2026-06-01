import { describe, expect, it } from 'vitest';
import { loadConsumerConfig } from '../../core/consumer-config.js';

describe('release reads lockstep + repoUrl from consumer config', () => {
  it('exposes the noldor lockstep package set (root package.json path)', () => {
    const cfg = loadConsumerConfig();
    // Single-package repo: the lockstep target is the root manifest path, not
    // the package name. release-packages.ts readFile()s each entry directly.
    expect(cfg.lockstepPackages).toContain('package.json');
    expect(cfg.lockstepPackages.length).toBeGreaterThan(0);
  });

  it('exposes the noldor repoUrl', () => {
    const cfg = loadConsumerConfig();
    expect(cfg.repoUrl).toBe('https://github.com/davidzoufaly/noldor');
  });
});
