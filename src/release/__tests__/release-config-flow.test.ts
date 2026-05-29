import { describe, expect, it } from 'vitest';
import { loadConsumerConfig } from '../../core/consumer-config.js';

describe('release reads lockstep + repoUrl from consumer config', () => {
  it('config has 7 lockstep entries matching previous hardcoded list', () => {
    const cfg = loadConsumerConfig();
    expect(cfg.lockstepPackages).toContain('package.json');
    expect(cfg.lockstepPackages).toContain('apps/web/package.json');
    expect(cfg.lockstepPackages).toContain('packages/engine/package.json');
    expect(cfg.lockstepPackages.length).toBe(7);
  });

  it('config has charuy repoUrl', () => {
    const cfg = loadConsumerConfig();
    expect(cfg.repoUrl).toBe('https://github.com/davidzoufaly/charuy');
  });
});
