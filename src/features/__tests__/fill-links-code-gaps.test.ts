// @tests: feature-md-links-overhaul

import { describe, expect, it } from 'vitest';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  backupFeatures,
  generateProposal,
  parseLlmResponse,
  parseProposal,
  resolveByPath,
} from '../fill-links-code-gaps.js';
import type { FeatureFrontmatter } from '../feature-schema.js';

type FeatureRow = { slug: string; frontmatter: FeatureFrontmatter };

const fmBase: Omit<FeatureFrontmatter, 'name' | 'area' | 'packages'> = {
  category: 'Modeling',
  deps: [],
  links: { code: [], docs: [], tests: [] },
  phase: 'done',
  'noldor-tier': 'specs-only',
};

const features: FeatureRow[] = [
  {
    slug: 'manifold-wasm-integration',
    frontmatter: { ...fmBase, area: 'engine', name: 'Manifold WASM', packages: ['engine'] },
  },
  {
    slug: 'boolean-operations',
    frontmatter: {
      ...fmBase,
      area: 'engine',
      name: 'Boolean Operations',
      packages: ['engine'],
    },
  },
  {
    slug: 'scene-tree-panel',
    frontmatter: {
      ...fmBase,
      area: 'web',
      category: 'Editor',
      name: 'Scene Tree Panel',
      packages: ['apps-web'],
    },
  },
];

