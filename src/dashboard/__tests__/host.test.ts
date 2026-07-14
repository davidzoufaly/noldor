// @tests: state-file-fail-open-hardening
import { describe, expect, it, afterEach } from 'vitest';
import { resolveBindHost, healthUrl } from '../host';

describe('resolveBindHost', () => {
  const prev = process.env.DASHBOARD_HOST;
  afterEach(() => {
    if (prev === undefined) delete process.env.DASHBOARD_HOST;
    else process.env.DASHBOARD_HOST = prev;
  });

  it('defaults to loopback 127.0.0.1', () => {
    delete process.env.DASHBOARD_HOST;
    expect(resolveBindHost()).toBe('127.0.0.1');
  });

  it('prefers an explicit arg over env and default', () => {
    process.env.DASHBOARD_HOST = '10.0.0.1';
    expect(resolveBindHost('192.168.0.2')).toBe('192.168.0.2');
  });

  it('falls back to DASHBOARD_HOST (the opt-out) when no explicit arg', () => {
    process.env.DASHBOARD_HOST = '0.0.0.0';
    expect(resolveBindHost()).toBe('0.0.0.0');
  });
});

describe('healthUrl', () => {
  it('formats a loopback URL', () => {
    expect(healthUrl('127.0.0.1', 4321)).toBe('http://127.0.0.1:4321');
  });

  it('maps a wildcard bind to loopback (not a portable connect target)', () => {
    expect(healthUrl('0.0.0.0', 4321)).toBe('http://127.0.0.1:4321');
    expect(healthUrl('::', 4321)).toBe('http://127.0.0.1:4321');
  });

  it('brackets an IPv6 literal host', () => {
    expect(healthUrl('::1', 4321)).toBe('http://[::1]:4321');
  });
});
