// @fd: fast-track-changes-can-obsolete-an-unattached-fd
// Advisory-with-teeth: name each FD whose owned code changed under a fast-track
// that never declared its doc impact. Never blocking — see
// `detectUndeclaredDocImpact`.

import { execFileSync } from 'node:child_process';

import { loadDocRoots } from '../../core/doc-roots.js';
import { commitsForFeature } from '../../release/release-fd-commits.js';
import { loadFdOwnership, ownersOf } from '../graph-fd-lookup.js';

/** One fast-track commit that changed an FD's code without declaring its doc impact. */
export interface UndeclaredCommit {
  readonly sha: string;
  readonly subject: string;
  /** The files it changed that the FD owns. */
  readonly files: readonly string[];
}

/** A finding for one FD, or the reason the check could not run at all. */
export type UndeclaredDocImpact =
  | {
      readonly kind: 'undeclared';
      readonly fd: string;
      readonly commits: readonly UndeclaredCommit[];
      readonly message: string;
    }
  | { readonly kind: 'unavailable'; readonly message: string };

interface WalkedCommit {
  readonly sha: string;
  readonly subject: string;
  readonly body: string;
  readonly files: readonly string[];
}

const RECORD = '\x1e';
const FIELD = '\x1f';
const FAST_TRACK_LINE = /^Noldor-Path: fast-track\s*$/m;
const DECLARATION_LINE = /^Noldor-Doc-Impact:[ \t]*(.*)$/gm;

/**
 * First-parent history, newest first. Squash merges keep each branch commit's
 * trailers only as body lines — GitHub appends `Co-authored-by:` after a
 * `---------` separator, so `git interpret-trailers` sees none of them — which
 * is why declarations are read line by line rather than through `parseTrailers`.
 */
function walkFirstParent(repo: string): WalkedCommit[] {
  const out = execFileSync(
    'git',
    [
      'log',
      '--first-parent',
      '--no-renames',
      '--name-only',
      `--format=${RECORD}%H${FIELD}%s${FIELD}%B${FIELD}`,
      'HEAD',
    ],
    { cwd: repo, encoding: 'utf8', timeout: 60_000, maxBuffer: 256 * 1024 * 1024 },
  );
  return out
    .split(RECORD)
    .filter((chunk) => chunk.trim() !== '')
    .map((chunk) => {
      const [sha = '', subject = '', body = '', files = ''] = chunk.split(FIELD);
      return { sha, subject, body, files: files.split('\n').filter(Boolean) };
    });
}

/** FD slugs a commit's `Noldor-Doc-Impact:` lines name, or `null` when it carries none. */
function declaredSlugs(body: string): Set<string> | null {
  const lines = [...body.matchAll(DECLARATION_LINE)];
  if (lines.length === 0) return null;
  return new Set(lines.flatMap((m) => (m[1] ?? '').split(',').map((slug) => slug.trim())));
}

/**
 * Report each FD whose owned code changed under a fast-track that recorded no
 * `Noldor-Doc-Impact:` declaration.
 *
 * **Floor.** Only commits newer than the oldest first-parent commit carrying a
 * declaration count, so a repo that never used the declaration is silent and
 * no date needs configuring.
 *
 * **Clearing.** A finding covers only commits newer than the FD's latest
 * record: a commit `commitsForFeature` finds (its scope names the FD, or a
 * `Noldor-FD:` line does), or one whose declaration names it. The second form
 * is what records a fast-track's own FD update, whose `docs(features:<slug>):`
 * subject sits in the squash body behind a `* ` bullet the scope grep skips.
 *
 * **Never blocking.** The caller surfaces these on their own `GardenFindings`
 * key, absent from `FINDING_CATEGORIES` in `garden-detect-runner.ts`, which
 * gates the receipt restamp and so a release. An FD whose frontmatter does not
 * parse is not reported here; `detectMalformedFds` names it in the same run.
 *
 * @param repo - Repository root
 * @returns One finding per FD, or a single `unavailable` finding when git fails
 */
export async function detectUndeclaredDocImpact(repo: string): Promise<UndeclaredDocImpact[]> {
  try {
    return await detect(repo);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return [{ kind: 'unavailable', message: `undeclared doc impact not checked: ${why}` }];
  }
}

async function detect(repo: string): Promise<UndeclaredDocImpact[]> {
  const history = walkFirstParent(repo);
  const declarations = history.map((c) => declaredSlugs(c.body));
  const floor = declarations.findLastIndex((d) => d !== null);
  if (floor === -1) return [];

  const ownership = await loadFdOwnership(loadDocRoots(repo).features);
  const undeclared = new Map<string, number[]>();
  for (let i = 0; i < floor; i += 1) {
    if (declarations[i] !== null || !FAST_TRACK_LINE.test(history[i]!.body)) continue;
    for (const owner of ownersOf(history[i]!.files, ownership)) {
      if (owner.skip === null)
        undeclared.set(owner.slug, [...(undeclared.get(owner.slug) ?? []), i]);
    }
  }

  const position = new Map(history.map((c, i) => [c.sha.slice(0, 12), i]));
  const findings: UndeclaredDocImpact[] = [];
  for (const [slug, indices] of [...undeclared].toSorted(([a], [b]) => (a < b ? -1 : 1))) {
    const recorded = [
      ...(await commitsForFeature(slug, history[floor]!.sha, 'HEAD', repo)).map(
        (c) => position.get(c.sha) ?? Number.POSITIVE_INFINITY,
      ),
      ...declarations.flatMap((d, i) => (d?.has(slug) === true ? [i] : [])),
    ];
    const latestRecord = Math.min(Number.POSITIVE_INFINITY, ...recorded);
    const commits = indices
      .filter((i) => i < latestRecord)
      .map((i) => ({
        sha: history[i]!.sha,
        subject: history[i]!.subject,
        files: ownersOf(history[i]!.files, ownership).find((o) => o.slug === slug)?.files ?? [],
      }));
    if (commits.length > 0)
      findings.push({ kind: 'undeclared', fd: slug, commits, message: message(slug, commits) });
  }
  return findings;
}

function message(slug: string, commits: readonly UndeclaredCommit[]): string {
  const list = commits.map((c) => `${c.sha.slice(0, 7)} ${c.subject}`).join('; ');
  return (
    `${slug}: owned code changed in ${String(commits.length)} fast-track commit(s) with no ` +
    `Noldor-Doc-Impact declaration (${list}) — check docs/features/${slug}.md's Usage against ` +
    `them, then update it, or commit <!-- noldor:usage-checked ${commits[0]!.sha.slice(0, 12)} --> ` +
    `under its ## Usage as docs(features:${slug}): Usage checked against ${commits[0]!.sha.slice(0, 12)}`
  );
}
