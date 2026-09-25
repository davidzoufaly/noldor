// @tests: pendev-ui-design-phase
// `noldor design verdict` — the design-approval record for a session's `.pen`.
// `--approve` (the operator ratified the FINAL set) and `--waive` (the verdict
// could not be taken; Q-0186's waiver-after-Seed) write it; `--check` asks
// whether the spec has moved since the approval, and `--reconfirm` rebinds an
// unchanged design to a changed spec on the operator's word. Called by
// /noldor-spec AFTER the approval sentence (or waiver note) lands in the spec,
// because the record is the authoritative half and writing it last makes the
// survivable failure the loud one: a sentence with no record is refused at the
// next commit, a record with no sentence would be a silent claim of ratification.
// A UI design must hold exactly the pages its spec's `### Design coverage` table
// declares: `--approve` and `--reconfirm` refuse one that does not, and
// `--coverage` asks the same question read-only, before the pages are shown.

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import { blobIdOfBytes, blobIdOfWorktreeFile } from '../core/blob-id.js';
import { runIfDirect } from '../core/cli-entry.js';
import {
  ARCH_BASELINE_PATH,
  ARCH_DESIGN_DIR,
  ARCHIVE_DIR,
  designKindOfPath,
  milestonePenPath,
  milestoneSlugFromPenPath,
  penSlugFromFilename,
  specSlugFromFilename,
  UI_BASELINE_DIR,
  UI_DESIGN_DIR,
  type DesignKind,
} from '../core/design-artifact-names.js';
import { loadDocRoots } from '../core/doc-roots.js';
import { errMessage } from '../core/err-message.js';
import { readRepoText } from '../core/read-text.js';
import {
  designApprovalRecordSchema,
  readApproval,
  writeApproval,
  type DesignApprovalRecord,
} from './design-approval.js';
import { ARCH_VIEWS } from './arch-pen.js';
import {
  checkFeatureCoverage,
  type CoverageFinding,
  type CoverageFindingCode,
} from './feature-coverage.js';
import { parsePenDocument, topLevelPages } from './pen-doc.js';

const USAGE =
  'usage: design verdict --pen <path> --approve --surface <s> [--surface <s>...] (--spec <path> | --milestone <slug>)\n' +
  '                      --editor-page <name> [--editor-page <name>...] [--reservation <text>]\n' +
  '                      (a docs/design/architecture/ .pen takes views as surfaces: context | containers | modules | flows)\n' +
  '       design verdict --pen <path> --coverage --spec <path> --editor-page <name> [--editor-page <name>...]\n' +
  '       design verdict --pen <path> --waive --reason <text>\n' +
  '       design verdict --pen <path> --check\n' +
  '       design verdict --pen <path> --reconfirm';

const STAGE_HINT = 'stage the record with the .pen and the spec — it rides the same commit';

/** What an approval binds: a feature design's spec, or a milestone target's milestone file. */
type ApprovalBinding = { kind: 'spec'; spec: string } | { kind: 'milestone'; slug: string };

type ApproveMode = {
  verb: 'approve';
  surfaces: string[];
  reservation?: string;
  /** Every top-level page name the editor shows, duplicates kept. */
  editorPages: string[];
  against: ApprovalBinding;
};

type CoverageMode = { verb: 'coverage'; spec: string; editorPages: string[] };

type VerdictMode =
  | ApproveMode
  | CoverageMode
  | { verb: 'waive'; reason: string }
  | { verb: 'check' }
  | { verb: 'reconfirm' };

/** Parsed argv, or the reason it was refused — argv is a trust boundary. */
export type VerdictArgs =
  | { ok: true; pen: string; mode: VerdictMode }
  | { ok: false; error: string };

type ApprovedRecord = Extract<DesignApprovalRecord, { outcome: 'approved' }>;

const VERB_FLAGS = ['--approve', '--waive', '--check', '--reconfirm', '--coverage'] as const;
type VerbFlag = (typeof VERB_FLAGS)[number];

const isVerbFlag = (arg: string): arg is VerbFlag =>
  (VERB_FLAGS as readonly string[]).includes(arg);

