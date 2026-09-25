// @fd: architecture-design-phase
// Module-to-module import pairs — the code truth the architecture baseline's
// arrows are held to (spec: "Code truth"). Built on the indirection ratchet's
// cruise (`cruiseFileGraph`), so both read one file graph: tests excluded,
// tsconfig aliases resolved, a partial cruise refused. graphify's graph.json
// is not used: it can be stale.

import { pairKey } from '../design/arch-pen.js';
import { cruiseFileGraph, type CruiseModule } from './detect.js';

export type ModulePairsResult =
  | { readonly kind: 'pairs'; readonly pairs: ReadonlySet<string> }
  | { readonly kind: 'unmeasurable'; readonly message: string };

/** The module a repo-relative file sits in — the longest module path prefixing it — or `null`. */
export function moduleOf(file: string, modules: readonly string[]): string | null {
  let best: string | null = null;
  for (const mod of modules) {
    if (file.startsWith(`${mod}/`) && (best === null || mod.length > best.length)) best = mod;
  }
  return best;
}

/** Every `from -> to` pair where a file in `from` imports a file in `to`; imports inside one module are not pairs. */
export function pairsFromFiles(
  files: readonly CruiseModule[],
  modules: readonly string[],
): Set<string> {
  const pairs = new Set<string>();
  for (const file of files) {
    const from = moduleOf(file.source, modules);
    if (from === null) continue;
    for (const dep of file.dependencies) {
      const to = moduleOf(dep.resolved, modules);
      if (to !== null && to !== from) pairs.add(pairKey(from, to));
    }
  }
  return pairs;
}

/**
 * The import pairs between `modules`, read off one cruise of `roots`. An empty
 * corpus has no pairs; a graph the cruise cannot build — or one holding an
 * in-repo import it could not resolve — is `unmeasurable`, never a set missing
 * pairs, which would read correctly drawn arrows as phantom.
 */
export async function moduleImportPairs(
  cwd: string,
  roots: readonly string[],
  modules: readonly string[],
): Promise<ModulePairsResult> {
  const graph = await cruiseFileGraph({ cwd, roots });
  if (graph.kind === 'empty') return { kind: 'pairs', pairs: new Set() };
  if (graph.kind !== 'graph') return { kind: 'unmeasurable', message: graph.message };
  if (graph.unresolvedInScope.length > 0) {
    const shown = graph.unresolvedInScope.slice(0, 5).join(', ');
    return {
      kind: 'unmeasurable',
      message: `${graph.unresolvedInScope.length} in-repo import(s) could not be resolved, so module pairs are unknown: ${shown}`,
    };
  }
  return { kind: 'pairs', pairs: pairsFromFiles(graph.files, modules) };
}
