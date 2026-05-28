// @tests: sdd-co-tag-detector

import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyBlock,
  buildResourcesBlock,
  resolveSpecPath,
  syncFile,
} from '../sync-fd-resources.js';

describe(buildResourcesBlock, () => {
  it('returns empty string when no link entries are present', () => {
    expect(buildResourcesBlock({})).toBe('');
    expect(buildResourcesBlock({ links: {} })).toBe('');
    expect(buildResourcesBlock({ links: { code: [], commits: [], docs: [], tests: [] } })).toBe('');
  });

  it('renders spec as a relative path link', () => {
    const out = buildResourcesBlock({ links: { spec: 'docs/superpowers/specs/foo.md' } });
    expect(out).toContain('## Resources');
    expect(out).toContain(
      '- **Spec:** [`docs/superpowers/specs/foo.md`](../../docs/superpowers/specs/foo.md)',
    );
  });

  it('renders code, tests, docs as bulleted relative links', () => {
    const out = buildResourcesBlock({
      links: {
        code: ['scripts/foo.ts'],
        tests: ['scripts/__tests__/foo.test.ts'],
        docs: ['docs/user/tutorials/bar.md'],
      },
    });
    expect(out).toContain('- **Code:**');
    expect(out).toContain('  - [`scripts/foo.ts`](../../scripts/foo.ts)');
    expect(out).toContain('- **Tests:**');
    expect(out).toContain(
      '  - [`scripts/__tests__/foo.test.ts`](../../scripts/__tests__/foo.test.ts)',
    );
    expect(out).toContain('- **Docs:**');
    expect(out).toContain('  - [`docs/user/tutorials/bar.md`](../../docs/user/tutorials/bar.md)');
  });

  it('renders a single-string plan as a relative path link', () => {
    const out = buildResourcesBlock({
      links: { plan: 'docs/superpowers/plans/foo-plan.md' },
    });
    expect(out).toContain('- **Plan:**');
    expect(out).toContain(
      '  - [`docs/superpowers/plans/foo-plan.md`](../../docs/superpowers/plans/foo-plan.md)',
    );
  });

  it('renders an array of plans as bulleted relative links', () => {
    const out = buildResourcesBlock({
      links: {
        plan: ['docs/superpowers/plans/foo-part1.md', 'docs/superpowers/plans/foo-part2.md'],
      },
    });
    expect(out).toContain('- **Plan:**');
    expect(out).toContain(
      '  - [`docs/superpowers/plans/foo-part1.md`](../../docs/superpowers/plans/foo-part1.md)',
    );
    expect(out).toContain(
      '  - [`docs/superpowers/plans/foo-part2.md`](../../docs/superpowers/plans/foo-part2.md)',
    );
  });

  it('orders sections as Spec → Plan → Code → Tests → Docs', () => {
    const out = buildResourcesBlock({
      links: {
        spec: 's.md',
        plan: 'p.md',
        code: ['c.ts'],
        tests: ['t.test.ts'],
        docs: ['d.md'],
      },
    });
    const idxSpec = out.indexOf('**Spec:**');
    const idxPlan = out.indexOf('**Plan:**');
    const idxCode = out.indexOf('**Code:**');
    const idxTests = out.indexOf('**Tests:**');
    const idxDocs = out.indexOf('**Docs:**');
    expect(idxSpec).toBeGreaterThan(-1);
    expect(idxSpec).toBeLessThan(idxPlan);
    expect(idxPlan).toBeLessThan(idxCode);
    expect(idxCode).toBeLessThan(idxTests);
    expect(idxTests).toBeLessThan(idxDocs);
  });

  it('renders the n/a sentinel as an opt-out marker', () => {
    const out = buildResourcesBlock({ links: { tests: ['n/a'], docs: ['n/a'] } });
    expect(out).toContain('- **Tests:** _n/a (opt-out)_');
    expect(out).toContain('- **Docs:** _n/a (opt-out)_');
  });

  it('emits start and end markers around the section', () => {
    const out = buildResourcesBlock({ links: { spec: 'x.md' } });
    expect(out.startsWith('<!-- generated: resources -->')).toBe(true);
    expect(out.endsWith('<!-- /generated: resources -->')).toBe(true);
  });
});

