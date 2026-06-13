#!/usr/bin/env node
import { register } from 'tsx/esm/api';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

register();
const here = dirname(fileURLToPath(import.meta.url));
const { buildConsumerFixture } = await import(resolve(here, '../src/testing/consumer-fixture.ts'));
const { installFrameworkTarball, runContractChecks } = await import(
  resolve(here, '../src/testing/contract-harness.ts')
);

const fx = buildConsumerFixture();
try {
  installFrameworkTarball(fx.dir);
  const results = runContractChecks(fx.dir);
  const failed = Object.entries(results).filter(([, code]) => code !== 0);
  if (failed.length) {
    console.error('Contract checks failed:', failed);
    console.error(fx.dumpState());
    process.exit(1);
  }
  console.log('Contract checks passed:', results);
} finally {
  fx.cleanup();
}
