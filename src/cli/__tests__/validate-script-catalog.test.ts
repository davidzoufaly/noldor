// @tests: validate-script-catalog-gate
import { describe, expect, it } from 'vitest';

import { flattenManifest, MANIFEST } from '../manifest.js';
import {
  diffCatalogCommands,
  diffCatalogSrcs,
  manifestCommandSet,
  manifestSrcSet,
  parseCatalogCommands,
  parseCatalogSrcs,
} from '../validate-script-catalog.js';

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

describe('manifestCommandSet', () => {
  it('keeps alias commands that share an entrypoint distinct', () => {
    // `autonomous run` and `autonomous queue-drain` collapse in the src set…
    const withSrc = [...manifestSrcSet()].filter((s) => s === 'src/autonomous/queue-drain.ts');
    expect(withSrc).toHaveLength(1);
    // …but both survive here, which is what makes the alias visible to the gate.
    const commands = manifestCommandSet();
    expect(commands.has('autonomous run')).toBe(true);
    expect(commands.has('autonomous queue-drain')).toBe(true);
  });

  it("renders a `''`-subcommand group as the bare group name", () => {
    expect(manifestCommandSet().has('doctor')).toBe(true);
  });
});

describe('parseCatalogCommands', () => {
  it('extracts a `<group> <sub>` command from a Trigger bullet', () => {
    const md = '- **Trigger:** `pnpm noldor validate features`. Runs in `pre-commit`.\n';
    expect(parseCatalogCommands(md).has('validate features')).toBe(true);
  });

  it('extracts a command from a table Command cell', () => {
    const md = '| `pnpm noldor worktrees create` | [`src/w.ts`](../../src/w.ts) | Create. |\n';
    expect(parseCatalogCommands(md).has('worktrees create')).toBe(true);
  });

  it('records the bare group form alongside the two-token form', () => {
    const md = '`pnpm noldor validate features`\n';
    const commands = parseCatalogCommands(md);
    expect(commands.has('validate')).toBe(true);
    expect(commands.has('validate features')).toBe(true);
  });

  it('extracts a bare leaf group with no subcommand', () => {
    const md = '- **Trigger:** `pnpm noldor doctor`.\n';
    expect(parseCatalogCommands(md).has('doctor')).toBe(true);
  });

  it('does not read a flag or a placeholder as a subcommand', () => {
    const md = '`pnpm noldor next-priority --suggestions` `pnpm noldor autonomous unpark <slug>`\n';
    const commands = parseCatalogCommands(md);
    expect(commands.has('next-priority')).toBe(true);
    expect(commands.has('next-priority --suggestions')).toBe(false);
    expect(commands.has('autonomous unpark')).toBe(true);
    expect(commands.has('autonomous unpark <slug>')).toBe(false);
  });

  it('ignores the generic `<group> <subcommand>` placeholder in prose', () => {
    const md = 'surfaced through the `noldor` CLI (`pnpm noldor <group> <subcommand>`)\n';
    expect(parseCatalogCommands(md)).toEqual(new Set());
  });

  it('returns an empty set for a body citing no commands', () => {
    expect(parseCatalogCommands('# Script Catalog\n')).toEqual(new Set());
  });
});

describe('diffCatalogCommands', () => {
  it('returns empty when every manifest command is named', () => {
    const manifest = new Set(['validate features', 'doctor']);
    const catalog = new Set(['validate features', 'doctor']);
    expect(diffCatalogCommands(manifest, catalog)).toEqual([]);
  });

  it('flags an alias whose shared entrypoint is documented but whose name is not', () => {
    // The regression this gate exists for: `autonomous queue-drain` shares
    // queue-drain.ts with `autonomous run`, so the src join is satisfied.
    const manifest = new Set(['autonomous run', 'autonomous queue-drain']);
    const catalog = new Set(['autonomous run']);
    expect(diffCatalogCommands(manifest, catalog)).toEqual(['autonomous queue-drain']);
  });

  it('reports no extras for catalog-only command forms', () => {
    const manifest = new Set(['doctor']);
    const catalog = new Set(['doctor', 'release publish', 'not-a-command']);
    expect(diffCatalogCommands(manifest, catalog)).toEqual([]);
  });

  it('sorts the missing list for stable output', () => {
    const manifest = new Set(['z sub', 'a sub', 'm sub']);
    expect(diffCatalogCommands(manifest, new Set())).toEqual(['a sub', 'm sub', 'z sub']);
  });
});

describe('the live catalog', () => {
  it('names every manifest leaf command', async () => {
    const { readFile } = await import('node:fs/promises');
    const md = await readFile('docs/noldor/script-catalog.md', 'utf8');
    expect(diffCatalogCommands(manifestCommandSet(), parseCatalogCommands(md))).toEqual([]);
  });
});