describe(applyBlock, () => {
  it('appends the block at the end on first sync', () => {
    const body = '## Summary\n\nFoo.\n';
    const block =
      '<!-- generated: resources -->\n\n## Resources\n\n- bar\n\n<!-- /generated: resources -->';
    const out = applyBlock(body, block);
    expect(out).toContain('## Summary');
    expect(out.indexOf('## Summary')).toBeLessThan(out.indexOf('## Resources'));
    expect(out.endsWith('<!-- /generated: resources -->\n')).toBe(true);
  });

  it('replaces an existing block in place', () => {
    const body = `## Summary

Foo.

<!-- generated: resources -->

## Resources

- old

<!-- /generated: resources -->
`;
    const newBlock =
      '<!-- generated: resources -->\n\n## Resources\n\n- new\n\n<!-- /generated: resources -->';
    const out = applyBlock(body, newBlock);
    expect(out).toContain('- new');
    expect(out).not.toContain('- old');
    // Summary stays intact and stays first
    expect(out.indexOf('## Summary')).toBeLessThan(out.indexOf('## Resources'));
  });

  it('removes an existing block when the new block is empty (FD lost its links)', () => {
    const body = `## Summary

Foo.

<!-- generated: resources -->

## Resources

- old

<!-- /generated: resources -->
`;
    const out = applyBlock(body, '');
    expect(out).not.toContain('Resources');
    expect(out).not.toContain('generated:');
    expect(out).toContain('## Summary');
  });

  it('returns body unchanged when there is no existing block and the new block is empty', () => {
    const body = '## Summary\n\nFoo.\n';
    expect(applyBlock(body, '')).toBe(body);
  });
});

const existsNone = (): boolean => false;
const existsOnly =
  (target: string) =>
  (p: string): boolean =>
    p === target;

describe(resolveSpecPath, () => {
  it('returns null when current path is undefined', () => {
    expect(resolveSpecPath(undefined, existsNone)).toBe(null);
  });

  it('returns null when current path is the empty string', () => {
    expect(resolveSpecPath('', existsNone)).toBe(null);
  });

  it('returns null when current path exists on disk (no rewrite needed)', () => {
    expect(
      resolveSpecPath('docs/superpowers/specs/foo.md', existsOnly('docs/superpowers/specs/foo.md')),
    ).toBe(null);
  });

  it('returns the archive path when current is missing and archive variant exists', () => {
    expect(
      resolveSpecPath(
        'docs/superpowers/specs/foo.md',
        existsOnly('docs/superpowers/specs/archive/foo.md'),
      ),
    ).toBe('docs/superpowers/specs/archive/foo.md');
  });

  it('returns null when both current and archive variant are missing', () => {
    expect(resolveSpecPath('docs/superpowers/specs/foo.md', existsNone)).toBe(null);
  });

  it('returns null when path already points at an archive directory', () => {
    expect(
      resolveSpecPath(
        'docs/superpowers/specs/archive/foo.md',
        existsOnly('docs/superpowers/specs/archive/foo.md'),
      ),
    ).toBe(null);
  });

  it('handles nested archive convention for plans directory (forward-compat)', () => {
    expect(
      resolveSpecPath(
        'docs/superpowers/plans/2026-05-09-foo.md',
        existsOnly('docs/superpowers/plans/archive/2026-05-09-foo.md'),
      ),
    ).toBe('docs/superpowers/plans/archive/2026-05-09-foo.md');
  });
});