/** Read `--flag value` pairs plus the bare verb flags, refusing leftovers. */
export function parseVerdictArgs(argv: readonly string[]): VerdictArgs {
  let pen: string | undefined;
  const verbs = new Set<VerbFlag>();
  const surfaces: string[] = [];
  const editorPages: string[] = [];
  let reservation: string | undefined;
  let reason: string | undefined;
  let spec: string | undefined;
  let milestone: string | undefined;

  const valueFlags = new Map<string, (v: string) => void>([
    ['--pen', (v) => (pen = v)],
    ['--surface', (v) => surfaces.push(v)],
    ['--editor-page', (v) => editorPages.push(v)],
    ['--spec', (v) => (spec = v)],
    ['--milestone', (v) => (milestone = v)],
    ['--reservation', (v) => (reservation = v)],
    ['--reason', (v) => (reason = v)],
  ]);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (isVerbFlag(arg)) {
      verbs.add(arg);
      continue;
    }
    const take = valueFlags.get(arg);
    if (take === undefined) return { ok: false, error: `unknown argument '${arg}'` };
    // Empty and flag-shaped values are refused, not consumed: `--surface ""`
    // would write a record the guard immediately rejects, and `--surface
    // --waive` would swallow the mode flag as its value.
    const v = argv[++i];
    if (v === undefined || v === '') return { ok: false, error: `${arg} requires a value` };
    if (v.startsWith('--')) return { ok: false, error: `${arg} requires a value, got flag '${v}'` };
    take(v);
  }

  if (pen === undefined) return { ok: false, error: '--pen is required' };
  const [verb, ...extra] = verbs;
  if (verb === undefined || extra.length > 0) {
    return {
      ok: false,
      error: 'exactly one of --approve / --waive / --check / --reconfirm / --coverage is required',
    };
  }

  if (verb === '--approve') {
    if (reason !== undefined) return { ok: false, error: '--reason belongs to --waive' };
    if (surfaces.length === 0) {
      return { ok: false, error: '--approve requires at least one --surface' };
    }
    if (editorPages.length === 0) {
      return {
        ok: false,
        error:
          '--approve requires at least one --editor-page — every top-level page the editor shows',
      };
    }
    if (spec !== undefined && milestone !== undefined) {
      return { ok: false, error: '--spec and --milestone exclude each other' };
    }
    if (spec === undefined && milestone === undefined) {
      return {
        ok: false,
        error: '--approve requires --spec (or --milestone <slug> for a milestone target)',
      };
    }
    const against: ApprovalBinding =
      spec !== undefined
        ? { kind: 'spec', spec }
        : { kind: 'milestone', slug: milestone as string };
    return {
      ok: true,
      pen,
      mode: {
        verb: 'approve',
        surfaces: [...new Set(surfaces)],
        editorPages,
        against,
        ...(reservation === undefined ? {} : { reservation }),
      },
    };
  }

  if (verb === '--coverage') {
    const foreign: Array<[string, boolean]> = [
      ['--surface', surfaces.length > 0],
      ['--reservation', reservation !== undefined],
      ['--milestone', milestone !== undefined],
      ['--reason', reason !== undefined],
    ];
    const stray = foreign.find(([, given]) => given);
    if (stray !== undefined)
      return { ok: false, error: `${stray[0]} does not apply to --coverage` };
    if (spec === undefined) return { ok: false, error: '--coverage requires --spec' };
    if (editorPages.length === 0) {
      return {
        ok: false,
        error:
          '--coverage requires at least one --editor-page — every top-level page the editor shows',
      };
    }
    return { ok: true, pen, mode: { verb: 'coverage', spec, editorPages } };
  }

  const approveOnly: Array<[string, boolean, string]> = [
    ['--surface', surfaces.length > 0, '--approve'],
    ['--reservation', reservation !== undefined, '--approve'],
    ['--editor-page', editorPages.length > 0, '--approve or --coverage'],
    ['--spec', spec !== undefined, '--approve or --coverage'],
    ['--milestone', milestone !== undefined, '--approve'],
  ];
  const stray = approveOnly.find(([, given]) => given);
  if (stray !== undefined) return { ok: false, error: `${stray[0]} belongs to ${stray[2]}` };

  if (verb === '--waive') {
    if (reason === undefined) return { ok: false, error: '--waive requires --reason' };
    return { ok: true, pen, mode: { verb: 'waive', reason } };
  }
  if (reason !== undefined) return { ok: false, error: '--reason belongs to --waive' };
  return { ok: true, pen, mode: { verb: verb === '--check' ? 'check' : 'reconfirm' } };
}

type Refusal = { ok: false; error: string };

/**
 * `arg` resolved to a real file, beside the realpath of the `root` it must sit
 * under — both sides of a containment test resolve the same way, or a
 * symlinked repo path (macOS /tmp) would fail the test for every legitimate
 * file. A symlinked `arg` is refused outright rather than resolved through:
 * git stages the LINK's path and blob while realpath would hand this CLI the
 * target's name and bytes — a record written for an identity no reader can
 * ever match. Seed and `design archive` only ever produce real files, so a
 * link here is a mistake, not a flow.
 */
