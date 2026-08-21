// @tests: de-superpowers-vendor-spec-plan-and-worktree-flows
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { locateArtifact, readArtifact } from '../artifact-locate.js';

const SLUG = 'my-feature';

function repo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'noldor-locate-'));
  mkdirSync(join(cwd, 'docs', 'design', 'specs'), { recursive: true });
  mkdirSync(join(cwd, 'docs', 'design', 'plans'), { recursive: true });
  return cwd;
}

function spec(cwd: string, name: string, body = '## Design\nx\n'): string {
  const p = join(cwd, 'docs', 'design', 'specs', name);
  writeFileSync(p, body);
  return p;
}

function plan(cwd: string, name: string): string {
  const p = join(cwd, 'docs', 'design', 'plans', name);
  writeFileSync(p, '## Task 1\nx\n');
  return p;
}

describe('locateArtifact — discovery', () => {
  it('returns the sole spec matching the slug', () => {
    const cwd = repo();
    spec(cwd, `2026-08-21-${SLUG}-design.md`);
    spec(cwd, '2026-08-20-other-design.md');
    const r = locateArtifact(cwd, { slug: SLUG });
    expect(r.status).toBe('found');
    expect(r.status === 'found' && r.paths).toHaveLength(1);
    expect(r.status === 'found' && r.paths[0]).toContain(`${SLUG}-design.md`);
  });

  it('rejects several spec files sharing one slug', () => {
    const cwd = repo();
    spec(cwd, `2026-08-20-${SLUG}-design.md`);
    spec(cwd, `2026-08-21-${SLUG}-design.md`);
    const r = locateArtifact(cwd, { slug: SLUG });
    expect(r.status).toBe('rejected');
    expect(r.status === 'rejected' && r.reason).toMatch(/2 spec files/);
  });

  it('returns none when nothing matches', () => {
    expect(locateArtifact(repo(), { slug: SLUG }).status).toBe('none');
  });

  it('returns none when the root does not exist', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'noldor-locate-bare-'));
    expect(locateArtifact(cwd, { slug: SLUG }).status).toBe('none');
  });

  it('rejects rather than reporting none when the root is not a directory', () => {
    // A misconfigured root reported as an absence would suppress the checklist
    // and every warning forever, with nothing on screen to explain why.
    const cwd = mkdtempSync(join(tmpdir(), 'noldor-locate-file-root-'));
    mkdirSync(join(cwd, 'docs', 'design'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'design', 'specs'), 'not a directory');
    const r = locateArtifact(cwd, { slug: SLUG });
    expect(r.status).toBe('rejected');
    expect(r.status === 'rejected' && r.reason).toMatch(/cannot be listed/);
  });

  it('orders split plan parts by part number, not lexically', () => {
    const cwd = repo();
    plan(cwd, `2026-08-21-${SLUG}-part10.md`);
    plan(cwd, `2026-08-21-${SLUG}-part2.md`);
    plan(cwd, `2026-08-21-${SLUG}.md`);
    const r = locateArtifact(cwd, { slug: SLUG, kind: 'plan' });
    expect(r.status).toBe('found');
    const names = r.status === 'found' ? r.paths.map((p) => p.split('/').pop()) : [];
    expect(names).toEqual([
      `2026-08-21-${SLUG}.md`,
      `2026-08-21-${SLUG}-part2.md`,
      `2026-08-21-${SLUG}-part10.md`,
    ]);
  });

  it('rejects two plan generations distinguished only by a planN prefix', () => {
    // extractPlanSlug strips a `^plan\d+-` prefix, so two generations collapse
    // onto one slug and would blend as if they were parts of one split plan.
    const cwd = repo();
    plan(cwd, `2026-08-21-plan2-${SLUG}.md`);
    plan(cwd, `2026-08-21-plan5-${SLUG}.md`);
    const r = locateArtifact(cwd, { slug: SLUG, kind: 'plan' });
    expect(r.status).toBe('rejected');
    expect(r.status === 'rejected' && r.reason).toMatch(/matches 2 generations/);
  });

  it('rejects a part-less generation mixed with a split generation', () => {
    // Non-overlapping part numbers are not enough: these are two generations, and
    // blending them lets view.section resolve a heading to the stale one.
    const cwd = repo();
    plan(cwd, `2026-08-20-plan1-${SLUG}.md`);
    plan(cwd, `2026-08-21-plan2-${SLUG}-part1.md`);
    plan(cwd, `2026-08-21-plan2-${SLUG}-part2.md`);
    const r = locateArtifact(cwd, { slug: SLUG, kind: 'plan' });
    expect(r.status).toBe('rejected');
    expect(r.status === 'rejected' && r.reason).toMatch(/matches 2 generations/);
  });

  it('treats a part-less file as part 1, so it collides with -part1', () => {
    const cwd = repo();
    plan(cwd, `2026-08-21-${SLUG}.md`);
    plan(cwd, `2026-08-21-${SLUG}-part1.md`);
    const r = locateArtifact(cwd, { slug: SLUG, kind: 'plan' });
    expect(r.status).toBe('rejected');
    expect(r.status === 'rejected' && r.reason).toMatch(/share slug .* and part number/);
  });

  it('still accepts genuine parts, which carry distinct part numbers', () => {
    const cwd = repo();
    plan(cwd, `2026-08-21-${SLUG}-part1.md`);
    plan(cwd, `2026-08-21-${SLUG}-part2.md`);
    expect(locateArtifact(cwd, { slug: SLUG, kind: 'plan' }).status).toBe('found');
  });

  it('defaults kind to spec', () => {
    const cwd = repo();
    spec(cwd, `2026-08-21-${SLUG}-design.md`);
    plan(cwd, `2026-08-21-${SLUG}.md`);
    const r = locateArtifact(cwd, { slug: SLUG });
    expect(r.status === 'found' && r.paths[0]).toContain('specs');
  });

  it('ignores non-markdown files', () => {
    const cwd = repo();
    writeFileSync(join(cwd, 'docs', 'design', 'specs', `2026-08-21-${SLUG}-design.txt`), 'x');
    expect(locateArtifact(cwd, { slug: SLUG }).status).toBe('none');
  });

  it('rejects a discovered candidate that symlinks outside the root', () => {
    const cwd = repo();
    const outside = join(cwd, 'secret.md');
    writeFileSync(outside, 'leak');
    symlinkSync(outside, join(cwd, 'docs', 'design', 'specs', `2026-08-21-${SLUG}-design.md`));
    const r = locateArtifact(cwd, { slug: SLUG });
    expect(r.status).toBe('rejected');
    expect(r.status === 'rejected' && r.reason).toMatch(/outside/);
  });
});

