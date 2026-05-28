// @tests: feature-md-links-overhaul

import { describe, expect, it } from 'vitest';

import { extractTouches } from '../extract-touches.js';

describe(extractTouches, () => {
  it('returns no paths and the input unchanged when no Touches: clause is present', () => {
    const body = 'Plain summary paragraph with no trailing clause.';
    const out = extractTouches(body);
    expect(out.paths).toEqual([]);
    expect(out.stripped).toBe(body);
  });

  it('extracts bare-backtick paths from a trailing Touches: clause', () => {
    const body = 'Summary paragraph. Touches: `scripts/foo.ts`, `scripts/bar.ts`, `docs/baz.md`.';
    const out = extractTouches(body);
    expect(out.paths).toEqual(['scripts/foo.ts', 'scripts/bar.ts', 'docs/baz.md']);
    expect(out.stripped).toBe('Summary paragraph.');
  });

  it('extracts markdown-link paths from a trailing Touches: clause', () => {
    const body =
      'Summary paragraph. Touches: [scripts/foo.ts](../../scripts/foo.ts), [docs/bar.md](../../docs/bar.md).';
    const out = extractTouches(body);
    expect(out.paths).toEqual(['scripts/foo.ts', 'docs/bar.md']);
    expect(out.stripped).toBe('Summary paragraph.');
  });

  it('handles mixed backtick + markdown-link entries', () => {
    const body =
      'Summary. Touches: `scripts/a.ts`, [scripts/b.ts](../../scripts/b.ts), `docs/c.md`.';
    const out = extractTouches(body);
    expect(out.paths).toEqual(['scripts/a.ts', 'scripts/b.ts', 'docs/c.md']);
    expect(out.stripped).toBe('Summary.');
  });

  it('trims trailing whitespace from the stripped body', () => {
    const body = 'Summary paragraph.   Touches: `scripts/x.ts`.   ';
    const out = extractTouches(body);
    expect(out.paths).toEqual(['scripts/x.ts']);
    expect(out.stripped).toBe('Summary paragraph.');
  });

  it('deduplicates repeated paths whether expressed via backticks or md-links', () => {
    const body = 'Summary. Touches: `a.ts`, `b.ts`, `a.ts`.';
    const out = extractTouches(body);
    expect(out.paths).toEqual(['a.ts', 'b.ts']);

    const mixed = 'Summary. Touches: [scripts/foo.ts](../../scripts/foo.ts), `scripts/foo.ts`.';
    expect(extractTouches(mixed).paths).toEqual(['scripts/foo.ts']);
  });

  it('ignores a Touches: occurrence that is not the trailing clause', () => {
    const body =
      'Summary discusses Touches: as a concept inline. Real trailing clause: Touches: `final.ts`.';
    const out = extractTouches(body);
    expect(out.paths).toEqual(['final.ts']);
    expect(out.stripped).toBe(
      'Summary discusses Touches: as a concept inline. Real trailing clause:',
    );
  });

  it('rejects non-path backticks (function names, prose tokens)', () => {
    // `parseRoadmap` is a function name, not a path — must not be lifted.
    // `parse-blocks.ts` is a bare filename (no slash); allowed by extension match.
    const body =
      'Summary. Touches: `packages/noldor/src/utils/parse-blocks.ts` `parseRoadmap` (drop section-heading scope), `docs/roadmap.md`.';
    const out = extractTouches(body);
    expect(out.paths).toContain('packages/noldor/src/utils/parse-blocks.ts');
    expect(out.paths).toContain('docs/roadmap.md');
    expect(out.paths).not.toContain('parseRoadmap');
  });

  it('does not extend the clause past the first sentence-ending period', () => {
    // Real-world clause shape: trailing "Possible drift:" prose after the Touches sentence.
    const body =
      'Summary. Touches: `docs/noldor/workflow.md`, `.claude/skills/gate/SKILL.md`. Possible drift: `.claude/skills/promote/SKILL.md:139` (...) needs the dangling reference removed.';
    const out = extractTouches(body);
    expect(out.paths).toEqual(['docs/noldor/workflow.md', '.claude/skills/gate/SKILL.md']);
    expect(out.paths).not.toContain('.claude/skills/promote/SKILL.md:139');
    expect(out.stripped).toBe(
      'Summary. Possible drift: `.claude/skills/promote/SKILL.md:139` (...) needs the dangling reference removed.',
    );
  });

  it('strips trailing period or comma fragments from extracted paths', () => {
    const body = 'Summary. Touches: `scripts/x.ts`,`scripts/y.ts`.';
    const out = extractTouches(body);
    expect(out.paths).toEqual(['scripts/x.ts', 'scripts/y.ts']);
    expect(out.paths.every((p) => !p.endsWith('.') && !p.endsWith(','))).toBe(true);
  });
});
