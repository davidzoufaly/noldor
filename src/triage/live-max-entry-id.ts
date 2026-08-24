// @fd: stable-entry-ids-for-roadmap-backlog

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadDocRoots } from '../core/doc-roots.js';
import { parseBacklog, parseRoadmap } from '../utils/parse-blocks.js';
import { ENTRY_ID_RE, featureEntryIds } from './entry-id.js';
import { RETIRED_IDS_PATH_DEFAULT, loadRetiredIds } from './retired-ids.js';

/** Sequence number of a well-formed entry ID, or 0 for anything else. */
function seq(id: unknown): number {
  return typeof id === 'string' && ENTRY_ID_RE.test(id) ? Number(id.slice(2)) : 0;
}

/**
 * Highest entry-ID sequence number already taken anywhere in the repo — the
 * recomputed truth that `.noldor/id-counter.json` is only a cache of. Every
 * place an ID comes to rest is scanned: live roadmap and backlog blocks, FD
 * `entry-id:` frontmatter (promotion moves the ID off the queue and into the
 * FD), and the retired-ID map (the no-FD retirement paths keep the number
 * resolvable, so it stays taken). Returns 0 when the repo holds no IDs at all.
 *
 * This exists because the counter is maintained state with many mutation sites
 * and drifts: on 2026-08-23 `triage mint-id` handed out `Q-0153` while
 * `Q-0153` was live on a backlog entry, and the collision only surfaced later
 * as `validate:triage`'s `duplicate-entry-id` — after the block was written.
 * Flooring the counter here makes drift self-healing rather than a hand repair.
 *
 * Missing files are simply absent IDs (an adopting repo may have no queue docs
 * at all); a malformed `- id:` contributes nothing, because the block parser
 * accepts any string there and one typo must not float the floor to infinity.
 * A *corrupt* retired-ID map still throws, via {@link loadRetiredIds} — the
 * same fail-loud posture the counter itself takes, since silently reading it as
 * empty is exactly how a taken number gets re-minted.
 *
 * @param repoRoot - Repo root; queue docs and the retired map resolve under it.
 */
export function liveMaxEntryId(repoRoot: string): number {
  const roots = loadDocRoots(repoRoot);
  let max = 0;

  for (const [path, parse] of [
    [roots.roadmap, parseRoadmap],
    [roots.backlog, parseBacklog],
  ] as const) {
    if (!existsSync(path)) continue;
    for (const e of parse(readFileSync(path, 'utf8'))) max = Math.max(max, seq(e.id));
  }

  for (const fd of featureEntryIds(roots.features)) max = Math.max(max, seq(fd.id));

  const retiredPath = join(repoRoot, RETIRED_IDS_PATH_DEFAULT);
  if (existsSync(retiredPath)) {
    for (const id of Object.keys(loadRetiredIds(retiredPath))) max = Math.max(max, seq(id));
  }

  return max;
}
