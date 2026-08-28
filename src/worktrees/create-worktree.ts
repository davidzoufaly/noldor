// noldor worktrees create <slug> [--branch <name>] [--no-install]
//
// Vendored worktree mechanics from docs/noldor/worktree-discipline.md:
// .worktrees/<slug> on feat/<slug> (or --branch), pnpm install with the
// lefthook-postinstall tolerance, port stamped into .env.local.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { parseSlug } from '../core/slug.js';
import { worktreePath } from './worktree-paths.js';
import { resolveErrorMessage, type ResolveError } from '../core/slug-paths.js';

/**
 * Why `createWorktree` refused.
 *
 * All four are expected failures of external input or repository state, so all
 * four are result arms rather than throws — converting only the slug case would
 * leave a direct caller with two contracts for one class of condition. The
 * install failure below stays a throw: it is a subprocess failure, which
 * `error-result-types` converts at the boundary with its `cause` intact.
 */
export type CreateRefusal =
  | ResolveError
  | { readonly kind: 'not-main-workspace' }
  | { readonly kind: 'worktree-exists'; readonly slug: string }
  | { readonly kind: 'branch-exists'; readonly branch: string };

/** Human-readable reason for a {@link CreateRefusal}, for a CLI's stderr. */
export function createRefusalMessage(error: CreateRefusal): string {
  switch (error.kind) {
    case 'not-main-workspace':
      return 'worktrees create must run from the main workspace, not inside a worktree';
    case 'worktree-exists':
      return `worktree already exists: .worktrees/${error.slug}`;
    case 'branch-exists':
      return `branch already exists: ${error.branch}`;
    default:
      return resolveErrorMessage(error);
  }
}
import { allocatePorts, parseWorktreeList, readPort } from './worktree-status.js';

const execFileP = promisify(execFile);

/**
 * Signature of the tolerated install failure: lefthook's postinstall refuses
 * to run because `core.hooksPath` already points at the shared `.git/hooks`
 * (set by the main checkout's install). Hooks remain active for the worktree
 * because the configured path is absolute, so the failure is cosmetic.
 */
const LEFTHOOK_HOOKSPATH_RE = /core\.hooksPath is set locally/;

/** Combined exit code + stdout/stderr of one `pnpm install` run. */
export interface InstallResult {
  code: number;
  output: string;
}

/** Injectable install step — tests stub this instead of running pnpm. */
export type InstallRunner = (cwd: string) => Promise<InstallResult>;

/** Options for {@link createWorktree}. */
export interface CreateOptions {
  /** Kebab-case worktree name; directory is `.worktrees/<slug>`. */
  slug: string;
  /** Branch name; defaults to `feat/<slug>` (gate fast-track passes `fast/<desc>`). */
  branch?: string;
  /** Main-workspace root; defaults to `process.cwd()`. */
  cwd?: string;
  /** Run `pnpm install` in the new tree (default true). */
  install?: boolean;
  installRunner?: InstallRunner;
  log?: (line: string) => void;
}

/** Result of {@link createWorktree}. */
export interface CreateResult {
  path: string;
  branch: string;
  port: number | null;
  installWarning: string | null;
}

