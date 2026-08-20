// @fd: root-readme-content-validator
import { lstat, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { flattenManifest } from '../cli/manifest.js';
import { toPosixRelative } from '../core/repo-paths.js';

import { extractLinks, walkMd } from './docs-check.js';

/**
 * Directories one level under `docs/` that hold per-change workflow artifacts —
 * one file per feature, spec or plan — rather than pages a reader navigates.
 *
 * An explicit constant, deliberately NOT derived from `loadDocRoots()`: that
 * accessor also names `adr`, `architecture` and `milestones`, so deriving from
 * it would exclude the very surfaces this check exists to catch. `docs/assets`
 * needs no entry — it holds no markdown, so the predicate below drops it.
 *
 * `superpowers` is the pre-1.0.0 home of plans and specs, still resolved by
 * `resolveDesignSubdir` (`src/core/doc-roots.ts`) for a consumer who bumped the
 * package but has not run `noldor upgrade`. Without it such a repo enrols
 * `docs/superpowers/` as a surface and gets a permanent finding demanding a
 * README link to an artifact directory — the adoption noise this feature's
 * advisory posture exists to avoid. Delete this member together with that
 * transition alias (tracked by Q-0006).
 */
const ARTIFACT_DIRS: ReadonlySet<string> = new Set(['features', 'design', 'superpowers']);

/**
 * Every documentation surface: a directory one level under `docs/` that holds
 * markdown and is not an artifact directory. Auto-enrolling by construction —
 * a new surface needs no registration to be checked.
 *
 * Walks `docs/` once via the shared {@link walkMd}, rather than once per
 * candidate directory, and inherits its `node_modules` / `dist` / `coverage`
 * exclusions and its design-archive exemptions (which is why `rel` is `'docs'`).
 *
 * @param cwd - Repository root
 * @returns Repo-relative POSIX dirs, sorted
 */
export async function enumerateDocSurfaces(cwd: string): Promise<readonly string[]> {
  const docsDir = join(cwd, 'docs');
  const hits: string[] = [];
  try {
    // `walkMd` throws on ENOENT — this catch is what makes a repo with no
    // `docs/` report no surfaces instead of failing the check.
    await walkMd(docsDir, hits, 'docs');
  } catch {
    return [];
  }

  const surfaces = new Set<string>();
  for (const hit of hits) {
    if (!hit.endsWith('.md')) continue;
    const rel = toPosixRelative(docsDir, hit);
    const segment = rel.split('/')[0];
    if (segment === undefined || segment === '') continue;
    // A `.md` directly in `docs/` belongs to no surface directory.
    if (rel === segment) continue;
    if (ARTIFACT_DIRS.has(segment)) continue;
    surfaces.add(`docs/${segment}`);
  }
  return [...surfaces].toSorted();
}

/** What the README link graph reaches. */
export interface ReachSet {
  /**
   * Repo-relative POSIX paths of every reached **markdown** file. Non-markdown
   * targets are never recorded: they cannot satisfy a documentation surface and
   * are not traversed, so keeping them would let an image link mark a surface
   * reachable.
   */
  readonly files: ReadonlySet<string>;
  /** Dirs reached directly by a directory-target link. */
  readonly dirs: ReadonlySet<string>;
  /** Operational degradations encountered during the walk. Never findings. */
  readonly notes: readonly string[];
  /**
   * Readability of the seed. The walk is the single place `README.md` is read,
   * so it is the single place this is decided; the façade maps it to a status
   * rather than re-deriving it from a second read.
   */
  readonly readme: 'ok' | 'missing' | 'unreadable';
  /**
   * The seed body, `''` unless `readme === 'ok'`. Carried so no caller re-reads
   * the file: a second read is not merely wasteful, it can fail after the first
   * succeeded (deleted or chmod-ed in between) and reject a promise this
   * module's contract says never rejects on expected I/O.
   */
  readonly body: string;
}

/**
 * Surfaces no README link reaches. A surface is satisfied by a direct
 * directory link, or by any reached markdown file at or beneath it.
 *
 * @param surfaces - From {@link enumerateDocSurfaces}
 * @param reached - From `reachableTargets`
 * @returns The unreachable subset, input order preserved
 */
export function unreachableSurfaces(
  surfaces: readonly string[],
  reached: ReachSet,
): readonly string[] {
  return surfaces.filter((surface) => {
    if (reached.dirs.has(surface)) return false;
    for (const file of reached.files) {
      if (file === surface || file.startsWith(`${surface}/`)) return false;
    }
    return true;
  });
}

/**
 * Every markdown file and directory the README link graph reaches, to a
 * fixpoint over a visited set so link cycles terminate.
 *
 * Eligibility is whatever {@link extractLinks} yields — it already strips code
 * regions and drops external and root-absolute hrefs, so this check's notion of
 * "a link" is identical to the one `docs check` enforces. That matters: the
 * surfaces this check exists to catch are named in the rule pages only inside
 * prose backticks, and counting those would make the check green while the
 * reader still has no route.
 *
 * Every failure is contained: a broken link is `docs check`'s finding and is
 * skipped silently, and every other error becomes a note. Nothing throws.
 *
 * Each body is read when its path is dequeued and then dropped, so the walk
 * holds one body at a time rather than every visited file's. The trade-off is
 * that a read failure is attributed to the unreadable file rather than to the
 * link that led there.
 *
 * @param cwd - Repository root
 * @returns Reached markdown files, directly-linked dirs, degradations, and the
 *   seed's readability plus its body
 */
export async function reachableTargets(cwd: string): Promise<ReachSet> {
  const files = new Set<string>();
  const dirs = new Set<string>();
  const notes: string[] = [];
  const visited = new Set<string>(['README.md']);
  const queue: string[] = ['README.md'];
  let readme: ReachSet['readme'] = 'ok';
  let seedBody = '';

  while (queue.length > 0) {
    const from = queue.shift() as string;

    let body: string;
    try {
      body = await readFile(join(cwd, from), 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (from === 'README.md') {
        readme = code === 'ENOENT' ? 'missing' : 'unreadable';
        if (readme === 'unreadable') {
          notes.push(`cannot read README.md: ${code ?? 'unknown'}`);
        }
        break; // no seed, nothing to walk
      }
      notes.push(`cannot read ${from}: ${code ?? 'unknown'}`);
      continue;
    }
    if (from === 'README.md') seedBody = body;

    for (const link of extractLinks(body)) {
      const withoutFragment = link.href.split('#')[0] ?? '';
      const bare = withoutFragment.split('?')[0] ?? '';
      if (bare === '') continue;

      let decoded: string;
      try {
        decoded = decodeURIComponent(bare);
      } catch {
        // URIError, not a filesystem error — it would otherwise escape the
        // handling below and crash the walk this contract exists to protect.
        notes.push(`${from}:${link.line}: malformed percent-escape in ${bare} — link skipped`);
        continue;
      }

      const abs = resolve(join(cwd, dirname(from)), decoded);
      const target = toPosixRelative(cwd, abs);
      if (target === '' || target.startsWith('..')) continue; // escapes the repo root

      let stats;
      try {
        stats = await lstat(abs);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        // ENOENT is a broken link — `docs check`'s finding, not this one's.
        if (code !== 'ENOENT') {
          notes.push(`${from}:${link.line}: cannot stat ${target}: ${code ?? 'unknown'}`);
        }
        continue;
      }

      if (stats.isSymbolicLink()) continue; // not followed
      if (stats.isDirectory()) {
        dirs.add(target);
        continue;
      }
      if (!target.endsWith('.md')) continue; // cannot satisfy a surface

      files.add(target);
      if (visited.has(target)) continue;
      visited.add(target);
      queue.push(target); // read at dequeue — no body is retained
    }
  }

  return { files, dirs, notes, readme, body: seedBody };
}

export type ReadmeStatus = 'absent' | 'ok' | 'findings';

/** One thing the README claims, or fails to say, that does not hold. */
export interface Finding {
  readonly message: string;
}

/** What `checks readme` found, shaped for both the CLI and `docSurfaceRow`. */
export interface ReadmeReport {
  readonly status: ReadmeStatus;
  readonly findings: readonly Finding[];
  /** Degradations: what could not be checked, and why. Never findings. */
  readonly notes: readonly string[];
}

/**
 * Run the README checks over `cwd`.
 *
 * Never rejects for an EXPECTED failure — I/O errors, parse errors and
 * malformed input each degrade to a note and the rest of the check continues.
 * Programmer errors are deliberately not caught: swallowing one would hide a
 * defect behind a green release row. `notes` never affect `status`, so a
 * degraded run reports its degradation rather than masquerading as a failure.
 *
 * @param cwd - Repository root
 * @returns The report; `absent` when there is no readable README
 */
export async function checkReadme(cwd: string = process.cwd()): Promise<ReadmeReport> {
  // The walk is the single place README.md is read, and the single place its
  // readability is decided — so absence is classified there, not re-derived,
  // and the body it already read is reused rather than fetched again.
  const reached = await reachableTargets(cwd);
  if (reached.readme !== 'ok') {
    return { status: 'absent', findings: [], notes: [...reached.notes] };
  }

  const notes: string[] = [...reached.notes];
  let scriptNames: ReadonlySet<string> | null = null;
  try {
    const parsed = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    // An absent `scripts` map means the valid script set is EMPTY, not unknown.
    scriptNames = new Set(Object.keys(parsed.scripts ?? {}));
  } catch {
    notes.push('root package.json missing or invalid — script resolution skipped');
  }

  const manifestCommands = new Set(flattenManifest().map((leaf) => leaf.command));
  const commandFindings = resolveCommands(
    parseReadmeCommands(reached.body),
    manifestCommands,
    scriptNames,
  );

  const surfaceFindings = unreachableSurfaces(await enumerateDocSurfaces(cwd), reached).map(
    (surface) => ({
      message: `${surface}/ holds documentation but no link from README.md reaches it`,
    }),
  );

  const findings = [...commandFindings, ...surfaceFindings];
  return { status: findings.length > 0 ? 'findings' : 'ok', findings, notes };
}

/** Leading shell prompt in a documented command. */
const PROMPT_RE = /^\s*[$>]\s+/;
/** A token documenting a shape rather than an invocation, e.g. `<slug>`. */
const PLACEHOLDER_RE = /[<>]/;
const INLINE_CODE_RE = /`([^`]+)`/g;
const FENCE_RE = /^\s*```/;

