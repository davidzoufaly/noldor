// @tests: single-static-binary-distribution
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function mapped(unameS: string, unameM: string): string {
  return execFileSync('sh', ['install.sh', '--map-only'], {
    encoding: 'utf8',
    env: { ...process.env, NOLDOR_UNAME_S: unameS, NOLDOR_UNAME_M: unameM },
  }).trim();
}

describe('install.sh platform mapping', () => {
  it('maps all four supported targets', () => {
    expect(mapped('Linux', 'x86_64')).toBe('noldor-linux-amd64');
    expect(mapped('Linux', 'aarch64')).toBe('noldor-linux-arm64');
    expect(mapped('Darwin', 'x86_64')).toBe('noldor-darwin-amd64');
    expect(mapped('Darwin', 'arm64')).toBe('noldor-darwin-arm64');
  });
  it('rejects unsupported platforms', () => {
    expect(() => mapped('Windows_NT', 'x86_64')).toThrow();
    expect(() => mapped('Linux', 'riscv64')).toThrow();
  });
});
