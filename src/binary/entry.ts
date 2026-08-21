/* eslint-disable no-console */
// Binary-channel entrypoint (spec Unit 2). Compiled by tsgo to
// dist/binary/entry.js, then `bun build --compile dist/binary/entry.js
// assets.pack` bundles it WITH the pack as an embedded extra input. Never
// imported under Node — bin/noldor.mjs is the npm-channel entry. Env is set
// BEFORE the dynamic CLI import so module-top-level seam reads see it
// (ordering spike-verified).
import { extractAssets } from './asset-pack.js';
import { assetRoot, resolveAssetCachePath } from './asset-root.js';
import { COMMAND_IMPORTS } from './command-table.gen.js';

process.env.NOLDOR_BINARY = '1';
// The router's computed dynamic imports are opaque to the bundler; this
// statically-imported table is how every command module enters the compiled
// graph, and how dispatch() resolves them at runtime (spec Unit 2).
globalThis.__NOLDOR_COMMAND_IMPORTS = COMMAND_IMPORTS;

// The one boundary the asset-root/extractor throw contract names: env
// misconfiguration and extraction failures exit 1 with the message, never a
// stack trace (spec Unit 1/2 error handling).
try {
  const operatorRoot = assetRoot();
  if (operatorRoot === null) {
    const embedded = Bun.embeddedFiles.find((f) => f.name.endsWith('.pack'));
    if (!embedded) {
      console.error('noldor: embedded assets.pack missing — rebuild the binary');
      process.exit(1);
    }
    const pack = Buffer.from(await embedded.arrayBuffer());
    const dest = resolveAssetCachePath(NOLDOR_BINARY_VERSION);
    const { extracted } = extractAssets(pack, dest);
    if (extracted) console.error(`noldor: extracted assets to ${dest}`);
    process.env.NOLDOR_ASSET_ROOT = dest;
  }
} catch (error) {
  console.error(`noldor: ${(error as Error).message}`);
  process.exit(1);
}

await import('../cli/index.js');