describe('locateArtifact — override', () => {
  it('prefers a legal override over the slug match', () => {
    const cwd = repo();
    spec(cwd, `2026-08-21-${SLUG}-design.md`);
    const other = spec(cwd, '2026-08-20-other-design.md');
    const r = locateArtifact(cwd, { slug: SLUG, override: other });
    // Compare basenames: the returned path is symlink-resolved by design, so on
    // macOS it is the /private/var form of the /var path the fixture built.
    expect(r.status === 'found' && r.paths.map((p) => p.split('/').pop())).toEqual([
      '2026-08-20-other-design.md',
    ]);
  });

  it('accepts an override given as a cwd-relative path', () => {
    const cwd = repo();
    spec(cwd, `2026-08-21-${SLUG}-design.md`);
    const r = locateArtifact(cwd, {
      slug: SLUG,
      override: `docs/design/specs/2026-08-21-${SLUG}-design.md`,
    });
    expect(r.status).toBe('found');
  });

  it('rejects a missing override instead of throwing', () => {
    const cwd = repo();
    const r = locateArtifact(cwd, { slug: SLUG, override: 'docs/design/specs/nope.md' });
    expect(r.status).toBe('rejected');
    expect(r.status === 'rejected' && r.reason).toMatch(/not a readable file/);
  });

  it('rejects a non-markdown override', () => {
    const cwd = repo();
    writeFileSync(join(cwd, 'docs', 'design', 'specs', 'x.txt'), 'x');
    const r = locateArtifact(cwd, { slug: SLUG, override: 'docs/design/specs/x.txt' });
    expect(r.status === 'rejected' && r.reason).toMatch(/\.md/);
  });

  it('rejects an override outside the root', () => {
    const cwd = repo();
    writeFileSync(join(cwd, 'elsewhere.md'), 'x');
    const r = locateArtifact(cwd, { slug: SLUG, override: 'elsewhere.md' });
    expect(r.status === 'rejected' && r.reason).toMatch(/outside/);
  });

  it('rejects a sibling directory that merely shares the root prefix', () => {
    const cwd = repo();
    mkdirSync(join(cwd, 'docs', 'design', 'specs-scratch'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'design', 'specs-scratch', 'x.md'), 'x');
    const r = locateArtifact(cwd, { slug: SLUG, override: 'docs/design/specs-scratch/x.md' });
    expect(r.status === 'rejected' && r.reason).toMatch(/outside/);
  });

  it('rejects a symlink planted inside the root', () => {
    const cwd = repo();
    const outside = join(cwd, 'secret.md');
    writeFileSync(outside, 'leak');
    symlinkSync(outside, join(cwd, 'docs', 'design', 'specs', 'link.md'));
    const r = locateArtifact(cwd, { slug: SLUG, override: 'docs/design/specs/link.md' });
    expect(r.status === 'rejected' && r.reason).toMatch(/outside/);
  });

  it('rejects an unreadable regular file rather than promising found', () => {
    const cwd = repo();
    const p = spec(cwd, `2026-08-21-${SLUG}-design.md`);
    chmodSync(p, 0o000);
    const r = locateArtifact(cwd, { slug: SLUG });
    chmodSync(p, 0o644);
    expect(r.status).toBe('rejected');
    expect(r.status === 'rejected' && r.reason).toMatch(/not a readable file/);
  });

  it('rejects a directory named like a markdown file', () => {
    const cwd = repo();
    mkdirSync(join(cwd, 'docs', 'design', 'specs', 'dir.md'));
    const r = locateArtifact(cwd, { slug: SLUG, override: 'docs/design/specs/dir.md' });
    expect(r.status === 'rejected' && r.reason).toMatch(/not a readable file/);
  });

  it('expands a plan override to its whole generation cohort', () => {
    // Honouring the override literally would hand back a subset, and confirming
    // against a subset is what the all-or-nothing invariant forbids.
    const cwd = repo();
    plan(cwd, `2026-08-21-${SLUG}-part1.md`);
    plan(cwd, `2026-08-21-${SLUG}-part2.md`);
    const r = locateArtifact(cwd, {
      slug: SLUG,
      kind: 'plan',
      override: `docs/design/plans/2026-08-21-${SLUG}-part2.md`,
    });
    expect(r.status).toBe('found');
    expect(r.status === 'found' && r.paths.map((p) => p.split('/').pop())).toEqual([
      `2026-08-21-${SLUG}-part1.md`,
      `2026-08-21-${SLUG}-part2.md`,
    ]);
  });

  it('vets every sibling the plan cohort pulls in', () => {
    // The sibling walk once bypassed vet(), so a same-stem symlink could leak a
    // file from outside the plans root into chat.
    const cwd = repo();
    plan(cwd, `2026-08-21-${SLUG}-part1.md`);
    const outside = join(cwd, 'secret.md');
    writeFileSync(outside, 'leak');
    symlinkSync(outside, join(cwd, 'docs', 'design', 'plans', `2026-08-21-${SLUG}-part2.md`));
    const r = locateArtifact(cwd, {
      slug: SLUG,
      kind: 'plan',
      override: `docs/design/plans/2026-08-21-${SLUG}-part1.md`,
    });
    expect(r.status).toBe('rejected');
    expect(r.status === 'rejected' && r.reason).toMatch(/outside/);
  });

  it('applies the duplicate-part check to an override cohort', () => {
    const cwd = repo();
    plan(cwd, `2026-08-21-${SLUG}.md`);
    plan(cwd, `2026-08-21-${SLUG}-part1.md`);
    const r = locateArtifact(cwd, {
      slug: SLUG,
      kind: 'plan',
      override: `docs/design/plans/2026-08-21-${SLUG}.md`,
    });
    expect(r.status).toBe('rejected');
    expect(r.status === 'rejected' && r.reason).toMatch(/part number/);
  });

  it('finds a plan cohort that lives in a subdirectory of the root', () => {
    const cwd = repo();
    mkdirSync(join(cwd, 'docs', 'design', 'plans', 'archive'), { recursive: true });
    for (const n of [1, 2]) {
      writeFileSync(
        join(cwd, 'docs', 'design', 'plans', 'archive', `2026-08-21-${SLUG}-part${n}.md`),
        `## Task ${n}\nx\n`,
      );
    }
    const r = locateArtifact(cwd, {
      slug: SLUG,
      kind: 'plan',
      override: `docs/design/plans/archive/2026-08-21-${SLUG}-part2.md`,
    });
    expect(r.status).toBe('found');
    expect(r.status === 'found' && r.paths).toHaveLength(2);
  });

  it('leaves a spec override as the single file named', () => {
    const cwd = repo();
    const p = spec(cwd, `2026-08-21-${SLUG}-design.md`);
    const r = locateArtifact(cwd, { slug: SLUG, override: p });
    expect(r.status === 'found' && r.paths).toHaveLength(1);
  });

  it('checks an override against the plan root when kind is plan', () => {
    const cwd = repo();
    const s = spec(cwd, `2026-08-21-${SLUG}-design.md`);
    const r = locateArtifact(cwd, { slug: SLUG, kind: 'plan', override: s });
    expect(r.status === 'rejected' && r.reason).toMatch(/outside/);
  });

  it('resolves through a symlinked cwd such as /var to /private/var', () => {
    // The failure this guards: the root is built with `join(cwd, …)` and left
    // unresolved while the override resolves through realpath, so every legal
    // override compares as "outside" on macOS.
    const real = repo();
    const link = mkdtempSync(join(tmpdir(), 'noldor-locate-link-')) + '/alias';
    symlinkSync(real, link);
    spec(real, `2026-08-21-${SLUG}-design.md`);
    const r = locateArtifact(link, {
      slug: SLUG,
      override: `docs/design/specs/2026-08-21-${SLUG}-design.md`,
    });
    expect(r.status).toBe('found');
  });
});

