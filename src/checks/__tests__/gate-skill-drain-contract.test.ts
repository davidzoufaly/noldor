// @tests: gate-skill-loads-only-the-branch-a-session-takes
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const GATE_DIR = join(ROOT, '.claude', 'skills', 'noldor-gate');
const DRAIN_PAGE = readFileSync(join(ROOT, 'docs', 'noldor', 'drain-mode.md'), 'utf8');

/** The `## <heading…>` section of a markdown page, up to the next H2. */
function section(page: string, heading: string): string {
  const start = page.indexOf(`\n## ${heading}`);
  if (start < 0) throw new Error(`no "## ${heading}" section`);
  const next = page.indexOf('\n## ', start + 1);
  return page.slice(start, next < 0 ? undefined : next);
}

describe('the drain contract lives on one page', () => {
  it('no gate skill file carries a drain or finish mode section', () => {
    for (const file of readdirSync(GATE_DIR).filter((f) => f.endsWith('.md'))) {
      const headings = readFileSync(join(GATE_DIR, file), 'utf8')
        .split('\n')
        .filter((line) => /^#{1,6} /.test(line));
      expect(
        headings.filter((h) => /drain mode|finish mode/i.test(h)),
        file,
      ).toEqual([]);
    }
  });

  it('the gate entry check sends a drain run to drain-mode.md', () => {
    expect(readFileSync(join(GATE_DIR, 'SKILL.md'), 'utf8')).toContain(
      '**Read now:** [`docs/noldor/drain-mode.md`](../../../docs/noldor/drain-mode.md)',
    );
  });

  it('the page scaffolds the fast-track worktree and marker a claude child took from the skill', () => {
    const branch = section(DRAIN_PAGE, 'Branch discipline');
    expect(branch).toContain('pnpm noldor worktrees create <slug> --branch fast/<slug>');
    expect(branch).toContain('"path": "fast-track"');
    expect(section(DRAIN_PAGE, 'Roadmap retirement')).toContain('.noldor/retired-entry-ids.json');
    expect(section(DRAIN_PAGE, 'Autonomous end-of-flow')).toContain(
      'pnpm noldor checks arch-baseline',
    );
  });

  it('the Resume path archives, flips and bootstraps the FD', () => {
    const resume = section(DRAIN_PAGE, 'Resume path');
    for (const command of [
      'pnpm noldor design archive',
      'pnpm noldor features phase-flip-done',
      'pnpm noldor cr bootstrap',
    ]) {
      expect(resume).toContain(command);
    }
  });
});