function resolveUnder(
  repoRoot: string,
  flag: string,
  arg: string,
  root: string,
): { ok: true; abs: string; root: string } | Refusal {
  const candidate = resolve(repoRoot, arg);
  let abs: string;
  try {
    if (lstatSync(candidate).isSymbolicLink()) {
      return { ok: false, error: `${flag} ${arg}: must not be a symlink` };
    }
    abs = realpathSync(candidate);
  } catch (err) {
    return { ok: false, error: `${flag} ${arg}: ${errMessage(err)}` };
  }
  try {
    return { ok: true, abs, root: realpathSync(root) };
  } catch (err) {
    return { ok: false, error: `${relative(repoRoot, root)} unavailable: ${errMessage(err)}` };
  }
}

/**
 * Containment for `--pen`: the path must realpath-resolve inside one design
 * kind's directory — `docs/design/ui/` or `docs/design/architecture/`, the kind
 * read off the lexical path — and must not be that kind's baseline. Symlinks,
 * traversal and absolute paths all resolve BEFORE the test. `archive/` is
 * deliberately inside: gate Step 4 archives the `.pen` in the flip commit
 * before the code-stage lane runs, so a re-verdict on an archived design is a
 * legitimate call, not an error.
 */
export function resolveFeaturePen(
  repoRoot: string,
  penArg: string,
): { ok: true; abs: string; base: string; kind: DesignKind; milestone: string | null } | Refusal {
  const lexical = relative(repoRoot, resolve(repoRoot, penArg)).split(sep).join('/');
  const kind = designKindOfPath(lexical) ?? 'ui';
  const designDir = kind === 'architecture' ? ARCH_DESIGN_DIR : UI_DESIGN_DIR;
  const found = resolveUnder(repoRoot, '--pen', penArg, join(repoRoot, designDir));
  if (!found.ok) return found;
  const { abs, root: designRoot } = found;
  const rel = relative(designRoot, abs);
  if (rel.startsWith('..') || rel === '') {
    return {
      ok: false,
      error: `--pen must resolve inside ${UI_DESIGN_DIR}/ or ${ARCH_DESIGN_DIR}/`,
    };
  }
  // Baseline exclusion, resolved. Either baseline may not exist yet (a repo
  // before its first capture or bootstrap), which excludes nothing.
  const resolvedOrNull = (path: string): string | null => {
    try {
      return realpathSync(join(repoRoot, path));
    } catch {
      return null;
    }
  };
  if (kind === 'ui') {
    const baselineRoot = resolvedOrNull(UI_BASELINE_DIR);
    if (baselineRoot !== null && abs.startsWith(baselineRoot + sep)) {
      return { ok: false, error: '--pen must not name a baseline .pen' };
    }
  } else if (abs === resolvedOrNull(ARCH_BASELINE_PATH)) {
    return { ok: false, error: '--pen must not name a baseline .pen' };
  }
  if (!abs.endsWith('.pen')) return { ok: false, error: '--pen must name a .pen file' };
  // `lexical` (the top of this function) equals the real path here: a symlinked --pen is refused above.
  const milestone = kind === 'architecture' ? milestoneSlugFromPenPath(lexical) : null;
  return { ok: true, abs, base: basename(abs), kind, milestone };
}

/**
 * Containment for `--spec`: a real file directly in the specs root or directly
 * in its `archive/` — the two places every later reader looks for the name the
 * record stores — named by the spec scheme, for the same dialogue key as the
 * design. The archive is allowed for the reason `--pen` allows it.
 */
function resolveFeatureSpec(
  repoRoot: string,
  specArg: string,
  penKey: string,
): { ok: true; rel: string; name: string } | Refusal {
  const found = resolveUnder(repoRoot, '--spec', specArg, loadDocRoots(repoRoot).specs);
  if (!found.ok) return found;
  const dir = dirname(found.abs);
  if (dir !== found.root && dir !== join(found.root, ARCHIVE_DIR)) {
    const shown = relative(repoRoot, found.root).split(sep).join('/');
    return {
      ok: false,
      error: `--spec must sit directly in ${shown}/ or ${shown}/${ARCHIVE_DIR}/ — the only places a later check looks`,
    };
  }
  const name = basename(found.abs);
  const key = specSlugFromFilename(name);
  if (key === null) {
    return {
      ok: false,
      error: `'${name}' does not match the <date>-<key>-design.md naming scheme`,
    };
  }
  if (key !== penKey) {
    return { ok: false, error: `--spec ${name} is for '${key}', the design is for '${penKey}'` };
  }
  return { ok: true, rel: relative(repoRoot, found.abs).split(sep).join('/'), name };
}

