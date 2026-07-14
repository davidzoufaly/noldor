// @tests: noldor
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectFdLinkRot } from '../fd-link-rot.js';

function repoWithFd(frontmatter: string): string {
  const repo = mkdtempSync(join(tmpdir(), 'fd-link-rot-'));
  mkdirSync(join(repo, 'docs', 'features'), { recursive: true });
  writeFileSync(
    join(repo, 'docs', 'features', 'my-feature.md'),
    `---\n${frontmatter}\n---\n\nbody\n`,
  );
  return repo;
}

describe('detectFdLinkRot', () => {
  it('flags missing link targets across all link keys', async () => {
    const repo = repoWithFd(
      [
        'name: my-feature',
        'links:',
        '  code:',
        '    - src/missing.ts',
        '  tests:',
        '    - src/__tests__/gone.test.ts',
        '  docs: []',
        '  spec: docs/design/specs/nope-design.md',
        '  plan: docs/design/plans/nope.md',
      ].join('\n'),
    );
    const gaps = await detectFdLinkRot(repo);
    expect(gaps.map((g) => g.message)).toEqual([
      'my-feature: links.code target missing: src/missing.ts',
      'my-feature: links.tests target missing: src/__tests__/gone.test.ts',
      'my-feature: links.spec target missing: docs/design/specs/nope-design.md',
      'my-feature: links.plan target missing: docs/design/plans/nope.md',
    ]);
    expect(gaps.every((g) => g.category === 'fd-link-rot' && g.itemId === 'my-feature')).toBe(true);
  });

  it('passes existing targets and skips sentinels and URLs', async () => {
    const repo = repoWithFd(
      [
        'name: my-feature',
        'links:',
        '  code:',
        '    - src/real.ts',
        '  tests:',
        '    - n/a',
        '  docs:',
        '    - https://example.test/page',
        '  spec: lost-pre-extraction',
      ].join('\n'),
    );
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'real.ts'), 'export {};\n');
    expect(await detectFdLinkRot(repo)).toEqual([]);
  });

  it('handles a plan list and a missing features dir', async () => {
    const repo = repoWithFd(
      ['name: my-feature', 'links:', '  plan:', '    - docs/design/plans/gone.md'].join('\n'),
    );
    const gaps = await detectFdLinkRot(repo);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].message).toContain('links.plan target missing');

    const empty = mkdtempSync(join(tmpdir(), 'fd-link-rot-empty-'));
    expect(await detectFdLinkRot(empty)).toEqual([]);
  });
});
