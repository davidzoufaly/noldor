// @tests: pendev-ui-design-phase
// Per-surface UI-design baseline freshness (spec U7). Same posture as
// graph-freshness.ts — reported, never thrown — but ancestry-based
// (merge-base), never committer timestamps, and evaluated per configured
// surface so one surface's sync cannot mask another's drift.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { braceExpand } from 'minimatch';

import { UI_BASELINE_DIR as BASELINE_DIR } from '../core/design-artifact-names.js';
import { parseReceiptBytes, receiptRelPath } from '../design/ui-capture.js';
import { IMPLICIT_SURFACE, isUiBearing, type UiConfig } from '../core/ui-predicate.js';
import { GRAPH_IRRELEVANT_EXCLUDES } from './graph-freshness.js';

const execFileAsync = promisify(execFile);

export interface UiSurfaceFreshness {
  surface: string;
  status: 'fresh' | 'stale' | 'uninitialized' | 'unverified' | 'skipped';
  uiCommit?: string;
  baselineCommit?: string;
  /**
   * Which command repairs this row. Structural rather than left for readers to
   * infer from {@link detail}, because `stale` no longer implies one answer: a
   * surface with a receipt is repaired by re-capturing, while a surface still
   * on the legacy read has no capture wired up and is repaired by hand in a
   * pencil session. Absent on rows nothing repairs (`fresh`, `skipped`).
   */
  remediation?: 'ui-sync' | 'capture';
  detail: string;
}

export interface UiFreshnessVerdict {
  overall: 'fresh' | 'stale' | 'uninitialized' | 'unverified' | 'skipped';
  surfaces: UiSurfaceFreshness[];
}

export { UI_BASELINE_DIR as BASELINE_DIR } from '../core/design-artifact-names.js';

const SYNC_REMEDIATION =
  'run `pnpm noldor design ui-sync` in a pencil-capable session, then commit';
const CAPTURE_REMEDIATION =
  'declare `consumer.uiCapture` for the surface if it has none, run `pnpm noldor design capture`, then commit the baseline and its receipt';

/**
 * Pure ancestry classifier — the U7 decision procedure, testable without a
 * repo. No `equal` parameter: `git merge-base --is-ancestor A A` exits 0, so
 * the U == B case already arrives as `uiIsAncestorOfBaseline: true`.
 */
export function classifyAncestry(
  uiIsAncestorOfBaseline: boolean,
  baselineIsAncestorOfUi: boolean,
): 'fresh' | 'stale' | 'skipped' {
  if (uiIsAncestorOfBaseline) return 'fresh';
  if (baselineIsAncestorOfUi) return 'stale';
  return 'skipped'; // unrelated / diverged / shallow-cut — never a false red
}

async function git(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  try {
    // Explicit buffer: node defaults to 1MB, and the unmapped-surface probe
    // asks for `--name-only` over a whole commit. An overrun here would land in
    // the `catch` as an ordinary "git failed", which is survivable only because
    // every caller degrades to `skipped` — but it would silently drop the
    // enforcement it was asked to perform.
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return { ok: true, stdout: stdout.trim() };
  } catch {
    return { ok: false, stdout: '' };
  }
}

/**
 * Latest commit touching `paths`. `ok: false` is an operational git failure —
 * distinct from `sha: ''` (history has no matching commit) — because conflating
 * them would mint `uninitialized`/red from a broken repo, and every git failure
 * must degrade to `skipped`.
 */
async function latestCommit(cwd: string, paths: string[]): Promise<{ ok: boolean; sha: string }> {
  const r = await git(cwd, ['log', '-1', '--format=%H', '--', ...paths]);
  return { ok: r.ok, sha: r.stdout };
}

/**
 * Does `path` exist in the HEAD commit? `git cat-file -e HEAD:<path>` exits 0
 * when present; a missing path exits non-zero WITH a recognizable "does not
 * exist" / "Not a valid object name" message, while other non-zero exits are
 * operational failures — kept distinct so the caller degrades to `skipped`
 * instead of minting a blocking `uninitialized` from a broken repo (exit code
 * 128 alone is ambiguous between the two, so the stderr text decides).
 */
async function existsAtHead(
  cwd: string,
  path: string,
): Promise<{ ok: true; exists: boolean } | { ok: false }> {
  try {
    await execFileAsync('git', ['cat-file', '-e', `HEAD:${path}`], { cwd });
    return { ok: true, exists: true };
  } catch (err) {
    const stderr = String((err as { stderr?: string }).stderr ?? '');
    if (/does not exist|exists on disk, but not in|Not a valid object name/i.test(stderr)) {
      return { ok: true, exists: false };
    }
    return { ok: false };
  }
}

