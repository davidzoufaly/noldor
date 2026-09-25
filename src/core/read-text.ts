// @fd: feature-pen-coverage-from-acceptance-criteria, architecture-design-phase

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { errMessage } from './err-message.js';

/** A repo file's UTF-8 text, or why it could not be read, prefixed with its repo-relative path. */
export function readRepoText(
  cwd: string,
  rel: string,
): { ok: true; text: string } | { ok: false; error: string } {
  try {
    return { ok: true, text: readFileSync(join(cwd, rel), 'utf8') };
  } catch (err) {
    return { ok: false, error: `${rel}: ${errMessage(err)}` };
  }
}
