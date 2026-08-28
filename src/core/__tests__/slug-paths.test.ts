// @tests: unvalidated-slug-path-traversal-across-cli-entry-points
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseSlug, type Slug } from '../slug.js';
import { pathErrorMessage, slugPath } from '../slug-paths.js';

/** Parse or fail the test — keeps every case reading as a slug, not a cast. */
function slug(value: string): Slug {
  const parsed = parseSlug(value);
  if (!parsed.ok) throw new Error(`fixture slug is invalid: ${value}`);
  return parsed.slug;
}

let anchor: string;
let outside: string;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'slug-paths-'));
  anchor = join(base, 'repo');
  outside = join(base, 'outside');
  mkdirSync(anchor, { recursive: true });
  mkdirSync(outside, { recursive: true });
});

afterEach(() => {
  rmSync(join(anchor, '..'), { recursive: true, force: true });
});

describe('slugPath', () => {
  it('composes anchor, relRoot and the slug segment', () => {
    const r = slugPath(anchor, ['docs', 'features'], slug('cloud-sync'), { suffix: '.md' });
    expect(r).toEqual({ ok: true, path: join(anchor, 'docs', 'features', 'cloud-sync.md') });
  });

  it('wraps the slug in both a prefix and a suffix within one segment', () => {
    const r = slugPath(anchor, ['.noldor'], slug('cloud-sync'), {
      prefix: 'dev-',
      suffix: '.pids',
    });
    expect(r).toEqual({ ok: true, path: join(anchor, '.noldor', 'dev-cloud-sync.pids') });
  });

  it('accepts a final segment that does not exist yet', () => {
    const r = slugPath(anchor, ['.worktrees'], slug('not-created-yet'));
    expect(r.ok).toBe(true);
  });

  it('refuses a relRoot that is a symlink pointing outside the anchor', () => {
    symlinkSync(outside, join(anchor, 'docs'));
    const r = slugPath(anchor, ['docs'], slug('cloud-sync'), { suffix: '.md' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('escapes-root');
  });

  it('refuses a symlinked final segment whose target exists', () => {
    mkdirSync(join(anchor, 'docs'));
    writeFileSync(join(outside, 'stolen.md'), 'secret\n');
    symlinkSync(join(outside, 'stolen.md'), join(anchor, 'docs', 'cloud-sync.md'));
    const r = slugPath(anchor, ['docs'], slug('cloud-sync'), { suffix: '.md' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('unsafe-symlink');
  });

  it('refuses a DANGLING symlinked final segment — containment alone accepts it', () => {
    mkdirSync(join(anchor, 'docs'));
    const target = join(outside, 'not-yet.md');
    symlinkSync(target, join(anchor, 'docs', 'cloud-sync.md'));
    const r = slugPath(anchor, ['docs'], slug('cloud-sync'), { suffix: '.md' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('unsafe-symlink');
  });

  it('reports which boundary was crossed', () => {
    symlinkSync(outside, join(anchor, 'docs'));
    const r = slugPath(anchor, ['docs'], slug('cloud-sync'), { suffix: '.md' });
    if (r.ok) throw new Error('expected refusal');
    expect(pathErrorMessage(r.error)).toContain('resolves outside');
  });
});
