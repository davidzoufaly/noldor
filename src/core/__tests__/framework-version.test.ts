// @tests: acceptance-verify-lane, version-aware-upgrade-and-migration-chain
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFrameworkVersion, writeFrameworkVersion } from '../consumer-config.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'noldor-fv-'));
  mkdirSync(join(dir, '.noldor'), { recursive: true });
  writeFileSync(
    join(dir, '.noldor/config.json'),
    JSON.stringify({ consumer: { name: 'x' } }, null, 2),
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('frameworkVersion anchor', () => {
  it('returns null when unset', () => {
    expect(loadFrameworkVersion(dir)).toBeNull();
  });
  it('writes then reads the anchor', () => {
    writeFrameworkVersion(dir, '0.4.0');
    expect(loadFrameworkVersion(dir)).toBe('0.4.0');
    const raw = JSON.parse(readFileSync(join(dir, '.noldor/config.json'), 'utf8'));
    expect(raw.consumer.frameworkVersion).toBe('0.4.0');
    expect(raw.consumer.name).toBe('x'); // preserves siblings
  });
  it('returns null when config absent', () => {
    expect(loadFrameworkVersion(join(dir, 'nope'))).toBeNull();
  });
});
