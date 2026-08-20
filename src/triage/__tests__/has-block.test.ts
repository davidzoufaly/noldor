// @tests: stable-entry-ids-for-roadmap-backlog
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hasBlock, parseHasBlockArgs } from '../has-block-cli.js';

/** A schema-C block. `id` optional so the ID-alias path can be exercised both ways. */
function block(name: string, id?: string): string {
  return [
    `### ${name}`,
    '',
    ...(id === undefined ? [] : [`- id: ${id}`]),
    '- area: tooling',
    '- size: XS',
    '- impact: med',
    '',
    'Body text.',
    '',
  ].join('\n');
}

const ROADMAP = `${block('Live Entry', 'Q-0001')}\n${block('Other Entry')}`;
const paths = { roadmapRaw: ROADMAP, backlogRaw: '', featuresDir: '/nonexistent' };

describe('parseHasBlockArgs', () => {
  it('takes the first non-flag token as the ref', () => {
    expect(parseHasBlockArgs(['--quiet', 'my-slug']).ref).toBe('my-slug');
  });

  it('reads the flags', () => {
    const a = parseHasBlockArgs(['x', '--backlog', '--quiet']);
    expect(a.backlog).toBe(true);
    expect(a.quiet).toBe(true);
  });

  it('leaves ref undefined when only flags are given', () => {
    expect(parseHasBlockArgs(['--backlog']).ref).toBeUndefined();
  });
});

describe('hasBlock', () => {
  it('finds a live entry by its derived slug', () => {
    // The slug never appears literally in the document — this is exactly what a
    // `grep -q "$slug" docs/roadmap.md` gets wrong, in the safe-looking direction.
    expect(ROADMAP).not.toContain('live-entry');
    expect(hasBlock('live-entry', ROADMAP, paths).present).toBe(true);
  });

  it('finds the same entry by its stable ID, reporting the slug it resolved to', () => {
    const r = hasBlock('Q-0001', ROADMAP, paths);
    expect(r.present).toBe(true);
    expect(r.slug).toBe('live-entry');
  });

  it('reports absent for a shipped slug', () => {
    expect(hasBlock('already-shipped', ROADMAP, paths).present).toBe(false);
  });

  it('reports absent for an unknown ID, which resolves to itself', () => {
    const r = hasBlock('Q-9999', ROADMAP, paths);
    expect(r.present).toBe(false);
    expect(r.slug).toBe('Q-9999');
  });

  it('reads the backlog when asked', () => {
    const backlogRaw = block('Parked Entry');
    const p = { roadmapRaw: ROADMAP, backlogRaw, featuresDir: '/nonexistent' };
    expect(hasBlock('parked-entry', backlogRaw, p, true).present).toBe(true);
    expect(hasBlock('parked-entry', ROADMAP, p, false).present).toBe(false);
  });
});

describe('has-block CLI exit codes', () => {
  const cli = join(process.cwd(), 'src/triage/has-block-cli.ts');
  const tsx = join(process.cwd(), 'node_modules/.bin/tsx');

  /** Run the CLI in a throwaway repo; returns its exit status. */
  function run(args: string[], roadmap: string | null): number {
    const dir = mkdtempSync(join(tmpdir(), 'has-block-'));
    try {
      if (roadmap !== null) {
        mkdirSync(join(dir, 'docs'), { recursive: true });
        writeFileSync(join(dir, 'docs', 'roadmap.md'), roadmap, 'utf8');
      }
      try {
        execFileSync(tsx, [cli, ...args], { cwd: dir, stdio: 'pipe' });
        return 0;
      } catch (e) {
        return (e as { status: number }).status;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('exits 0 for a present entry', () => {
    expect(run(['live-entry', '--quiet'], ROADMAP)).toBe(0);
  });

  it('exits 1 for an absent entry', () => {
    expect(run(['already-shipped', '--quiet'], ROADMAP)).toBe(1);
  });

  it('exits 2 with no ref, so a scripting mistake is never read as "absent"', () => {
    expect(run(['--quiet'], ROADMAP)).toBe(2);
  });

  it('exits 2 when the document is missing, not 1', () => {
    // A broken checkout must not read as a shipped entry.
    expect(run(['live-entry', '--quiet'], null)).toBe(2);
  });
});
