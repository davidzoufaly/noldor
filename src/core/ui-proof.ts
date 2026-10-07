// @tests: ui-proof-screenshots-on-the-pr
// UI proof for the PR body: which surfaces a branch touched, which screenshots
// prove them, and where those images are hosted so a PR body can show them.
// Images live on an orphan branch, never the feature branch, because a squash
// merge would land every PNG on `main`.

import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, open, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { minimatch } from 'minimatch';

import type { UiCaptureRecipe } from './consumer-config.js';
import { errMessage } from './err-message.js';
import type { UiProofLink } from './pr-flow.js';
import type { runCapture } from './run-capture.js';
import { sanitizeSurfaceName } from './ui-boot.js';
import { surfaceMap, type UiConfig } from './ui-predicate.js';

const execFileAsync = promisify(execFile);

/** The orphan branch every proof image is pushed to. */
export const UI_PROOF_BRANCH = 'noldor/ui-proof';

const MAX_IMAGES_PER_SURFACE = 3;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** One surface's proof before hosting: local image files plus every note worth showing. */
export interface UiProofItem {
  surface: string;
  source: 'e2e' | 'render-compare' | null;
  files: string[];
  notes: string[];
}

/**
 * The surfaces whose globs match a path the branch touched, sorted. An FD
 * `design: skip` suppresses every surface: the operator declared the change
 * carries no visual delta worth proving.
 */
export function uiProofSurfaces(
  branchFiles: readonly string[],
  config: UiConfig,
  fdDesign: unknown,
): string[] {
  if (fdDesign === 'skip') return [];
  return Object.entries(surfaceMap(config))
    .filter(([, globs]) =>
      branchFiles.some((f) => globs.some((g) => minimatch(f, g, { dot: true }))),
    )
    .map(([surface]) => surface)
    .sort();
}

async function hasPngSignature(file: string): Promise<boolean> {
  await using handle = await open(file, 'r');
  const head = Buffer.alloc(PNG_SIGNATURE.length);
  const { bytesRead } = await handle.read(head, 0, head.length, 0);
  return bytesRead === head.length && head.equals(PNG_SIGNATURE);
}

/** Keeps the files that start with the PNG signature; every rejected one becomes a note. */
async function validPngs(files: readonly string[], notes: string[]): Promise<string[]> {
  const kept: string[] = [];
  for (const file of files) {
    let ok: boolean;
    try {
      ok = await hasPngSignature(file);
    } catch (err) {
      notes.push(`could not read ${file}: ${errMessage(err)}`);
      continue;
    }
    if (ok) kept.push(file);
    else notes.push(`skipped ${file}: not a PNG`);
  }
  return kept;
}

/** `{out}` substituted as one single-quoted shell token; `null` when the path itself holds a quote. */
function substituteOut(template: string, outDir: string): string | null {
  if (outDir.includes("'")) return null;
  return template.replaceAll('{out}', `'${outDir}'`);
}

async function runProofCommand(opts: {
  cwd: string;
  slug: string;
  surface: string;
  recipe: UiCaptureRecipe;
  capture: typeof runCapture;
  notes: string[];
}): Promise<string[]> {
  const outDir = join(
    opts.cwd,
    '.noldor',
    'ui-proof',
    opts.slug,
    sanitizeSurfaceName(opts.surface),
  );
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const command = substituteOut(opts.recipe.command, outDir);
  if (command === null) {
    opts.notes.push(`proof command not run: the output path contains a single quote (${outDir})`);
    return [];
  }
  const cap = await opts.capture(command, opts.cwd, opts.recipe.timeoutMs, {
    NOLDOR_PROOF_OUT: outDir,
  });
  if (cap.timedOut) {
    opts.notes.push(`proof command timed out after ${opts.recipe.timeoutMs} ms`);
    return [];
  }
  if (cap.code !== 0) {
    const tail = cap.stderrTail.trim();
    opts.notes.push(`proof command exited ${cap.code}${tail === '' ? '' : `: ${tail}`}`);
    return [];
  }
  const pngs = (await readdir(outDir))
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .sort()
    .map((f) => join(outDir, f));
  if (pngs.length === 0) {
    opts.notes.push('proof command wrote no PNG');
    return [];
  }
  return (await validPngs(pngs, opts.notes)).slice(0, MAX_IMAGES_PER_SURFACE);
}

/**
 * The render-compare lane's shot for a surface, only when its sidecar records
 * the tree being shipped. Tree, not commit: the review receipt is amended onto
 * the tip after the lane ran, which moves the SHA and keeps the tree.
 */
async function renderCompareShot(opts: {
  cwd: string;
  slug: string;
  surface: string;
  headTree: string;
  notes: string[];
}): Promise<string[]> {
  const base = join(
    opts.cwd,
    '.noldor',
    'cr',
    'render-compare',
    opts.slug,
    `${sanitizeSurfaceName(opts.surface)}.shot`,
  );
  let tree: unknown;
  try {
    tree = (JSON.parse(await readFile(`${base}.json`, 'utf8')) as { tree?: unknown }).tree;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      opts.notes.push(`render-compare shot record unreadable: ${errMessage(err)}`);
    }
    return [];
  }
  if (tree !== opts.headTree) {
    opts.notes.push('render-compare shot is from an older tree; not used');
    return [];
  }
  return validPngs([`${base}.png`], opts.notes);
}

/**
 * One item per surface: the proof command's images when one is configured and
 * succeeds, else the render-compare shot. A failed proof command keeps its
 * note even when the fallback supplies an image.
 */