/**
 * The page names a `.pen` holds, in file order. The file is plain JSON (see
 * docs/noldor/gotchas.md). A name argv cannot carry as an `--editor-page` value
 * is refused here, or the comparison below would report an unsaved editor for
 * a page the agent had no way to name.
 */
function readPenPages(bytes: Buffer): { ok: true; pages: string[] } | { ok: false; error: string } {
  const parsed = parsePenDocument(bytes);
  if (!parsed.ok) {
    return {
      ok: false,
      error:
        parsed.reason === 'not-json' ? parsed.error : 'no top-level children array of named pages',
    };
  }
  const named = topLevelPages(parsed.doc).map((page) => page.name);
  if (named.some((name) => name === undefined)) {
    return { ok: false, error: 'no top-level children array of named pages' };
  }
  const pages = named as string[];
  const unpassable = pages.find((name) => name.trim() === '' || name.startsWith('--'));
  if (unpassable !== undefined) {
    return {
      ok: false,
      error: `page name '${unpassable}' cannot be passed as --editor-page — rename it in the editor`,
    };
  }
  return { ok: true, pages };
}

/** Multiset difference both ways: a page drawn twice must be reported twice. */
function pageSetDiff(
  editor: readonly string[],
  disk: readonly string[],
): { editorOnly: string[]; diskOnly: string[] } {
  const unmatched = [...disk];
  const editorOnly: string[] = [];
  for (const name of editor) {
    const at = unmatched.indexOf(name);
    if (at === -1) editorOnly.push(name);
    else unmatched.splice(at, 1);
  }
  return { editorOnly, diskOnly: unmatched };
}

/** `--surface` against the file's `FINAL:<surface>: <state>` pages, both directions. */
function surfaceCoverageError(
  surfaces: readonly string[],
  pages: readonly string[],
): string | null {
  const owned = new Set<string>();
  for (const page of pages) {
    if (!page.startsWith('FINAL:')) continue;
    const rest = page.slice('FINAL:'.length);
    const colon = rest.indexOf(':');
    const surface = colon === -1 ? '' : rest.slice(0, colon).trim();
    if (surface === '') return `page '${page}' does not follow FINAL:<surface>: <state>`;
    if (!surfaces.includes(surface)) {
      return `page '${page}' belongs to surface '${surface}', which no --surface names`;
    }
    owned.add(surface);
  }
  const bare = surfaces.filter((surface) => !owned.has(surface));
  return bare.length > 0 ? `--surface ${bare.join(', ')} owns no FINAL: page in the file` : null;
}

/** The findings a changed design answers; every other finding is answered in the spec's table. */
const PAGE_GAPS: ReadonlySet<CoverageFindingCode> = new Set([
  'missing-page',
  'duplicate-page',
  'undeclared-page',
]);

/** A UI design's pages against the spec's `### Design coverage` table — no gaps means covered. */
function coverageGaps(
  cwd: string,
  specRel: string,
  pages: readonly string[],
): { ok: true; gaps: CoverageFinding[] } | { ok: false; error: string } {
  const spec = readRepoText(cwd, specRel);
  return spec.ok ? { ok: true, gaps: checkFeatureCoverage(spec.text, pages) } : spec;
}

const gapLines = (gaps: readonly CoverageFinding[]): string =>
  gaps.map((gap) => `  ${gap.code}: ${gap.message}`).join('\n');

/** Everything `main` needs, injected so tests drive real behaviour. */
export interface VerdictDeps {
  cwd: string;
  now: () => string;
}

interface VerdictCtx {
  cwd: string;
  now: () => string;
  pen: { abs: string; rel: string; key: string; kind: DesignKind; milestone: string | null };
}

function fail(message: string, code: 1 | 2): 1 | 2 {
  console.error(`design verdict: ${message}`);
  return code;
}

/**
 * Validate through the SAME schema every reader applies, then write — not
 * asserted: exiting 0 on a record the guard would reject as unusable is the
 * silent failure this CLI exists to prevent.
 */
function writeValidated(
  ctx: VerdictCtx,
  candidate: unknown,
): { code: 0; rel: string } | { code: 1 | 2 } {
  const parsed = designApprovalRecordSchema.safeParse(candidate);
  if (!parsed.success) {
    return { code: fail(`record would be unusable: ${parsed.error.message}`, 2) };
  }
  const written = writeApproval(ctx.cwd, ctx.pen.rel, parsed.data);
  if (!written.ok) return { code: fail(written.message, 1) };
  return { code: 0, rel: relative(ctx.cwd, written.path).split(sep).join('/') };
}

