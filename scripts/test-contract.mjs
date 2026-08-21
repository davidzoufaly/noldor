#!/usr/bin/env node
import { register } from 'tsx/esm/api';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

register();
const here = dirname(fileURLToPath(import.meta.url));
const { buildConsumerFixture } = await import(resolve(here, '../src/testing/consumer-fixture.ts'));
const {
  installFrameworkTarball,
  runContractChecks,
  checkPackagedRuntime,
  checkPackagedAssetBehaviour,
  checkInstalledSubcommands,
} = await import(resolve(here, '../src/testing/contract-harness.ts'));
const { flattenManifest } = await import(resolve(here, '../src/cli/manifest.ts'));

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

  // The tarball ships one runtime tree and executes it: no src, no transpiler,
  // every module-adjacent asset present, and doctor reporting the dist runtime.
  const runtimeProblems = checkPackagedRuntime(fx.dir);
  if (runtimeProblems.length) {
    console.error('Packaged runtime problems:');
    for (const p of runtimeProblems) console.error(`  - ${p}`);
    process.exit(1);
  }

  // Assets reached through the code that reads them, not merely present.
  const assetProblems = checkPackagedAssetBehaviour(fx.dir);
  if (assetProblems.length) {
    console.error('Packaged asset probes failed:');
    for (const p of assetProblems) console.error(`  - ${p}`);
    process.exit(1);
  }

  // Router coverage: every declared subcommand is known to the packaged CLI.
  const leaves = flattenManifest().map((l) => {
    const [group, sub = ''] = l.command.split(' ');
    return [group, sub];
  });
  const brokenHelp = checkInstalledSubcommands(fx.dir, leaves);
  if (brokenHelp.length) {
    console.error(`--help failed from the installed CLI for ${brokenHelp.length} subcommand(s):`);
    for (const s of brokenHelp.slice(0, 10)) console.error(`  - ${s}`);
    process.exit(1);
  }

  console.log('Contract checks passed:', results);
  console.log(
    `Packaged runtime OK: dist-only tarball, whole import graph resolves, ${leaves.length} subcommands known to the packaged router`,
  );
} finally {
  fx.cleanup();
}
