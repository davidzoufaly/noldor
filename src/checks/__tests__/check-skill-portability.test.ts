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

/** A repo whose `demo` skill is SHIPPED — working copy plus `templates/` twin. */
function shippedSkillRepo(body: string): string {
  return fixtureRepo({ verify: 'x', test: 'x' }, { [SKILL]: body, [`templates/${SKILL}`]: body });
}

describe('checks skill-portability', () => {
  it('refuses a fenced block naming a script the framework does not install', async () => {
    expect(await main(shippedSkillRepo('```bash\npnpm verify\n```\n'))).toBe(1);
  });

  it('accepts the same block once it carries the ignore marker', async () => {
    const body = '<!-- noldor-skill-drift-ignore -->\n\n```bash\npnpm verify\n```\n';
    expect(await main(shippedSkillRepo(body))).toBe(0);
  });

  // A consumer installs this check but no `templates/` tree, so its own skills
  // are never judged against a portability premise that is false for them.
  it('accepts a consumer skill with no templates/ twin running its own script', async () => {
    const repo = fixtureRepo(
      { test: 'vitest run' },
      { '.claude/skills/team-thing/SKILL.md': '```bash\npnpm test\n```\n' },
    );
    expect(await main(repo)).toBe(0);
  });

  // The other three drift classes are advisory by design: a missing path or a
  // renamed subcommand is visible from this repo, so garden owns them. Blocking
  // on them here would turn every stale link into a refused commit.
  it.each([
    ['a script no package.json defines', '```bash\npnpm nope-script\n```\n'],
    ['a subcommand the manifest lacks', '```bash\npnpm noldor garden nope-sub\n```\n'],
    ['a repo-relative path that is gone', 'See [gone](../../../src/gone.ts).\n'],
  ])('does not block on %s in a shipped skill', async (_label, body) => {
    expect(await main(shippedSkillRepo(body))).toBe(0);
  });

  it('accepts a repo with no skills at all', async () => {
    expect(await main(fixtureRepo({ verify: 'x' }, {}))).toBe(0);
  });
});
