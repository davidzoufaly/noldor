// Sibling of fd-link-rot in the FD-link-rot family. Where fd-link-rot stats an
// FD's frontmatter link *targets*, this stats the CLI *commands* a done FD
// documents in its body — verifying each still resolves against the live CLI
// surface (the `noldor` manifest ∪ package.json scripts ∪ the script catalog).
// Catches the rot where a command is renamed, moved under a new group, or
// dropped while a shipped FD keeps citing the dead invocation (e.g.
// `pnpm noldor fill-links-code-gaps` after it moved under the `features` group,
// or a stale `pnpm noldor:set-autonomous` colon form). Advisory — rides the
// sddGaps channel, never blocks a release.
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import matter from 'gray-matter';

import { MANIFEST, flattenManifest } from '../../cli/manifest.js';
import type { Gap } from '../../core/fd-load.js';

/**
 * `pnpm` sub-commands that are package-manager built-ins, not project scripts.
 * A `pnpm <builtin>` invocation in an FD is never a command-rot candidate.
 */
const PNPM_BUILTINS = new Set([
  'install',
  'i',
  'add',
  'remove',
  'rm',
  'update',
  'up',
  'run',
  'exec',
  'dlx',
  'pack',
  'publish',
  'why',
  'list',
  'ls',
  'store',
  'create',
  'link',
  'unlink',
  'import',
  'rebuild',
  'prune',
  'outdated',
  'audit',
  'patch',
  'patch-commit',
  'deploy',
  'start',
  'test',
  'config',
  'dedupe',
  'fetch',
  'env',
]);

/**
 * True when a token ends the literal-command portion of a shell invocation: a
 * flag, a shell operator/redirect, an inline comment, or anything carrying a
 * placeholder / glob / substitution char — none can be part of a command name.
 */
