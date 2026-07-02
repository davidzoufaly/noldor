// @tests: acceptance-verify-lane, noldor
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { CrRecordSchema } from '../sidecar.js';

describe('cr-record.schema.json parity with CrRecordSchema', () => {
  it('matches zodToJsonSchema(CrRecordSchema) byte-for-structure', () => {
    const schemaPath = fileURLToPath(new URL('../cr-record.schema.json', import.meta.url));
    const onDisk = JSON.parse(readFileSync(schemaPath, 'utf8'));
    const derived = zodToJsonSchema(CrRecordSchema, {
      target: 'jsonSchema7',
      $refStrategy: 'none',
    });
    expect(onDisk).toEqual(derived);
  });
});
