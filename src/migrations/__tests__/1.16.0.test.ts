// @tests: dead-code-detection-with-knip, version-aware-upgrade-and-migration-chain
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { migration_1_16_0 } from '../1.16.0.js';

function consumer(config: string | null): { dir: string; [Symbol.dispose](): void } {
  const dir = mkdtempSync(join(tmpdir(), 'mig1160-'));
  if (config !== null) {
    mkdirSync(join(dir, '.noldor'));
    writeFileSync(join(dir, '.noldor/config.json'), config);
  }
  return { dir, [Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }) };
}

const read = (dir: string): string => readFileSync(join(dir, '.noldor/config.json'), 'utf8');

describe('migration 1.16.0 — deadCode opt-in switch', () => {
  it('appends deadCode.enabled false as the last key, keeping key order and indentation', () => {
    using c = consumer('{\n    "consumer": { "name": "x" },\n    "clones": {}\n}\n');
    const steps = migration_1_16_0.migrate(c.dir, {} as never);
    expect(steps).toHaveLength(1);
    expect(read(c.dir)).toBe(
      '{\n    "consumer": { "name": "x" },\n    "clones": {},\n    "deadCode": {\n        "enabled": false\n    }\n}\n',
    );
  });

  it('writes into an empty object', () => {
    using c = consumer('{}');
    migration_1_16_0.migrate(c.dir, {} as never);
    expect(JSON.parse(read(c.dir))).toEqual({ deadCode: { enabled: false } });
  });

  it('dryRun reports the step without writing', () => {
    using c = consumer('{ "consumer": {} }\n');
    const steps = migration_1_16_0.dryRun(c.dir, {} as never);
    expect(steps).toHaveLength(1);
    expect(JSON.parse(steps[0]!.after)).toEqual({ consumer: {}, deadCode: { enabled: false } });
    expect(read(c.dir)).toBe('{ "consumer": {} }\n');
  });

  it.each([
    ['an existing deadCode block', '{ "deadCode": { "enabled": true } }'],
    ['a malformed deadCode value', '{ "deadCode": "yes" }'],
    ['an unparseable file', '{ nope'],
    ['a non-object root', '[]'],
  ])('leaves %s untouched', (_label, config) => {
    using c = consumer(config);
    expect(migration_1_16_0.migrate(c.dir, {} as never)).toEqual([]);
    expect(read(c.dir)).toBe(config);
  });

  it('is a no-op without a config file', () => {
    using c = consumer(null);
    expect(migration_1_16_0.migrate(c.dir, {} as never)).toEqual([]);
  });

  it('a second run changes nothing', () => {
    using c = consumer('{\n  "consumer": {}\n}\n');
    migration_1_16_0.migrate(c.dir, {} as never);
    const once = read(c.dir);
    expect(migration_1_16_0.migrate(c.dir, {} as never)).toEqual([]);
    expect(read(c.dir)).toBe(once);
  });
});
