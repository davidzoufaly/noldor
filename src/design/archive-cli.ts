// @tests: doc-gardening-skill
// `noldor design archive` — move THIS session's spec/plan into their sibling
// archive/ dir and leave the moves staged, so the gate's phase-flip commit
// carries them. Portable CLI: consumer repos have no ./src/ tree to import from,
// and prose-dispatch runners (codex/opencode) shell CLIs rather than run skills.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import matter from 'gray-matter';

import { loadDocRoots } from '../core/doc-roots.js';

import {
  defaultRunGit,
  discoverAddedFiles,
  repoRoot,
  resolveDefaultBase,
} from '../core/branch-added.js';
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

/**
 * `{ok, stderr}` view over core's {@link defaultRunGit} — this CLI reports git
 * failures in its own message shape rather than throwing, but the spawn handling
 * (including surfacing `spawnSync`'s `error` when git is missing) stays in one
 * place.
 */
function git(cwd: string, gitArgs: readonly string[]): { ok: boolean; stderr: string } {
  const r = defaultRunGit(cwd)(gitArgs);
  return { ok: r.status === 0, stderr: r.stderr };
}

/**
 * Rewrite any FD whose `links.design` names the moved pen artifact to its new
 * archive path, in the same staged change as the move — the docs-link gate must
 * never see a dangling target at any commit (spec U3). Scans docs/features/
 * frontmatter rather than deriving the FD from the session marker: `--slug`
 * invocations carry no session, and the scan makes attach-parent FDs work for
 * free. Returns the repo-relative FD paths rewritten (already `git add`ed).
 */
export function rewriteDesignLinks(
  root: string,
  from: string,
  to: string,
): { rewritten: string[]; failed: string[] } {
  const featuresDir = loadDocRoots(root).features;
  let entries: string[];
  try {
    entries = readdirSync(featuresDir);
  } catch {
    return { rewritten: [], failed: [] };
  }
  const rewritten: string[] = [];
  const failed: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const abs = join(featuresDir, entry);
    const raw = readFileSync(abs, 'utf8');
    const parsed = matter(raw);
    const links = (parsed.data as { links?: { design?: string } }).links;
    if (links?.design !== from) continue;
    // Targeted line replace of the frontmatter value, not matter.stringify —
    // re-serializing the whole document would reformat unrelated frontmatter.
    // Line-anchored on the `design:` KEY at its indentation so a comment or
    // unrelated line merely containing the same path can never be the match;
    // the escape keeps the path from being read as regex syntax.
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const next = raw.replace(
      new RegExp(`^(\\s*design:\\s*)(["']?)${escaped}\\2(\\s*)$`, 'm'),
      (_m, prefix: string, quote: string, tail: string) => `${prefix}${quote}${to}${quote}${tail}`,
    );
    const rel = abs
      .slice(root.length + 1)
      .split('\\')
      .join('/');
    if (next === raw) {
      // Parsed value matched but the textual form did not (exotic YAML style:
      // folded scalar, flow mapping). Never stage-and-claim a rewrite that did
      // not happen — a silent dangling link is the exact failure this exists
      // to prevent.
      process.stderr.write(
        `design archive: ${entry} declares links.design ${from} but its YAML form ` +
          `could not be rewritten textually; repoint it to ${to} by hand\n`,
      );
      failed.push(rel);
      continue;
    }
    writeFileSync(abs, next, 'utf8');
    const add = git(root, ['add', '--', rel]);
    if (!add.ok) {
      process.stderr.write(
        `design archive: git add failed for ${rel} after links.design rewrite — stage it by hand\n${add.stderr}`,
      );
      failed.push(rel);
      continue;
    }
    rewritten.push(rel);
  }
  return { rewritten, failed };
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
  } catch (error) {
    // "Not a repository" is a benign skip (a consumer running the CLI outside a
    // repo); anything else — git missing, EACCES — is a real fault the operator
    // must see rather than read as "nothing to archive here".
    const message = error instanceof Error ? error.message : String(error);
    if (/not a git repository/i.test(message)) {
      process.stderr.write('design archive: not a git repository — skipped\n');
      return 0;
    }
    process.stderr.write(`design archive: cannot resolve the repository root\n${message}\n`);
    return 1;
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
  } catch (error) {
    // Exit 0 is contractual: gate Step 4 runs this unconditionally, so a
    // non-zero here would abort end-of-flow for every consumer whose base ref
    // cannot be resolved. But the note has to be loud — a base that is broken
    // *permanently* (shallow clone, `origin/HEAD` never set) means archival
    // silently never runs at any ship, and only garden would ever file anything.
    const base = resolveDefaultBase(defaultRunGit(root));
    process.stderr.write(
      `design archive: WARNING — cannot resolve '${base}' to determine branch-added artifacts; ` +
        'skipping archival (/noldor-garden remains the backstop).\n' +
        `  reason: ${error instanceof Error ? error.message : String(error)}\n` +
        '  If this warning appears on every ship, the repo is misconfigured (unset ' +
        'refs/remotes/origin/HEAD, or a shallow clone with no merge base) and NO spec ' +
        'is being archived at done-flip.\n',
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
    if (m.kind === 'pen') {
      const links = rewriteDesignLinks(root, m.from, m.to);
      for (const fd of links.rewritten) {
        process.stdout.write(`repointed links.design: ${fd}\n`);
      }
      if (links.failed.length > 0) {
        // The pen moved but an FD still points at the old path: exiting 0 here
        // would report a clean archive while the docs-link gate is now broken.
        process.stderr.write(
          `design archive: ${links.failed.length} FD(s) still reference ${m.from} — fix by hand before committing\n`,
        );
        return 1;
      }
    }
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
