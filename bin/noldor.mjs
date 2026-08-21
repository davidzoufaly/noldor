#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { assertNodeFloor } from './engines-check.mjs';

// Floor check before anything else loads — the boot helper and tsx may not even
// parse on below-floor Node.
assertNodeFloor();

const { boot } = await import('./boot.mjs');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await boot(root, { dist: 'dist/cli/index.js', source: 'src/cli/index.ts' });
