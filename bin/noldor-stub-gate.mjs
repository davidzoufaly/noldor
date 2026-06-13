#!/usr/bin/env node
import { register } from 'tsx/esm/api';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

register();
const here = dirname(fileURLToPath(import.meta.url));
const { main } = await import(resolve(here, '../src/testing/stub-gate.ts'));
process.exit(main(process.argv));
