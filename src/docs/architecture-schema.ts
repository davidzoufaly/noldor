// @fd: consumer-architecture-doc-surface
/**
 * One page of the architecture surface.
 *
 * `allowedKinds` are mermaid graph keywords, compared lowercased — the page
 * passes when ANY of its fences declares one of them, so a page may carry extra
 * diagrams of other kinds beside its required one.
 */
export interface ArchitecturePage {
  readonly id: string;
  readonly title: string;
  /** One-line statement of what the page answers. Rendered in templates. */
  readonly purpose: string;
  readonly allowedKinds: readonly string[];
  /**
   * H2 headings the page must carry, stored **bare** — `'Actors'`, never
   * `'## Actors'`. One representation: the templates render the `## ` and the
   * advisory messages quote the bare name, so the prefix is never stripped at
   * two sites that then drift.
   *
   * An empty array is the `flows` sentinel: "at least one H2, names
   * unconstrained" rather than "nothing to check". That page's natural shape is
   * one section per flow, so no fixed set exists that does not lie about it —
   * and expressing the exemption as a registry value rather than a page id in
   * the checker is what keeps this list the full description of a page.
   *
   * Order is what the templates render, not what the check enforces: presence
   * is checked, order is not.
   */
  readonly sections: readonly string[];
}

/**
 * The closed set of architecture pages — the framework's opinion about which
 * four questions an architecture surface must answer, deliberately not a
 * consumer config knob (`docs/vision.md`: "opinionated, not configurable").
 *
 * Four IDs a product repo and a CLI can both fill honestly: a repo with no
 * backend still has a `containers` answer (its runnable units), and a repo with
 * no UI still has a `context` answer (who calls it). That is what lets Noldor
 * dogfood the same surface it ships.
 *
 * Every validating surface — the page validator, the garden detector, the SDD
 * gap, the release probe — reads this list, so a fifth page needs no change in
 * any of them. It does need its own template file, a `SCAFFOLD_ONLY_TEMPLATES`
 * entry and a page in this repo: the registry propagates the checking, not the
 * content.
 */
export const ARCHITECTURE_PAGES = [
  {
    id: 'context',
    title: 'Context',
    purpose: 'The system, its actors, and the externals it talks to.',
    allowedKinds: ['flowchart', 'graph', 'c4context'],
    sections: ['Actors', 'Externals', 'Boundary'],
  },
  {
    id: 'containers',
    title: 'Containers',
    purpose:
      'Deployable and runnable units — frontend app, backend service, database, worker, CLI, infrastructure.',
    allowedKinds: ['flowchart', 'graph', 'c4container'],
    sections: ['Runnable units', 'Durable state', 'Topology'],
  },
  {
    id: 'modules',
    title: 'Modules',
    purpose: 'Internal dependency direction, and which module owns which durable state.',
    allowedKinds: ['flowchart', 'graph', 'classdiagram'],
    sections: ['Dependency direction', 'State ownership'],
  },
  {
    id: 'flows',
    title: 'Flows',
    purpose: 'The two or three load-bearing runtime flows, end to end.',
    allowedKinds: ['sequencediagram'],
    sections: [],
  },
] as const satisfies readonly ArchitecturePage[];

/**
 * Page id union, derived so a typo in a caller is a type error.
 *
 * This only holds because `ARCHITECTURE_PAGES` is declared
 * `as const satisfies readonly ArchitecturePage[]`. The previous
 * `: readonly ArchitecturePage[]` annotation widened every `id` to `string`, so
 * this alias was `string` and a bogus page id typechecked clean.
 */
export type ArchitecturePageId = (typeof ARCHITECTURE_PAGES)[number]['id'];

/** Filename a page occupies inside the architecture folder. */
export function pageFilename(page: ArchitecturePage): string {
  return `${page.id}.md`;
}

/**
 * The marker a scaffolded-but-unwritten page carries. Its presence is what
 * makes an untouched scaffold recognisable, so `noldor init` cannot put a fresh
 * consumer into a blocking state — see `checkArchitecture`'s opt-in rule.
 */
export const PLACEHOLDER_MARKER = '<!-- TODO:';
