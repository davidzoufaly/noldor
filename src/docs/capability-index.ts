// @fd: validate-script-catalog-gate
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { MANIFEST, type Group } from '../cli/manifest.js';
import { runIfDirect } from '../core/cli-entry.js';

// Both copies: the repo's own agent-rules file and the template every consumer
// scaffolds and `doctor` diffs against. A file that is absent is skipped — a
// claude-only consumer carries no AGENTS.md.
const TARGETS = ['AGENTS.md', 'templates/AGENTS.md'] as const;

const START = '<!-- noldor:capabilities:start -->';
const END = '<!-- noldor:capabilities:end -->';

/**
 * The always-read capability index: one line per `pnpm noldor` verb group with
 * its subcommands, rendered from the CLI manifest so it cannot drift from what
 * the CLI actually ships. Descriptions are the manifest's group `desc`; the
 * per-command detail stays in `docs/noldor/script-catalog.md`, which keeps the
 * block small enough to sit in every agent's context.
 */
export function renderCapabilityIndex(manifest: Record<string, Group> = MANIFEST): string {
  const lines = Object.entries(manifest).map(([group, { desc, subs }]) => {
    const names = Object.keys(subs).filter((s) => s !== '');
    const summary = desc.replace(/\.$/, '');
    return names.length === 0
      ? `- \`${group}\` — ${summary}`
      : `- \`${group}\` — ${summary}: ${names.join(', ')}`;
  });
  return [
    START,
    '',
    '## Capability index',
    '',
    'Every `pnpm noldor` verb group and its subcommands, generated from the CLI manifest',
    '(`pnpm noldor docs capability-index --write`; do not edit by hand). Check here before',
    'building something by hand — the framework may already ship it. Per-command inputs,',
    'outputs and exit codes: `docs/noldor/script-catalog.md`.',
    '',
    ...lines,
    '',
    END,
  ].join('\n');
}

/**
 * `doc` with its marker block replaced by `index`, or `null` when `doc` carries
 * no well-formed block — the caller decides whether that is an error.
 */
export function replaceCapabilityIndex(doc: string, index: string): string | null {
  const start = doc.indexOf(START);
  const end = doc.indexOf(END, start);
  if (start === -1 || end === -1) return null;
  return doc.slice(0, start) + index + doc.slice(end + END.length);
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

/**
 * Check (default) or `--write` the capability index in every present target.
 * Exit 0 = current (or rewritten); 1 = stale or missing block, with the remedy.
 */
export async function main(argv: readonly string[], cwd = process.cwd()): Promise<number> {
  const write = argv.includes('--write');
  const index = renderCapabilityIndex();
  let failed = false;
  for (const rel of TARGETS) {
    const doc = await readIfPresent(join(cwd, rel));
    if (doc === null) continue;
    const next = replaceCapabilityIndex(doc, index);
    if (next === null) {
      console.error(`✗ ${rel}: no ${START} … ${END} block — add the markers, then --write`);
      failed = true;
    } else if (next !== doc) {
      if (write) {
        await writeFile(join(cwd, rel), next);
        console.log(`capability-index: rewrote ${rel}`);
      } else {
        console.error(
          `✗ ${rel}: capability index is stale — run \`pnpm noldor docs capability-index --write\``,
        );
        failed = true;
      }
    }
  }
  return failed ? 1 : 0;
}

runIfDirect('capability-index', 'capability-index', main);
