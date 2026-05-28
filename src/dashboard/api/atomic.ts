import { rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/**
 * Write `content` to `target` via a sibling tmp file + atomic POSIX rename.
 *
 * On same-filesystem rename, this is atomic — concurrent readers see either
 * the old content or the new content, never a half-written file. Bubbles any
 * underlying error to the caller; the tmp file is intentionally left in place
 * on rename failure so a postmortem can inspect it.
 *
 * The tmp file is named `<basename>.tmp.<pid>` in the same directory as the
 * target. PID-scoping keeps the path stable enough to identify the partial
 * write while still being unique per dashboard-server process.
 */
export async function atomicWriteFile(target: string, content: string): Promise<void> {
  const tmp = join(dirname(target), `${basename(target)}.tmp.${process.pid}`);
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, target);
}