describe('readArtifact', () => {
  it('reads a single spec', () => {
    const cwd = repo();
    const p = spec(cwd, `2026-08-21-${SLUG}-design.md`, '## Alpha\n\nbody\n');
    const r = readArtifact([p]);
    expect(r.status).toBe('read');
    expect(r.status === 'read' && r.view.headings.map((h) => h.name)).toEqual(['Alpha']);
    expect(r.status === 'read' && r.view.section('Alpha')).toBe('body');
  });

  it('unions the headings of a split plan in the order given', () => {
    const cwd = repo();
    const a = plan(cwd, `2026-08-21-${SLUG}.md`);
    const b = join(cwd, 'docs', 'design', 'plans', `2026-08-21-${SLUG}-part2.md`);
    writeFileSync(b, '## Task 2\nsecond\n');
    const r = readArtifact([a, b]);
    expect(r.status === 'read' && r.view.headings.map((h) => h.name)).toEqual(['Task 1', 'Task 2']);
    expect(r.status === 'read' && r.view.section('Task 2')).toBe('second');
  });

  it('rejects when any part is unreadable rather than rendering a subset', () => {
    // Rendering a partial split plan would let --confirm-section store an
    // approval digest for prose the operator never saw.
    const cwd = repo();
    const a = plan(cwd, `2026-08-21-${SLUG}.md`);
    const r = readArtifact([a, join(cwd, 'docs', 'design', 'plans', 'gone.md')]);
    expect(r.status).toBe('rejected');
    expect(r.status === 'rejected' && r.reason).toMatch(/cannot be read/);
  });
});
