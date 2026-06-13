import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedFrameworkVersion } from '../pkg-version.js';

describe('installedFrameworkVersion', () => {
  it('returns the framework package.json version', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', '..', '..', 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(installedFrameworkVersion()).toBe(pkg.version);
    expect(installedFrameworkVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
