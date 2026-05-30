import { describe, expect, it } from 'vitest';
import { loadConsumerConfig } from '../../core/consumer-config.js';

describe('release reads lockstep + repoUrl from consumer config', () => {
  it('exposes the noldor lockstep package set', () => {
    const cfg = loadConsumerConfig();
    expect(cfg.lockstepPackages).toContain('noldor');
    expect(cfg.lockstepPackages.length).toBeGreaterThan(0);
  });

  it('exposes the noldor repoUrl', () => {
    const cfg = loadConsumerConfig();
    expect(cfg.repoUrl).toBe('https://github.com/davidzoufaly/noldor');
  });
});
