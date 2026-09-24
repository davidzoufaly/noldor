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

import { z } from 'zod';

import { blobIdOfBytes, blobIdOfWorktreeFile } from '../core/blob-id.js';
import { runIfDirect } from '../core/cli-entry.js';
import {
  ARCHIVE_DIR,
  penSlugFromFilename,
  specSlugFromFilename,
  UI_BASELINE_DIR,
  UI_DESIGN_DIR,
} from '../core/design-artifact-names.js';
import { loadDocRoots } from '../core/doc-roots.js';
import { errMessage } from '../core/err-message.js';
import {
  designApprovalRecordSchema,
  readApproval,
  writeApproval,
  type DesignApprovalRecord,
} from './design-approval.js';

const USAGE =
  'usage: design verdict --pen <path> --approve --surface <s> [--surface <s>...] --spec <path>\n' +
  '                      --editor-page <name> [--editor-page <name>...] [--reservation <text>]\n' +
  '       design verdict --pen <path> --waive --reason <text>\n' +
  '       design verdict --pen <path> --check\n' +
  '       design verdict --pen <path> --reconfirm';

const STAGE_HINT = 'stage the record with the .pen and the spec — it rides the same commit';

type ApproveMode = {
  verb: 'approve';
  surfaces: string[];
  reservation?: string;
  /** Every top-level page name the editor shows, duplicates kept. */
  editorPages: string[];
  spec: string;
};

type VerdictMode =
  | ApproveMode
  | { verb: 'waive'; reason: string }
  | { verb: 'check' }
  | { verb: 'reconfirm' };

/** Parsed argv, or the reason it was refused — argv is a trust boundary. */
export type VerdictArgs =
  | { ok: true; pen: string; mode: VerdictMode }
  | { ok: false; error: string };

type ApprovedRecord = Extract<DesignApprovalRecord, { outcome: 'approved' }>;

const VERB_FLAGS = ['--approve', '--waive', '--check', '--reconfirm'] as const;
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

  const valueFlags = new Map<string, (v: string) => void>([
    ['--pen', (v) => (pen = v)],
    ['--surface', (v) => surfaces.push(v)],
    ['--editor-page', (v) => editorPages.push(v)],
    ['--spec', (v) => (spec = v)],
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
      error: 'exactly one of --approve / --waive / --check / --reconfirm is required',
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
    if (spec === undefined) return { ok: false, error: '--approve requires --spec' };
    return {
      ok: true,
      pen,
      mode: {
        verb: 'approve',
        surfaces: [...new Set(surfaces)],
        editorPages,
        spec,
        ...(reservation === undefined ? {} : { reservation }),
      },
    };
  }

  const approveOnly: Array<[string, boolean]> = [
    ['--surface', surfaces.length > 0],
    ['--reservation', reservation !== undefined],
    ['--editor-page', editorPages.length > 0],
    ['--spec', spec !== undefined],
  ];
  const stray = approveOnly.find(([, given]) => given);
  if (stray !== undefined) return { ok: false, error: `${stray[0]} belongs to --approve` };

  if (verb === '--waive') {
    if (reason === undefined) return { ok: false, error: '--waive requires --reason' };
    return { ok: true, pen, mode: { verb: 'waive', reason } };
  }
  if (reason !== undefined) return { ok: false, error: '--reason belongs to --waive' };
  return { ok: true, pen, mode: { verb: verb === '--check' ? 'check' : 'reconfirm' } };
}

/**
 * `arg` resolved to a real file. A symlink is refused outright rather than
 * resolved through: git stages the LINK's path and blob while realpath would
 * hand this CLI the target's name and bytes — a record written for an identity
 * no reader can ever match. Seed and `design archive` only ever produce real
 * files, so a link here is a mistake, not a flow.
 */