describe('resolveByPath', () => {
  it('returns single high-confidence match when only one package candidate', () => {
    const result = resolveByPath({
      filePath: 'packages/format/src/serialize.ts',
      features: [
        ...features,
        {
          slug: 'format-package',
          frontmatter: { ...fmBase, area: 'format', name: 'Format', packages: ['format'] },
        },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].fdSlug).toBe('format-package');
    expect(result[0].confidence).toBe('high');
  });

  it('disambiguates multi-candidate via slug substring', () => {
    const result = resolveByPath({
      filePath: 'packages/engine/src/booleans.ts',
      features,
    });
    expect(result).toHaveLength(1);
    expect(result[0].fdSlug).toBe('boolean-operations');
    expect(result[0].confidence).toBe('high');
  });

  it('returns empty array when no package match', () => {
    const result = resolveByPath({
      filePath: 'docs/some-doc.md',
      features,
    });
    expect(result).toHaveLength(0);
  });

  it('uses area fallback for apps/web/ paths', () => {
    const result = resolveByPath({
      filePath: 'apps/web/src/components/scene-tree/TreeNode.tsx',
      features,
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some((m) => m.fdSlug === 'scene-tree-panel')).toBe(true);
  });

  it('matches cross-area FDs via packages.includes("web") for apps/web/ paths', () => {
    const crossArea: FeatureRow = {
      slug: 'export-import-charuy-file',
      frontmatter: {
        ...fmBase,
        area: 'format',
        category: 'Distribution',
        name: 'Export / Import .charuy File',
        packages: ['format', 'web'],
      },
    };
    const result = resolveByPath({
      filePath: 'apps/web/src/file/import-charuy.ts',
      features: [...features, crossArea],
    });
    expect(result.some((m) => m.fdSlug === 'export-import-charuy-file')).toBe(true);
  });

  it('matches scripts/ paths via packages.includes("scripts") + area-group fallback', () => {
    const scriptFd: FeatureRow = {
      slug: 'noldor',
      frontmatter: {
        ...fmBase,
        area: 'docs',
        category: 'Tooling',
        name: 'Noldor Framework',
        packages: ['scripts'],
      },
    };
    const releaseFd: FeatureRow = {
      slug: 'release-pipeline',
      frontmatter: {
        ...fmBase,
        area: 'release',
        category: 'Tooling',
        name: 'Release Pipeline',
        packages: ['scripts'],
      },
    };
    const result = resolveByPath({
      filePath: 'packages/noldor/src/release/release-notes.ts',
      features: [scriptFd, releaseFd],
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some((m) => m.fdSlug === 'release-pipeline')).toBe(true);
  });
});

describe('parseLlmResponse', () => {
  it('parses valid JSON response', () => {
    const raw =
      '{"chosen_fd_slug": "manifold-wasm-integration", "confidence": "high", "reason": "owns wasm module"}';
    const parsed = parseLlmResponse(raw);
    expect(parsed).toEqual({
      fdSlug: 'manifold-wasm-integration',
      confidence: 'high',
      reason: 'owns wasm module',
    });
  });

  it('returns null on malformed JSON', () => {
    expect(parseLlmResponse('not-json')).toBeNull();
  });

  it('returns null on missing required fields', () => {
    expect(parseLlmResponse('{"chosen_fd_slug": "foo"}')).toBeNull();
  });

  it('returns null on invalid confidence', () => {
    expect(
      parseLlmResponse('{"chosen_fd_slug": "foo", "confidence": "extreme", "reason": "x"}'),
    ).toBeNull();
  });
});

describe('generateProposal', () => {
  it('groups assignments by FD slug', () => {
    const md = generateProposal({
      assignments: [
        {
          filePath: 'packages/engine/src/mesh.ts',
          match: { fdSlug: 'manifold-wasm-integration', confidence: 'high', reason: 'pkg' },
        },
        {
          filePath: 'packages/engine/src/booleans.ts',
          match: { fdSlug: 'boolean-operations', confidence: 'high', reason: 'slug' },
        },
      ],
      unassigned: [],
    });
    expect(md).toContain('## manifold-wasm-integration');
    expect(md).toContain('packages/engine/src/mesh.ts');
    expect(md).toContain('## boolean-operations');
    expect(md).toContain('packages/engine/src/booleans.ts');
  });

  it('emits UNASSIGNED section when present', () => {
    const md = generateProposal({
      assignments: [],
      unassigned: [
        {
          filePath: 'apps/web/src/lib/utils.ts',
          candidates: ['editor-shell', 'state-management'],
        },
      ],
    });
    expect(md).toContain('## UNASSIGNED');
    expect(md).toContain('apps/web/src/lib/utils.ts');
    expect(md).toContain('candidates [editor-shell, state-management]');
  });

  it('omits UNASSIGNED when no unassigned files', () => {
    const md = generateProposal({
      assignments: [
        {
          filePath: 'foo.ts',
          match: { fdSlug: 'foo', confidence: 'high', reason: 'r' },
        },
      ],
      unassigned: [],
    });
    expect(md).not.toContain('UNASSIGNED');
  });
});

describe('parseProposal', () => {
  it('extracts FD-to-files mapping from markdown', () => {
    const md = `# links.code Backfill Proposal

## manifold-wasm-integration

- packages/engine/src/mesh.ts (high — pkg)
- packages/engine/src/primitives.ts (high — pkg)

## boolean-operations

- packages/engine/src/booleans.ts (high — slug)
`;
    const parsed = parseProposal(md);
    expect(parsed.get('manifold-wasm-integration')).toEqual([
      'packages/engine/src/mesh.ts',
      'packages/engine/src/primitives.ts',
    ]);
    expect(parsed.get('boolean-operations')).toEqual(['packages/engine/src/booleans.ts']);
  });

  it('skips lines starting with #', () => {
    const md = `## fd-a

- foo.ts (high)
- # bar.ts (skipped)
`;
    const parsed = parseProposal(md);
    expect(parsed.get('fd-a')).toEqual(['foo.ts']);
  });

  it('skips UNASSIGNED section', () => {
    const md = `## fd-a

- foo.ts (high)

## UNASSIGNED (operator must choose)

- bar.ts (LLM)
`;
    const parsed = parseProposal(md);
    expect(parsed.get('fd-a')).toEqual(['foo.ts']);
    expect(parsed.has('UNASSIGNED')).toBe(false);
  });
});

describe('backupFeatures', () => {
  it('copies all FD MDs to a timestamped backup dir', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'backfill-test-'));
    const featuresDir = join(tempRoot, 'features');
    const backupRoot = join(tempRoot, 'backups');
    mkdirSync(featuresDir);
    writeFileSync(join(featuresDir, 'foo.md'), 'foo content', 'utf8');
    writeFileSync(join(featuresDir, 'bar.md'), 'bar content', 'utf8');

    const backupDir = backupFeatures(featuresDir, backupRoot);

    expect(backupDir).toContain(backupRoot);
    expect(existsSync(join(backupDir, 'foo.md'))).toBe(true);
    expect(existsSync(join(backupDir, 'bar.md'))).toBe(true);
    expect(readFileSync(join(backupDir, 'foo.md'), 'utf8')).toBe('foo content');
  });

  it('skips non-md files', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'backfill-test-'));
    const featuresDir = join(tempRoot, 'features');
    const backupRoot = join(tempRoot, 'backups');
    mkdirSync(featuresDir);
    writeFileSync(join(featuresDir, 'foo.md'), 'foo', 'utf8');
    writeFileSync(join(featuresDir, 'README.txt'), 'readme', 'utf8');

    const backupDir = backupFeatures(featuresDir, backupRoot);

    expect(existsSync(join(backupDir, 'foo.md'))).toBe(true);
    expect(existsSync(join(backupDir, 'README.txt'))).toBe(false);
  });
});
