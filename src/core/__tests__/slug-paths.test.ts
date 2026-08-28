// @tests: unvalidated-slug-path-traversal-across-cli-entry-points
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseSlug, type Slug } from '../slug.js';
import { atomicWriteFileSync } from '../atomic-write.js';
import { pathErrorMessage, readFileNoFollow, slugPath } from '../slug-paths.js';

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

  it('refuses a path it cannot inspect rather than assuming it is safe', () => {
    // A parent the process cannot traverse makes lstat fail with EACCES, not
    // ENOENT. Reporting that as "absent, therefore fine" is a fail-open: the
    // guard would vouch for exactly the path it can see least.
    const locked = join(anchor, 'locked');
    mkdirSync(locked);
    chmodSync(locked, 0o000);
    try {
      const r = slugPath(anchor, ['locked'], slug('cloud-sync'), { suffix: '.md' });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.kind).toBe('uninspectable');
    } finally {
      chmodSync(locked, 0o755); // so afterEach can remove it
    }
  });

  it('reports which boundary was crossed', () => {
    symlinkSync(outside, join(anchor, 'docs'));
    const r = slugPath(anchor, ['docs'], slug('cloud-sync'), { suffix: '.md' });
    if (r.ok) throw new Error('expected refusal');
    expect(pathErrorMessage(r.error)).toContain('resolves outside');
  });
});

describe('the no-follow IO pair closes the check-then-use window', () => {
  it('refuses to READ through a symlink planted after the check', () => {
    // slugPath's lstat and an ordinary pathname read are two syscalls with a
    // gap between them; a symlink swapped in during that gap defeats the check.
    // O_NOFOLLOW moves the refusal into the open, so there is no gap to race —
    // this plants the link AFTER a successful guard call, which is exactly the
    // race, and the read must still refuse.
    mkdirSync(join(anchor, 'docs'));
    const target = join(anchor, 'docs', 'cloud-sync.md');
    const vetted = slugPath(anchor, ['docs'], slug('cloud-sync'), { suffix: '.md' });
    expect(vetted.ok).toBe(true);

    writeFileSync(join(outside, 'secret.md'), 'SECRET\n');
    symlinkSync(join(outside, 'secret.md'), target);

    expect(() => readFileNoFollow(target)).toThrow();
  });

  it('does not WRITE through a symlink planted after the check', () => {
    // Writes use the repo's atomic helper rather than a no-follow open: it
    // writes a sibling temp file and renames it over the target, so a planted
    // link is REPLACED rather than followed. That also keeps the temp-then-
    // rename atomicity `concurrency-write-discipline` requires, which a second
    // in-place writer would have given up.
    mkdirSync(join(anchor, 'docs'));
    const target = join(anchor, 'docs', 'cloud-sync.md');
    const victim = join(outside, 'victim.md');
    writeFileSync(victim, 'ORIGINAL\n');
    symlinkSync(victim, target);

    atomicWriteFileSync(target, 'OVERWRITTEN\n');

    expect(readFileSync(victim, 'utf8')).toBe('ORIGINAL\n');
    expect(lstatSync(target).isSymbolicLink()).toBe(false);
  });

  it('reads a regular file normally', () => {
    mkdirSync(join(anchor, 'docs'));
    const target = join(anchor, 'docs', 'cloud-sync.md');
    atomicWriteFileSync(target, 'BODY\n');
    expect(readFileNoFollow(target)).toBe('BODY\n');
  });
});
