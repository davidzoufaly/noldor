#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

// Same runtime selection as bin/noldor.mjs, via the same helper: the tsx import
// is dynamic and fallback-only, so this entry no longer crashes on load in an
// installed package where tsx is absent.
const { boot } = await import('./boot.mjs');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await boot(root, { dist: 'dist/testing/stub-gate-cli.js', source: 'src/testing/stub-gate-cli.ts' });