function resolveRealFile(
  repoRoot: string,
  flag: string,
  arg: string,
): { ok: true; abs: string } | { ok: false; error: string } {
  const candidate = resolve(repoRoot, arg);
  try {
    if (lstatSync(candidate).isSymbolicLink()) {
      return { ok: false, error: `${flag} ${arg}: must not be a symlink` };
    }
    return { ok: true, abs: realpathSync(candidate) };
  } catch (err) {
    return { ok: false, error: `${flag} ${arg}: ${errMessage(err)}` };
  }
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
  const real = resolveRealFile(repoRoot, '--pen', penArg);
  if (!real.ok) return real;
  const { abs } = real;
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
): { ok: true; rel: string; name: string } | { ok: false; error: string } {
  const real = resolveRealFile(repoRoot, '--spec', specArg);
  if (!real.ok) return real;
  let specsRoot: string;
  try {
    specsRoot = realpathSync(loadDocRoots(repoRoot).specs);
  } catch (err) {
    return { ok: false, error: `specs root unavailable: ${errMessage(err)}` };
  }
  const dir = dirname(real.abs);
  if (dir !== specsRoot && dir !== join(specsRoot, ARCHIVE_DIR)) {
    const shown = relative(repoRoot, specsRoot).split(sep).join('/');
    return {
      ok: false,
      error: `--spec must sit directly in ${shown}/ or ${shown}/${ARCHIVE_DIR}/ — the only places a later check looks`,
    };
  }
  const name = basename(real.abs);
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
  return { ok: true, rel: relative(repoRoot, real.abs).split(sep).join('/'), name };
}

/** Top-level children are the pages; nothing else in the document is read. */
const penPagesSchema = z.object({ children: z.array(z.object({ name: z.string() })) });

/**
 * The page names a `.pen` holds, in file order. The file is plain JSON (see
 * docs/noldor/gotchas.md). A name argv cannot carry as an `--editor-page` value
 * is refused here, or the comparison below would report an unsaved editor for
 * a page the agent had no way to name.
 */
