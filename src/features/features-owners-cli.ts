// @fd: fast-track-changes-can-obsolete-an-unattached-fd
// `noldor features owners [--base <ref> | --path <file>...] [--json]` — the FDs
// that own a branch's changed files, which gate Step 4 reads before a fast-track
// ships to decide whose Usage the change may have outdated.

import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

import { runIfDirect } from '../core/cli-entry.js';
import { loadDocRoots } from '../core/doc-roots.js';
import { loadFdOwnership, ownersOf, type PathOwner } from '../garden/graph-fd-lookup.js';

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const USAGE = 'usage: noldor features owners [--base <ref> | --path <file>...] [--json]';
const GIT_TIMEOUT_MS = 30_000;

type ChangedPaths = { ok: true; paths: string[] } | { ok: false; error: string };

/**
 * Files changed on this branch since it left `base` — the three-dot form, so a
 * `base` that moved on since the fork does not count its own commits as ours.
 * `--no-renames` lists both sides of a rename, and either side may be owned.
 */
function changedSince(base: string, cwd: string): ChangedPaths {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${base}^{commit}`], {
      cwd,
      stdio: 'ignore',
      timeout: GIT_TIMEOUT_MS,
    });
  } catch {
    return { ok: false, error: `cannot resolve base ref '${base}'` };
  }
  try {
    const out = execFileSync('git', ['diff', '--name-only', '--no-renames', `${base}...HEAD`], {
      cwd,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, paths: out.split('\n').filter(Boolean) };
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `git diff against '${base}' failed: ${why}` };
  }
}

function render(owners: readonly PathOwner[], pathCount: number): string {
  if (owners.length === 0) return `no FD owns any of the ${String(pathCount)} path(s)\n`;
  const lines = owners.flatMap((o) => [
    `${o.slug} — ${o.skip === null ? 'candidate' : `skip: ${o.skip}`} (${o.phase})`,
    ...o.files.map((f) => `  ${f}`),
  ]);
  return `${lines.join('\n')}\n`;
}

async function main(argv: readonly string[]): Promise<number> {
  let values: { base?: string; path?: string[]; json?: boolean };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        base: { type: 'string' },
        path: { type: 'string', multiple: true },
        json: { type: 'boolean' },
      },
      strict: true,
    }));
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    process.stderr.write(`features owners: ${why}\n${USAGE}\n`);
    return EXIT_USAGE;
  }
  if (values.base !== undefined && values.path !== undefined) {
    process.stderr.write(`features owners: --base and --path are exclusive\n${USAGE}\n`);
    return EXIT_USAGE;
  }

  const cwd = process.cwd();
  const base = values.path === undefined ? (values.base ?? 'origin/main') : null;
  const changed: ChangedPaths =
    base === null ? { ok: true, paths: values.path ?? [] } : changedSince(base, cwd);
  if (!changed.ok) {
    process.stderr.write(`features owners: ${changed.error}\n`);
    return EXIT_USAGE;
  }

  const ownership = await loadFdOwnership(loadDocRoots(cwd).features);
  if (ownership.unparseable.length > 0) {
    process.stderr.write(
      `features owners: frontmatter does not parse, so the owner list would be incomplete: ${ownership.unparseable
        .map((name) => `docs/features/${name}`)
        .join(', ')} — run \`pnpm noldor validate features\`\n`,
    );
    return EXIT_USAGE;
  }

  const owners = ownersOf(changed.paths, ownership);
  process.stdout.write(
    values.json === true
      ? `${JSON.stringify({ base, paths: changed.paths, owners }, null, 2)}\n`
      : render(owners, changed.paths.length),
  );
  return EXIT_OK;
}

runIfDirect('features-owners-cli', 'features owners', main);
