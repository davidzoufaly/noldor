// @tests: graphify-plan-of-edges-nodes-for-plans-specs, outcome-telemetry-and-effectiveness-metrics
import { describe, it, expect } from 'vitest';
import { resolveByGraphAdjacency, resolveByLinksField } from '../plan-resolution.js';

describe('resolveByLinksField (links.plan)', () => {
  it('returns the FD whose links.plan contains the plan path', async () => {
    const reads = new Map<string, string>([
      [
        'docs/features/foo.md',
        '---\nname: Foo\nphase: done\narea: tooling\ncategory: Tooling\npackages:\n  - scripts\nlinks:\n  code: []\n  tests: []\n  plan:\n    - docs/design/plans/2026-04-19-foo.md\nnoldor-tier: full\n---\n',
      ],
      [
        'docs/features/bar.md',
        '---\nname: Bar\nphase: in-progress\narea: tooling\ncategory: Tooling\npackages:\n  - scripts\nlinks:\n  code: []\n  tests: []\nnoldor-tier: specs-only\n---\n',
      ],
    ]);
    const result = await resolveByLinksField({
      docPath: 'docs/design/plans/2026-04-19-foo.md',
      field: 'plan',
      repo: '/tmp/repo',
      readdir: async () => ['foo.md', 'bar.md'],
      readFile: async (p: string) => reads.get(p.replace('/tmp/repo/', '')) ?? '',
    });
    expect(result.outcome).toBe('resolved');
    expect(result).toMatchObject({ owner: { fd: { name: 'Foo' }, slug: 'foo' } });
  });

  it('handles plan as a single string (not array)', async () => {
    const result = await resolveByLinksField({
      docPath: 'docs/design/plans/2026-04-19-foo.md',
      field: 'plan',
      repo: '/tmp/repo',
      readdir: async () => ['foo.md'],
      readFile: async () =>
        '---\nname: Foo\nphase: done\narea: tooling\ncategory: Tooling\npackages:\n  - scripts\nlinks:\n  code: []\n  tests: []\n  plan: docs/design/plans/2026-04-19-foo.md\nnoldor-tier: full\n---\n',
    });
    expect(result).toMatchObject({ outcome: 'resolved', owner: { slug: 'foo' } });
  });

  it('reports none when no FD references the plan', async () => {
    const result = await resolveByLinksField({
      docPath: 'docs/design/plans/2026-04-19-orphan.md',
      field: 'plan',
      repo: '/tmp/repo',
      readdir: async () => ['foo.md'],
      readFile: async () =>
        '---\nname: Foo\nphase: in-progress\narea: tooling\ncategory: Tooling\npackages:\n  - scripts\nlinks:\n  code: []\n  tests: []\nnoldor-tier: specs-only\n---\n',
    });
    expect(result).toEqual({ outcome: 'none' });
  });

  it('ignores FDs without a links.plan field', async () => {
    const result = await resolveByLinksField({
      docPath: 'docs/design/plans/2026-04-19-foo.md',
      field: 'plan',
      repo: '/tmp/repo',
      readdir: async () => ['foo.md'],
      readFile: async () =>
        '---\nname: Foo\nphase: in-progress\narea: tooling\ncategory: Tooling\npackages:\n  - scripts\nlinks:\n  code: []\n  tests: []\nnoldor-tier: specs-only\n---\n',
    });
    expect(result).toEqual({ outcome: 'none' });
  });

  it('skips files that do not parse as FDs without throwing', async () => {
    const result = await resolveByLinksField({
      docPath: 'docs/design/plans/2026-04-19-foo.md',
      field: 'plan',
      repo: '/tmp/repo',
      readdir: async () => ['foo.md', 'malformed.md'],
      readFile: async (p: string) => {
        if (p.endsWith('malformed.md')) return 'no frontmatter here';
        return '---\nname: Foo\nphase: in-progress\narea: tooling\ncategory: Tooling\npackages:\n  - scripts\nlinks:\n  code: []\n  tests: []\n  plan:\n    - docs/design/plans/2026-04-19-foo.md\nnoldor-tier: specs-only\n---\n';
      },
    });
    expect(result).toMatchObject({ outcome: 'resolved', owner: { slug: 'foo' } });
  });
  it('reports unreadable when a candidate FD does not parse and nothing matched', async () => {
    const result = await resolveByLinksField({
      docPath: 'docs/design/plans/2026-04-19-foo.md',
      field: 'plan',
      repo: '/tmp/repo',
      readdir: async () => ['malformed.md'],
      readFile: async () => 'no frontmatter here',
    });
    expect(result).toMatchObject({ outcome: 'unreadable' });
  });

  it('scopes unreadable to FDs that could own the artifact when artifactSlug is given', async () => {
    const seams = {
      readdir: async () => ['unrelated.md'],
      readFile: async () => 'no frontmatter here',
      repo: '/tmp/repo',
    };
    // `unrelated.md` cannot own `foo-extra` by filename, so the scan answers
    // `none` (→ age-out) rather than blanking the finding.
    expect(
      await resolveByLinksField({
        ...seams,
        artifactSlug: 'foo-extra',
        docPath: 'docs/design/plans/2026-04-19-foo-extra.md',
        field: 'plan',
      }),
    ).toEqual({ outcome: 'none' });
    // A malformed `foo.md` is exactly the attach-path owner shape, so it does.
    expect(
      await resolveByLinksField({
        ...seams,
        artifactSlug: 'foo-extra',
        docPath: 'docs/design/plans/2026-04-19-foo-extra.md',
        field: 'plan',
        readdir: async () => ['foo.md'],
      }),
    ).toMatchObject({ outcome: 'unreadable' });
  });
});

