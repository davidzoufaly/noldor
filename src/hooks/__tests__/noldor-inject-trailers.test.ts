import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { injectTrailers } from '../noldor-inject-trailers';

describe('injectTrailers', () => {
  it('injects path + FD from session marker', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfi-'));
    mkdirSync(join(dir, '.noldor'));
    writeFileSync(
      join(dir, '.noldor', 'session.json'),
      JSON.stringify({
        path: 'specs-only-new',
        slug: 'foo',
        startedAt: '2026-05-10T00:00:00Z',
        markerVersion: 2,
      }),
    );
    const msgFile = join(dir, 'COMMIT_EDITMSG');
    writeFileSync(msgFile, 'feat: x\n');
    injectTrailers({ messageFile: msgFile, cwd: dir });
    const out = readFileSync(msgFile, 'utf8');
    expect(out).toContain('Noldor-Path: specs-only-new');
    expect(out).toContain('Noldor-FD: foo');
  });

  it('emits Noldor-Enhancement when session marker has enhancement field', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfi-'));
    mkdirSync(join(dir, '.noldor'));
    writeFileSync(
      join(dir, '.noldor', 'session.json'),
      JSON.stringify({
        path: 'full-attach',
        parent: 'noldor',
        enhancement: 'my-enhancement',
        startedAt: '2026-05-25T00:00:00Z',
      }),
    );
    const msgFile = join(dir, 'COMMIT_EDITMSG');
    writeFileSync(msgFile, 'docs(features:noldor): add spec for my-enhancement\n');
    injectTrailers({ messageFile: msgFile, cwd: dir });
    const out = readFileSync(msgFile, 'utf8');
    expect(out).toContain('Noldor-Enhancement: my-enhancement');
  });

  it('does NOT emit Noldor-Enhancement when session marker lacks enhancement field', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfi-'));
    mkdirSync(join(dir, '.noldor'));
    writeFileSync(
      join(dir, '.noldor', 'session.json'),
      JSON.stringify({
        path: 'full-new',
        slug: 'foo',
        startedAt: '2026-05-25T00:00:00Z',
      }),
    );
    const msgFile = join(dir, 'COMMIT_EDITMSG');
    writeFileSync(msgFile, 'feat(foo): initial\n');
    injectTrailers({ messageFile: msgFile, cwd: dir });
    const out = readFileSync(msgFile, 'utf8');
    expect(out).not.toContain('Noldor-Enhancement');
  });

  it('skips injection when no session marker (allows manual messages)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfi-'));
    const msgFile = join(dir, 'COMMIT_EDITMSG');
    writeFileSync(msgFile, 'feat: x\n');
    injectTrailers({ messageFile: msgFile, cwd: dir });
    const out = readFileSync(msgFile, 'utf8');
    expect(out).toBe('feat: x\n');
  });

  it('does not duplicate trailers when already present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qfi-'));
    mkdirSync(join(dir, '.noldor'));
    writeFileSync(
      join(dir, '.noldor', 'session.json'),
      JSON.stringify({ path: 'fast-track', startedAt: '2026-05-10T00:00:00Z' }),
    );
    const msgFile = join(dir, 'COMMIT_EDITMSG');
    writeFileSync(msgFile, 'fix: x\n\nNoldor-Path: fast-track\n');
    injectTrailers({ messageFile: msgFile, cwd: dir });
    const out = readFileSync(msgFile, 'utf8');
    expect((out.match(/Noldor-Path:/g) ?? []).length).toBe(1);
  });
});
