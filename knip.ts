import type { KnipConfig } from 'knip';

import { flattenManifest } from './src/cli/manifest.ts';

// Every entry and ignore below is a knip false positive, each with its reason.
// Real dead code is never silenced here: it belongs in
// .noldor/dead-code-baseline.json, where `noldor dead-code check` ratchets it.
const config: KnipConfig = {
  // Without it knip skips unused exports in entry files — and every CLI leaf
  // below is one, which would leave most of src/ unchecked.
  includeEntryExports: true,
  entry: [
    'bin/*.mjs',
    'src/cli/index.ts',
    'templates/scripts/*.mjs',
    // src/cli/index.ts loads every command by a string path out of MANIFEST,
    // which knip cannot follow — so the manifest itself is the entry list.
    ...flattenManifest().map((leaf) => leaf.src),
    // bin/noldor-stub-gate.mjs boots it by a string path, like the CLI above.
    'src/testing/stub-gate-cli.ts',
  ],
  project: ['bin/**/*.mjs', 'src/**/*.{ts,mjs,cjs}', 'templates/scripts/**/*.mjs'],
  ignore: ['src/indirection/__tests__/trees/**', 'src/fixtures/**'],
  ignoreDependencies: [
    // dependency-cruiser loads it as its TypeScript parser (src/invariants/boundaries.ts).
    '@swc/core',
    // src/core/fmt-guard-cli.ts runs node_modules/.bin/oxfmt by path.
    'oxfmt',
    // templates/scripts/geometry-capture.mjs ships to consumers, who install it.
    'playwright',
  ],
  // OS tools, not packages: src/design/editor-launch.ts and a templates test shell out to them.
  ignoreBinaries: ['pgrep', 'jq'],
};

export default config;
