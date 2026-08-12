#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { assertNodeFloor } from './engines-check.mjs';

// Floor check before tsx loads — dynamic import keeps tsx (which may not even
// parse on below-floor Node) out of the module graph until the guard passes.
assertNodeFloor();

const { register } = await import('tsx/esm/api');
register();
const here = dirname(fileURLToPath(import.meta.url));
await import(resolve(here, '../src/cli/index.ts'));