/** Resolve what an approval binds: the design's spec, or — for a milestone target, and only there — its milestone file. */
function resolveBinding(
  ctx: VerdictCtx,
  against: ApprovalBinding,
):
  | { ok: true; kind: 'spec'; name: string; rel: string }
  | { ok: true; kind: 'milestone'; slug: string; rel: string }
  | Refusal {
  if (against.kind === 'spec') {
    if (ctx.pen.milestone !== null) {
      return {
        ok: false,
        error: `${ctx.pen.rel} is a milestone target — approve it against its milestone file with --milestone ${ctx.pen.milestone}`,
      };
    }
    const spec = resolveFeatureSpec(ctx.cwd, against.spec, ctx.pen.key);
    return spec.ok ? { ok: true, kind: 'spec', name: spec.name, rel: spec.rel } : spec;
  }
  if (ctx.pen.milestone !== against.slug) {
    return {
      ok: false,
      error: `--milestone ${against.slug} does not own ${ctx.pen.rel} — its target is ${milestonePenPath(against.slug)}`,
    };
  }
  const abs = join(loadDocRoots(ctx.cwd).milestones, `${against.slug}.md`);
  const rel = relative(ctx.cwd, abs).split(sep).join('/');
  if (!existsSync(abs) || !lstatSync(abs).isFile()) {
    return { ok: false, error: `--milestone ${against.slug}: no ${rel}` };
  }
  return { ok: true, kind: 'milestone', slug: against.slug, rel };
}

/**
 * The record member that binds a file — `spec` for a feature design, `milestone`
 * for a milestone target, never both. Unvalidated: every caller hands it to
 * {@link writeValidated}, which parses the whole record.
 */
function bindingField(
  file: { kind: 'spec'; name: string } | { kind: 'milestone'; slug: string },
  blob: string,
): { spec: { name: string; blob: string } } | { milestone: { slug: string; blob: string } } {
  return file.kind === 'spec'
    ? { spec: { name: file.name, blob } }
    : { milestone: { slug: file.slug, blob } };
}

function approve(ctx: VerdictCtx, mode: ApproveMode): number {
  let bytes: Buffer;
  try {
    bytes = readFileSync(ctx.pen.abs);
  } catch (err) {
    return fail(`${ctx.pen.rel}: ${errMessage(err)}`, 2);
  }
  const read = readPenPages(bytes);
  if (!read.ok) return fail(`${ctx.pen.rel}: ${read.error}`, 2);
  const { editorOnly, diskOnly } = pageSetDiff(mode.editorPages, read.pages);
  if (editorOnly.length > 0 || diskOnly.length > 0) {
    const list = (names: string[]): string => (names.length > 0 ? names.join(' | ') : '(none)');
    return fail(
      `the editor and ${ctx.pen.rel} hold different pages — the editor has not saved\n` +
        `  in the editor, not on disk: ${list(editorOnly)}\n` +
        `  on disk, not in the editor: ${list(diskOnly)}\n` +
        'save the .pen in VS Code, then re-run — nothing was written',
      1,
    );
  }
  if (ctx.pen.kind === 'architecture') {
    const views: readonly string[] = ARCH_VIEWS;
    const stray = mode.surfaces.filter((surface) => !views.includes(surface));
    if (stray.length > 0) {
      return fail(
        `--surface ${stray.join(', ')} is not an architecture view (${views.join(' | ')})`,
        2,
      );
    }
  }
  const surfaceError = surfaceCoverageError(mode.surfaces, read.pages);
  if (surfaceError !== null) return fail(surfaceError, 2);
  const bound = resolveBinding(ctx, mode.against);
  if (!bound.ok) return fail(bound.error, 2);
  if (ctx.pen.kind === 'ui' && bound.kind === 'spec') {
    const covered = coverageGaps(ctx.cwd, bound.rel, read.pages);
    if (!covered.ok) return fail(covered.error, 2);
    if (covered.gaps.length > 0) {
      return fail(
        `${ctx.pen.rel} does not cover ${bound.rel}:\n${gapLines(covered.gaps)}\n` +
          "return to Iterate: draw what is missing, or correct the spec's ### Design coverage table — nothing was written",
        2,
      );
    }
  }

  const penBlob = blobIdOfBytes(ctx.cwd, ctx.pen.rel, bytes);
  if (penBlob === null) return fail(`git could not hash ${ctx.pen.rel}`, 2);
  const boundBlob = blobIdOfWorktreeFile(ctx.cwd, bound.rel, { write: true });
  if (boundBlob === null) return fail(`git could not store ${bound.rel}`, 2);

  const written = writeValidated(ctx, {
    outcome: 'approved',
    at: ctx.now(),
    penBlob,
    surfaces: mode.surfaces,
    ...(mode.reservation === undefined ? {} : { reservation: mode.reservation }),
    pages: read.pages,
    ...bindingField(bound, boundBlob),
  });
  if (written.code !== 0) return written.code;
  console.log(`approved: ${written.rel} → ${ctx.pen.rel} @ ${penBlob.slice(0, 12)}`);
  console.log(`signed ${read.pages.length} page(s):`);
  for (const page of read.pages) console.log(`  ${page}`);
  console.log(`against ${bound.kind} ${bound.rel} @ ${boundBlob.slice(0, 12)}`);
  console.log(STAGE_HINT);
  return 0;
}

