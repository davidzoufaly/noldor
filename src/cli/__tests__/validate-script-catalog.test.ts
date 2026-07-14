// @tests: validate-script-catalog-gate
import { describe, expect, it } from 'vitest';

import { flattenManifest, MANIFEST } from '../manifest.js';
import { diffCatalogSrcs, manifestSrcSet, parseCatalogSrcs } from '../validate-script-catalog.js';

describe('flattenManifest', () => {
  it('emits one entry per leaf command', () => {
    const expected = Object.values(MANIFEST).reduce((n, g) => n + Object.keys(g.subs).length, 0);
    expect(flattenManifest()).toHaveLength(expected);
  });

  it("renders a `''`-subcommand group as the bare group name", () => {
    const init = flattenManifest().find((l) => l.command === 'init');
    expect(init).toBeDefined();
    expect(init!.src).toBe('src/cli/commands/init.ts');
  });

  it('renders a `<group> <sub>` command for non-empty subcommands', () => {
    const commands = flattenManifest().map((l) => l.command);
    expect(commands).toContain('validate script-catalog');
    expect(commands).toContain('worktrees create');
  });

  it('normalizes src to a repo-relative `src/…` path', () => {
    for (const leaf of flattenManifest()) {
      expect(leaf.src.startsWith('src/')).toBe(true);
    }
  });
});

describe('manifestSrcSet', () => {
  it('collapses alias commands that share an entrypoint', () => {
    // `autonomous run` and `autonomous queue-drain` both point at queue-drain.ts.
    const runLeaves = flattenManifest().filter((l) => l.src === 'src/autonomous/queue-drain.ts');
    expect(runLeaves.length).toBeGreaterThan(1);
    // …yet the set holds the shared src exactly once.
    const withSrc = [...manifestSrcSet()].filter((s) => s === 'src/autonomous/queue-drain.ts');
    expect(withSrc).toHaveLength(1);
  });
});

describe('parseCatalogSrcs', () => {
  it('extracts src links with a `../../` prefix', () => {
    const md = '### `foo`\n\n- Source: [`src/core/foo.ts`](../../src/core/foo.ts)\n';
    expect(parseCatalogSrcs(md)).toEqual(new Set(['src/core/foo.ts']));
  });

  it('extracts src links from table Source cells', () => {
    const md =
      '| `pnpm noldor foo` | [`src/foo.ts`](../../src/foo.ts) | Do foo. |\n' +
      '| `pnpm noldor bar` | [`src/bar.ts`](../../src/bar.ts) | Do bar. |\n';
    expect(parseCatalogSrcs(md)).toEqual(new Set(['src/foo.ts', 'src/bar.ts']));
  });

  it('tolerates a bare `src/…` target and a trailing #anchor', () => {
    const md = '[a](src/a.ts) [b](../../src/b.ts#L10)\n';
    expect(parseCatalogSrcs(md)).toEqual(new Set(['src/a.ts', 'src/b.ts']));
  });

  it('ignores non-src links', () => {
    const md = '[doc](../pr-flow.md) [ext](https://example.com/x.ts)\n';
    expect(parseCatalogSrcs(md)).toEqual(new Set());
  });

  it('returns empty set for an empty body', () => {
    expect(parseCatalogSrcs('# Script Catalog\n')).toEqual(new Set());
  });
});

describe('diffCatalogSrcs', () => {
  it('returns empty missing when every manifest src is documented', () => {
    const manifest = new Set(['src/a.ts', 'src/b.ts']);
    const catalog = new Set(['src/a.ts', 'src/b.ts']);
    expect(diffCatalogSrcs(manifest, catalog).missingFromCatalog).toEqual([]);
  });

  it('flags a manifest src absent from the catalog', () => {
    const manifest = new Set(['src/a.ts', 'src/b.ts']);
    const catalog = new Set(['src/a.ts']);
    expect(diffCatalogSrcs(manifest, catalog).missingFromCatalog).toEqual(['src/b.ts']);
  });

  it('does NOT flag an alias whose shared src is documented', () => {
    // Two alias commands share src/x.ts; the doc cites it once → not missing.
    const manifest = new Set(['src/x.ts']); // src set already collapsed the aliases
    const catalog = new Set(['src/x.ts']);
    expect(diffCatalogSrcs(manifest, catalog).missingFromCatalog).toEqual([]);
  });

  it('reports catalog-only srcs as advisory extras, not missing', () => {
    const manifest = new Set(['src/a.ts']);
    const catalog = new Set(['src/a.ts', 'src/helper.ts']);
    const diff = diffCatalogSrcs(manifest, catalog);
    expect(diff.missingFromCatalog).toEqual([]);
    expect(diff.extraInCatalog).toEqual(['src/helper.ts']);
  });

  it('sorts both lists for stable output', () => {
    const manifest = new Set(['src/z.ts', 'src/a.ts', 'src/m.ts']);
    const catalog = new Set<string>();
    expect(diffCatalogSrcs(manifest, catalog).missingFromCatalog).toEqual([
      'src/a.ts',
      'src/m.ts',
      'src/z.ts',
    ]);
  });
});
