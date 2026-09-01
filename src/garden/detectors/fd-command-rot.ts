// Sibling of fd-link-rot in the FD-link-rot family. Where fd-link-rot stats an
// FD's frontmatter link *targets*, this stats the CLI *commands* a done FD
// documents in its body — verifying each still resolves against the live CLI
// surface (the `noldor` manifest ∪ package.json scripts ∪ the script catalog).
// Catches the rot where a command is renamed, moved under a new group, or
// dropped while a shipped FD keeps citing the dead invocation (e.g.
// `pnpm noldor fill-links-code-gaps` after it moved under the `features` group,
// or a stale `pnpm noldor:set-autonomous` colon form). Advisory — rides the
// sddGaps channel, never blocks a release.
//
// A line carrying `noldor-fd-command-rot-ignore` contributes no references, the
// twin of `skill-code-drift`'s `noldor-skill-drift-ignore` — see
// `FD_COMMAND_ROT_IGNORE_MARKER` below.
//
// The resolution helpers (`commandTokens`, `buildCommandRegistry`,
// `extractCommandRefs`, `refResolves`) live in `src/cli/command-registry.ts`,
// shared with the README command check (Q-0148).
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import matter from 'gray-matter';

import {
  buildCommandRegistry,
  extractCommandRefs,
  refResolves,
} from '../../cli/command-registry.js';
import type { Gap } from '../../core/fd-load.js';

/**
 * Lines carrying this marker (conventionally `<!-- noldor-fd-command-rot-ignore -->`
 * at end of line, or alone on the preceding line) contribute no command
 * references. The affordance exists because a done FD's Summary routinely
 * quotes a *rejected* design option — `portable-gate-entrypoint-for-non-claude-runners`
 * cites "(a) a portable `noldor gate --drain <slug>` CLI entrypoint" as the road
 * not taken — and the extractor cannot tell a road not taken from a live
 * invocation. Without the marker the only fix is to de-backtick the prose,
 * degrading the FD to satisfy a detector. Twin of `SKILL_DRIFT_IGNORE_MARKER`
 * in `skill-code-drift.ts`; deliberately verbose so each use site is greppable
 * and self-documenting.
 */
export const FD_COMMAND_ROT_IGNORE_MARKER = 'noldor-fd-command-rot-ignore';

/**
 * Blank every line the ignore marker covers, preserving the line count so the
 * body still parses identically for {@link extractCommandRefs} — which reads
 * fenced blocks as ```-delimited spans.
 *
 * A fence delimiter is never blanked: a marker alone on the line before an
 * opening ``` would otherwise erase the opener, invert every fence boundary
 * after it, and silently change what the rest of the FD extracts. Put the
 * marker on the offending command line inside the fence instead.
 */
function stripIgnoredLines(body: string): string {
  const lines = body.split('\n');
  const markerAlone = `<!-- ${FD_COMMAND_ROT_IGNORE_MARKER} -->`;
  return lines
    .map((line, i) => {
      if (line.trimStart().startsWith('```')) return line;
      if (line.includes(FD_COMMAND_ROT_IGNORE_MARKER)) return '';
      if (i > 0 && lines[i - 1]!.trim() === markerAlone) return '';
      return line;
    })
    .join('\n');
}

/**
 * Emit a Gap per CLI command documented in a `phase: done` FD body that no
 * longer resolves against the live CLI surface (see `buildCommandRegistry`).
 * Only done FDs are scanned — in-progress FDs may legitimately reference
 * commands that do not exist yet. Lines covered by
 * {@link FD_COMMAND_ROT_IGNORE_MARKER} are excluded. Advisory; rides the
 * sddGaps channel.
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
    for (const ref of extractCommandRefs(stripIgnoredLines(content))) {
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
