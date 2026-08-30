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
import { isUiBearing, surfaceMap, type UiConfig } from '../core/ui-predicate.js';
import { GRAPH_IRRELEVANT_EXCLUDES } from './graph-freshness.js';

const execFileAsync = promisify(execFile);

export interface UiSurfaceFreshness {
  surface: string;
  status: 'fresh' | 'stale' | 'uninitialized' | 'unverified' | 'indeterminate' | 'skipped';
  uiCommit?: string;
  baselineCommit?: string;
  /**
   * Which command repairs this row. Structural rather than left for readers to
   * infer from {@link detail}, because `stale` no longer implies one answer: a
   * surface with a receipt is repaired by re-capturing, while a surface still
   * on the legacy read has no capture wired up and is repaired by hand in a
   * pencil session. Absent on rows nothing repairs (`fresh`, `skipped`) and on
   * rows nothing CAN repair (`indeterminate` — the check never ran).
   */
  remediation?: 'ui-sync' | 'capture';
  detail: string;
}

export interface UiFreshnessVerdict {
  overall: 'fresh' | 'stale' | 'uninitialized' | 'unverified' | 'indeterminate' | 'skipped';
  surfaces: UiSurfaceFreshness[];
}

export { UI_BASELINE_DIR as BASELINE_DIR } from '../core/design-artifact-names.js';

const SYNC_REMEDIATION =
  'run `pnpm noldor design ui-sync` in a pencil-capable session, then commit';
/**
 * The one capture-remediation sentence, parameterised by surface. Exported and
 * imported rather than restated: three copies had drifted, and the drift was
 * load-bearing — the version the BLOCKING verdict printed omitted `--surface`,
 * and a bare all-surfaces run reds on any surface the command leaves untouched.
 */
export function captureRemediation(surface?: string): string {
  const target = surface === undefined ? '' : ` --surface ${surface}`;
  return `declare \`consumer.uiCapture\` for the surface if it has none, run \`pnpm noldor design capture${target}\`, then commit the baseline and its receipt`;
}

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
  // `skipped`, not `indeterminate`: both probes ANSWERED, and the answer is
  // that the two commits share no ancestry (unrelated / diverged / shallow-cut).
  // The check ran and does not apply — nothing failed, so nothing is unknown.
  return 'skipped';
}

