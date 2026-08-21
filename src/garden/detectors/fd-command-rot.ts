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
 * Emit a Gap per CLI command documented in a `phase: done` FD body that no
 * longer resolves against the live CLI surface (see `buildCommandRegistry`).
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