/** One command as written in the README. */
export interface QuotedCommand {
  /** The command as written, for diagnostics. */
  readonly raw: string;
  /** Whitespace-split tokens, prompt prefix and comment removed. */
  readonly argv: readonly string[];
  /** 1-based line in `README.md`. */
  readonly line: number;
}

/**
 * Lex every `pnpm` command the README quotes, from fenced blocks and inline
 * code alike.
 *
 * Deliberately MANIFEST-unaware: it cannot know whether the token after a group
 * is a subcommand or a positional argument, so it does not try. Resolution owns
 * that, reading the manifest's own shape.
 *
 * @param content - Raw `README.md` body
 * @returns One entry per lexed `pnpm` command, in document order
 */
export function parseReadmeCommands(content: string): readonly QuotedCommand[] {
  const out: QuotedCommand[] = [];

  const emit = (text: string, line: number): void => {
    const commentIndex = text.indexOf('#');
    const withoutComment = commentIndex === -1 ? text : text.slice(0, commentIndex);
    for (const piece of withoutComment.replace(PROMPT_RE, '').split(/&&|\|\||;|\|/)) {
      const argv = piece
        .trim()
        .split(/\s+/)
        .filter((t) => t.length > 0);
      if (argv[0] !== 'pnpm') continue;
      if (argv.some((t) => PLACEHOLDER_RE.test(t))) continue;
      out.push({ raw: piece.trim(), argv, line });
    }
  };

  const lines = content.split('\n');
  let inFence = false;
  let pending = '';
  let pendingLine = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      pending = '';
      continue;
    }
    if (inFence) {
      const trimmed = line.replace(/\s+$/, '');
      if (trimmed.endsWith('\\')) {
        if (pending === '') pendingLine = i + 1;
        pending += `${trimmed.slice(0, -1)} `;
        continue;
      }
      const at = pending === '' ? i + 1 : pendingLine;
      const full = pending + line;
      pending = '';
      emit(full, at);
      continue;
    }
    const re = new RegExp(INLINE_CODE_RE.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(line)) !== null) {
      emit(match[1] ?? '', i + 1);
    }
  }

  return out;
}

