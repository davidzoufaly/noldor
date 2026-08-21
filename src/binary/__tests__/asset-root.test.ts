// @tests: single-static-binary-distribution
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetRoot, isBinaryChannel, resolveAssetCachePath } from '../asset-root.js';

describe('isBinaryChannel', () => {
  it("is true only for the exact value '1'", () => {
    expect(isBinaryChannel({ NOLDOR_BINARY: '1' })).toBe(true);
    expect(isBinaryChannel({ NOLDOR_BINARY: '0' })).toBe(false);
    expect(isBinaryChannel({ NOLDOR_BINARY: 'true' })).toBe(false);
    expect(isBinaryChannel({})).toBe(false);
  });
});

describe('assetRoot', () => {
  it('returns null when unset', () => {
    expect(assetRoot({})).toBeNull();
  });
  it('returns the value verbatim when absolute', () => {
    expect(assetRoot({ NOLDOR_ASSET_ROOT: '/opt/noldor-pkg' })).toBe('/opt/noldor-pkg');
  });
  it('throws on empty and on relative values (both channels)', () => {
    expect(() => assetRoot({ NOLDOR_ASSET_ROOT: '' })).toThrow(/NOLDOR_ASSET_ROOT/);
    expect(() => assetRoot({ NOLDOR_ASSET_ROOT: 'rel/path' })).toThrow(/absolute/);
  });
});

describe('resolveAssetCachePath', () => {
  it('appends the version key under NOLDOR_CACHE_DIR', () => {
    expect(resolveAssetCachePath('9.9.9', { NOLDOR_CACHE_DIR: '/tmp/nc' }, 'linux')).toBe(
      '/tmp/nc/9.9.9/pkg',
    );
  });
  it('rejects a relative NOLDOR_CACHE_DIR', () => {
    expect(() => resolveAssetCachePath('9.9.9', { NOLDOR_CACHE_DIR: 'nc' }, 'linux')).toThrow(
      /absolute/,
    );
  });
  it('uses Library/Caches on darwin', () => {
    expect(resolveAssetCachePath('9.9.9', { HOME: '/Users/u' }, 'darwin')).toBe(
      '/Users/u/Library/Caches/noldor/9.9.9/pkg',
    );
  });
  it('prefers XDG_CACHE_HOME elsewhere', () => {
    expect(
      resolveAssetCachePath('9.9.9', { XDG_CACHE_HOME: '/xdg', HOME: '/home/u' }, 'linux'),
    ).toBe('/xdg/noldor/9.9.9/pkg');
  });
  it('falls back to ~/.cache', () => {
    expect(resolveAssetCachePath('9.9.9', { HOME: '/home/u' }, 'linux')).toBe(
      '/home/u/.cache/noldor/9.9.9/pkg',
    );
  });
  it('throws when neither HOME nor XDG_CACHE_HOME resolves', () => {
    expect(() => resolveAssetCachePath('9.9.9', {}, 'linux')).toThrow(/HOME/);
  });
});

describe('asset-root seams', () => {
  const saved = process.env.NOLDOR_ASSET_ROOT;
  afterEach(() => {
    if (saved === undefined) delete process.env.NOLDOR_ASSET_ROOT;
    else process.env.NOLDOR_ASSET_ROOT = saved;
    vi.resetModules();
  });

  it('TEMPLATES_ROOT follows NOLDOR_ASSET_ROOT when set', async () => {
    process.env.NOLDOR_ASSET_ROOT = '/opt/pkg';
    vi.resetModules();
    const { TEMPLATES_ROOT } = await import('../../templates/manifest.js');
    expect(TEMPLATES_ROOT).toBe('/opt/pkg/templates');
  });

  it('CR_RECORD_SCHEMA_PATH follows NOLDOR_ASSET_ROOT when set', async () => {
    process.env.NOLDOR_ASSET_ROOT = '/opt/pkg';
    vi.resetModules();
    const { CR_RECORD_SCHEMA_PATH } = await import('../../cr/codex-adapter.js');
    expect(CR_RECORD_SCHEMA_PATH).toBe('/opt/pkg/dist/cr/cr-record.schema.json');
  });

  it('TEMPLATES_ROOT stays module-relative when unset', async () => {
    delete process.env.NOLDOR_ASSET_ROOT;
    vi.resetModules();
    const { TEMPLATES_ROOT } = await import('../../templates/manifest.js');
    expect(TEMPLATES_ROOT.endsWith('/templates')).toBe(true);
    expect(TEMPLATES_ROOT.startsWith('/opt/pkg')).toBe(false);
  });
});
