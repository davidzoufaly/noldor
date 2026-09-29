// @fd: architecture-design-phase
// The architecture honesty check with its inputs gathered: the baseline read
// from disk, the module set from the code (`listModuleDirs`), the import pairs
// and file edges from one dependency-cruiser pass (`moduleImportPairs`), and
// which of the baseline's part paths exist. Shared by `checks arch-baseline`
// and the release preflight row — which is why it lives here rather than in
// the CLI file: src/release never imports src/checks.

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { ARCH_BASELINE_PATH } from '../core/design-artifact-names.js';
import { errMessage } from '../core/err-message.js';
import { scanRoots } from '../core/repo-paths.js';
import { listModuleDirs } from '../docs/docs-architecture.js';
import { moduleImportPairs } from '../indirection/module-pairs.js';
import { checkArchDoc, type ArchAdvisory, type ArchFinding } from './arch-check.js';
import { readArchPen, type ArchDoc } from './arch-pen.js';

export interface ArchBaselineReport {
  /** `absent` — no baseline, nothing checked; `ok` — no findings; `incomplete` — findings. */
  readonly status: 'absent' | 'ok' | 'incomplete';
  readonly findings: readonly ArchFinding[];
  readonly advisories: readonly ArchAdvisory[];
}

function unreadable(subject: string, message: string): ArchBaselineReport {
  return {
    status: 'incomplete',
    findings: [{ kind: 'unreadable', subject, message }],
    advisories: [],
  };
}

/**
 * Hold `docs/design/architecture/baseline.pen` to the code. Every read failure
 * is a finding, never a throw. An import graph the cruise cannot build is an
 * `unreadable` finding: skipping the arrows would mint a green never earned.
 */
export async function checkArchBaseline(cwd: string): Promise<ArchBaselineReport> {
  let text: string;
  try {
    text = await readFile(join(cwd, ARCH_BASELINE_PATH), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      return { status: 'absent', findings: [], advisories: [] };
    return unreadable(ARCH_BASELINE_PATH, errMessage(err));
  }
  const read = readArchPen(text);
  if (!read.ok) return unreadable(ARCH_BASELINE_PATH, read.error);

  let roots: string[];
  try {
    roots = scanRoots(cwd);
  } catch (err) {
    return unreadable('.noldor/config.json', `scan roots unreadable: ${errMessage(err)}`);
  }
  const modules = await listModuleDirs(cwd);
  const pairs = await moduleImportPairs(cwd, roots, modules);
  if (pairs.kind === 'unmeasurable') return unreadable('import graph', pairs.message);

  const result = checkArchDoc(read.doc, {
    modules,
    pairs: pairs.pairs,
    edges: pairs.edges,
    parts: await existingParts(cwd, read.doc, modules),
  });
  return { status: result.findings.length === 0 ? 'ok' : 'incomplete', ...result };
}

/** The part paths the baseline names that exist on disk. A part is a path under a module, never a module itself. */
async function existingParts(
  cwd: string,
  doc: ArchDoc,
  modules: readonly string[],
): Promise<Set<string>> {
  const known = new Set(modules);
  const candidates = new Set(
    doc.pages
      .flatMap((page) => page.boxes.flatMap((box) => box.refs))
      .filter((ref) => !known.has(ref) && modules.some((mod) => ref.startsWith(`${mod}/`))),
  );
  const found = new Set<string>();
  for (const path of candidates) {
    try {
      await stat(join(cwd, path));
      found.add(path);
    } catch {
      // Absent — the check reports it as `unknown-part`.
    }
  }
  return found;
}