function isTerminator(tok: string): boolean {
  return tok.startsWith('-') || /^[&|;]/.test(tok) || /[<>{}$|()[\]#*]/.test(tok);
}

/**
 * Reduce a raw backticked shell string to the leading command tokens of a
 * `pnpm`/`noldor` invocation, or `null` when it is not one. Strips the `pnpm`
 * and `noldor` launcher words (so `pnpm noldor garden detect` →
 * `['garden','detect']`, `noldor doctor` → `['doctor']`, `pnpm release` →
 * `['release']`) and keeps literal words up to the first flag, placeholder, or
 * shell operator. Exported for unit coverage of the normalization contract.
 */
export function commandTokens(raw: string): string[] | null {
  let s = raw.trim();
  if (!/^(pnpm|noldor)\b/.test(s)) return null;
  let hadPnpm = false;
  if (/^pnpm\s+/.test(s)) {
    s = s.replace(/^pnpm\s+/, '');
    hadPnpm = true;
  }
  let tokens = s.split(/\s+/);
  if (tokens[0] === 'noldor') {
    tokens = tokens.slice(1); // drop the `noldor` launcher word (`pnpm noldor …` or bare `noldor …`)
  } else if (!hadPnpm) {
    return null; // a bare word with no launcher is not a command reference
  } else if (PNPM_BUILTINS.has(tokens[0])) {
    return null; // `pnpm install` and friends — package-manager built-in
  }
  const kept: string[] = [];
  for (const t of tokens) {
    if (isTerminator(t)) break;
    kept.push(t.toLowerCase());
  }
  return kept.length > 0 ? kept : null;
}

/**
 * The set of command strings the CLI surface currently exposes, normalized to
 * match {@link commandTokens} output. Union of three sources so every notation
 * an FD might legitimately use resolves:
 *  - the `noldor` manifest — `<group> <sub>` leaf commands plus bare group names;
 *  - `package.json` scripts — flat `pnpm <script>` forms;
 *  - the script catalog — colon-form display aliases (`### garden:detect`) and
 *    every backticked `pnpm …` / `noldor …` trigger it documents.
 * Kept permissive on purpose: a missing registry entry only risks a false
 * *negative* (an unflagged phantom), never a false positive against a real
 * command.
 */
async function buildCommandRegistry(repo: string): Promise<Set<string>> {
  const reg = new Set<string>();
  for (const leaf of flattenManifest()) reg.add(leaf.command.toLowerCase());
  for (const group of Object.keys(MANIFEST)) reg.add(group.toLowerCase());

  const pkgPath = join(repo, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const scripts = (
        JSON.parse(await readFile(pkgPath, 'utf8')) as {
          scripts?: Record<string, unknown>;
        }
      ).scripts;
      if (scripts) for (const name of Object.keys(scripts)) reg.add(name.toLowerCase());
    } catch {
      // malformed package.json is not this detector's finding
    }
  }

  const catalogPath = join(repo, 'docs', 'noldor', 'script-catalog.md');
  if (existsSync(catalogPath)) {
    const catalog = await readFile(catalogPath, 'utf8');
    // Colon-form display aliases live in `##`..`####` headings, sometimes
    // several per heading separated by ` / ` (e.g. `cr:orchestrate / cr:aggregate`).
    for (const heading of catalog.matchAll(/^#{2,4}\s+(.+)$/gm)) {
      for (const frag of heading[1].split('/')) {
        const name = frag.replace(/`/g, '').trim().toLowerCase();
        if (name && !/\s/.test(name)) reg.add(name);
      }
    }
    // Every backticked `pnpm …` / `noldor …` trigger the catalog cites.
    for (const span of catalog.matchAll(/`([^`\n]+)`/g)) {
      const tokens = commandTokens(span[1]);
      if (tokens) reg.add(tokens.join(' '));
    }
  }
  return reg;
}

/**
 * Extract every `pnpm`/`noldor` command reference from an FD body's inline-code
 * spans and fenced code blocks, as `{ display, tokens }`. Prose outside
 * backticks is ignored — command rot only matters where the FD presents
 * something as a runnable invocation.
 */
function extractCommandRefs(body: string): Array<{ display: string; tokens: string[] }> {
  const chunks: string[] = [];
  for (const span of body.matchAll(/`([^`\n]+)`/g)) chunks.push(span[1]);
  for (const block of body.matchAll(/```[\s\S]*?```/g))
    for (const line of block[0].split('\n')) chunks.push(line);
  const refs: Array<{ display: string; tokens: string[] }> = [];
  for (const chunk of chunks) {
    const tokens = commandTokens(chunk);
    if (tokens) refs.push({ display: tokens.join(' '), tokens });
  }
  return refs;
}

/**
 * True when a reference's leading tokens resolve against the registry. Checks
 * the two-token `<group> <sub>` form first, then the one-token form (a leaf
 * command, bare group, package script, or colon alias). Trailing positional
 * args never affect resolution — longest-prefix wins.
 */
function refResolves(tokens: string[], registry: Set<string>): boolean {
  if (tokens.length >= 2 && registry.has(`${tokens[0]} ${tokens[1]}`)) return true;
  return registry.has(tokens[0]);
}

/**
 * Emit a Gap per CLI command documented in a `phase: done` FD body that no
 * longer resolves against the live CLI surface (see {@link buildCommandRegistry}).
 * Only done FDs are scanned — in-progress FDs may legitimately reference
 * commands that do not exist yet. Advisory; rides the sddGaps channel.
 */
export async function detectFdCommandRot(repo: string): Promise<Gap[]> {
  const dir = join(repo, 'docs', 'features');
  if (!existsSync(dir)) return [];
  const registry = await buildCommandRegistry(repo);
  const gaps: Gap[] = [];
  for (const entry of (await readdir(dir)).toSorted()) {
    if (!entry.endsWith('.md')) continue;
    const slug = entry.slice(0, -3);
    let data: Record<string, unknown>;
    let content: string;
    try {
      const parsed = matter(await readFile(join(dir, entry), 'utf8'));
      data = parsed.data as Record<string, unknown>;
      content = parsed.content;
    } catch {
      continue; // malformed FD is `features validate`'s finding, not ours
    }
    if (data.phase !== 'done') continue;
    const seen = new Set<string>();
    for (const ref of extractCommandRefs(content)) {
      if (refResolves(ref.tokens, registry) || seen.has(ref.display)) continue;
      seen.add(ref.display);
      gaps.push({
        category: 'fd-command-rot',
        itemId: slug,
        message: `${slug}: documented command not in CLI surface (manifest/scripts/script-catalog): ${ref.display}`,
      });
    }
  }
  return gaps;
}