function waive(ctx: VerdictCtx, reason: string): number {
  const penBlob = blobIdOfWorktreeFile(ctx.cwd, ctx.pen.rel);
  if (penBlob === null) return fail(`git could not hash ${ctx.pen.rel}`, 2);
  const written = writeValidated(ctx, { outcome: 'waived', at: ctx.now(), penBlob, reason });
  if (written.code !== 0) return written.code;
  console.log(`waived: ${written.rel} → ${ctx.pen.rel} @ ${penBlob.slice(0, 12)}`);
  console.log(STAGE_HINT);
  return 0;
}

/**
 * The file an approved record binds, where it now sits: a milestone target's
 * milestone file, or a feature design's spec — live, or archived under the
 * same name.
 */
/** A bound file located on disk. `name` is its basename, the name `--check`'s diff shows. */
type BoundFile =
  | { kind: 'spec'; name: string; blob: string; rel: string; abs: string }
  | { kind: 'milestone'; slug: string; name: string; blob: string; rel: string; abs: string };

function boundFile(
  cwd: string,
  pen: VerdictCtx['pen'],
  record: ApprovedRecord,
): ({ ok: true } & BoundFile) | { ok: false; error: string } {
  if (record.milestone !== undefined) {
    const abs = join(loadDocRoots(cwd).milestones, `${record.milestone.slug}.md`);
    const rel = relative(cwd, abs).split(sep).join('/');
    if (!existsSync(abs) || !lstatSync(abs).isFile()) {
      return {
        ok: false,
        error: `the milestone file the approval names (${rel}) is gone — take the verdict again with --milestone`,
      };
    }
    return {
      ok: true,
      kind: 'milestone',
      slug: record.milestone.slug,
      name: `${record.milestone.slug}.md`,
      blob: record.milestone.blob,
      rel,
      abs,
    };
  }
  const { spec } = record;
  if (spec === undefined) {
    return {
      ok: false,
      error: `the record for ${pen.rel} predates spec binding — take the verdict again with --spec`,
    };
  }
  const specs = loadDocRoots(cwd).specs;
  const abs = [specs, join(specs, ARCHIVE_DIR)]
    .map((dir) => join(dir, spec.name))
    .find((path) => existsSync(path) && lstatSync(path).isFile());
  if (abs === undefined) {
    const shown = relative(cwd, specs).split(sep).join('/');
    return {
      ok: false,
      error: `the spec the approval names (${spec.name}) is in neither ${shown}/ nor ${shown}/${ARCHIVE_DIR}/ — take the verdict again with --spec`,
    };
  }
  return { ok: true, kind: 'spec', ...spec, abs, rel: relative(cwd, abs).split(sep).join('/') };
}

/** A disposable scratch directory, removed on every path out of its scope. */
function scratchDir(): { path: string } & Disposable {
  const path = mkdtempSync(join(tmpdir(), 'noldor-verdict-'));
  return { path, [Symbol.dispose]: () => rmSync(path, { recursive: true, force: true }) };
}

const GIT_TIMEOUT_MS = 30_000;

/**
 * The approval-time spec against the one on disk, as a unified diff — or
 * `missing` when the old text is not in this clone's object store, kept apart
 * from a diff that failed, because only one of them means "compare by hand".
 * Diffed as two copies in a scratch dir so `--check` writes nothing into the
 * repository — not even a git object for the current text.
 */
