// @tests: unvalidated-slug-path-traversal-across-cli-entry-points
import { describe, expect, it } from 'vitest';

import { scanSource } from '../slug-path-choke-point.js';

describe('scanSource', () => {
  it('flags a value joined onto a slug-rooted literal', () => {
    const v = scanSource('src/features/some-cli.ts', "const p = join(cwd, '.worktrees', slug);\n");
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(1);
    expect(v[0]?.severity).toBe('warn');
    expect(v[0]?.message).toContain('.worktrees');
  });

  it('flags a template-literal segment too', () => {
    const v = scanSource('src/cr/x.ts', 'const p = join(root, ".noldor/cr", `${slug}.json`);\n');
    expect(v).toHaveLength(1);
  });

  it('does not flag a bare directory root feeding a readdir', () => {
    expect(scanSource('src/garden/d.ts', "const dir = join(repo, 'docs/features');\n")).toEqual([]);
  });

  it('does not flag a relative display label with no anchor', () => {
    expect(scanSource('src/garden/d.ts', "const rel = join('docs/features', entry);\n")).toEqual(
      [],
    );
  });

  it('does not flag the guarded builders themselves', () => {
    const src = "const p = join(cwd, 'docs/features', `${slug}.md`);\n";
    expect(scanSource('src/core/doc-roots.ts', src)).toEqual([]);
    expect(scanSource('src/core/slug-paths.ts', src)).toEqual([]);
  });

  it('does not flag the test tree, which builds expected paths on purpose', () => {
    const src = "expect(p).toBe(join(cwd, '.worktrees', 'foo'));\n";
    expect(scanSource('src/worktrees/__tests__/x.test.ts', src)).toEqual([]);
  });

  it('reports the line the join starts on', () => {
    const v = scanSource(
      'src/a.ts',
      `const a = 1;\nconst b = 2;\nconst p = join(cwd, '.noldor/design', s);\n`,
    );
    expect(v[0]?.line).toBe(3);
  });

  it('is blind to a root hidden in a const — a stated limit, not an accident', () => {
    // This is why the brand, not this scan, is the enforcement.
    expect(scanSource('src/m.ts', 'const p = join(cwd, MILESTONES_DIR, `${slug}.md`);\n')).toEqual(
      [],
    );
  });
});
