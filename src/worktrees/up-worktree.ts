// @tests: per-task-dev-environment-bootstrap
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadDevConfig } from '../core/consumer-config.js';
import { createWorktree } from './create-worktree.js';
import { bootDevSurfaces, type BootedSurface } from './dev-surfaces.js';
import { launchTree, resolveAgentInvocation } from './launch-worktrees.js';
import { openEditor } from './open-editor.js';
import { readPort } from './worktree-status.js';

export interface UpOptions {
  slug: string;
  cwd: string;
  branch?: string;
  noCreate?: boolean;
  noEditor?: boolean;
  noTerminal?: boolean;
  noServers?: boolean;
}

export interface UpSummary {
  treePath: string;
  basePort: number | null;
  editorOpened: boolean;
  terminalSpawned: boolean;
  surfaces: BootedSurface[];
}

/** Injectable seams (defaults wired to the real units; tests stub them). */
export interface UpDeps {
  createWorktreeImpl: typeof createWorktree;
  existsImpl: (p: string) => boolean;
  readPortImpl: typeof readPort;
  openEditorImpl: typeof openEditor;
  launchTreeImpl: typeof launchTree;
  bootDevSurfacesImpl: typeof bootDevSurfaces;
  loadDevConfigImpl: typeof loadDevConfig;
  readTemplateImpl: (cwd: string) => Promise<string>;
}

const defaultDeps: UpDeps = {
  createWorktreeImpl: createWorktree,
  existsImpl: existsSync,
  readPortImpl: readPort,
  openEditorImpl: openEditor,
  launchTreeImpl: launchTree,
  bootDevSurfacesImpl: bootDevSurfaces,
  loadDevConfigImpl: loadDevConfig,
  readTemplateImpl: (cwd) =>
    readFile(join(cwd, '.claude/launch-prompt.md'), 'utf8').catch(() => ''),
};

/**
 * From "branch checked out" (or not) to a usable dev surface: create the
 * worktree, open the IDE, spawn the agent terminal (the configured
 * `agents.default` runner), and boot every consumer-declared dev surface on
 * its per-tree port. Each step is skippable.
 */
export async function upWorktree(opts: UpOptions, deps: UpDeps = defaultDeps): Promise<UpSummary> {
  const treePath = join(opts.cwd, '.worktrees', opts.slug);
  const branch = opts.branch ?? `feat/${opts.slug}`;

  if (!opts.noCreate && !deps.existsImpl(treePath)) {
    await deps.createWorktreeImpl({ slug: opts.slug, branch, cwd: opts.cwd });
  }

  const basePort = await deps.readPortImpl(treePath);
  const devConfig = deps.loadDevConfigImpl(opts.cwd);

  let editorOpened = false;
  if (!opts.noEditor) {
    editorOpened = (await deps.openEditorImpl(treePath, devConfig?.editor?.command)).opened;
  }

  let terminalSpawned = false;
  if (!opts.noTerminal) {
    const template = await deps.readTemplateImpl(opts.cwd);
    const agentInvocation = resolveAgentInvocation(opts.cwd);
    await deps.launchTreeImpl({ path: treePath, branch, isMain: false }, template, agentInvocation);
    terminalSpawned = true;
  }

  let surfaces: BootedSurface[] = [];
  if (!opts.noServers && basePort !== null) {
    surfaces = await deps.bootDevSurfacesImpl({
      treePath,
      slug: opts.slug,
      surfaces: devConfig?.surfaces ?? {},
      basePort,
      cwd: opts.cwd,
    });
  }

  return { treePath, basePort, editorOpened, terminalSpawned, surfaces };
}

function parseArgs(argv: string[]): UpOptions & { ok: boolean } {
  let slug: string | null = null;
  let branch: string | undefined;
  const flags = { noCreate: false, noEditor: false, noTerminal: false, noServers: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--no-create') flags.noCreate = true;
    else if (a === '--no-editor') flags.noEditor = true;
    else if (a === '--no-terminal') flags.noTerminal = true;
    else if (a === '--no-servers') flags.noServers = true;
    else if (a === '--branch') branch = argv[++i];
    else if (!a.startsWith('-') && slug === null) slug = a;
  }
  return {
    slug: slug ?? '',
    cwd: process.cwd(),
    ...(branch ? { branch } : {}),
    ...flags,
    ok: slug !== null,
  };
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.ok) {
    process.stderr.write(
      'usage: noldor worktrees up <slug> [--branch <n>] [--no-create|--no-editor|--no-terminal|--no-servers]\n',
    );
    return 2;
  }
  const s = await upWorktree(opts);
  process.stdout.write(`Worktree: ${s.treePath}  base port: ${s.basePort ?? 'none'}\n`);
  process.stdout.write(
    `Editor: ${s.editorOpened ? 'opened' : 'skipped'}  Terminal: ${s.terminalSpawned ? 'spawned' : 'skipped'}\n`,
  );
  for (const su of s.surfaces) {
    process.stdout.write(
      `  ${su.ready ? '✓' : '✗'} ${su.name}: ${su.url}${su.note ? ` (${su.note})` : ''}\n`,
    );
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
