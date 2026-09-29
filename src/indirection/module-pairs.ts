// @fd: architecture-design-phase
// Module-to-module import pairs and the file edges under them — the code truth
// the architecture baseline's arrows are held to (spec: "Honesty check"). Built
// on the indirection ratchet's cruise (`cruiseFileGraph`), so both read one
// file graph: tests excluded, tsconfig aliases resolved, a partial cruise
// refused. graphify's graph.json is not used: it can be stale.

import { pairKey, type FileEdge } from '../design/arch-pen.js';
import { cruiseFileGraph, workspacePackages, type CruiseModule } from './detect.js';

export type ModulePairsResult =
  | {
      readonly kind: 'pairs';
      readonly pairs: ReadonlySet<string>;
      /** Every import between two files, the ones inside one module included. */
      readonly edges: readonly FileEdge[];
    }
  | { readonly kind: 'unmeasurable'; readonly message: string };

/** The module a repo-relative path is or sits in — the longest module path prefixing it — or `null`. */
export function moduleOf(file: string, modules: readonly string[]): string | null {
  let best: string | null = null;
  for (const mod of modules) {
    if ((file === mod || file.startsWith(`${mod}/`)) && (best === null || mod.length > best.length))
      best = mod;
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

/** A resolved import target inside the repo: a path, never a Node builtin (`fs`) or a `node_modules` file. */
function inRepo(resolved: string): boolean {
  return resolved.includes('/') && !resolved.split('/').includes('node_modules');
}

/** Every import between two different files of the repo — the graph a part arrow is held to. */
export function edgesFromFiles(files: readonly CruiseModule[]): FileEdge[] {
  const edges: FileEdge[] = [];
  for (const file of files)
    for (const dep of file.dependencies)
      if (dep.resolved !== file.source && inRepo(dep.resolved))
        edges.push({ from: file.source, to: dep.resolved });
  return edges;
}

/**
 * Point an import of a workspace package by name (`@scope/lib`, `@scope/lib/sub`)
 * at that package's directory when it did not land on one of the measured
 * files: it resolved into build output (`exports` pointing at `dist/`), or did
 * not resolve at all because the package is unbuilt. Either way the import is
 * real, and without this the check would call its arrow phantom — and whether
 * it did would hang on whether the checkout ran a build.
 */
export function withWorkspaceTargets(
  files: readonly CruiseModule[],
  packages: ReadonlyMap<string, string>,
): CruiseModule[] {
  const measured = new Set(files.map((f) => f.source));
  const dirOf = (spec: string | undefined): string | undefined => {
    if (spec === undefined) return undefined;
    for (const [name, dir] of packages)
      if (spec === name || spec.startsWith(`${name}/`)) return dir;
    return undefined;
  };
  return files.map((file) => ({
    source: file.source,
    dependencies: file.dependencies.map((dep) => {
      const dir = measured.has(dep.resolved) ? undefined : dirOf(dep.module);
      return dir === undefined ? dep : { ...dep, resolved: dir, couldNotResolve: false };
    }),
  }));
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
  if (graph.kind === 'empty') return { kind: 'pairs', pairs: new Set(), edges: [] };
  if (graph.kind !== 'graph') return { kind: 'unmeasurable', message: graph.message };
  if (graph.unresolvedInScope.length > 0) {
    const shown = graph.unresolvedInScope.slice(0, 5).join(', ');
    return {
      kind: 'unmeasurable',
      message: `${graph.unresolvedInScope.length} in-repo import(s) could not be resolved, so module pairs are unknown: ${shown}`,
    };
  }
  const files = withWorkspaceTargets(graph.files, workspacePackages(graph.base, graph.roots));
  return { kind: 'pairs', pairs: pairsFromFiles(files, modules), edges: edgesFromFiles(files) };
}
