// @tests: skill-vs-code-drift-detector
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { detectSkillCodeDrift } from '../skill-code-drift.js';

/** Scaffold a fixture repo: package.json with the given scripts + one skill file. */
function fixtureRepo(opts: {
  scripts?: Record<string, string>;
  files: Record<string, string>;
}): string {
  const repo = mkdtempSync(join(tmpdir(), 'noldor-skill-drift-'));
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'fixture', scripts: opts.scripts ?? {} }),
    'utf8',
  );
  for (const [rel, body] of Object.entries(opts.files)) {
    const abs = join(repo, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, 'utf8');
  }
  return repo;
}

const SKILL = '.claude/skills/demo/SKILL.md';

describe('detectSkillCodeDrift — pnpm scripts (class 1)', () => {
  it('flags a pnpm script absent from package.json; passes a present one', async () => {
    const repo = fixtureRepo({
      scripts: { typecheck: 'tsc --noEmit' },
      files: { [SKILL]: 'Run `pnpm typecheck` then `pnpm nope-script`.\n' },
    });
    const findings = await detectSkillCodeDrift(repo);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'pnpm-script',
      token: 'nope-script',
      skillPath: SKILL,
      line: 1,
      action: 'investigate',
    });
  });

  it('scripts-first: a real script named like a pnpm builtin (test) validates', async () => {
    const repo = fixtureRepo({
      scripts: { test: 'vitest run' },
      files: { [SKILL]: 'Run `pnpm test` and `pnpm install`.\n' },
    });
    expect(await detectSkillCodeDrift(repo)).toEqual([]);
  });
});

describe('detectSkillCodeDrift — consumer portability (class 4)', () => {
  const SCRIPTS = { verify: 'x', release: 'x', typecheck: 'x', test: 'x' };

  /** A fenced block holding `lines`, with `above` written before the fence. */
  const fenced = (lines: readonly string[], above: readonly string[] = []): string =>
    [...above, '```bash', ...lines, '```', ''].join('\n');

  /** A repo whose `demo` skill is SHIPPED — working copy plus `templates/` twin. */
  const shippedSkillRepo = (body: string, scripts: Record<string, string> = SCRIPTS): string =>
    fixtureRepo({ scripts, files: { [SKILL]: body, [`templates/${SKILL}`]: body } });

  // MUST FIRE — a fenced block in a shipped skill naming a script only this repo defines.
  it.each([
    ['a lone command', ['pnpm verify']],
    ['a command with args', ['pnpm release --preflight']],
    ['a command under a pipe', ['pnpm typecheck 2>&1 | tail -5']],
  ])('flags %s that resolves only through this repo package.json', async (_label, lines) => {
    const findings = await detectSkillCodeDrift(shippedSkillRepo(fenced(lines)));
    // Both copies of a shipped skill are scanned, and both are the same defect.
    expect(findings.map((f) => [f.kind, f.skillPath, f.line])).toEqual([
      ['non-portable-script', SKILL, 2],
      ['non-portable-script', `templates/${SKILL}`, 2],
    ]);
  });

  it('reports every offending command in one block, at its own line', async () => {
    const findings = await detectSkillCodeDrift(
      shippedSkillRepo(fenced(['pnpm typecheck', 'pnpm test'])),
    );
    expect(findings.filter((f) => f.skillPath === SKILL).map((f) => [f.token, f.line])).toEqual([
      ['typecheck', 2],
      ['test', 3],
    ]);
  });

  it('suppression ends at the closing fence — a later unmarked block still flags', async () => {
    const body =
      fenced(['pnpm verify'], ['<!-- noldor-skill-drift-ignore -->', '']) + fenced(['pnpm verify']);
    const findings = await detectSkillCodeDrift(shippedSkillRepo(body));
    expect(findings.filter((f) => f.skillPath === SKILL).map((f) => [f.kind, f.line])).toEqual([
      ['non-portable-script', 7],
    ]);
  });

  // MUST STAY QUIET — every shape the portability rule deliberately does not own.
  it.each([
    ['an inline span in prose', 'Ships in the next `pnpm release`; run `pnpm verify` first.\n'],
    ['a framework command in a fence', fenced(['pnpm noldor garden detect'])],
    ['a pnpm builtin in a fence', fenced(['pnpm install --frozen-lockfile'])],
    [
      'a block marked by a preceding line, blank-separated',
      fenced(['pnpm verify'], ['<!-- noldor-skill-drift-ignore -->', '']),
    ],
    [
      'a block marked by the line directly above the fence',
      fenced(['pnpm verify'], ['<!-- noldor-skill-drift-ignore -->']),
    ],
    [
      'a marked command line inside the fence',
      fenced(['pnpm verify <!-- noldor-skill-drift-ignore -->']),
    ],
  ])('does not flag %s', async (_label, body) => {
    expect(await detectSkillCodeDrift(shippedSkillRepo(body))).toEqual([]);
  });

  // The consumer case: the framework installs this detector and the pre-commit
  // job that reads it, but ships no `templates/` tree, so a skill the consumer
  // wrote has no twin — and `pnpm test` there is the consumer's own script,
  // portable to the only repo it ever runs in.
  it('leaves a skill with no templates/ twin alone', async () => {
    const repo = fixtureRepo({
      scripts: SCRIPTS,
      files: { '.claude/skills/team-thing/SKILL.md': fenced(['pnpm test']) },
    });
    expect(await detectSkillCodeDrift(repo)).toEqual([]);
  });

  it('a fenced script no package.json defines stays ordinary rot, not a portability defect', async () => {
    const findings = await detectSkillCodeDrift(shippedSkillRepo(fenced(['pnpm nope-script'])));
    expect([...new Set(findings.map((f) => f.kind))]).toEqual(['pnpm-script']);
  });
});