export async function collectUiProof(opts: {
  cwd: string;
  slug: string;
  surfaces: readonly string[];
  recipes: Readonly<Record<string, UiCaptureRecipe>>;
  headTree: string;
  capture: typeof runCapture;
}): Promise<UiProofItem[]> {
  const items: UiProofItem[] = [];
  for (const surface of opts.surfaces) {
    const notes: string[] = [];
    const recipe = Object.hasOwn(opts.recipes, surface) ? opts.recipes[surface] : undefined;
    const e2e =
      recipe === undefined
        ? []
        : await runProofCommand({ ...opts, surface, recipe, notes }).catch((err: unknown) => {
            notes.push(`proof command failed: ${errMessage(err)}`);
            return [];
          });
    if (e2e.length > 0) {
      items.push({ surface, source: 'e2e', files: e2e, notes });
      continue;
    }
    const shot = await renderCompareShot({ ...opts, surface, notes });
    items.push({
      surface,
      source: shot.length > 0 ? 'render-compare' : null,
      files: shot,
      notes,
    });
  }
  return items;
}

async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    ...(env !== undefined ? { env: { ...process.env, ...env } } : {}),
  });
  return stdout.trim();
}

/**
 * Commit the items' images onto the remote proof branch under
 * `<branch>/<headSha>/` and push. Builds the commit in a throwaway index so the
 * caller's index and working tree are never touched. Returns the proof commit.
 */
async function commitAndPush(opts: {
  cwd: string;
  dir: string;
  files: ReadonlyArray<{ path: string; local: string }>;
}): Promise<string> {
  const remoteTip = (
    await git(opts.cwd, ['ls-remote', 'origin', `refs/heads/${UI_PROOF_BRANCH}`])
  ).split(/\s/)[0];
  const parent = remoteTip === undefined || remoteTip === '' ? null : remoteTip;
  if (parent !== null) await git(opts.cwd, ['fetch', '--quiet', 'origin', parent]);

  const scratch = await mkdtemp(join(tmpdir(), 'noldor-ui-proof-'));
  try {
    const env = { GIT_INDEX_FILE: join(scratch, 'index') };
    if (parent !== null) await git(opts.cwd, ['read-tree', parent], env);
    for (const f of opts.files) {
      const blob = await git(opts.cwd, ['hash-object', '-w', f.local]);
      await git(
        opts.cwd,
        ['update-index', '--add', '--cacheinfo', `100644,${blob},${f.path}`],
        env,
      );
    }
    const tree = await git(opts.cwd, ['write-tree'], env);
    const commit = await git(opts.cwd, [
      'commit-tree',
      tree,
      ...(parent === null ? [] : ['-p', parent]),
      '-m',
      `ui proof: ${opts.dir}`,
    ]);
    await git(opts.cwd, ['push', '--quiet', 'origin', `${commit}:refs/heads/${UI_PROOF_BRANCH}`]);
    return commit;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Host the items' images on {@link UI_PROOF_BRANCH} and return PR-ready links
 * pinned to the proof commit. A rejected push (another session moved the
 * branch) retries once on the new tip; any other failure turns every image
 * into a note, so the caller never has to catch.
 */
export async function hostUiProof(opts: {
  cwd: string;
  repoUrl: string;
  branch: string;
  headSha: string;
  items: readonly UiProofItem[];
}): Promise<UiProofLink[]> {
  const dir = `${opts.branch}/${opts.headSha}`;
  const placed = opts.items.map((item) => ({
    item,
    files: item.files.map((local, i) => ({
      local,
      path: `${dir}/${sanitizeSurfaceName(item.surface)}-${i + 1}.png`,
    })),
  }));
  const files = placed.flatMap((p) => p.files);
  const toLinks = (commit: string | null, failure: string | null): UiProofLink[] =>
    placed.map(({ item, files: own }) => ({
      surface: item.surface,
      source: commit === null ? null : item.source,
      imageUrls:
        commit === null ? [] : own.map((f) => `${opts.repoUrl}/blob/${commit}/${f.path}?raw=true`),
      notes: failure === null || own.length === 0 ? item.notes : [...item.notes, failure],
    }));
  if (files.length === 0) return toLinks(null, null);

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return toLinks(await commitAndPush({ cwd: opts.cwd, dir, files }), null);
    } catch (err) {
      lastError = err;
    }
  }
  return toLinks(
    null,
    `could not push the screenshots to ${UI_PROOF_BRANCH}: ${errMessage(lastError)}`,
  );
}

/**
 * The lazy step `pr-flow` hands to `openAndAutoMerge`, or `undefined` when the
 * branch touched no UI surface (or the repo declares none) — then nothing runs
 * and the PR body is unchanged. Each surface left without an image warns once
 * on stderr; the step itself never throws.
 */
export function uiProofStep(opts: {
  cwd: string;
  slug: string;
  branch: string;
  headSha: string;
  repoUrl: string;
  branchFiles: readonly string[];
  fdDesign: unknown;
  config: UiConfig & { uiProof?: Record<string, UiCaptureRecipe> };
  capture: typeof runCapture;
}): (() => Promise<readonly UiProofLink[]>) | undefined {
  const surfaces = uiProofSurfaces(opts.branchFiles, opts.config, opts.fdDesign);
  if (surfaces.length === 0) return undefined;
  return async () => {
    const items = await collectUiProof({
      cwd: opts.cwd,
      slug: opts.slug,
      surfaces,
      recipes: opts.config.uiProof ?? {},
      headTree: await git(opts.cwd, ['rev-parse', 'HEAD^{tree}']).catch(() => ''),
      capture: opts.capture,
    });
    const links = await hostUiProof({ ...opts, items });
    for (const l of links.filter((x) => x.imageUrls.length === 0)) {
      process.stderr.write(
        `pr-flow: warning — no UI proof screenshot for surface '${l.surface}'` +
          `${l.notes.length > 0 ? `: ${l.notes.join('; ')}` : ''}\n`,
      );
    }
    return links;
  };
}
