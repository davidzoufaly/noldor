import { describe, it, expect } from 'vitest';
import { resolveByLinksPlan } from '../plan-resolution';

describe('resolveByLinksPlan', () => {
  it('returns the FD whose links.plan contains the plan path', async () => {
    const reads = new Map<string, string>([
      [
        'docs/features/foo.md',
        '---\nname: Foo\nphase: done\narea: tooling\ncategory: Tooling\npackages:\n  - scripts\nlinks:\n  code: []\n  tests: []\n  plan:\n    - docs/superpowers/plans/2026-04-19-foo.md\nnoldor-tier: full\n---\n',
      ],
      [
        'docs/features/bar.md',
        '---\nname: Bar\nphase: in-progress\narea: tooling\ncategory: Tooling\npackages:\n  - scripts\nlinks:\n  code: []\n  tests: []\nnoldor-tier: specs-only\n---\n',
      ],
    ]);
    const result = await resolveByLinksPlan({
      planPath: 'docs/superpowers/plans/2026-04-19-foo.md',
      repo: '/tmp/repo',
      readdir: async () => ['foo.md', 'bar.md'],
      readFile: async (p: string) => reads.get(p.replace('/tmp/repo/', '')) ?? '',
    });
    expect(result).not.toBeNull();
    expect(result?.fd.name).toBe('Foo');
    expect(result?.slug).toBe('foo');
  });

  it('handles plan as a single string (not array)', async () => {
    const result = await resolveByLinksPlan({
      planPath: 'docs/superpowers/plans/2026-04-19-foo.md',
      repo: '/tmp/repo',
      readdir: async () => ['foo.md'],
      readFile: async () =>
        '---\nname: Foo\nphase: done\narea: tooling\ncategory: Tooling\npackages:\n  - scripts\nlinks:\n  code: []\n  tests: []\n  plan: docs/superpowers/plans/2026-04-19-foo.md\nnoldor-tier: full\n---\n',
    });
    expect(result).not.toBeNull();
    expect(result?.slug).toBe('foo');
  });

  it('returns null when no FD references the plan', async () => {
    const result = await resolveByLinksPlan({
      planPath: 'docs/superpowers/plans/2026-04-19-orphan.md',
      repo: '/tmp/repo',
      readdir: async () => ['foo.md'],
      readFile: async () =>
        '---\nname: Foo\nphase: in-progress\narea: tooling\ncategory: Tooling\npackages:\n  - scripts\nlinks:\n  code: []\n  tests: []\nnoldor-tier: specs-only\n---\n',
    });
    expect(result).toBeNull();
  });

  it('ignores FDs without a links.plan field', async () => {
    const result = await resolveByLinksPlan({
      planPath: 'docs/superpowers/plans/2026-04-19-foo.md',
      repo: '/tmp/repo',
      readdir: async () => ['foo.md'],
      readFile: async () =>
        '---\nname: Foo\nphase: in-progress\narea: tooling\ncategory: Tooling\npackages:\n  - scripts\nlinks:\n  code: []\n  tests: []\nnoldor-tier: specs-only\n---\n',
    });
    expect(result).toBeNull();
  });

  it('skips files that do not parse as FDs without throwing', async () => {
    const result = await resolveByLinksPlan({
      planPath: 'docs/superpowers/plans/2026-04-19-foo.md',
      repo: '/tmp/repo',
      readdir: async () => ['foo.md', 'malformed.md'],
      readFile: async (p: string) => {
        if (p.endsWith('malformed.md')) return 'no frontmatter here';
        return '---\nname: Foo\nphase: in-progress\narea: tooling\ncategory: Tooling\npackages:\n  - scripts\nlinks:\n  code: []\n  tests: []\n  plan:\n    - docs/superpowers/plans/2026-04-19-foo.md\nnoldor-tier: specs-only\n---\n';
      },
    });
    expect(result).not.toBeNull();
    expect(result?.slug).toBe('foo');
  });
});