describe('resolveByLinksField (links.spec)', () => {
  it('returns the FD whose links.spec matches the spec path', async () => {
    const reads = new Map<string, string>([
      [
        'docs/features/parent-feat.md',
        '---\nname: Parent Feat\nphase: in-progress\narea: tooling\ncategory: Tooling\npackages:\n  - scripts\nlinks:\n  code: []\n  tests: []\n  spec: docs/design/specs/2026-05-15-parent-feat-extra-design.md\nnoldor-tier: full\n---\n',
      ],
      [
        'docs/features/bar.md',
        '---\nname: Bar\nphase: in-progress\narea: tooling\ncategory: Tooling\npackages:\n  - scripts\nlinks:\n  code: []\n  tests: []\nnoldor-tier: specs-only\n---\n',
      ],
    ]);
    const result = await resolveByLinksField({
      docPath: 'docs/design/specs/2026-05-15-parent-feat-extra-design.md',
      field: 'spec',
      repo: '/tmp/repo',
      readdir: async () => ['parent-feat.md', 'bar.md'],
      readFile: async (p: string) => reads.get(p.replace('/tmp/repo/', '')) ?? '',
    });
    expect(result.outcome).toBe('resolved');
    expect(result).toMatchObject({ owner: { fd: { name: 'Parent Feat' }, slug: 'parent-feat' } });
  });

  it('reports none when no FD references the spec', async () => {
    const result = await resolveByLinksField({
      docPath: 'docs/design/specs/2026-05-15-orphan-design.md',
      field: 'spec',
      repo: '/tmp/repo',
      readdir: async () => ['foo.md'],
      readFile: async () =>
        '---\nname: Foo\nphase: in-progress\narea: tooling\ncategory: Tooling\npackages:\n  - scripts\nlinks:\n  code: []\n  tests: []\nnoldor-tier: specs-only\n---\n',
    });
    expect(result).toEqual({ outcome: 'none' });
  });

  it('skips files that do not parse as FDs without throwing', async () => {
    const result = await resolveByLinksField({
      docPath: 'docs/design/specs/2026-05-15-foo-extra-design.md',
      field: 'spec',
      repo: '/tmp/repo',
      readdir: async () => ['malformed.md', 'foo.md'],
      readFile: async (p: string) => {
        if (p.endsWith('malformed.md')) return 'no frontmatter here';
        return '---\nname: Foo\nphase: done\narea: tooling\ncategory: Tooling\npackages:\n  - scripts\nlinks:\n  code: []\n  tests: []\n  spec: docs/design/specs/2026-05-15-foo-extra-design.md\nnoldor-tier: full\n---\n';
      },
    });
    expect(result).toMatchObject({ outcome: 'resolved', owner: { slug: 'foo' } });
  });
  it('reports unreadable when a candidate FD does not parse and nothing matched', async () => {
    const result = await resolveByLinksField({
      docPath: 'docs/design/specs/2026-05-15-foo-extra-design.md',
      field: 'spec',
      repo: '/tmp/repo',
      readdir: async () => ['malformed.md'],
      readFile: async () => 'no frontmatter here',
    });
    expect(result).toMatchObject({ outcome: 'unreadable' });
  });
});