describe('detectSkillCodeDrift — noldor subcommands (class 2)', () => {
  it('flags unknown group and unknown sub; passes real ones', async () => {
    const repo = fixtureRepo({
      files: {
        [SKILL]: [
          'Run `pnpm noldor garden detect` first.',
          'Then `pnpm noldor bogus subcmd`.',
          'Then `pnpm noldor garden bogus-sub`.',
          'Leaf: `pnpm noldor init --update`.',
        ].join('\n'),
      },
    });
    const findings = await detectSkillCodeDrift(repo);
    expect(findings.map((f) => f.token)).toEqual(['noldor bogus', 'noldor garden bogus-sub']);
    expect(findings.every((f) => f.kind === 'noldor-subcommand')).toBe(true);
  });

  it('prose (no backticks) never flags — code contexts only', async () => {
    const repo = fixtureRepo({
      files: { [SKILL]: 'The noldor then does things. Also pnpm whatever in prose.\n' },
    });
    expect(await detectSkillCodeDrift(repo)).toEqual([]);
  });

  it('fenced-block commands are scanned', async () => {
    const repo = fixtureRepo({
      files: { [SKILL]: ['```', 'pnpm noldor bogus subcmd', '```'].join('\n') },
    });
    const findings = await detectSkillCodeDrift(repo);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.line).toBe(2);
  });
});

describe('detectSkillCodeDrift — repo-relative paths (class 3)', () => {
  it('flags a missing src/ path; passes an existing one', async () => {
    const repo = fixtureRepo({
      files: {
        'src/real.ts': 'export {};\n',
        [SKILL]: 'See `src/real.ts` and `src/gone.ts`.\n',
      },
    });
    const findings = await detectSkillCodeDrift(repo);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'missing-path', token: 'src/gone.ts' });
  });

  it('skips placeholders, globs, transients, and directory mentions', async () => {
    const repo = fixtureRepo({
      files: {
        [SKILL]: [
          'Edit `docs/features/<slug>.md` and `src/**/*.ts`.',
          'State in `.noldor/session.json` is transient.',
          'The `./src/` import needs no resolution.',
        ].join('\n'),
      },
    });
    expect(await detectSkillCodeDrift(repo)).toEqual([]);
  });

  it('file.ts:symbol anchors stat the file part only', async () => {
    const repo = fixtureRepo({
      files: {
        'src/real.ts': 'export {};\n',
        [SKILL]: 'Call `src/real.ts:doThing` and `src/gone.ts:doThing`.\n',
      },
    });
    const findings = await detectSkillCodeDrift(repo);
    expect(findings.map((f) => f.token)).toEqual(['src/gone.ts:doThing']);
  });

  it('resolves ../-relative and same-dir relative markdown links from the skill dir', async () => {
    const repo = fixtureRepo({
      files: {
        'src/real.ts': 'export {};\n',
        '.claude/skills/demo/references/kept.md': 'kept\n',
        [SKILL]: [
          'See [real](../../../src/real.ts) and [gone](../../../src/gone.ts).',
          'Also [kept](references/kept.md) and [lost](references/lost.md).',
        ].join('\n'),
      },
    });
    const findings = await detectSkillCodeDrift(repo);
    expect(findings.map((f) => f.token).sort()).toEqual([
      '../../../src/gone.ts',
      'references/lost.md',
    ]);
  });

  it('template twins resolve relative links from the installed location', async () => {
    const repo = fixtureRepo({
      files: {
        'src/real.ts': 'export {};\n',
        'templates/.claude/skills/demo/SKILL.md': 'See [real](../../../src/real.ts).\n',
      },
    });
    expect(await detectSkillCodeDrift(repo)).toEqual([]);
  });
});

describe('detectSkillCodeDrift — suppression + corpus', () => {
  it('a line carrying the ignore marker produces no finding', async () => {
    const repo = fixtureRepo({
      files: {
        [SKILL]: [
          '(`pnpm not-a-script` is intentionally absent <!-- noldor-skill-drift-ignore -->)',
          '<!-- noldor-skill-drift-ignore -->',
          'Next line ref `pnpm also-not-a-script` suppressed by preceding marker.',
        ].join('\n'),
      },
    });
    expect(await detectSkillCodeDrift(repo)).toEqual([]);
  });

  it('scans sibling references/*.md files in the skill dir', async () => {
    const repo = fixtureRepo({
      files: {
        '.claude/skills/demo/references/extra.md': 'Run `pnpm nope-script`.\n',
        [SKILL]: 'Main body is clean.\n',
      },
    });
    const findings = await detectSkillCodeDrift(repo);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.skillPath).toBe('.claude/skills/demo/references/extra.md');
  });

  it('missing skills roots return []', async () => {
    const repo = fixtureRepo({ files: {} });
    expect(await detectSkillCodeDrift(repo)).toEqual([]);
  });
});

describe('detectSkillCodeDrift — real-tree self-scan', () => {
  it('the repo skills are drift-clean', async () => {
    const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');
    expect(await detectSkillCodeDrift(repoRoot)).toEqual([]);
  });
});

describe('detectSkillCodeDrift — branch files beside SKILL.md', () => {
  it('scans a branch file in a skill folder the way it scans SKILL.md', async () => {
    const fork = '.claude/skills/demo/fork.md';
    const repo = fixtureRepo({
      files: { [SKILL]: '# demo\n', [fork]: 'Run `pnpm nope-script`.\n' },
    });
    const findings = await detectSkillCodeDrift(repo);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'pnpm-script',
      token: 'nope-script',
      skillPath: fork,
      line: 1,
    });
  });
});
