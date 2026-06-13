// @tests: consumer-contract-ci-and-headless-gate-e2e-harness
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildConsumerFixture, type ConsumerFixture } from '../consumer-fixture';
import { runConsumerCli } from '../contract-harness';

let fx: ConsumerFixture | null = null;
afterEach(() => fx?.cleanup());

describe('contract harness — CLI contract on the fixture', () => {
  it('validate features exits 0 on a clean fixture', () => {
    fx = buildConsumerFixture();
    const r = runConsumerCli(fx.dir, ['validate', 'features']);
    expect(r.exitCode).toBe(0);
  });
  it('a renamed consumer config field fails the contract', () => {
    fx = buildConsumerFixture();
    // corrupt the config: drop a required field
    const cfgPath = join(fx.dir, '.noldor', 'config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    delete cfg.consumer.name;
    writeFileSync(cfgPath, JSON.stringify(cfg));
    const r = runConsumerCli(fx.dir, ['doctor']);
    expect(r.exitCode).not.toBe(0);
  });
});
