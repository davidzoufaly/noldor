import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { specsSource, roadmapSource, plansSource } from '../drain-source.js';

describe('specsSource', () => {
  it('throws a clear phase-2 message (not yet implemented)', () => {
    expect(() => specsSource('/x')).toThrow(/not yet implemented|phase 2/i);
  });
});

function tmpRepo(roadmap: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'drain-src-'));
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'roadmap.md'), roadmap, 'utf8');
  return dir;
}

// A real roadmap entry: `### Name` + `- key: value` bullets + free-text body.
// parseRoadmap derives the slug from the heading via slugify (single-word lowercase
// names keep slug === name) and sets priority from source order — no slug:/priority:
// fields. size XS → suggestedPath 'fast-track'; size L → an attach path (not fast-track).
function block(name: string, size: string, body = ''): string {
  return [
    `### ${name}`,
    '',
    `- area: tooling`,
    `- size: ${size}`,
    `- impact: high`,
    '',
    body,
    '',
  ].join('\n');
}

// Same as `block` but with a `- deps:` field bullet (comma-separated slugs).
function blockWithDeps(name: string, size: string, deps: string, body = ''): string {
  return [
    `### ${name}`,
    '',
    `- area: tooling`,
    `- size: ${size}`,
    `- impact: high`,
    `- deps: ${deps}`,
    '',
    body,
    '',
  ].join('\n');
}

