// @tests: pendev-ui-design-phase
// `noldor design verdict` — write the design-approval record for a session's
// `.pen`, in exactly one of two modes: `--approve` (the operator ratified the
// FINAL set) or `--waive` (the verdict could not be taken; Q-0186's
// waiver-after-Seed). Called by /noldor-spec step 1.5 AFTER the approval
// sentence (or waiver note) lands in the spec, because the record is the
// authoritative half and writing it last makes the survivable failure the loud
// one: a sentence with no record is refused at the next commit, a record with
// no sentence would be a silent claim of ratification.

import { realpathSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';

import { blobIdOfWorktreeFile } from '../core/blob-id.js';
import { runIfDirect } from '../core/cli-entry.js';
import {
  penSlugFromFilename,
  UI_BASELINE_DIR,
  UI_DESIGN_DIR,
} from '../core/design-artifact-names.js';
import { errMessage } from '../core/err-message.js';
import {
  designApprovalRecordSchema,
  writeApproval,
  type DesignApprovalRecord,
} from './design-approval.js';

const USAGE =
  'usage: design verdict --pen <path> --approve --surface <s> [--surface <s>...] [--reservation <text>]\n' +
  '       design verdict --pen <path> --waive --reason <text>';

/** Parsed argv, or the reason it was refused — argv is a trust boundary. */
export type VerdictArgs =
  | {
      ok: true;
      pen: string;
      mode:
        | { outcome: 'approved'; surfaces: string[]; reservation?: string }
        | { outcome: 'waived'; reason: string };
    }
  | { ok: false; error: string };

/** Read `--flag value` pairs plus bare `--approve`/`--waive`, refusing leftovers. */
export function parseVerdictArgs(argv: readonly string[]): VerdictArgs {
  let pen: string | undefined;
  let approve = false;
  let waive = false;
  const surfaces: string[] = [];
  let reservation: string | undefined;
  let reason: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = (flag: string): string | { error: string } => {
      const v = argv[++i];
      // Empty and flag-shaped values are refused, not consumed: `--surface ""`
      // would write a record the guard immediately rejects, and `--surface
      // --waive` would swallow the mode flag as its value.
      if (v === undefined || v === '') return { error: `${flag} requires a value` };
      if (v.startsWith('--')) return { error: `${flag} requires a value, got flag '${v}'` };
      return v;
    };
    switch (arg) {
      case '--pen': {
        const v = value('--pen');
        if (typeof v !== 'string') return { ok: false, error: v.error };
        pen = v;
        break;
      }
      case '--approve':
        approve = true;
        break;
      case '--waive':
        waive = true;
        break;
      case '--surface': {
        const v = value('--surface');
        if (typeof v !== 'string') return { ok: false, error: v.error };
        surfaces.push(v);
        break;
      }
      case '--reservation': {
        const v = value('--reservation');
        if (typeof v !== 'string') return { ok: false, error: v.error };
        reservation = v;
        break;
      }
      case '--reason': {
        const v = value('--reason');
        if (typeof v !== 'string') return { ok: false, error: v.error };
        reason = v;
        break;
      }
      default:
        return { ok: false, error: `unknown argument '${arg}'` };
    }
  }

  if (pen === undefined) return { ok: false, error: '--pen is required' };
  if (approve === waive) {
    return { ok: false, error: 'exactly one of --approve / --waive is required' };
  }
  if (approve) {
    if (reason !== undefined) return { ok: false, error: '--reason belongs to --waive' };
    if (surfaces.length === 0) {
      return { ok: false, error: '--approve requires at least one --surface' };
    }
    const deduped = [...new Set(surfaces)];
    return {
      ok: true,
      pen,
      mode: {
        outcome: 'approved',
        surfaces: deduped,
        ...(reservation === undefined ? {} : { reservation }),
      },
    };
  }
  if (surfaces.length > 0) return { ok: false, error: '--surface belongs to --approve' };
  if (reservation !== undefined) return { ok: false, error: '--reservation belongs to --approve' };
  if (reason === undefined) return { ok: false, error: '--waive requires --reason' };
  return { ok: true, pen, mode: { outcome: 'waived', reason } };
}

/**
 * Containment for `--pen`: the path must realpath-resolve inside
 * `<repo>/docs/design/ui/` and outside `baseline/` — symlinks, traversal and
 * absolute paths all resolve BEFORE the test. `archive/` is deliberately
 * inside: gate Step 4 archives the `.pen` in the flip commit before the
 * code-stage lane runs, so a re-verdict on an archived design is a legitimate
 * call, not an error.
 */
