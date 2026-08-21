/* eslint-disable no-console */
// Binary-channel entrypoint (spec Unit 2). Compiled by tsgo to
// dist/binary/entry.js, then `bun build --compile dist/binary/entry.js
// assets.pack` bundles it WITH the pack as an embedded extra input. Never
// imported under Node — bin/noldor.mjs is the npm-channel entry. Env is set
// BEFORE the dynamic CLI import so module-top-level seam reads see it
// (ordering spike-verified).
import { extractAssets } from './asset-pack.js';
import { assetRoot, resolveAssetCachePath } from './asset-root.js';

process.env.NOLDOR_BINARY = '1';

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

await import('../cli/index.js');
