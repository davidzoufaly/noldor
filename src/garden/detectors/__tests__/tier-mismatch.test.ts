import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectTierMismatch } from '../tier-mismatch.js';

// @tests: noldor, outcome-telemetry-and-effectiveness-metrics

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'tier-mismatch-'));
  await mkdir(join(root, 'docs/features'), { recursive: true });
  return root;
}

const BASE_FRONTMATTER = `name: Test Feature
phase: in-progress
area: test
category: Tooling
packages:
  - '@acme/web'
links:
  code: []
  tests: []
  docs: []`;

describe('detectTierMismatch', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await makeRepo();
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('does NOT flag full tier with spec present', async () => {
    await writeFile(
      join(repo, 'docs/features/my-feature.md'),
      [
        '---',
        'name: Test Feature',
        'phase: in-progress',
        'area: test',
        'category: Tooling',
        "packages:\n  - '@acme/web'",
        'noldor-tier: full',
        'links:',
        '  code: []',
        '  tests: []',
        '  docs: []',
        '  spec: docs/superpowers/specs/2026-01-01-my-feature-design.md',
        '---',
        'body',
      ].join('\n'),
    );

    const findings = await detectTierMismatch(repo);
    expect(findings).toHaveLength(0);
  });

  it('flags full tier when links.spec is absent', async () => {
    await writeFile(
      join(repo, 'docs/features/no-spec.md'),
      `---\n${BASE_FRONTMATTER}\nnoldor-tier: full\n---\nbody\n`,
    );

    const findings = await detectTierMismatch(repo);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.slug).toBe('no-spec');
    expect(findings[0]!.reason).toBe('full-tier-missing-spec');
  });

  it('does NOT flag specs-only tier with no spec', async () => {
    await writeFile(
      join(repo, 'docs/features/specs-only.md'),
      `---\n${BASE_FRONTMATTER}\nnoldor-tier: specs-only\n---\nbody\n`,
    );

    const findings = await detectTierMismatch(repo);
    expect(findings).toHaveLength(0);
  });

  it('does NOT flag FDs with no tier set', async () => {
    await writeFile(
      join(repo, 'docs/features/no-tier.md'),
      `---\n${BASE_FRONTMATTER}\n---\nbody\n`,
    );

    const findings = await detectTierMismatch(repo);
    expect(findings).toHaveLength(0);
  });

  it('flags multiple mismatched FDs', async () => {
    await writeFile(
      join(repo, 'docs/features/a.md'),
      `---\n${BASE_FRONTMATTER}\nnoldor-tier: full\n---\nbody\n`,
    );
    await writeFile(
      join(repo, 'docs/features/b.md'),
      `---\n${BASE_FRONTMATTER}\nnoldor-tier: full\n---\nbody\n`,
    );

    const findings = await detectTierMismatch(repo);
    expect(findings).toHaveLength(2);
  });
});
