// @tests: framework-doc-extraction
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDocRoots } from '../doc-roots.js';

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