/**
 * `git merge-base --is-ancestor` exits 0 = yes, 1 = no, anything else = an
 * operational failure (missing object, broken repo). The three outcomes must
 * stay distinct: collapsing an error into "no" can combine with the reverse
 * probe into a false blocking `stale` — the one verdict U7 forbids minting
 * from a git failure.
 */
async function isAncestor(
  cwd: string,
  a: string,
  b: string,
): Promise<{ ok: true; isAncestor: boolean } | { ok: false }> {
  try {
    await execFileAsync('git', ['merge-base', '--is-ancestor', a, b], { cwd });
    return { ok: true, isAncestor: true };
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 1) return { ok: true, isAncestor: false };
    return { ok: false };
  }
}

/**
 * A path's bytes as they exist in the HEAD commit, or `ok: false` on any git
 * failure. HEAD rather than the working tree, matching {@link existsAtHead}:
 * committed state is the only thing a verdict may depend on, so an uncommitted
 * receipt or a locally regenerated baseline changes nothing.
 */
async function showAtHead(
  cwd: string,
  path: string,
): Promise<{ ok: true; bytes: Buffer } | { ok: false }> {
  try {
    const { stdout } = await execFileAsync('git', ['show', `HEAD:${path}`], {
      cwd,
      encoding: 'buffer',
      // A `.pen` is a design document, not source; the cap is generous enough
      // that a real baseline never trips it and a runaway read still stops.
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, bytes: stdout as unknown as Buffer };
  } catch {
    return { ok: false };
  }
}

/**
 * Resolve `proofPath`'s latest commit and classify it against `uiCommit`.
 *
 * The receipt path and the legacy fallback ask git exactly the same three
 * questions — what commit last touched the proof, and is it an ancestor of the
 * UI commit either way — and differ only in which file is the proof and how
 * they word the result. Keeping one implementation is what stops the two
 * drifting into different degradation behaviour, which is the half that must
 * never diverge: an indeterminate answer may not become a blocking verdict.
 */
async function ancestryVerdict(
  cwd: string,
  uiCommit: string,
  proof: { path: string } | { sha: string },
): Promise<
  | { ok: false; detail: string; baselineCommit?: string }
  | { ok: true; baselineCommit: string; status: 'fresh' | 'stale' | 'skipped' }
> {
  // A caller that already resolved the sha passes it: the adopted path probes
  // receipt history before it gets here, and re-asking would spend a second
  // identical `git log -1` per surface for one answer.
  let baselineCommit: string;
  if ('sha' in proof) {
    baselineCommit = proof.sha;
  } else {
    const resolved = await latestCommit(cwd, [proof.path]);
    if (!resolved.ok || resolved.sha === '') {
      return { ok: false, detail: 'git log failed — indeterminate' };
    }
    baselineCommit = resolved.sha;
  }
  const forward = await isAncestor(cwd, uiCommit, baselineCommit);
  const backward = await isAncestor(cwd, baselineCommit, uiCommit);
  if (!forward.ok || !backward.ok) {
    return {
      ok: false,
      baselineCommit,
      detail: `git merge-base failed probing ${uiCommit.slice(0, 8)} / ${baselineCommit.slice(0, 8)} — indeterminate, never a false red`,
    };
  }
  return {
    ok: true,
    baselineCommit,
    status: classifyAncestry(forward.isAncestor, backward.isAncestor),
  };
}

/**
 * The pre-adoption read, for a surface that has never had a receipt: derive the
 * verdict from the baseline file's own commit exactly as this check always did,
 * then report a legacy `stale` AS `stale` and a legacy `fresh` as `unverified`.
 *
 * The asymmetry is the point. Reporting every receipt-less surface `unverified`
 * would turn an existing BLOCKING `stale` — a consumer whose baseline is
 * genuinely behind its UI — into a non-blocking status the moment they upgrade
 * the framework. Adoption may add no new block; it may not silently remove one
 * either.
 */
async function legacyFallback(
  cwd: string,
  surface: string,
  baselineFile: string,
  uiCommit: string,
): Promise<UiSurfaceFreshness> {
  const a = await ancestryVerdict(cwd, uiCommit, { path: baselineFile });
  if (!a.ok) {
    return {
      surface,
      status: 'skipped',
      uiCommit,
      ...(a.baselineCommit === undefined ? {} : { baselineCommit: a.baselineCommit }),
      detail: a.detail,
    };
  }
  const { baselineCommit } = a;
  if (a.status === 'stale') {
    return {
      surface,
      status: 'stale',
      uiCommit,
      baselineCommit,
      remediation: 'ui-sync',
      detail: `UI ${uiCommit.slice(0, 8)} newer than baseline ${baselineCommit.slice(0, 8)} — ${SYNC_REMEDIATION}`,
    };
  }
  if (a.status === 'fresh') {
    return {
      surface,
      status: 'unverified',
      uiCommit,
      baselineCommit,
      remediation: 'capture',
      detail: `baseline at/after UI (${baselineCommit.slice(0, 8)}) but no capture has vouched for it — ${CAPTURE_REMEDIATION}`,
    };
  }
  return {
    surface,
    status: 'skipped',
    uiCommit,
    baselineCommit,
    detail: `commits ${uiCommit.slice(0, 8)} / ${baselineCommit.slice(0, 8)} share no ancestry — indeterminate`,
  };
}

/**
 * Reduction order for {@link UiFreshnessVerdict.overall}, which is a max over
 * the per-surface statuses. The placement of `unverified` is safety-critical,
 * not cosmetic: at or above `stale`, a repo with one `stale` surface and one
 * `unverified` surface would reduce to an overall `unverified`, take the
 * non-blocking preflight branch, and stop blocking the release — the exact
 * regression the legacy fallback below exists to prevent.
 */
const RANK: Record<UiSurfaceFreshness['status'], number> = {
  stale: 4,
  uninitialized: 3,
  unverified: 2,
  fresh: 1,
  skipped: 0,
};

/**
 * Evaluate baseline freshness for every configured surface. `config` is the
 * consumer's `uiPaths`/`uiSurfaces` slice; absent/empty `uiPaths` skips the
 * whole check (feature not adopted). Every git failure degrades to a
 * per-surface `skipped` with detail — reported, never thrown.
 */
export async function evaluateUiDesignFreshness(
  cwd: string,
  config: UiConfig,
): Promise<UiFreshnessVerdict> {
  const uiPaths = config.uiPaths ?? [];
  if (uiPaths.length === 0) {
    return { overall: 'skipped', surfaces: [] };
  }

  const shallow = await git(cwd, ['rev-parse', '--is-shallow-repository']);
  if (shallow.ok && shallow.stdout === 'true') {
    return {
      overall: 'skipped',
      surfaces: [
        { surface: '*', status: 'skipped', detail: 'shallow clone — ancestry unavailable' },
      ],
    };
  }

  const surfaceMap: Record<string, string[]> = config.uiSurfaces ?? { [IMPLICIT_SURFACE]: uiPaths };
  const surfaces: UiSurfaceFreshness[] = [];

  for (const [surface, globs] of Object.entries(surfaceMap).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const baselineFile = `${BASELINE_DIR}/${surface}.pen`;
    // `:(glob)` magic: surface globs are minimatch patterns (predicate side);
    // plain git pathspecs use wildmatch where `*` crosses `/` and `**`
    // degrades. The glob magic makes git honor the same double-star semantics,
    // keeping "one pattern language everywhere" true (the excludes already
    // rely on it — see GRAPH_IRRELEVANT_EXCLUDES). Braces are the one
    // minimatch construct wildmatch lacks, so expand them here first —
    // otherwise `src/{a,b}/**` silently matches no history and the surface
    // bypasses enforcement as `skipped`.
    const ui = await latestCommit(cwd, [
      ...globs.flatMap((g) => braceExpand(g)).map((g) => `:(glob)${g}`),
      ...GRAPH_IRRELEVANT_EXCLUDES,
    ]);
    if (!ui.ok) {
      surfaces.push({ surface, status: 'skipped', detail: 'git log failed — indeterminate' });
      continue;
    }
    const uiCommit = ui.sha;
    if (uiCommit === '') {
      surfaces.push({ surface, status: 'skipped', detail: 'no commits touch this surface' });
      continue;
    }
    // Has this surface EVER had a receipt? Probed before anything else,
    // because both "file is missing at HEAD" branches below have to know:
    // withdrawing either file must not soften a verdict. Deleting the baseline
    // would otherwise turn an adopted, blocking `stale` into a non-blocking
    // `uninitialized` — the same escape hatch the receipt branch closes, on the
    // other file.
    const receiptRel = receiptRelPath(surface);
    const receiptHistory = await latestCommit(cwd, [receiptRel]);
    if (!receiptHistory.ok) {
      surfaces.push({
        surface,
        status: 'skipped',
        uiCommit,
        detail: 'git log failed — indeterminate',
      });
      continue;
    }
    const adopted = receiptHistory.sha !== '';

    // Existence AT HEAD decides `uninitialized`, not history and not the
    // working tree: `git log` still returns the commit that DELETED the
    // baseline (a delete postdating the UI commit would classify as fresh with
    // no baseline), and a working-tree check flips on uncommitted deletions or
    // untracked recreations — U7 reads committed state only.
    const atHead = await existsAtHead(cwd, baselineFile);
    if (!atHead.ok) {
      surfaces.push({ surface, status: 'skipped', detail: 'git cat-file failed — indeterminate' });
      continue;
    }
    if (!atHead.exists) {
      surfaces.push(
        adopted
          ? {
              surface,
              status: 'stale',
              uiCommit,
              remediation: 'capture',
              detail: `${baselineFile} is not in HEAD but ${receiptRel} has vouched for it before (last at ${receiptHistory.sha.slice(0, 8)}) — the baseline was removed after adoption; ${CAPTURE_REMEDIATION}`,
            }
          : {
              surface,
              status: 'uninitialized',
              uiCommit,
              remediation: 'ui-sync',
              detail: `${baselineFile} is not in HEAD — bootstrap and commit: ${SYNC_REMEDIATION}`,
            },
      );
      continue;
    }
    // --- the ordering proof: the RECEIPT file's commit, not the .pen's ---
    //
    // The .pen cannot be its own proof. A capture writes temp-then-rename, so a
    // FAILED run leaves the baseline — and therefore its commit — untouched,
    // and the last good capture keeps satisfying ancestry forever. The receipt
    // is written only on exit 0, so its commit history contains successful
    // captures and nothing else. Reading the FILE's commit rather than a sha
    // stored inside it is what survives squash-merge: a branch sha is
    // unreachable in a fresh clone of main, and the probe below would then
    // degrade to `skipped` permanently.
    const receiptAtHead = await existsAtHead(cwd, receiptRel);
    if (!receiptAtHead.ok) {
      surfaces.push({
        surface,
        status: 'skipped',
        uiCommit,
        detail: 'git cat-file failed — indeterminate',
      });
      continue;
    }

    if (!receiptAtHead.exists) {
      if (adopted) {
        // Absent at HEAD but with history: the proof was WITHDRAWN after
        // adoption. Routing this back through the legacy read would be an
        // escape hatch — an adopted surface sitting at a blocking `stale`
        // could be un-blocked by deleting its receipt, because the legacy read
        // of a recently captured .pen may well be `fresh`.
        surfaces.push({
          surface,
          status: 'stale',
          uiCommit,
          remediation: 'capture',
          detail: `${receiptRel} was removed after adoption (last at ${receiptHistory.sha.slice(0, 8)}) — ${CAPTURE_REMEDIATION}`,
        });
        continue;
      }
      surfaces.push(await legacyFallback(cwd, surface, baselineFile, uiCommit));
      continue;
    }

    // --- the binding proof: does the receipt describe the .pen at HEAD? ---
    //
    // The commit proves ordering but says nothing about content: an operator
    // can commit the freshly written receipt and leave the regenerated .pen out
    // of the commit, which would otherwise read `fresh` over a baseline HEAD
    // never received.
    const receiptBlob = await showAtHead(cwd, receiptRel);
    if (!receiptBlob.ok) {
      surfaces.push({
        surface,
        status: 'skipped',
        uiCommit,
        detail: 'git show failed — indeterminate',
      });
      continue;
    }
    const receipt = parseReceiptBytes(receiptBlob.bytes);
    if (receipt === null) {
      // Unreadable content cannot mint a red — only an indeterminate. This
      // ordering matters: the digest comparison below needs parsed content, so
      // a malformed receipt must land here rather than fall through to `stale`.
      surfaces.push({
        surface,
        status: 'skipped',
        uiCommit,
        detail: `${receiptRel} is unreadable or does not match the receipt schema — indeterminate`,
      });
      continue;
    }
    // Git's stored blob id, compared against the id git computed at capture
    // time. Both sides come from git, so `core.autocrlf`, a `text=auto`
    // attribute, a clean filter or LFS apply to both — a raw byte hash of the
    // working tree would differ from the stored blob permanently on any repo
    // with those on, minting a blocking `stale` no re-capture could clear.
    const headBlob = await git(cwd, ['rev-parse', `HEAD:${baselineFile}`]);
    if (!headBlob.ok || headBlob.stdout === '') {
      surfaces.push({
        surface,
        status: 'skipped',
        uiCommit,
        detail: 'git rev-parse failed — indeterminate',
      });
      continue;
    }
    const headDigest = headBlob.stdout;
    if (headDigest !== receipt.baselineBlob) {
      surfaces.push({
        surface,
        status: 'stale',
        uiCommit,
        remediation: 'capture',
        detail: `${receiptRel} vouches for baseline blob ${receipt.baselineBlob.slice(0, 12)} but ${baselineFile} at HEAD is ${headDigest.slice(0, 12)} — the receipt was committed without its baseline; ${CAPTURE_REMEDIATION}`,
      });
      continue;
    }

    const a = await ancestryVerdict(cwd, uiCommit, { sha: receiptHistory.sha });
    if (!a.ok) {
      surfaces.push({
        surface,
        status: 'skipped',
        uiCommit,
        ...(a.baselineCommit === undefined ? {} : { baselineCommit: a.baselineCommit }),
        detail: a.detail,
      });
      continue;
    }
    const { baselineCommit, status } = a;
    surfaces.push({
      surface,
      status,
      uiCommit,
      baselineCommit,
      ...(status === 'stale' ? { remediation: 'capture' as const } : {}),
      detail:
        status === 'fresh'
          ? `capture receipt at/after UI (${baselineCommit.slice(0, 8)}, captured ${receipt.capturedAt})`
          : status === 'stale'
            ? `UI ${uiCommit.slice(0, 8)} newer than capture receipt ${baselineCommit.slice(0, 8)} — ${CAPTURE_REMEDIATION}`
            : `commits ${uiCommit.slice(0, 8)} / ${baselineCommit.slice(0, 8)} share no ancestry — indeterminate`,
    });
  }

  // Declared-surface maps can under-cover uiPaths (the schema cannot prove glob
  // coverage), so UI commits outside every surface would otherwise be checked
  // by nobody. Probe the union commit and match its CHANGED PATHS in-process
  // with minimatch — the same engine the predicate uses — never ancestry, which
  // an unrelated later baseline commit would falsely satisfy: any changed path
  // that matches uiPaths but no declared surface is an unmapped UI change.
  if (config.uiSurfaces !== undefined) {
    const all = await git(cwd, [
      'log',
      '-1',
      '--format=%H',
      '--name-only',
      '--',
      ...uiPaths.flatMap((g) => braceExpand(g)).map((g) => `:(glob)${g}`),
      ...GRAPH_IRRELEVANT_EXCLUDES,
    ]);
    if (!all.ok) {
      // The one git failure in this function that used to produce NO row: with
      // every declared surface fresh, `overall` reduced to `fresh` and the
      // probe announced "all UI baselines fresh" while the config-coverage gap
      // went unchecked. Every other branch degrades to an explicit indeterminate
      // row; this one must too.
      // `unverified`, not `skipped`: skipped ranks BELOW fresh, so any fresh
      // surface would mask this row and the probe would still announce "all UI
      // baselines fresh" with coverage never checked — the row would exist and
      // change nothing. `unverified` ranks above fresh, so the verdict says so,
      // and it is non-blocking, so a git failure still cannot mint a red.
      surfaces.push({
        surface: '(unmapped)',
        status: 'unverified',
        detail: 'git log failed probing uiPaths coverage — indeterminate, coverage unchecked',
      });
    } else if (all.stdout !== '') {
      const lines = all.stdout.split('\n');
      const sha = lines[0].trim();
      const files = lines.slice(1).filter((l) => l.trim().length > 0);
      const surfaceGlobs = Object.values(config.uiSurfaces).flat();
      const unmapped = files.filter(
        (f) => isUiBearing([f], uiPaths) && !isUiBearing([f], surfaceGlobs),
      );
      if (unmapped.length > 0) {
        surfaces.push({
          surface: '(unmapped)',
          status: 'stale',
          uiCommit: sha,
          detail: `UI commit ${sha.slice(0, 8)} touches uiPaths outside every declared surface (${unmapped[0]}${unmapped.length > 1 ? ` +${unmapped.length - 1}` : ''}) — extend uiSurfaces, then ${SYNC_REMEDIATION}`,
        });
      }
    }
  }

  const overall = surfaces.reduce<UiFreshnessVerdict['overall']>(
    (worst, s) => (RANK[s.status] > RANK[worst] ? s.status : worst),
    'skipped',
  );
  return { overall: surfaces.length === 0 ? 'skipped' : overall, surfaces };
}
