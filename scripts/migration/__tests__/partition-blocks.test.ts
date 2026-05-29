import { describe, expect, it } from 'vitest';
import { partitionBlocks } from '../partition-blocks.js';

const SAMPLE_FLAT = `# Roadmap

Intro paragraph stays with header.

#### Slug One

block one content

#### Slug Two

block two content

#### Slug Three

block three content
`;

const SAMPLE_WITH_H3 = `# Roadmap

Intro paragraph.

### Noldor Framework

#### Codex CR Plan-Review Mode

framework entry one

#### Drop Manual Feature MD Update Step

framework entry two

### Modeling

#### Boolean Operations Solver

product entry one

#### CSG Tree Evaluation

product entry two
`;

describe('partitionBlocks (flat H4 only)', () => {
  it('matches by slugified H4 title', () => {
    const { framework, product } = partitionBlocks(
      SAMPLE_FLAT,
      new Set(['slug-one', 'slug-three']),
    );

    expect(framework).toContain('#### Slug One');
    expect(framework).toContain('#### Slug Three');
    expect(framework).not.toContain('#### Slug Two');

    expect(product).toContain('#### Slug Two');
    expect(product).not.toContain('#### Slug One');
    expect(product).not.toContain('#### Slug Three');
  });

  it('preserves preamble in product output', () => {
    const { product } = partitionBlocks(SAMPLE_FLAT, new Set(['slug-one']));
    expect(product).toMatch(/^# Roadmap\n/);
    expect(product).toContain('Intro paragraph stays with header');
  });

  it('empty framework set leaves product with all blocks', () => {
    const { framework, product } = partitionBlocks(SAMPLE_FLAT, new Set());
    expect(framework).toBe('');
    expect(product).toContain('#### Slug One');
    expect(product).toContain('#### Slug Two');
    expect(product).toContain('#### Slug Three');
  });
});

describe('partitionBlocks (with H3 categories)', () => {
  it('carries H3 header into framework output when child H4 matches', () => {
    const { framework } = partitionBlocks(
      SAMPLE_WITH_H3,
      new Set(['codex-cr-plan-review-mode', 'drop-manual-feature-md-update-step']),
    );

    expect(framework).toContain('### Noldor Framework');
    expect(framework).toContain('#### Codex CR Plan-Review Mode');
    expect(framework).toContain('#### Drop Manual Feature MD Update Step');
    expect(framework).not.toContain('### Modeling');
    expect(framework).not.toContain('#### Boolean Operations Solver');
  });

  it('carries H3 header into product when child H4 stays', () => {
    const { product } = partitionBlocks(
      SAMPLE_WITH_H3,
      new Set(['codex-cr-plan-review-mode', 'drop-manual-feature-md-update-step']),
    );

    expect(product).toContain('### Modeling');
    expect(product).toContain('#### Boolean Operations Solver');
    expect(product).toContain('#### CSG Tree Evaluation');
    expect(product).not.toContain('### Noldor Framework');
    expect(product).not.toContain('#### Codex CR Plan-Review Mode');
  });

  it('backlog-style H3-only entries route to framework or product by slug', () => {
    const backlog = `# Backlog

Intro.

### Framework Entry One

- area: tooling

framework body one.

### Product Entry Alpha

- area: editor

product body alpha.

### Framework Entry Two

- area: tooling

framework body two.
`;

    const { framework, product } = partitionBlocks(
      backlog,
      new Set(['framework-entry-one', 'framework-entry-two']),
    );

    expect(framework).toContain('### Framework Entry One');
    expect(framework).toContain('framework body one');
    expect(framework).toContain('### Framework Entry Two');
    expect(framework).toContain('framework body two');
    expect(framework).not.toContain('### Product Entry Alpha');

    expect(product).toContain('### Product Entry Alpha');
    expect(product).toContain('product body alpha');
    expect(product).not.toContain('### Framework Entry One');
    expect(product).not.toContain('### Framework Entry Two');
  });

  it('treats H3 with no H4 children as framework when H3 slug matches', () => {
    const body = `# Roadmap

Intro.

### Mark FD phase=done in feature PR (not at release)

Single-entry section promoted to H3. Body paragraph.

### Modeling

#### Boolean Operations Solver

product entry
`;

    const { framework, product } = partitionBlocks(
      body,
      new Set(['mark-fd-phasedone-in-feature-pr-not-at-release']),
    );

    expect(framework).toContain('### Mark FD phase=done in feature PR (not at release)');
    expect(framework).toContain('Single-entry section promoted to H3');
    expect(product).toContain('#### Boolean Operations Solver');
    expect(product).not.toContain('### Mark FD phase=done');
  });
});
