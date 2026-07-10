import { readFileSync, writeFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { argv, exit } from 'node:process';

/**
 * One-time, idempotent codemod prefixing the 9 bare framework skill names with
 * `noldor-`. Word-boundary-anchored (both sides) so homonyms — CR lane
 * `kind: 'gate'`, commit type `refactor`, module dirs `../garden/`, dashboard
 * routes `/milestones`, `docs/milestones/` paths, `promote-from-backlog` URLs,
 * and FD slugs like `portable-gate-entrypoint` — are never touched (proven by the
 * homonym test). Idempotent: a second run finds no unprefixed anchors. Mirrors
 * `rename-plan-only-tier.ts`, minus its slug-placeholder round-trip — the
 * symmetric boundaries make it unnecessary (no PROTECTED table, no NUL sentinel).
 */
const NAMES = [
  'gate',
  'garden',
  'triage',
  'promote',
  'milestone',
  'new-feature',
  'draft-feature-md',
  'refactor',
  'release-sweep',
] as const;

export function prefixSkills(input: string): string {
  let s = input;
  for (const n of NAMES) {
    // Slash invocation, symmetric word boundary. The left class excludes `.` so a
    // relative module path (`../garden/`, `./gate`) is NOT rewritten — a bare
    // `(?<![\w-])` would pass on the `.` before the slash and corrupt imports.
    // The right class stops `/milestone`->`/milestones` and `/promote-from-backlog`.
    // Must match the acceptance grep's `(?<![\w.-])...(?![\w-])` exactly.
    s = s.replace(new RegExp(`(?<![\\w.-])/${n}(?![\\w-])`, 'g'), `/noldor-${n}`);
    // Skill dir path segment.
    s = s.replaceAll(`.claude/skills/${n}/`, `.claude/skills/noldor-${n}/`);
    // SKILL.md frontmatter name (line-anchored; no other file carries `name: <bare-slug>`).
    s = s.replace(new RegExp(`^name: ${n}$`, 'gm'), `name: noldor-${n}`);
    // Backtick skill-context: `n` skill  /  name `n`.
    s = s.replace(new RegExp('`' + n + '`(\\s+skill)', 'g'), '`noldor-' + n + '`$1');
    s = s.replace(new RegExp('(name\\s+)`' + n + '`', 'g'), '$1`noldor-' + n + '`');
  }
  return s;
}

// Fixed-prefix globs; `*` never crosses `/`, so results are exactly the intended
// skill/doc files — no exclude machinery is reachable, hence none. `glob` from
// node:fs/promises is stable enough for this one-shot dev codemod; it may emit an
// ExperimentalWarning on the Node 22 CI floor — that is NOT a failure.
const FILE_GLOBS = [
  '.claude/skills/*/SKILL.md',
  'templates/.claude/skills/*/SKILL.md',
  'docs/noldor/*.md',
  'templates/docs/noldor/*.md',
  'docs/features/*.md',
  'docs/roadmap.md',
  'docs/backlog.md',
];

async function collectFiles(): Promise<string[]> {
  const seen = new Set<string>();
  for (const pattern of FILE_GLOBS) {
    for await (const path of glob(pattern)) {
      seen.add(path.replace(/\\/g, '/'));
    }
  }
  return [...seen].toSorted();
}

async function main(): Promise<void> {
  const dryRun = argv.includes('--dry-run');
  const files = await collectFiles();
  let touched = 0;
  for (const path of files) {
    const before = readFileSync(path, 'utf8');
    const after = prefixSkills(before);
    if (after !== before) {
      touched++;
      if (dryRun) console.log(`would-touch ${path}`);
      else {
        writeFileSync(path, after, 'utf8');
        console.log(`touched ${path}`);
      }
    }
  }
  console.log(`\n${dryRun ? 'dry-run' : 'applied'}: ${touched} file(s) touched`);
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    exit(1);
  });
}
