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
    if (flag === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (flag === '--slug') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return { error: 'missing value: --slug' };
      // An empty key would resolve to nothing and print the benign "nothing to
      // do" line — invalid input must not read as success.
      if (value.trim().length === 0) return { error: 'empty value: --slug' };
      // Trim what we store too: a padded key would silently match nothing.
      args.slug = value.trim();
      i += 1;
      continue;
    }
    return { error: `unknown flag: ${flag}` };
  }
  return args;
}

function git(cwd: string, gitArgs: readonly string[]): { ok: boolean; stderr: string } {
  const r = spawnSync('git', gitArgs, { cwd, encoding: 'utf8' });
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
    let session;
    try {
      session = readSession(root);
    } catch {
      // Schema-invalid / corrupt marker: report it in the same shape as the
      // other error paths rather than letting a raw ZodError escape.
      process.stderr.write(
        'design archive: .noldor/session.json is unreadable — re-run /noldor-gate to rewrite the marker\n',
      );
      return 1;
    }
    if (session === null) {
      process.stderr.write(
        'design archive: no .noldor/session.json — did you skip the gate scaffold?\n',
      );
      return 1;
    }
    const derived = dialogueKeyFromSession(session);
    if (derived.kind === 'none') {
      process.stdout.write(
        `design archive: path ${session.path} carries no design artifacts — skipped\n`,
      );
      return 0;
    }
    if (derived.kind === 'invalid') {
      // The path DOES own artifacts; the marker just cannot name them. Saying
      // "carries no design artifacts" here would be a lie that reads as success.
      process.stderr.write(
        `design archive: session marker for path ${session.path} is missing ${derived.missing} — ` +
          're-run /noldor-gate to rewrite the marker\n',
      );
      return 1;
    }
    key = derived.key;
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
  if (plan.moves.length === 0 && plan.skipped.length === 0) {
    // Say WHY nothing matched: the common benign case is a spec committed on an
    // earlier branch (a specs-only session shipped it; a later session flips the
    // phase), which is never branch-added here and is garden's to archive.
    process.stdout.write(
      `design archive: no artifacts matching ${key} added on this branch — nothing to do ` +
        `(already archived, or committed on an earlier branch: /noldor-garden owns those)\n`,
    );
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

  let moved = 0;
  for (const m of plan.moves) {
    mkdirSync(dirname(join(root, m.to)), { recursive: true });
    // `git mv` (not fs rename): it preserves rename detection AND stages both
    // halves, so the gate's flip commit carries the move without ever naming an
    // artifact directory. Every eligible artifact is tracked by construction —
    // `branchAdded` is derived from commits — so there is no untracked branch to
    // fall back to; an untracked artifact simply is not eligible.
    const mv = git(root, ['mv', '--', m.from, m.to]);
    if (!mv.ok) {
      const stderr =
        mv.stderr.endsWith('\n') || mv.stderr.length === 0 ? mv.stderr : `${mv.stderr}\n`;
      process.stderr.write(
        `design archive: git mv failed for ${m.from}\n${stderr}` +
          (moved > 0
            ? `design archive: ${moved} earlier move(s) are already staged — unstage or finish them by hand\n`
            : ''),
      );
      return 1;
    }
    moved += 1;
    process.stdout.write(`archived: ${m.from} → ${m.to}\n`);
  }

  // Name the collision count in the tail line: a caller reading only the last
  // line must not read "archived: 0 artifact(s)" as clean success when an
  // artifact was left behind because the archive already holds that basename.
  const tail =
    plan.skipped.length > 0
      ? `archived: ${plan.moves.length} artifact(s), ${plan.skipped.length} skipped (already in archive — resolve by hand)\n`
      : `archived: ${plan.moves.length} artifact(s)\n`;
  process.stdout.write(tail);
  return 0;
}

const invokedDirect = /[\\/]archive-cli\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) {
  void main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      // Keep the stack: an unexpected throw here (e.g. loadDocRoots) is a bug
      // report, not a usage error, and a bare one-liner loses the trail.
      process.stderr.write(
        `design archive: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      process.exitCode = 1;
    },
  );
}
