// @tests: acceptance-verify-lane, consumer-contract-ci-and-headless-gate-e2e-harness, drain-startup-reconciliation-of-a-prior-dead-run, make-noldor-agent-agnostic, version-aware-upgrade-and-migration-chain
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildConsumerFixture, type ConsumerFixture } from '../consumer-fixture';
import { loadConsumerConfig } from '../../core/consumer-config';
import { loadAgentsConfig } from '../../core/agent-runner/registry';

let fx: ConsumerFixture | null = null;
afterEach(() => fx?.cleanup());

describe('consumer fixture builder', () => {
  it('generates a real git repo with a valid consumer + agents config', () => {
    fx = buildConsumerFixture();
    expect(existsSync(join(fx.dir, '.git'))).toBe(true);
    const cfg = loadConsumerConfig(fx.dir);
    expect(cfg.name).toBeTruthy();
    const agents = loadAgentsConfig(fx.dir);
    expect(agents.default).toBe('stub');
    // initial commit exists on main
    expect(fx.git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('main');
  });

  it('seeds one XS roadmap entry whose slug is exposed', () => {
    fx = buildConsumerFixture({ seedSlug: 'add-greeting-helper' });
    const roadmap = readFileSync(join(fx.dir, 'docs', 'roadmap.md'), 'utf8');
    expect(roadmap).toContain('add-greeting-helper');
    expect(fx.seedSlug).toBe('add-greeting-helper');
  });

  it('dumpState returns git log + .noldor listing', () => {
    fx = buildConsumerFixture();
    const state = fx.dumpState();
    expect(state).toContain('.noldor');
    expect(state.length).toBeGreaterThan(0);
  });
});
