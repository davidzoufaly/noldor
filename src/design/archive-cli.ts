// @tests: doc-gardening-skill
// `noldor design archive` — move THIS session's spec/plan into their sibling
// archive/ dir and leave the moves staged, so the gate's phase-flip commit
// carries them. Portable CLI: consumer repos have no ./src/ tree to import from,
// and prose-dispatch runners (codex/opencode) shell CLIs rather than run skills.
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

import { discoverAddedFiles, repoRoot } from '../core/branch-added.js';
import { readSession } from '../core/session.js';
import { dialogueKeyFromSession, resolveArchivePlan } from './archive-resolve.js';

const USAGE = 'usage: noldor design archive [--dry-run] [--slug <key>]';

export interface ArchiveArgs {
  dryRun: boolean;
  slug?: string;
}

/** Parse argv into {@link ArchiveArgs}. */
export function parseArchiveArgs(argv: readonly string[]): ArchiveArgs | { error: string } {
  const args: ArchiveArgs = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--dry-run') continue;
    if (flag === '--slug') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return { error: 'missing value: --slug' };
      args.slug = value;
      i += 1;
      continue;
    }
    return { error: `unknown flag: ${flag}` };
  }
  args.dryRun = argv.includes('--dry-run');
  return args;
}

function git(cwd: string, gitArgs: readonly string[]): { ok: boolean; stderr: string } {
  const r = spawnSync('git', [...gitArgs], { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, stderr: r.stderr ?? '' };
}

async function main(): Promise<number> {
  const parsed = parseArchiveArgs(process.argv.slice(2));
  if ('error' in parsed) {
    process.stderr.write(`design archive: ${parsed.error}\n${USAGE}\n`);
    return 1;
  }

  const cwd = process.cwd();
  let root: string;
  try {
    root = repoRoot(cwd);
  } catch {
    process.stderr.write('design archive: not a git repository — skipped\n');
    return 0;
  }

  let key: string | undefined = parsed.slug;
  if (key === undefined) {
    // Repo root, not `cwd`: the marker lives at `<root>/.noldor/session.json`, and
    // the gate may invoke this from anywhere inside the worktree.
    const session = readSession(root);
    if (session === null) {
      process.stderr.write(
        'design archive: no .noldor/session.json — did you skip the gate scaffold?\n',
      );
      return 1;
    }
    const derived = dialogueKeyFromSession(session);
    if (derived === null) {
      process.stdout.write(
        `design archive: path ${session.path} carries no design artifacts — skipped\n`,
      );
      return 0;
    }
    key = derived;
  }

  // Fail closed: archiving without the ownership gate is the one outcome worth
  // refusing outright, because a filename-only match can reach a foreign
  // feature's live spec. Garden's detectors remain the backstop.
  let branchAdded: string[];
  try {
    branchAdded = discoverAddedFiles({ cwd: root });
  } catch {
    process.stderr.write(
      'design archive: cannot determine branch-added artifacts — skipped (garden will catch it)\n',
    );
    return 0;
  }

  const plan = await resolveArchivePlan({ branchAdded, key, repo: root });
  if (plan === null || (plan.moves.length === 0 && plan.skipped.length === 0)) {
    process.stdout.write(`design archive: no artifacts matching ${key} — nothing to do\n`);
    return 0;
  }

  for (const s of plan.skipped) {
    process.stdout.write(`skipped (exists in archive): ${s.from}\n`);
  }

  if (parsed.dryRun) {
    for (const m of plan.moves) {
      process.stdout.write(`would archive: ${m.from} → ${m.to}\n`);
    }
    return 0;
  }

  for (const m of plan.moves) {
    mkdirSync(dirname(join(root, m.to)), { recursive: true });
    // `git mv` (not fs rename): it preserves rename detection AND stages both
    // halves, so the gate's flip commit carries the move without ever naming an
    // artifact directory. Every eligible artifact is tracked by construction —
    // `branchAdded` is derived from commits — so there is no untracked branch to
    // fall back to; an untracked artifact simply is not eligible.
    const mv = git(root, ['mv', '--', m.from, m.to]);
    if (!mv.ok) {
      process.stderr.write(`design archive: git mv failed for ${m.from}\n${mv.stderr}`);
      return 1;
    }
    process.stdout.write(`archived: ${m.from} → ${m.to}\n`);
  }

  process.stdout.write(`archived: ${plan.moves.length} artifact(s)\n`);
  return 0;
}

const invokedDirect = /[\\/]archive-cli\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) {
  void main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`design archive: ${String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