export function resolveFeaturePen(
  repoRoot: string,
  penArg: string,
): { ok: true; abs: string; base: string } | { ok: false; error: string } {
  const candidate = resolve(repoRoot, penArg);
  let abs: string;
  try {
    abs = realpathSync(candidate);
  } catch (err) {
    return { ok: false, error: `--pen ${penArg}: ${errMessage(err)}` };
  }
  let designRoot: string;
  try {
    // The root is realpath'd too, or a symlinked repo path (macOS /tmp) would
    // fail the prefix test for every legitimate file under it.
    designRoot = realpathSync(join(repoRoot, UI_DESIGN_DIR));
  } catch (err) {
    return { ok: false, error: `design root unavailable: ${errMessage(err)}` };
  }
  const rel = relative(designRoot, abs);
  if (rel.startsWith('..') || rel === '') {
    return { ok: false, error: `--pen must resolve inside ${UI_DESIGN_DIR}/` };
  }
  // Baseline exclusion by resolved prefix. The baseline dir may simply not
  // exist yet (a repo before its first capture), which excludes nothing.
  const baselineRoot = (() => {
    try {
      return realpathSync(join(repoRoot, UI_BASELINE_DIR));
    } catch {
      return null;
    }
  })();
  if (baselineRoot !== null && abs.startsWith(baselineRoot + sep)) {
    return { ok: false, error: '--pen must not name a baseline .pen' };
  }
  if (!abs.endsWith('.pen')) return { ok: false, error: '--pen must name a .pen file' };
  return { ok: true, abs, base: basename(abs) };
}

/** Everything `main` needs, injected so tests drive real behaviour. */
export interface VerdictDeps {
  cwd: string;
  now: () => string;
}

export async function main(argv: readonly string[], deps?: Partial<VerdictDeps>): Promise<number> {
  const rawCwd = deps?.cwd ?? process.cwd();
  const now = deps?.now ?? (() => new Date().toISOString());
  // Realpath the root once: `resolveFeaturePen` realpaths the candidate, so a
  // symlinked root (macOS `/var` → `/private/var`) would otherwise make every
  // `relative(cwd, abs)` climb out of the repo and git refuse the pathspec.
  let cwd: string;
  try {
    cwd = realpathSync(rawCwd);
  } catch (err) {
    console.error(`design verdict: cwd unavailable: ${errMessage(err)}`);
    return 2;
  }

  const args = parseVerdictArgs(argv);
  if (!args.ok) {
    console.error(`design verdict: ${args.error}\n${USAGE}`);
    return 2;
  }

  const pen = resolveFeaturePen(cwd, args.pen);
  if (!pen.ok) {
    console.error(`design verdict: ${pen.error}`);
    return 2;
  }
  // `resolveFeaturePen`'s realpath already proved existence; the remaining
  // trust-boundary check is the naming scheme, which keys the record.
  if (penSlugFromFilename(pen.base) === null) {
    console.error(
      `design verdict: '${pen.base}' does not match the <date>-<key>.pen naming scheme — ` +
        'a record cannot name a file the scheme cannot identify',
    );
    return 2;
  }

  const rel = relative(cwd, pen.abs).split('\\').join('/');
  const blob = blobIdOfWorktreeFile(cwd, rel);
  if (blob === null) {
    console.error(`design verdict: git could not hash ${rel}`);
    return 2;
  }

  // Validated through the SAME schema every reader applies — not asserted:
  // exiting 0 on a record the guard would reject as unusable is the silent
  // failure this CLI exists to prevent.
  const candidate: unknown =
    args.mode.outcome === 'approved'
      ? {
          outcome: 'approved',
          at: now(),
          penBlob: blob,
          surfaces: args.mode.surfaces,
          ...(args.mode.reservation === undefined ? {} : { reservation: args.mode.reservation }),
        }
      : { outcome: 'waived', at: now(), penBlob: blob, reason: args.mode.reason };
  const parsed = designApprovalRecordSchema.safeParse(candidate);
  if (!parsed.success) {
    console.error(`design verdict: record would be unusable: ${parsed.error.message}`);
    return 2;
  }
  const record: DesignApprovalRecord = parsed.data;

  const written = writeApproval(cwd, pen.base, record);
  if (!written.ok) {
    console.error(`design verdict: ${written.message}`);
    return 1;
  }
  console.log(
    `${args.mode.outcome}: ${relative(cwd, written.path).split('\\').join('/')} → ${rel} @ ${blob.slice(0, 12)}`,
  );
  console.log('stage the record with the .pen and the spec — it rides the same commit');
  return 0;
}

runIfDirect('design-approval-cli', 'design verdict', async () => main(process.argv.slice(2)));
