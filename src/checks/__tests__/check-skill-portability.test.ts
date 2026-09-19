// @tests: skill-vs-code-drift-detector
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { main } from '../check-skill-portability.js';

/** Scaffold a fixture repo: package.json with the given scripts + skill files. */
function fixtureRepo(scripts: Record<string, string>, files: Record<string, string>): string {
  const repo = mkdtempSync(join(tmpdir(), 'noldor-skill-portability-'));
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'fixture', scripts }), 'utf8');
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(repo, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, 'utf8');
  }
  return repo;
}

const SKILL = '.claude/skills/demo/SKILL.md';

describe('checks skill-portability', () => {
  it('refuses a fenced block naming a script the framework does not install', async () => {
    const repo = fixtureRepo({ verify: 'x' }, { [SKILL]: '```bash\npnpm verify\n```\n' });
    expect(await main(repo)).toBe(1);
  });

  it('accepts the same block once it carries the ignore marker', async () => {
    const repo = fixtureRepo(
      { verify: 'x' },
      { [SKILL]: '<!-- noldor-skill-drift-ignore -->\n\n```bash\npnpm verify\n```\n' },
    );
    expect(await main(repo)).toBe(0);
  });

  // The other three drift classes are advisory by design: a missing path or a
  // renamed subcommand is visible from this repo, so garden owns them. Blocking
  // on them here would turn every stale link into a refused commit.
  it.each([
    ['a script no package.json defines', { [SKILL]: '```bash\npnpm nope-script\n```\n' }],
    ['a subcommand the manifest lacks', { [SKILL]: '```bash\npnpm noldor garden nope-sub\n```\n' }],
    ['a repo-relative path that is gone', { [SKILL]: 'See [gone](../../../src/gone.ts).\n' }],
  ])('does not block on %s', async (_label, files) => {
    expect(await main(fixtureRepo({ verify: 'x' }, files))).toBe(0);
  });

  it('accepts a repo with no skills at all', async () => {
    expect(await main(fixtureRepo({ verify: 'x' }, {}))).toBe(0);
  });
});