async function git(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  try {
    // Explicit buffer: node defaults to 1MB, and the unmapped-surface probe
    // asks for `--name-only` over a whole commit. An overrun here would land in
    // the `catch` as an ordinary "git failed", which is survivable only because
    // every caller degrades to `indeterminate` — but it would silently drop the
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
 * must degrade to `indeterminate`.
 */
async function latestCommit(cwd: string, paths: string[]): Promise<{ ok: boolean; sha: string }> {
  const r = await git(cwd, ['log', '-1', '--format=%H', '--', ...paths]);
  return { ok: r.ok, sha: r.stdout };
}

/**
 * Is this rejection git saying "that path is not in that commit", rather than an
 * operational failure? Both exit 128, so only the stderr text separates them,
 * and they must stay separate: a missing baseline is a real verdict
 * (`uninitialized`), while a broken repo may only ever be `indeterminate`.
 *
 * Shared by the two HEAD readers below so the discrimination cannot drift
 * between them — one reading a missing path as absent while the other reads it
 * as an error would produce two different verdicts for one repo state.
 */
function isMissingPathError(err: unknown): boolean {
  const stderr = String((err as { stderr?: string | Buffer }).stderr ?? '');
  return /does not exist|exists on disk, but not in|Not a valid object name/i.test(stderr);
}

/**
 * The blob id git stores for `path` at HEAD, or `blob: null` when the path is
 * not in that commit.
 *
 * One probe answers both questions the caller has — does the baseline exist at
 * HEAD, and what is its blob id — because `git rev-parse HEAD:<path>` fails on
 * a missing path with the same recognizable wording `cat-file -e` used. The
 * earlier pair spent two subprocesses per surface on one fact, on a path four
 * callers run.
 *
 * The id is git's own, compared later against the id git computed at capture
 * time. Both sides come from git, so `core.autocrlf`, a `text=auto` attribute,
 * a clean filter or LFS apply to both — a raw byte hash of the working tree
 * would differ from the stored blob permanently on any repo with those on,
 * minting a blocking `stale` no re-capture could clear.
 */
async function blobAtHead(
  cwd: string,
  path: string,
): Promise<{ ok: true; blob: string | null } | { ok: false }> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', `HEAD:${path}`], { cwd });
    const blob = stdout.trim();
    // A zero exit with no id is not a real answer; treat it as operational.
    return blob === '' ? { ok: false } : { ok: true, blob };
  } catch (err) {
    return isMissingPathError(err) ? { ok: true, blob: null } : { ok: false };
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
 * A path's bytes as they exist in the HEAD commit, `bytes: null` when the path
 * is not in that commit, or `ok: false` on an operational git failure. HEAD
 * rather than the working tree: committed state is the only thing a verdict may
 * depend on, so an uncommitted receipt or a locally regenerated baseline
 * changes nothing.
 *
 * Absence is returned rather than raised for the same reason {@link blobAtHead}
 * returns it — the caller needs the receipt's presence AND its content, and
 * asking `cat-file -e` first spent a second subprocess to learn what this call
 * already reports.
 */
async function showAtHead(
  cwd: string,
  path: string,
): Promise<{ ok: true; bytes: Buffer | null } | { ok: false }> {
  try {
    const { stdout } = await execFileAsync('git', ['show', `HEAD:${path}`], {
      cwd,
      encoding: 'buffer',
      // A `.pen` is a design document, not source; the cap is generous enough
      // that a real baseline never trips it and a runaway read still stops.
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, bytes: stdout as unknown as Buffer };
  } catch (err) {
    return isMissingPathError(err) ? { ok: true, bytes: null } : { ok: false };
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
      return { ok: false, detail: 'git log failed' };
    }
    baselineCommit = resolved.sha;
  }
  const forward = await isAncestor(cwd, uiCommit, baselineCommit);
  const backward = await isAncestor(cwd, baselineCommit, uiCommit);
  if (!forward.ok || !backward.ok) {
    return {
      ok: false,
      baselineCommit,
      detail: `git merge-base failed probing ${uiCommit.slice(0, 8)} / ${baselineCommit.slice(0, 8)} — never a false red`,
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
      status: 'indeterminate',
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
      detail: `baseline at/after UI (${baselineCommit.slice(0, 8)}) but no capture has vouched for it — ${captureRemediation(surface)}`,
    };
  }
  return {
    surface,
    status: 'skipped',
    uiCommit,
    baselineCommit,
    detail: `commits ${uiCommit.slice(0, 8)} / ${baselineCommit.slice(0, 8)} share no ancestry — not applicable`,
  };
}

/**
 * Reduction order for {@link UiFreshnessVerdict.overall}, which is a max over
 * the per-surface statuses. Three tiers, and the boundaries are safety-critical
 * rather than cosmetic:
 *
 * - **Red-capable** (`stale`, `uninitialized`) outranks everything else: these
 *   are the two statuses `checks ui-design-freshness` exits non-zero on, and
 *   `stale` is what blocks release preflight. Were `unverified` at or above
 *   `stale`, a repo with one of each would reduce to `unverified`, take the
 *   non-blocking preflight branch, and stop blocking the release — the exact
 *   regression the legacy fallback below exists to prevent. (Preflight renders
 *   `uninitialized` as a warn rather than a block; it is up here because of the
 *   CLI's exit code, and because an unknown must never mask a known defect.)
 * - **Unknown** (`indeterminate`) sits above every remaining status but below
 *   both red-capable ones. Above, because a surface whose check could not run
 *   says nothing about whether it is stale, and an unknown reported behind a
 *   known is a false all-clear: with `indeterminate` at `skipped`'s rank one
 *   healthy surface masked another whose verdict a failed `merge-base` or
 *   `cat-file` had made uncomputable, and preflight announced "all UI baselines
 *   fresh". Below, because a git failure may never mint a red — and because
 *   raising it over `uninitialized` would let a git failure reduce a genuine
 *   exit-1 verdict to an exit-0 one.
 * - **Known and green-ish** (`unverified`, `fresh`) and finally `skipped` — the
 *   check ran and does not apply (shallow clone, no commit touches the surface,
 *   two commits sharing no ancestry). Nothing is unknown there, so it stays at
 *   the floor where it cannot outrank a real verdict.
 *
 * `unverified` below `indeterminate` for the same unknown-over-known reason: it
 * is adoption debt with a named remedy, so the operator can act on it, while an
 * indeterminate row means the check never ran.
 *
 * The rank is a reduction order, not the whole report: `overall` names only the
 * worst row, so preflight's warn detail lists every non-fresh surface rather
 * than filtering to the winning status.
 */
const RANK: Record<UiSurfaceFreshness['status'], number> = {
  stale: 5,
  uninitialized: 4,
  indeterminate: 3,
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

  const surfaces_ = surfaceMap(config);
  const surfaces: UiSurfaceFreshness[] = [];

  for (const [surface, globs] of Object.entries(surfaces_).sort(([a], [b]) => a.localeCompare(b))) {
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
      surfaces.push({ surface, status: 'indeterminate', detail: 'git log failed' });
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
      surfaces.push({ surface, status: 'indeterminate', uiCommit, detail: 'git log failed' });
      continue;
    }
    const adopted = receiptHistory.sha !== '';

    // Existence AT HEAD decides `uninitialized`, not history and not the
    // working tree: `git log` still returns the commit that DELETED the
    // baseline (a delete postdating the UI commit would classify as fresh with
    // no baseline), and a working-tree check flips on uncommitted deletions or
    // untracked recreations — U7 reads committed state only. The same probe
    // carries the blob id the digest comparison needs further down, so
    // existence and content cost one subprocess between them, not two.
    const atHead = await blobAtHead(cwd, baselineFile);
    if (!atHead.ok) {
      surfaces.push({ surface, status: 'indeterminate', uiCommit, detail: 'git rev-parse failed' });
      continue;
    }
    if (atHead.blob === null) {
      surfaces.push(
        adopted
          ? {
              surface,
              status: 'stale',
              uiCommit,
              remediation: 'capture',
              detail: `${baselineFile} is not in HEAD but ${receiptRel} has vouched for it before (last at ${receiptHistory.sha.slice(0, 8)}) — the baseline was removed after adoption; ${captureRemediation(surface)}`,
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
    // Read the receipt's bytes once: `git show` reports absence and content in
    // the same call, so the separate `cat-file -e` existence probe this branch
    // used to run first was a second subprocess spent on an answer already in
    // hand. The BINDING check further down needs those bytes anyway.
    const receiptBlob = await showAtHead(cwd, receiptRel);
    if (!receiptBlob.ok) {
      surfaces.push({ surface, status: 'indeterminate', uiCommit, detail: 'git show failed' });
      continue;
    }

    if (receiptBlob.bytes === null) {
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
          detail: `${receiptRel} was removed after adoption (last at ${receiptHistory.sha.slice(0, 8)}) — ${captureRemediation(surface)}`,
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
    const receipt = parseReceiptBytes(receiptBlob.bytes);
    if (receipt === null) {
      // Unreadable content cannot mint a red — only an indeterminate. This
      // ordering matters: the digest comparison below needs parsed content, so
      // a malformed receipt must land here rather than fall through to `stale`.
      surfaces.push({
        surface,
        status: 'indeterminate',
        uiCommit,
        detail: `${receiptRel} is unreadable or does not match the receipt schema`,
      });
      continue;
    }
    const headDigest = atHead.blob;
    if (headDigest !== receipt.baselineBlob) {
      surfaces.push({
        surface,
        status: 'stale',
        uiCommit,
        remediation: 'capture',
        detail: `${receiptRel} vouches for baseline blob ${receipt.baselineBlob.slice(0, 12)} but ${baselineFile} at HEAD is ${headDigest.slice(0, 12)} — the receipt was committed without its baseline; ${captureRemediation(surface)}`,
      });
      continue;
    }

    const a = await ancestryVerdict(cwd, uiCommit, { sha: receiptHistory.sha });
    if (!a.ok) {
      surfaces.push({
        surface,
        status: 'indeterminate',
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
            ? `UI ${uiCommit.slice(0, 8)} newer than capture receipt ${baselineCommit.slice(0, 8)} — ${captureRemediation(surface)}`
            : `commits ${uiCommit.slice(0, 8)} / ${baselineCommit.slice(0, 8)} share no ancestry — not applicable`,
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
      // A merge commit prints NO file list by default, so `files` would be
      // empty, no unmapped path would be found, and coverage would silently go
      // unchecked while the verdict read fresh — the same false-green the
      // failure branch above exists to prevent.
      '--diff-merges=first-parent',
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
      // `indeterminate`, which is what this row has always meant: it ranks
      // above `fresh` so no healthy surface can mask it into "all UI baselines
      // fresh" with coverage never checked, and below both blocking statuses so
      // a git failure still cannot mint a red. It carried `unverified` while
      // that was the only status with those two properties — a borrowed name
      // for adoption debt this row does not have.
      surfaces.push({
        surface: '(unmapped)',
        status: 'indeterminate',
        detail: 'git log failed probing uiPaths coverage — coverage unchecked',
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