describe(syncFile, () => {
  // Regression: syncFile must emit oxfmt-clean output so `pnpm sync:fd-resources`
  // never requires a follow-up `pnpm fmt` round. Symptoms before the fix:
  // no blank line between the closing `---` frontmatter delimiter and the first
  // body heading, plus accumulating trailing blank lines on each invocation.
  let tmpDir: string;
  let mdPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sync-fd-resources-'));
    mdPath = join(tmpDir, 'fake-feature.md');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('emits a blank line between the closing frontmatter delimiter and the body', async () => {
    writeFileSync(
      mdPath,
      `---
name: Fake
links:
  code:
    - scripts/fake.ts
---

## Summary

Body.
`,
      'utf8',
    );
    await syncFile(mdPath);
    const out = readFileSync(mdPath, 'utf8');
    // oxfmt requires one blank line after `---\n` — the post-frontmatter
    // separator that `matter.stringify` does not emit by default.
    expect(out).toMatch(/---\n\n## Summary/);
  });

  it('emits exactly one trailing newline (no accumulating blank lines on re-sync)', async () => {
    writeFileSync(
      mdPath,
      `---
name: Fake
links:
  code:
    - scripts/fake.ts
---

## Summary

Body.
`,
      'utf8',
    );
    await syncFile(mdPath);
    await syncFile(mdPath);
    await syncFile(mdPath);
    const out = readFileSync(mdPath, 'utf8');
    // Single trailing newline only — re-running sync must be idempotent.
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });

  it('produces output that passes `oxfmt --check` without an interim fmt pass', async () => {
    writeFileSync(
      mdPath,
      `---
name: Fake
links:
  code:
    - scripts/fake.ts
  tests:
    - scripts/__tests__/fake.test.ts
---

## Summary

Body.
`,
      'utf8',
    );
    await syncFile(mdPath);
    // Shell oxfmt against the synced file. Exit 0 = clean. Non-zero would
    // throw, which is the failure mode this regression test is locking in.
    const result = execSync(`pnpm --silent fmt:check ${mdPath}`, {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(result).toContain('use the correct format');
  });

  it('rewrites links.spec to archive variant when current path is missing', async () => {
    // Create the archived spec file on disk so resolveSpecPath finds it.
    const archiveDir = join(tmpDir, 'docs', 'superpowers', 'specs', 'archive');
    execSync(`mkdir -p ${JSON.stringify(archiveDir)}`, { stdio: 'ignore' });
    writeFileSync(join(archiveDir, 'foo.md'), '# archived spec\n', 'utf8');

    // FD points at the ORIGINAL path (now missing) — the bug we are fixing.
    writeFileSync(
      mdPath,
      `---
name: Fake
links:
  code:
    - scripts/fake.ts
  spec: docs/superpowers/specs/foo.md
---

## Summary

Body.
`,
      'utf8',
    );

    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const changed = await syncFile(mdPath);
      expect(changed).toBe(true);
      const out = readFileSync(mdPath, 'utf8');
      expect(out).toContain('spec: docs/superpowers/specs/archive/foo.md');
      expect(out).not.toMatch(/spec: docs\/superpowers\/specs\/foo\.md\b/);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('leaves links.spec untouched when the current path still exists', async () => {
    const specDir = join(tmpDir, 'docs', 'superpowers', 'specs');
    execSync(`mkdir -p ${JSON.stringify(specDir)}`, { stdio: 'ignore' });
    writeFileSync(join(specDir, 'foo.md'), '# live spec\n', 'utf8');

    writeFileSync(
      mdPath,
      `---
name: Fake
links:
  code:
    - scripts/fake.ts
  spec: docs/superpowers/specs/foo.md
---

## Summary

Body.
`,
      'utf8',
    );

    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      await syncFile(mdPath);
      const out = readFileSync(mdPath, 'utf8');
      expect(out).toMatch(/spec: docs\/superpowers\/specs\/foo\.md\b/);
      expect(out).not.toContain('archive/foo.md');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('leaves links.spec untouched when neither current nor archive variant exists', async () => {
    writeFileSync(
      mdPath,
      `---
name: Fake
links:
  code:
    - scripts/fake.ts
  spec: docs/superpowers/specs/missing.md
---

## Summary

Body.
`,
      'utf8',
    );

    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      await syncFile(mdPath);
      const out = readFileSync(mdPath, 'utf8');
      expect(out).toMatch(/spec: docs\/superpowers\/specs\/missing\.md\b/);
      expect(out).not.toContain('archive/');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('is idempotent on a second invocation when rewrite happened on the first', async () => {
    const archiveDir = join(tmpDir, 'docs', 'superpowers', 'specs', 'archive');
    execSync(`mkdir -p ${JSON.stringify(archiveDir)}`, { stdio: 'ignore' });
    writeFileSync(join(archiveDir, 'foo.md'), '# archived spec\n', 'utf8');

    writeFileSync(
      mdPath,
      `---
name: Fake
links:
  code:
    - scripts/fake.ts
  spec: docs/superpowers/specs/foo.md
---

## Summary

Body.
`,
      'utf8',
    );

    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const firstChanged = await syncFile(mdPath);
      const firstBody = readFileSync(mdPath, 'utf8');
      const secondChanged = await syncFile(mdPath);
      const secondBody = readFileSync(mdPath, 'utf8');
      expect(firstChanged).toBe(true);
      expect(secondChanged).toBe(false);
      expect(secondBody).toBe(firstBody);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
