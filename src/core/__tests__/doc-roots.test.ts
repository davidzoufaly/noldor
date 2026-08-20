// @tests: framework-doc-extraction, feature-md-links-overhaul
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { docPresenceRoots, docProjectionRoots, listDocMds, loadDocRoots } from '../doc-roots.js';

describe('loadDocRoots', () => {
  it('returns docs/* paths anchored at given cwd', () => {
    const r = loadDocRoots('/tmp/example');
    expect(r.features).toBe('/tmp/example/docs/features');
    expect(r.roadmap).toBe('/tmp/example/docs/roadmap.md');
    expect(r.backlog).toBe('/tmp/example/docs/backlog.md');
    expect(r.vision).toBe('/tmp/example/docs/vision.md');
    expect(r.ideas).toBe('/tmp/example/ideas.md');
    expect(r.milestones).toBe('/tmp/example/docs/milestones');
    expect(r.plans).toBe('/tmp/example/docs/design/plans');
    expect(r.specs).toBe('/tmp/example/docs/design/specs');
    expect(r.designUi).toBe('/tmp/example/docs/design/ui');
  });

  it('defaults to process.cwd() when omitted', () => {
    const r = loadDocRoots();
    expect(r.features.endsWith('/docs/features')).toBe(true);
    expect(r.roadmap.endsWith('/docs/roadmap.md')).toBe(true);
  });

  describe('docs/superpowers → docs/design transition alias (Q-0006)', () => {
    let dir: string;
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('prefers docs/design when present', () => {
      dir = mkdtempSync(join(tmpdir(), 'doc-roots-'));
      mkdirSync(join(dir, 'docs', 'design', 'plans'), { recursive: true });
      mkdirSync(join(dir, 'docs', 'design', 'specs'), { recursive: true });
      const r = loadDocRoots(dir);
      expect(r.plans).toBe(join(dir, 'docs', 'design', 'plans'));
      expect(r.specs).toBe(join(dir, 'docs', 'design', 'specs'));
    });

    it('falls back to legacy docs/superpowers for a not-yet-migrated consumer', () => {
      dir = mkdtempSync(join(tmpdir(), 'doc-roots-'));
      mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true });
      mkdirSync(join(dir, 'docs', 'superpowers', 'specs'), { recursive: true });
      const r = loadDocRoots(dir);
      expect(r.plans).toBe(join(dir, 'docs', 'superpowers', 'plans'));
      expect(r.specs).toBe(join(dir, 'docs', 'superpowers', 'specs'));
    });

    it('prefers docs/design when both exist', () => {
      dir = mkdtempSync(join(tmpdir(), 'doc-roots-'));
      mkdirSync(join(dir, 'docs', 'design', 'plans'), { recursive: true });
      mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true });
      const r = loadDocRoots(dir);
      expect(r.plans).toBe(join(dir, 'docs', 'design', 'plans'));
    });

    it('defaults to docs/design when neither exists (writer path)', () => {
      dir = mkdtempSync(join(tmpdir(), 'doc-roots-'));
      const r = loadDocRoots(dir);
      expect(r.plans).toBe(join(dir, 'docs', 'design', 'plans'));
      expect(r.specs).toBe(join(dir, 'docs', 'design', 'specs'));
    });
  });
});

describe('doc root providers', () => {
  it('keeps docs/noldor out of both sets so a templated tree is never scanned or validated', () => {
    const projection = docProjectionRoots('/tmp/example');
    const presence = docPresenceRoots('/tmp/example');
    expect(projection.some((p) => p.endsWith('docs/noldor'))).toBe(false);
    expect(presence.some((p) => p.endsWith('docs/noldor'))).toBe(false);
    expect(projection).toContain('/tmp/example/docs/user/how-to');
    expect(presence).not.toContain('/tmp/example/docs/user/how-to');
  });
});

describe(listDocMds, () => {
  let dir: string;

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('finds a doc nested below the root, matching what the tag scan walks', async () => {
    dir = mkdtempSync(join(tmpdir(), 'doc-roots-'));
    const root = join(dir, 'docs', 'user', 'how-to');
    mkdirSync(join(root, 'nested'), { recursive: true });
    writeFileSync(join(root, 'top.md'), '# top\n', 'utf8');
    writeFileSync(join(root, 'nested', 'deep.md'), '# deep\n', 'utf8');
    writeFileSync(join(root, 'nested', 'skip.txt'), 'x', 'utf8');

    await expect(listDocMds([root], dir)).resolves.toEqual([
      'docs/user/how-to/nested/deep.md',
      'docs/user/how-to/top.md',
    ]);
  });

  it('skips a missing root rather than failing', async () => {
    dir = mkdtempSync(join(tmpdir(), 'doc-roots-'));
    await expect(listDocMds([join(dir, 'absent')], dir)).resolves.toEqual([]);
  });
});
