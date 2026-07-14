// @tests: version-aware-upgrade-and-migration-chain
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migration_1_0_0 } from '../1.0.0.js';

/** A consumer tree with legacy docs/superpowers content + references to it. */
function fakeConsumer(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mig100-'));
  const w = (rel: string, body: string): void => {
    const p = join(dir, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, body);
  };
  w(
    'docs/superpowers/specs/2026-06-01-foo-design.md',
    '# foo spec\nsee docs/superpowers/plans/x.md\n',
  );
  w('docs/superpowers/plans/2026-06-01-foo.md', '# foo plan');
  w('docs/superpowers/specs/archive/2026-01-01-old-design.md', '# archived spec');
  w(
    'docs/features/foo.md',
    '---\nlinks:\n  spec: docs/superpowers/specs/2026-06-01-foo-design.md\n  plan: docs/superpowers/plans/2026-06-01-foo.md\n---\n# Foo\n',
  );
  w('docs/noldor/lifecycle.md', 'Specs live under docs/superpowers/specs/.\n');
  w('docs/roadmap.md', '# Roadmap\n');
  return dir;
}

const read = (dir: string, rel: string): string => readFileSync(join(dir, rel), 'utf8');

describe('migration 1.0.0 — docs/superpowers → docs/design (Q-0006)', () => {
  it('moves spec/plan trees (incl archive/) and rewrites links', () => {
    const dir = fakeConsumer();
    migration_1_0_0.migrate(dir, {} as never);

    // Files moved.
    expect(existsSync(join(dir, 'docs/design/specs/2026-06-01-foo-design.md'))).toBe(true);
    expect(existsSync(join(dir, 'docs/design/plans/2026-06-01-foo.md'))).toBe(true);
    expect(existsSync(join(dir, 'docs/design/specs/archive/2026-01-01-old-design.md'))).toBe(true);
    // Legacy tree gone.
    expect(existsSync(join(dir, 'docs/superpowers'))).toBe(false);

    // FD frontmatter links rewritten.
    const fd = read(dir, 'docs/features/foo.md');
    expect(fd).toContain('spec: docs/design/specs/2026-06-01-foo-design.md');
    expect(fd).toContain('plan: docs/design/plans/2026-06-01-foo.md');
    expect(fd).not.toContain('docs/superpowers');

    // Framework twin rewritten.
    expect(read(dir, 'docs/noldor/lifecycle.md')).toContain('docs/design/specs/');

    // Moved spec's own internal link rewritten.
    expect(read(dir, 'docs/design/specs/2026-06-01-foo-design.md')).toContain(
      'docs/design/plans/x.md',
    );
  });

  it('dryRun reports steps without touching disk', () => {
    const dir = fakeConsumer();
    const steps = migration_1_0_0.dryRun(dir, {} as never);
    expect(steps.length).toBeGreaterThan(0);
    // Nothing moved or rewritten.
    expect(existsSync(join(dir, 'docs/superpowers/specs/2026-06-01-foo-design.md'))).toBe(true);
    expect(existsSync(join(dir, 'docs/design'))).toBe(false);
    expect(read(dir, 'docs/features/foo.md')).toContain('docs/superpowers');
  });

  it('is idempotent — a second migrate is a no-op', () => {
    const dir = fakeConsumer();
    migration_1_0_0.migrate(dir, {} as never);
    const steps = migration_1_0_0.migrate(dir, {} as never);
    expect(steps).toEqual([]);
  });

  it('no-op on a tree with no docs/superpowers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig100-'));
    mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'features', 'bar.md'), '# bar, no legacy links\n');
    expect(migration_1_0_0.migrate(dir, {} as never)).toEqual([]);
  });

  it('chains contiguously from 0.7.0', () => {
    expect(migration_1_0_0.from).toBe('0.7.0');
    expect(migration_1_0_0.to).toBe('1.0.0');
  });
});