const defaultInstall: InstallRunner = async (cwd) => {
  try {
    const { stdout, stderr } = await execFileP('pnpm', ['install'], {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { code: 0, output: `${stdout}\n${stderr}` };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, output: `${e.stdout ?? ''}\n${e.stderr ?? String(err)}` };
  }
};

/**
 * Create `.worktrees/<slug>` on a fresh branch from the main workspace's HEAD,
 * install dependencies (tolerating the known lefthook hooksPath failure), and
 * stamp a dev-server port into the tree's `.env.local`.
 *
 * @param opts - See {@link CreateOptions}.
 * @returns Path, branch, assigned port, and any tolerated-install warning.
 */
export async function createWorktree(
  opts: CreateOptions,
): Promise<{ ok: true; result: CreateResult } | { ok: false; error: CreateRefusal }> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const log = opts.log ?? (() => {});

  // Parse before the first git call: every step below is keyed on the slug, and
  // `git rev-parse` is already a subprocess launch from this working directory.
  const parsed = parseSlug(opts.slug);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const tree = worktreePath(cwd, parsed.slug);
  if (!tree.ok) return { ok: false, error: tree.error };

  // Slug-derived, but a git ref rather than a path, so no builder reaches it —
  // the parse above is what makes interpolating it safe.
  const branch = opts.branch ?? `feat/${parsed.slug}`;

  const gitDir = (await execFileP('git', ['rev-parse', '--git-dir'], { cwd })).stdout.trim();
  const commonDir = (
    await execFileP('git', ['rev-parse', '--git-common-dir'], { cwd })
  ).stdout.trim();
  if (resolve(cwd, gitDir) !== resolve(cwd, commonDir)) {
    return { ok: false, error: { kind: 'not-main-workspace' } };
  }

  const path = tree.path;
  if (existsSync(path)) {
    return { ok: false, error: { kind: 'worktree-exists', slug: parsed.slug } };
  }
  const branchExists = await execFileP(
    'git',
    ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
    { cwd },
  ).then(
    () => true,
    () => false,
  );
  if (branchExists) {
    return { ok: false, error: { kind: 'branch-exists', branch } };
  }

  await execFileP('git', ['worktree', 'add', path, '-b', branch], { cwd });
  log(`worktree created: .worktrees/${parsed.slug} on ${branch}`);

  let installWarning: string | null = null;
  if (opts.install !== false) {
    const run = opts.installRunner ?? defaultInstall;
    const res = await run(path);
    if (res.code !== 0) {
      const binPopulated = existsSync(join(path, 'node_modules', '.bin'));
      if (binPopulated && LEFTHOOK_HOOKSPATH_RE.test(res.output)) {
        installWarning =
          'lefthook postinstall failed (core.hooksPath already targets the shared .git/hooks) — hooks remain active; continuing';
        log(`warning: ${installWarning}`);
      } else {
        throw new Error(`pnpm install failed in ${path}:\n${res.output}`);
      }
    } else {
      log('dependencies installed');
    }
  }

  const porcelain = (await execFileP('git', ['worktree', 'list', '--porcelain'], { cwd })).stdout;
  const trees = parseWorktreeList(porcelain).filter((t) => resolve(t.path) !== cwd);
  const inputs = await Promise.all(
    trees.map(async (t) => ({ path: t.path, currentPort: await readPort(t.path) })),
  );
  const alloc = await allocatePorts(inputs);
  if (alloc.exhausted) {
    log('warning: port range 5174-5179 exhausted — no PORT stamped');
  }
  const port = await readPort(path);

  return { ok: true, result: { path, branch, port, installWarning } };
}

function parseArgs(argv: string[]): { slug: string | null; branch?: string; install: boolean } {
  let slug: string | null = null;
  let branch: string | undefined;
  let install = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--no-install') install = false;
    else if (a === '--branch') branch = argv[++i];
    else if (!a.startsWith('-') && slug === null) slug = a;
  }
  return { slug, branch, install };
}

async function main(): Promise<number> {
  const { slug, branch, install } = parseArgs(process.argv.slice(2));
  if (!slug) {
    process.stderr.write(
      'usage: noldor worktrees create <slug> [--branch <name>] [--no-install]\n',
    );
    return 2;
  }
  try {
    const outcome = await createWorktree({
      slug,
      ...(branch === undefined ? {} : { branch }),
      install,
      log: (l) => process.stdout.write(`${l}\n`),
    });
    if (!outcome.ok) {
      process.stderr.write(`${createRefusalMessage(outcome.error)}\n`);
      return 1;
    }
    const res = outcome.result;
    process.stdout.write(`\nWorktree ready at ${res.path}\n`);
    process.stdout.write(`Branch: ${res.branch}${res.port ? `  Port: ${res.port}` : ''}\n`);
    process.stdout.write(
      `Edit-path prefix: ${res.path}/ — every edit must start with this root; a main-workspace path lands on main while typecheck/test here stay green (false-green).\n`,
    );
    process.stdout.write('Next: run the baseline test suite from inside the tree.\n');
    return 0;
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