function specDiff(
  cwd: string,
  oldBlob: string,
  currentAbs: string,
  name: string,
): { kind: 'diff'; text: string } | { kind: 'missing' } | { kind: 'failed'; error: string } {
  const old = spawnSync('git', ['cat-file', 'blob', oldBlob], { cwd, timeout: GIT_TIMEOUT_MS });
  if (old.error !== undefined) return { kind: 'failed', error: errMessage(old.error) };
  if (old.status !== 0) return { kind: 'missing' };
  try {
    using scratch = scratchDir();
    mkdirSync(join(scratch.path, 'approved'));
    mkdirSync(join(scratch.path, 'current'));
    writeFileSync(join(scratch.path, 'approved', name), old.stdout);
    copyFileSync(currentAbs, join(scratch.path, 'current', name));
    const diff = spawnSync(
      'git',
      ['diff', '--no-index', '--no-color', `approved/${name}`, `current/${name}`],
      { cwd: scratch.path, encoding: 'utf8', timeout: GIT_TIMEOUT_MS },
    );
    if (diff.error !== undefined) return { kind: 'failed', error: errMessage(diff.error) };
    // `git diff --no-index` exits 1 when the files differ — the expected case.
    if (diff.status === 0 || diff.status === 1) return { kind: 'diff', text: diff.stdout };
    // A killed process has no status — name the signal instead of printing `null`.
    const how = diff.signal !== null ? `was killed by ${diff.signal}` : `exited ${diff.status}`;
    return { kind: 'failed', error: `git diff ${how}: ${diff.stderr.trim()}` };
  } catch (err) {
    return { kind: 'failed', error: errMessage(err) };
  }
}

/** The working-tree record and the spec it binds, located — or why no verb can act on it. */
function loadApproval(ctx: VerdictCtx):
  | { kind: 'refused'; code: 1 | 2 }
  | { kind: 'waived' }
  | {
      kind: 'bound';
      record: ApprovedRecord;
      spec: BoundFile;
    } {
  const read = readApproval(ctx.cwd, ctx.pen.rel);
  if (!read.ok) return { kind: 'refused', code: fail(`cannot read the record: ${read.error}`, 2) };
  const { record } = read;
  if (record === null) {
    const code = fail(`no usable design-approval record for ${ctx.pen.rel} — take the verdict`, 2);
    return { kind: 'refused', code };
  }
  if (record.outcome === 'waived') return { kind: 'waived' };
  const spec = boundFile(ctx.cwd, ctx.pen, record);
  if (!spec.ok) return { kind: 'refused', code: fail(spec.error, 2) };
  return { kind: 'bound', record, spec };
}

function check(ctx: VerdictCtx): number {
  const loaded = loadApproval(ctx);
  if (loaded.kind === 'refused') return loaded.code;
  if (loaded.kind === 'waived') {
    console.log(`waived: ${ctx.pen.rel} ratified nothing, so nothing can drift`);
    return 0;
  }
  const { spec } = loaded;
  const current = blobIdOfWorktreeFile(ctx.cwd, spec.rel);
  if (current === null) return fail(`git could not hash ${spec.rel}`, 2);
  if (current === spec.blob) {
    console.log(`current: ${ctx.pen.rel} was approved against ${spec.rel} as it stands`);
    return 0;
  }
  console.log(
    `drifted: ${spec.rel} changed after ${ctx.pen.rel} was approved (${spec.blob.slice(0, 12)} → ${current.slice(0, 12)})`,
  );
  const diff = specDiff(ctx.cwd, spec.blob, spec.abs, spec.name);
  if (diff.kind === 'diff') console.log(diff.text);
  else if (diff.kind === 'missing') {
    console.log(
      `the approval-time text (${spec.blob.slice(0, 12)}) is not in this clone's object store — compare by hand`,
    );
  } else console.log(`could not diff the ${spec.kind}: ${diff.error}`);
  console.log(
    `if the design still depicts the ${spec.kind}: design verdict --pen ${ctx.pen.rel} --reconfirm; ` +
      'otherwise revise the design and take the verdict again',
  );
  return 1;
}

/**
 * Why the changed spec is no longer covered by the approved design, or `null`.
 * The pages come from the `.pen` on disk — the caller has proven its blob is the
 * approved one — so a record written before `pages` existed is checked too.
 */