function readPenPages(bytes: Buffer): { ok: true; pages: string[] } | { ok: false; error: string } {
  let doc: unknown;
  try {
    doc = JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    return { ok: false, error: `not JSON (${errMessage(err)})` };
  }
  const parsed = penPagesSchema.safeParse(doc);
  if (!parsed.success) return { ok: false, error: 'no top-level children array of named pages' };
  const pages = parsed.data.children.map((page) => page.name);
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

/** Everything `main` needs, injected so tests drive real behaviour. */
export interface VerdictDeps {
  cwd: string;
  now: () => string;
}

interface VerdictCtx {
  cwd: string;
  now: () => string;
  pen: { abs: string; base: string; rel: string; key: string };
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
  const written = writeApproval(ctx.cwd, ctx.pen.base, parsed.data);
  if (!written.ok) return { code: fail(written.message, 1) };
  return { code: 0, rel: relative(ctx.cwd, written.path).split(sep).join('/') };
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
  const coverage = surfaceCoverageError(mode.surfaces, read.pages);
  if (coverage !== null) return fail(coverage, 2);
  const spec = resolveFeatureSpec(ctx.cwd, mode.spec, ctx.pen.key);
  if (!spec.ok) return fail(spec.error, 2);

  const penBlob = blobIdOfBytes(ctx.cwd, ctx.pen.rel, bytes);
  if (penBlob === null) return fail(`git could not hash ${ctx.pen.rel}`, 2);
  const specBlob = blobIdOfWorktreeFile(ctx.cwd, spec.rel, { write: true });
  if (specBlob === null) return fail(`git could not store ${spec.rel}`, 2);

  const written = writeValidated(ctx, {
    outcome: 'approved',
    at: ctx.now(),
    penBlob,
    surfaces: mode.surfaces,
    ...(mode.reservation === undefined ? {} : { reservation: mode.reservation }),
    pages: read.pages,
    spec: { name: spec.name, blob: specBlob },
  });
  if (written.code !== 0) return written.code;
  console.log(`approved: ${written.rel} → ${ctx.pen.rel} @ ${penBlob.slice(0, 12)}`);
  console.log(`signed ${read.pages.length} page(s):`);
  for (const page of read.pages) console.log(`  ${page}`);
  console.log(`against spec ${spec.rel} @ ${specBlob.slice(0, 12)}`);
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

/** The spec an approved record names, where it now sits: live, or archived under the same name. */
function boundSpec(
  cwd: string,
  pen: VerdictCtx['pen'],
  record: ApprovedRecord,
):
  | { ok: true; name: string; blob: string; rel: string; abs: string }
  | { ok: false; error: string } {
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
  return { ok: true, ...spec, abs, rel: relative(cwd, abs).split(sep).join('/') };
}

/** A disposable scratch directory, removed on every path out of its scope. */
function scratchDir(): { path: string } & Disposable {
  const path = mkdtempSync(join(tmpdir(), 'noldor-verdict-'));
  return { path, [Symbol.dispose]: () => rmSync(path, { recursive: true, force: true }) };
}

/**
 * The approval-time spec against the one on disk, as a unified diff, or `null`
 * when the old text is not in this clone's object store. Diffed as two copies
 * in a scratch dir so `--check` writes nothing into the repository — not even
 * a git object for the current text.
 */
function specDiff(cwd: string, oldBlob: string, currentAbs: string, name: string): string | null {
  const old = spawnSync('git', ['cat-file', 'blob', oldBlob], { cwd });
  if (old.status !== 0) return null;
  using scratch = scratchDir();
  mkdirSync(join(scratch.path, 'approved'));
  mkdirSync(join(scratch.path, 'current'));
  writeFileSync(join(scratch.path, 'approved', name), old.stdout);
  copyFileSync(currentAbs, join(scratch.path, 'current', name));
  const diff = spawnSync(
    'git',
    ['diff', '--no-index', '--no-color', `approved/${name}`, `current/${name}`],
    { cwd: scratch.path, encoding: 'utf8' },
  );
  // `git diff --no-index` exits 1 when the files differ — the expected case.
  return diff.status === 0 || diff.status === 1 ? diff.stdout : null;
}

function check(ctx: VerdictCtx): number {
  const record = readApproval(ctx.cwd, ctx.pen.base);
  if (record === null) {
    return fail(`no usable design-approval record for ${ctx.pen.rel} — take the verdict`, 2);
  }
  if (record.outcome === 'waived') {
    console.log(`waived: ${ctx.pen.rel} ratified nothing, so nothing can drift`);
    return 0;
  }
  const spec = boundSpec(ctx.cwd, ctx.pen, record);
  if (!spec.ok) return fail(spec.error, 2);
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
  console.log(
    diff ??
      `the approval-time text (${spec.blob.slice(0, 12)}) is not in this clone's object store — compare by hand`,
  );
  console.log(
    `if the design still depicts the spec: design verdict --pen ${ctx.pen.rel} --reconfirm; ` +
      'otherwise revise the design and take the verdict again',
  );
  return 1;
}

function reconfirm(ctx: VerdictCtx): number {
  const record = readApproval(ctx.cwd, ctx.pen.base);
  if (record === null) {
    return fail(`no usable design-approval record for ${ctx.pen.rel} — take the verdict`, 2);
  }
  if (record.outcome === 'waived') {
    return fail(`${ctx.pen.rel} was waived, not approved — take the verdict`, 2);
  }
  const spec = boundSpec(ctx.cwd, ctx.pen, record);
  if (!spec.ok) return fail(spec.error, 2);
  const penBlob = blobIdOfWorktreeFile(ctx.cwd, ctx.pen.rel);
  if (penBlob === null) return fail(`git could not hash ${ctx.pen.rel}`, 2);
  if (penBlob !== record.penBlob) {
    return fail(
      `${ctx.pen.rel} changed after its verdict (record ${record.penBlob.slice(0, 12)}, file ${penBlob.slice(0, 12)}) — ` +
        'a changed design needs a full verdict',
      2,
    );
  }
  const specBlob = blobIdOfWorktreeFile(ctx.cwd, spec.rel, { write: true });
  if (specBlob === null) return fail(`git could not store ${spec.rel}`, 2);
  const written = writeValidated(ctx, {
    ...record,
    at: ctx.now(),
    spec: { name: spec.name, blob: specBlob },
  });
  if (written.code !== 0) return written.code;
  console.log(
    `reconfirmed: ${written.rel} → ${ctx.pen.rel} against ${spec.rel} @ ${specBlob.slice(0, 12)} (was ${spec.blob.slice(0, 12)})`,
  );
  console.log('stage the record — it rides the next commit');
  return 0;
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
  const key = penSlugFromFilename(pen.base);
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
    pen: { abs: pen.abs, base: pen.base, rel: relative(cwd, pen.abs).split(sep).join('/'), key },
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
  }
}

runIfDirect('design-approval-cli', 'design verdict', async () => main(process.argv.slice(2)));
