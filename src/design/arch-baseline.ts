// @fd: architecture-design-phase
// The architecture honesty check with its inputs gathered: the baseline read
// from disk and the module set from the code. Shared by `checks arch-baseline`
// and the release preflight row — which is why it lives here rather than in
// the CLI file: src/release never imports src/checks.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ARCH_BASELINE_PATH } from '../core/design-artifact-names.js';
import { errMessage } from '../core/err-message.js';
import { listModuleDirs } from '../docs/docs-architecture.js';
import { checkArchDoc, type ArchFinding } from './arch-check.js';
import { readArchPen } from './arch-pen.js';

export interface ArchBaselineReport {
  /** `absent` — no baseline, nothing checked; `ok` — no findings; `incomplete` — findings. */
  readonly status: 'absent' | 'ok' | 'incomplete';
  readonly findings: readonly ArchFinding[];
}

function unreadable(subject: string, message: string): ArchBaselineReport {
  return {
    status: 'incomplete',
    findings: [{ kind: 'unreadable', view: 'baseline', subject, message }],
  };
}

/** Hold `docs/design/architecture/baseline.pen` to the code. Every read failure is a finding, never a throw. */
export async function checkArchBaseline(cwd: string): Promise<ArchBaselineReport> {
  let text: string;
  try {
    text = await readFile(join(cwd, ARCH_BASELINE_PATH), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'absent', findings: [] };
    return unreadable(ARCH_BASELINE_PATH, errMessage(err));
  }
  const read = readArchPen(text);
  if (!read.ok) return unreadable(ARCH_BASELINE_PATH, read.error);
  const result = checkArchDoc(read.doc, await listModuleDirs(cwd));
  return { status: result.findings.length === 0 ? 'ok' : 'incomplete', ...result };
}
