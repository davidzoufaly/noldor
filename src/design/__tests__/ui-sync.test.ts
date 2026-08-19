// @tests: pendev-ui-design-phase
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderSurfaceReport, validateBaselineFile } from '../ui-sync-cli.js';

describe('renderSurfaceReport', () => {
  it('prints verdict, detail and the edit instruction per surface', () => {
    const out = renderSurfaceReport({
      surface: 'dashboard',
      status: 'stale',
      uiCommit: 'a'.repeat(40),
      baselineCommit: 'b'.repeat(40),
      detail: 'UI newer than baseline',
    });
    expect(out).toContain('dashboard');
    expect(out).toContain('stale');
    expect(out).toContain('edit docs/design/ui/baseline/dashboard.pen');
  });
  it('uninitialized instructs bootstrap-create', () => {
    const out = renderSurfaceReport({
      surface: 'app',
      status: 'uninitialized',
      detail: 'no baseline',
    });
    expect(out).toContain('create docs/design/ui/baseline/app.pen');
  });
});

describe('validateBaselineFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ui-sync-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails on missing file', () => {
    expect(validateBaselineFile(join(tmpDir, 'nope.pen'), { staged: true })).toEqual({
      ok: false,
      reason: 'missing',
    });
  });
  it('fails on empty file and on unstaged change', () => {
    const empty = join(tmpDir, 'empty.pen');
    writeFileSync(empty, '', 'utf8');
    expect(validateBaselineFile(empty, { staged: true })).toEqual({ ok: false, reason: 'empty' });

    const full = join(tmpDir, 'full.pen');
    writeFileSync(full, 'pen-bytes', 'utf8');
    expect(validateBaselineFile(full, { staged: false })).toEqual({
      ok: false,
      reason: 'not staged',
    });
  });
  it('passes on non-empty staged file with the completes-at-commit notice', () => {
    const full = join(tmpDir, 'full.pen');
    writeFileSync(full, 'pen-bytes', 'utf8');
    const v = validateBaselineFile(full, { staged: true });
    expect(v.ok).toBe(true);
    expect(v.notice).toMatch(/completes .*commit/i);
  });
});