describe('roadmapSource', () => {
  it('nextItem returns the top entry as an eligible fast-track candidate', () => {
    const dir = tmpRepo(block('alpha', 'XS', 'do one small thing'));
    try {
      const c = roadmapSource(dir).nextItem(new Set());
      expect(c).not.toBeNull();
      expect(c!.slug).toBe('alpha');
      expect(c!.eligible).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('marks a non-fast-track (L) entry ineligible with a fast-track reason', () => {
    const dir = tmpRepo(block('big', 'L', 'a large feature'));
    try {
      const c = roadmapSource(dir).nextItem(new Set());
      expect(c!.eligible).toBe(false);
      expect(c!.reason).toMatch(/fast-track/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('marks a Touches-bearing fast-track entry ineligible (residue reason)', () => {
    const dir = tmpRepo(block('touch', 'XS', 'do it\nTouches: a.ts'));
    try {
      const c = roadmapSource(dir).nextItem(new Set());
      expect(c!.eligible).toBe(false);
      expect(c!.reason).toMatch(/multi-scope|Touches/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('marks a fast-track entry ineligible when a deps: slug is still in the queue', () => {
    const dir = tmpRepo(
      blockWithDeps('beta', 'XS', 'alpha', 'depends on alpha') + block('alpha', 'XS', 'base'),
    );
    try {
      const c = roadmapSource(dir).nextItem(new Set());
      expect(c!.slug).toBe('beta');
      expect(c!.eligible).toBe(false);
      expect(c!.reason).toMatch(/dep|blocked|queue/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('eligible when a deps: slug is absent from the queue (already shipped)', () => {
    const dir = tmpRepo(blockWithDeps('beta', 'XS', 'shipped-thing', 'depends on a shipped entry'));
    try {
      const c = roadmapSource(dir).nextItem(new Set());
      expect(c!.slug).toBe('beta');
      expect(c!.eligible).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('respects the skip set and returns null when nothing remains', () => {
    const dir = tmpRepo(block('alpha', 'XS'));
    try {
      expect(roadmapSource(dir).nextItem(new Set(['alpha']))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parseAll returns every roadmap slug; gatePrompt is /gate --drain <slug>; branchFor is fast/<slug>', () => {
    const dir = tmpRepo(block('alpha', 'XS') + block('beta', 'L'));
    try {
      const s = roadmapSource(dir);
      expect(s.parseAll().sort()).toEqual(['alpha', 'beta']);
      expect(s.gatePrompt('alpha')).toBe('/gate --drain alpha');
      expect(s.branchFor('alpha')).toBe('fast/alpha');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Seed an in-progress FD + optional spec/plan files under a temp repo. The FD
 * frontmatter must satisfy `FeatureFrontmatterSchema` (strict — `links` is
 * REQUIRED) or `loadInProgressFds` silently skips it.
 */
function tmpPlansRepo(
  fds: Array<{ slug: string; spec?: boolean; planDate?: string | null }>,
): string {
  const dir = mkdtempSync(join(tmpdir(), 'drain-plans-'));
  mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'superpowers', 'specs'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true });
  for (const fd of fds) {
    const fm = [
      '---',
      `name: ${fd.slug}`,
      'area: tooling',
      'category: Tooling',
      'packages:',
      '  - scripts',
      'links:',
      '  code: []',
      '  tests: []',
      'phase: in-progress',
      'noldor-tier: full',
      '---',
      '',
      '## Summary',
      '',
      'x',
      '',
    ].join('\n');
    writeFileSync(join(dir, 'docs', 'features', `${fd.slug}.md`), fm, 'utf8');
    if (fd.spec !== false) {
      writeFileSync(
        join(dir, 'docs', 'superpowers', 'specs', `2026-06-01-${fd.slug}-design.md`),
        '# spec',
        'utf8',
      );
    }
    if (fd.planDate !== null) {
      const d = fd.planDate ?? '2026-06-05';
      writeFileSync(
        join(dir, 'docs', 'superpowers', 'plans', `${d}-${fd.slug}.md`),
        '# plan',
        'utf8',
      );
    }
  }
  return dir;
}

describe('plansSource', () => {
  it('returns an in-progress FD with spec+plan as an eligible candidate', () => {
    const dir = tmpPlansRepo([{ slug: 'designed' }]);
    try {
      const c = plansSource(dir).nextItem(new Set());
      expect(c).not.toBeNull();
      expect(c!.slug).toBe('designed');
      expect(c!.eligible).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('orders eligible FDs by ascending plan-file date (FIFO oldest-first)', () => {
    const dir = tmpPlansRepo([
      { slug: 'newer', planDate: '2026-06-09' },
      { slug: 'older', planDate: '2026-06-02' },
    ]);
    try {
      expect(plansSource(dir).nextItem(new Set())!.slug).toBe('older');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('surfaces an in-progress FD lacking a plan as ineligible with the phase-2 reason', () => {
    const dir = tmpPlansRepo([{ slug: 'noplan', planDate: null }]);
    try {
      const c = plansSource(dir).nextItem(new Set());
      expect(c!.slug).toBe('noplan');
      expect(c!.eligible).toBe(false);
      expect(c!.reason).toMatch(/no plan/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('surfaces a plan-but-no-spec FD as ineligible with a no-spec reason (never silently dropped)', () => {
    const dir = tmpPlansRepo([{ slug: 'nospec', spec: false }]);
    try {
      const c = plansSource(dir).nextItem(new Set());
      expect(c!.slug).toBe('nospec');
      expect(c!.eligible).toBe(false);
      expect(c!.reason).toMatch(/no spec/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prefers an eligible FD over a non-eligible one', () => {
    const dir = tmpPlansRepo([{ slug: 'noplan', planDate: null }, { slug: 'designed' }]);
    try {
      expect(plansSource(dir).nextItem(new Set())!.slug).toBe('designed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parseAll returns all in-progress slugs; gatePrompt resumes; branchFor is feat/<slug>', () => {
    const dir = tmpPlansRepo([{ slug: 'designed' }, { slug: 'noplan', planDate: null }]);
    try {
      const s = plansSource(dir);
      expect(s.parseAll().sort()).toEqual(['designed', 'noplan']);
      // Plan-drain resume must ride the autonomous directive on the prompt (PR #33):
      // the `--autonomous` flag plus prose so the headless gate never stalls at an
      // interactive seam. Assert the resume command + the autonomous signal.
      const prompt = s.gatePrompt('designed');
      expect(prompt).toContain('/gate --resume designed --autonomous');
      expect(prompt).toMatch(/set-autonomous|autonomous mode/);
      expect(prompt).toContain('NO interactive prompts');
      expect(s.branchFor('designed')).toBe('feat/designed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('honours the skip set', () => {
    const dir = tmpPlansRepo([{ slug: 'designed' }]);
    try {
      expect(plansSource(dir).nextItem(new Set(['designed']))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
