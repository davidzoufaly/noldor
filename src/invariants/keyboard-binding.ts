import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

import matter from 'gray-matter';

import type { Invariant, InvariantResult, InvariantViolation } from './types.js';

const ACTIVE_PHASES = ['done', 'in-progress'] as const;
const KEYBOARD_FILE = 'keyboard-shortcuts.md';
const OPT_OUT_RE = /<!--\s*keyboard:\s*not-applicable\s*-->/;

interface UiFeature {
  readonly slug: string;
  readonly file: string;
}

async function listUiFeatures(featuresDir: string): Promise<UiFeature[]> {
  const entries = await readdir(featuresDir);
  const out: UiFeature[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md')) {
      continue;
    }
    if (entry === KEYBOARD_FILE) {
      continue;
    }
    const slug = basename(entry, '.md');
    const path = join(featuresDir, entry);
    const raw = await readFile(path, 'utf8');
    const parsed = matter(raw);
    const fm = parsed.data as { area?: unknown; phase?: unknown };
    if (fm.area !== 'web') {
      continue;
    }
    if (
      typeof fm.phase !== 'string' ||
      !ACTIVE_PHASES.includes(fm.phase as (typeof ACTIVE_PHASES)[number])
    ) {
      continue;
    }
    if (OPT_OUT_RE.test(parsed.content)) {
      continue;
    }
    out.push({ file: `docs/features/${entry}`, slug });
  }
  return out;
}

/**
 * Build the keyboard-binding invariant plugin.
 *
 * @param repoRoot - Absolute path to repo root.
 * @returns Plugin instance that cross-references UI feature MDs against
 *   `docs/features/keyboard-shortcuts.md`.
 */
export function makeKeyboardBindingInvariant(repoRoot: string): Invariant {
  return {
    description: 'UI feature MDs must appear in keyboard-shortcuts.md (or opt-out)',
    name: 'keyboard-binding',
    async run(): Promise<InvariantResult> {
      const start = Date.now();
      const featuresDir = join(repoRoot, 'docs/features');
      const ksPath = join(featuresDir, KEYBOARD_FILE);
      const ksBody = await readFile(ksPath, 'utf8').catch(() => '');
      const uiFeatures = await listUiFeatures(featuresDir);
      const violations: InvariantViolation[] = [];
      for (const feat of uiFeatures) {
        const slugRe = new RegExp(`\\b${feat.slug.replace(/-/g, '[-_]')}\\b`);
        if (!slugRe.test(ksBody)) {
          violations.push({
            file: feat.file,
            message: `${feat.slug}: area:web feature absent from ${KEYBOARD_FILE} (add chord row, or mark <!-- keyboard: not-applicable -->)`,
          });
        }
      }
      return {
        invariant: 'keyboard-binding',
        violations,
        durationMs: Date.now() - start,
      };
    },
  };
}

/** Pre-built singleton using `process.cwd()` as repo root. */
export const keyboardBinding: Invariant = makeKeyboardBindingInvariant(process.cwd());
