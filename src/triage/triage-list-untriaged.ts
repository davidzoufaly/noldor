import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const HEADING_RE = /^(#{2,4})\s+(.+)$/;
const TOP_LEVEL_BULLET_RE = /^-\s+(.+)$/;
const TRIAGED_MARKER_RE = /\[triaged\s+\d{4}-\d{2}-\d{2}\s+→/;

const TRIAGE_TOP_SECTION = 'Verticals';
const TRIAGE_PHASE_ALLOWLIST = new Set(['Now', 'Next', 'Later']);

/**
 * One untriaged bullet from `ideas.md` paired with its 1-based line number.
 */
export interface Untriaged {
  line: number;
  text: string;
}

/**
 * Walk an `ideas.md` body and return top-level bullets that are triage
 * candidates: bullets nested under `## Verticals → #### Now|Next|Later`
 * without a `[triaged …]` marker. Bullets in `#### Done`, header notes
 * above `## Verticals`, and bullets under `## In Progress` / `## Not
 * groomed` are deliberately ignored — they are not triage material.
 *
 * @param content - Raw `ideas.md` contents
 * @returns Each candidate bullet's text + 1-based line number
 */
export function extractUntriagedBullets(content: string): Untriaged[] {
  const out: Untriaged[] = [];
  const lines = content.split('\n');
  let topLevel: string | null = null;
  let phase: string | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';

    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      const hashes = headingMatch[1] ?? '';
      const title = (headingMatch[2] ?? '').trim();
      if (hashes === '##') {
        topLevel = title;
        phase = null;
      } else if (hashes === '###') {
        phase = null;
      } else if (hashes === '####') {
        phase = title;
      }
      continue;
    }

    const bulletMatch = line.match(TOP_LEVEL_BULLET_RE);
    if (!bulletMatch) {
      continue;
    }
    if (TRIAGED_MARKER_RE.test(line)) {
      continue;
    }
    if (topLevel !== TRIAGE_TOP_SECTION) {
      continue;
    }
    if (phase === null || !TRIAGE_PHASE_ALLOWLIST.has(phase)) {
      continue;
    }

    out.push({ line: i + 1, text: (bulletMatch[1] ?? '').trim() });
  }
  return out;
}

async function main(): Promise<void> {
  // ideas.md is a per-user local inbox (gitignored since PR #14). Treat a
  // missing file as "no untriaged bullets" rather than crashing — matches the
  // pattern in scripts/garden/sdd-report.ts and scripts/dashboard/data.ts.
  const raw = await readFile('ideas.md', 'utf8').catch(() => '');
  const untriaged = extractUntriagedBullets(raw);
  const payload = { ideasMd: 'ideas.md', untriaged };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

const invokedDirect =
  process.argv[1] && basename(process.argv[1]).startsWith('triage-list-untriaged');
if (invokedDirect) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