function reconfirmCoverageError(ctx: VerdictCtx, specRel: string): string | null {
  let bytes: Buffer;
  try {
    bytes = readFileSync(ctx.pen.abs);
  } catch (err) {
    return `${ctx.pen.rel}: ${errMessage(err)}`;
  }
  const read = readPenPages(bytes);
  if (!read.ok) return `${ctx.pen.rel}: ${read.error}`;
  const covered = coverageGaps(ctx.cwd, specRel, read.pages);
  if (!covered.ok) return covered.error;
  if (covered.gaps.length === 0) return null;
  const onPages = covered.gaps.some((gap) => PAGE_GAPS.has(gap.code));
  const onTable = covered.gaps.some((gap) => !PAGE_GAPS.has(gap.code));
  return [
    `${specRel} is no longer covered by the approved ${ctx.pen.rel}:`,
    gapLines(covered.gaps),
    ...(onTable ? ["correct the spec's ### Design coverage table, then re-run --reconfirm"] : []),
    ...(onPages
      ? ['the design must change to hold the declared pages: revise it and take the verdict again']
      : []),
    'nothing was written',
  ].join('\n');
}

function reconfirm(ctx: VerdictCtx): number {
  const loaded = loadApproval(ctx);
  if (loaded.kind === 'refused') return loaded.code;
  if (loaded.kind === 'waived') {
    return fail(`${ctx.pen.rel} was waived, not approved — take the verdict`, 2);
  }
  const { record, spec } = loaded;
  const penBlob = blobIdOfWorktreeFile(ctx.cwd, ctx.pen.rel);
  if (penBlob === null) return fail(`git could not hash ${ctx.pen.rel}`, 2);
  if (penBlob !== record.penBlob) {
    return fail(
      `${ctx.pen.rel} changed after its verdict (record ${record.penBlob.slice(0, 12)}, file ${penBlob.slice(0, 12)}) — ` +
        'a changed design needs a full verdict',
      2,
    );
  }
  if (ctx.pen.kind === 'ui' && spec.kind === 'spec') {
    const uncovered = reconfirmCoverageError(ctx, spec.rel);
    if (uncovered !== null) return fail(uncovered, 2);
  }
  const specBlob = blobIdOfWorktreeFile(ctx.cwd, spec.rel, { write: true });
  if (specBlob === null) return fail(`git could not store ${spec.rel}`, 2);
  const written = writeValidated(ctx, {
    ...record,
    at: ctx.now(),
    ...bindingField(spec, specBlob),
  });
  if (written.code !== 0) return written.code;
  console.log(
    `reconfirmed: ${written.rel} → ${ctx.pen.rel} against ${spec.rel} @ ${specBlob.slice(0, 12)} (was ${spec.blob.slice(0, 12)})`,
  );
  console.log('stage the record — it rides the next commit');
  return 0;
}

/** Read-only: the editor's pages against the spec's table, before anyone is shown them. */
function coverage(ctx: VerdictCtx, mode: CoverageMode): number {
  if (ctx.pen.kind !== 'ui') {
    return fail(
      `--coverage holds a UI design to its spec; ${ctx.pen.rel} is an architecture design`,
      2,
    );
  }
  const spec = resolveFeatureSpec(ctx.cwd, mode.spec, ctx.pen.key);
  if (!spec.ok) return fail(spec.error, 2);
  const covered = coverageGaps(ctx.cwd, spec.rel, mode.editorPages);
  if (!covered.ok) return fail(covered.error, 2);
  if (covered.gaps.length === 0) {
    console.log(
      `covered: the FINAL pages are exactly the ones ${spec.rel} declares, and every criterion has a row`,
    );
    return 0;
  }
  console.log(`not covered: ${ctx.pen.rel} against ${spec.rel}`);
  console.log(gapLines(covered.gaps));
  return 1;
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
  if (!pen.ok) return fail(pen.error, 2);
  // `resolveFeaturePen`'s realpath already proved existence; the remaining
  // trust-boundary check is the naming scheme, which keys the record.
  const key = pen.milestone ?? penSlugFromFilename(pen.base);
  if (key === null) {
    return fail(
      `'${pen.base}' does not match the <date>-<key>.pen naming scheme — ` +
        'a record cannot name a file the scheme cannot identify',
      2,
    );
  }

  const ctx: VerdictCtx = {
    cwd,
    now,
    pen: {
      abs: pen.abs,
      rel: relative(cwd, pen.abs).split(sep).join('/'),
      key,
      kind: pen.kind,
      milestone: pen.milestone,
    },
  };
  switch (args.mode.verb) {
    case 'approve':
      return approve(ctx, args.mode);
    case 'waive':
      return waive(ctx, args.mode.reason);
    case 'check':
      return check(ctx);
    case 'reconfirm':
      return reconfirm(ctx);
    case 'coverage':
      return coverage(ctx, args.mode);
  }
}

runIfDirect('design-approval-cli', 'design verdict', async () => main(process.argv.slice(2)));