/**
 * `pnpm` verbs whose arguments are package specifiers or external binaries
 * rather than repo-owned names, so nothing local can resolve them.
 */
const PM_PASSTHROUGH: ReadonlySet<string> = new Set(['add', 'install', 'dlx', 'exec']);

/**
 * Resolve every lexed command against the manifest and the root scripts.
 *
 * Direction is README → registry only: a manifest entry the README never
 * mentions is not a finding, because `## CLI reference` declares itself a
 * non-exhaustive subset.
 *
 * The group branch reads the manifest's own leaf/group shape rather than
 * falling back from a longest match — a fallback cannot tell a positional
 * argument from a mistyped subcommand, and this can.
 *
 * @param cmds - From {@link parseReadmeCommands}
 * @param manifestCommands - `flattenManifest()` leaf command strings
 * @param scriptNames - Root script names; empty means none declared, `null`
 *   means the source was unavailable and script resolution is skipped
 * @returns One finding per distinct unresolved command, citing its first line
 */
export function resolveCommands(
  cmds: readonly QuotedCommand[],
  manifestCommands: ReadonlySet<string>,
  scriptNames: ReadonlySet<string> | null,
): readonly Finding[] {
  const leafGroups = new Set<string>();
  const subGroups = new Set<string>();
  for (const command of manifestCommands) {
    const space = command.indexOf(' ');
    if (space === -1) leafGroups.add(command);
    else subGroups.add(command.slice(0, space));
  }

  const findings: Finding[] = [];
  const seen = new Set<string>();
  const report = (key: string, message: string): void => {
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ message });
  };

  for (const cmd of cmds) {
    const words = cmd.argv.filter((t) => !t.startsWith('-'));
    const verb = words[1];
    if (verb === undefined || PM_PASSTHROUGH.has(verb)) continue;
    const at = `README.md:${cmd.line}`;

    if (verb === 'run') {
      const name = words[2];
      if (name === undefined || scriptNames === null) continue;
      if (!scriptNames.has(name)) {
        report(`run ${name}`, `${at}: \`pnpm run ${name}\` — no such script in root package.json`);
      }
      continue;
    }

    if (verb === 'noldor') {
      const group = words[2];
      if (group === undefined) continue; // `pnpm noldor --help`
      const sub = words[3];
      if (subGroups.has(group)) {
        if (sub === undefined) {
          report(`noldor ${group}`, `${at}: \`pnpm noldor ${group}\` — needs a subcommand`);
        } else if (!manifestCommands.has(`${group} ${sub}`)) {
          report(
            `noldor ${group} ${sub}`,
            `${at}: \`pnpm noldor ${group} ${sub}\` — no such subcommand`,
          );
        }
        continue;
      }
      if (leafGroups.has(group)) continue; // any further token is a positional
      report(`noldor ${group}`, `${at}: \`pnpm noldor ${group}\` — no such command group`);
      continue;
    }

    if (scriptNames === null) continue;
    if (!scriptNames.has(verb)) {
      report(`script ${verb}`, `${at}: \`pnpm ${verb}\` — no such script in root package.json`);
    }
  }

  return findings;
}