describe('resolveByGraphAdjacency', () => {
  const GRAPH = JSON.stringify({
    nodes: [
      {
        id: 'doc:docs/design/plans/2026-06-14-orphan.md',
        source_file: 'docs/design/plans/2026-06-14-orphan.md',
      },
      { id: 'doc:docs/features/owner.md', source_file: 'docs/features/owner.md' },
    ],
    links: [
      {
        source: 'doc:docs/design/plans/2026-06-14-orphan.md',
        target: 'doc:docs/features/owner.md',
        relation: 'plan-of',
        confidence: 'INFERRED',
      },
    ],
  });
  const FD =
    '---\nname: Owner\nphase: done\narea: tooling\ncategory: Tooling\npackages:\n  - scripts\nlinks:\n  code: []\n  tests: []\nnoldor-tier: specs-only\n---\n';

  const seamFor = (graph: string | null) => async (p: string, _e: 'utf8') => {
    if (p.endsWith('graph.json')) {
      if (graph === null) throw new Error('ENOENT');
      return graph;
    }
    if (p.endsWith('owner.md')) return FD;
    throw new Error(`unexpected read ${p}`);
  };

  it('follows the plan-of edge to the owning FD', async () => {
    const result = await resolveByGraphAdjacency({
      repo: '/tmp/repo',
      docPath: 'docs/design/plans/2026-06-14-orphan.md',
      relation: 'plan-of',
      graphPath: '/tmp/repo/graphify-out/graph.json',
      readFile: seamFor(GRAPH),
    });
    expect(result).toMatchObject({
      outcome: 'resolved',
      owner: { fd: { phase: 'done' }, slug: 'owner' },
    });
  });

  it('reports none on a missing graph file', async () => {
    const result = await resolveByGraphAdjacency({
      repo: '/tmp/repo',
      docPath: 'docs/design/plans/2026-06-14-orphan.md',
      relation: 'plan-of',
      graphPath: '/tmp/repo/graphify-out/graph.json',
      readFile: seamFor(null),
    });
    expect(result).toEqual({ outcome: 'none' });
  });

  it('reports none when no node matches the docPath', async () => {
    const result = await resolveByGraphAdjacency({
      repo: '/tmp/repo',
      docPath: 'docs/design/plans/2026-06-14-nonexistent.md',
      relation: 'plan-of',
      graphPath: '/tmp/repo/graphify-out/graph.json',
      readFile: seamFor(GRAPH),
    });
    expect(result).toEqual({ outcome: 'none' });
  });

  it('reports none when the relation does not match (spec-of asked, only plan-of present)', async () => {
    const result = await resolveByGraphAdjacency({
      repo: '/tmp/repo',
      docPath: 'docs/design/plans/2026-06-14-orphan.md',
      relation: 'spec-of',
      graphPath: '/tmp/repo/graphify-out/graph.json',
      readFile: seamFor(GRAPH),
    });
    expect(result).toEqual({ outcome: 'none' });
  });
  it('reports unreadable when the edge names an owner FD that does not parse', async () => {
    const result = await resolveByGraphAdjacency({
      repo: '/tmp/repo',
      docPath: 'docs/design/plans/2026-06-14-orphan.md',
      relation: 'plan-of',
      graphPath: '/tmp/repo/graphify-out/graph.json',
      readFile: async (p: string) => {
        if (p.endsWith('graph.json')) return GRAPH;
        return 'no frontmatter here';
      },
    });
    expect(result).toMatchObject({ outcome: 'unreadable' });
  });
  it('reports none when the edge names an FD that no longer exists', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    const result = await resolveByGraphAdjacency({
      repo: '/tmp/repo',
      docPath: 'docs/design/plans/2026-06-14-orphan.md',
      relation: 'plan-of',
      graphPath: '/tmp/repo/graphify-out/graph.json',
      readFile: async (p: string) => {
        if (p.endsWith('graph.json')) return GRAPH;
        throw enoent;
      },
    });
    // A stale edge must not suppress the age-out signal forever.
    expect(result).toEqual({ outcome: 'none' });
  });
});
