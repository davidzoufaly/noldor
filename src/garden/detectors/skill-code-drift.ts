import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { MANIFEST } from '../../cli/manifest.js';

/**
 * One skill-vs-code drift finding: a skill markdown file referencing a
 * `pnpm` script, `noldor` subcommand, or repo-relative path that no longer
 * exists, or a command that runs here but not in a consumer. Advisory
 * (`action: 'investigate'`) — the operator fixes or suppresses; nothing is
 * auto-rewritten. `non-portable-script` is additionally gated by
 * `pnpm noldor checks skill-portability`, which blocks on that kind alone.
 */
export interface SkillDriftFinding {
  /** Repo-relative path of the skill markdown file. */
  readonly skillPath: string;
  /** 1-based line of the offending token. */
  readonly line: number;
  readonly kind: 'pnpm-script' | 'non-portable-script' | 'noldor-subcommand' | 'missing-path';
  /** The offending script name / subcommand / path. */
  readonly token: string;
  /** One-line human explanation. */
  readonly detail: string;
  readonly action: 'investigate';
}

/**
 * The finding kind that blocks. Split out because the check and the detector's
 * own tests both name it, and a string literal repeated across a module
 * boundary is the shape that silently survives a rename.
 */
export const NON_PORTABLE_SCRIPT: SkillDriftFinding['kind'] = 'non-portable-script';

/**
 * Lines carrying this marker (conventionally `<!-- noldor-skill-drift-ignore -->`
 * at end of line, or alone on the preceding line) are excluded from all four
 * drift classes — the affordance for intentional negative references such as
 * "`pnpm docs:build` is not a script in this repo".
 *
 * A marker-only line sitting **above an opening fence** exempts that whole
 * fenced block. Without that form the only way to exempt a command block is a
 * marker on the command line itself, inside the fence, where it renders as part
 * of the block and travels with anything the reader copies.
 */
export const SKILL_DRIFT_IGNORE_MARKER = 'noldor-skill-drift-ignore';

/**
 * pnpm built-ins that are not package.json scripts, plus `noldor` — the one
 * launcher word that makes what follows a framework command rather than a repo
 * script, and so the only `pnpm <word>` form a consumer is guaranteed to have.
 *
 * `test` is deliberately absent. It resolves through a `test` script, which a
 * consumer may not define; treating it as a built-in would exempt the most
 * commonly assumed script in the ecosystem from the portability rule below.
 */
const PNPM_BUILTINS = new Set([
  'install',
  'i',
  'add',
  'remove',
  'rm',
  'exec',
  'dlx',
  'pack',
  'publish',
  'link',
  'unlink',
  'create',
  'why',
  'update',
  'up',
  'run',
  'store',
  'audit',
  'outdated',
  'list',
  'ls',
  'config',
  'setup',
  'import',
  'rebuild',
  'patch',
  'noldor',
]);

/** Tokens containing these are templated placeholders or globs, never real refs. */
const PLACEHOLDER_RE = /[<>*{}$]|NNNN|YYYY/;

/** Roots whose contents are transient run-state — never stat-checked. */
const TRANSIENT_RE = /(^|\/)(\.noldor|\.worktrees|graphify-out|node_modules)\//;

/** Repo-root-anchored prefixes that mark a token as a repo-relative path claim. */
const ROOT_ANCHOR_RE = /^(src|docs|scripts|templates|bin|e2e|samples|\.claude|\.github)\//;

const PNPM_SCRIPT_RE = /\bpnpm\s+(?:run\s+)?([A-Za-z0-9:_.-]+)/g;
const NOLDOR_CMD_RE = /\bnoldor\s+([a-z-]+)(?:\s+([a-z][a-z0-9:-]*))?/g;
const INLINE_CODE_RE = /`([^`]+)`/g;
const MD_LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;

/** Recursively collect every `*.md` under a skills root; missing root → []. */
function collectSkillMd(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
    }
  };
  walk(root);
  return out;
}

/**
 * True when the nearest non-blank line above `idx` is a marker-only HTML
 * comment. Blank lines are skipped because a marker is usually written with one
 * between it and the fence it guards — CommonMark does not require the blank,
 * but every hand-written instance in this repo has it.
 */
function markerAbove(lines: readonly string[], idx: number): boolean {
  for (let j = idx - 1; j >= 0; j--) {
    const text = lines[j]!.trim();
    if (text === '') continue;
    return text === `<!-- ${SKILL_DRIFT_IGNORE_MARKER} -->`;
  }
  return false;
}

/** Extract inline backtick spans from a prose line. */
function inlineCodeSpans(line: string): string[] {
  const spans: string[] = [];
  for (const m of line.matchAll(INLINE_CODE_RE)) spans.push(m[1]!);
  return spans;
}

function checkCommands(
  codeText: string,
  scripts: ReadonlySet<string>,
  fenced: boolean,
  push: (kind: SkillDriftFinding['kind'], token: string, detail: string) => void,
): void {
  for (const m of codeText.matchAll(PNPM_SCRIPT_RE)) {
    const name = m[1]!;
    if (name.startsWith('-')) continue;
    if (PNPM_BUILTINS.has(name)) continue;
    if (PLACEHOLDER_RE.test(name)) continue;
    // A script this repo happens to define is NOT evidence the command runs
    // where the skill ships. `pnpm verify` / `pnpm release` / `pnpm toon` each
    // resolved here and each broke a consumer mid-release (Q-0239), because
    // the framework installs skills but not scripts. So the two outcomes are
    // reported apart rather than collapsed: a name with no script anywhere is
    // ordinary rot, a name backed only by THIS repo's package.json is a
    // portability defect, and only the second has a blocking check.
    //
    // Fenced blocks only. An inline span in prose ("shipped in the next `pnpm
    // release`") names a thing; a fenced block is the thing the reader copies
    // and runs, which is the form that broke charuy. Extending the rule to
    // prose turns 16 sites into 76 and the markers into noise — and a marker
    // is only worth reading where it records a real decision.
    if (scripts.has(name)) {
      if (!fenced) continue; // scripts-first, as before: a real script never flags in prose
      push(
        NON_PORTABLE_SCRIPT,
        name,
        `\`pnpm ${name}\` is a script in this repo's package.json, not a framework command — ` +
          `a consumer that installs this skill has no such script. Rewrite it against ` +
          `\`pnpm noldor …\`, or put \`<!-- ${SKILL_DRIFT_IGNORE_MARKER} -->\` above the block ` +
          `and say in prose which repo script it stands for`,
      );
      continue;
    }
    push('pnpm-script', name, `\`pnpm ${name}\` matches no package.json script`);
  }
  for (const m of codeText.matchAll(NOLDOR_CMD_RE)) {
    const group = m[1]!;
    const sub = m[2];
    if (PLACEHOLDER_RE.test(group)) continue;
    const entry = MANIFEST[group];
    if (!entry) {
      push('noldor-subcommand', `noldor ${group}`, `no CLI group \`${group}\` in the manifest`);
      continue;
    }
    const isLeaf = Object.keys(entry.subs).length === 1 && entry.subs[''] !== undefined;
    if (isLeaf || sub === undefined || sub.startsWith('-') || PLACEHOLDER_RE.test(sub)) continue;
    if (entry.subs[sub] === undefined) {
      push(
        'noldor-subcommand',
        `noldor ${group} ${sub}`,
        `group \`${group}\` has no subcommand \`${sub}\``,
      );
    }
  }
}

function checkPaths(
  candidates: readonly string[],
  repo: string,
  fileDir: string,
  push: (kind: SkillDriftFinding['kind'], token: string, detail: string) => void,
): void {
  for (const raw of candidates) {
    const token = raw.split('#')[0]!.trim();
    if (!token.includes('/')) continue;
    if (PLACEHOLDER_RE.test(token)) continue;
    if (TRANSIENT_RE.test(token)) continue;
    if (/^[a-z]+:\/\//.test(token) || token.startsWith('mailto:')) continue;
    if (/\s/.test(token)) continue;
    if (token.endsWith('/')) continue; // directory mentions are prose, not link claims
    // `file.ts:symbol` / `file.ts:12` anchors — stat the file part only
    // (the finding still reports the full token as written).
    const anchor = /^(.+\.[a-z]{1,4}):[\w$.-]+$/.exec(token);
    const statTarget = anchor ? anchor[1]! : token;
    let abs: string | null = null;
    if (ROOT_ANCHOR_RE.test(statTarget)) {
      abs = join(repo, statTarget);
    } else if (statTarget.startsWith('./') || statTarget.startsWith('../')) {
      abs = resolve(fileDir, statTarget);
    } else {
      // Same-dir relative like `references/foo.md` — only a path claim when the
      // first segment exists as a directory next to the file, else it's prose.
      const first = statTarget.split('/')[0]!;
      if (existsSync(join(fileDir, first))) abs = resolve(fileDir, statTarget);
      else continue;
    }
    const rel = relative(repo, abs);
    if (rel.startsWith('..') || rel.includes(`..${sep}`)) continue; // escapes repo
    if (TRANSIENT_RE.test(rel.split(sep).join('/'))) continue;
    if (existsSync(abs)) continue;
    push('missing-path', token, `resolves to \`${rel.split(sep).join('/')}\` which does not exist`);
  }
}

/**
 * Detect skill-vs-code drift: walk `.claude/skills/**` and
 * `templates/.claude/skills/**` markdown, extracting `pnpm <script>` and
 * `noldor <group> <sub>` references from code contexts (inline backticks +
 * fenced blocks — never bare prose) and repo-relative path claims from
 * backtick spans and markdown link targets, then validating each against
 * `package.json` scripts, the CLI `MANIFEST`, and the filesystem.
 *
 * Inside a FENCED block, a `pnpm <script>` that only this repo's `package.json`
 * defines is reported as `non-portable-script` rather than passing: skills ship
 * to consumers, which receive no scripts. See {@link NON_PORTABLE_SCRIPT}.
 *
 * Template twins are validated against the ROOT `package.json`/tree —
 * templates describe consumer repos, but self-host is the only tree we can
 * stat; accepted imprecision.
 *
 * @param repo - Repository root.
 * @returns Findings sorted by `skillPath`, then `line` (deterministic).
 */
export async function detectSkillCodeDrift(repo: string): Promise<SkillDriftFinding[]> {
  let scripts: ReadonlySet<string>;
  try {
    const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    scripts = new Set(Object.keys(pkg.scripts ?? {}));
  } catch {
    scripts = new Set();
  }

  const files = [
    ...collectSkillMd(join(repo, '.claude', 'skills')),
    ...collectSkillMd(join(repo, 'templates', '.claude', 'skills')),
  ];

  const findings: SkillDriftFinding[] = [];
  for (const file of files) {
    let body: string;
    try {
      body = readFileSync(file, 'utf8');
    } catch {
      continue; // fail-open per detector convention
    }
    const skillPath = relative(repo, file).split(sep).join('/');
    // Template twins install into the consumer repo at `.claude/skills/...`;
    // resolve their relative links from that INSTALLED location, not from the
    // `templates/` tree (else every `../../../src/...` gains a bogus prefix).
    const installedRel = skillPath.startsWith('templates/')
      ? skillPath.slice('templates/'.length)
      : skillPath;
    const fileDir = dirname(join(repo, installedRel));
    const lines = body.split('\n');
    let inFence = false;
    let fenceSuppressed = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (/^\s*(```|~~~)/.test(line)) {
        // An opening delimiter reads the marker above it and carries that
        // verdict to every line of the block; a closing one clears it.
        fenceSuppressed = inFence ? false : markerAbove(lines, i);
        inFence = !inFence;
        continue;
      }
      if (fenceSuppressed) continue;
      if (line.includes(SKILL_DRIFT_IGNORE_MARKER)) continue;
      if (i > 0 && lines[i - 1]!.trim() === `<!-- ${SKILL_DRIFT_IGNORE_MARKER} -->`) continue;
      const push = (kind: SkillDriftFinding['kind'], token: string, detail: string): void => {
        findings.push({ skillPath, line: i + 1, kind, token, detail, action: 'investigate' });
      };
      const codeSpans = inFence ? [line] : inlineCodeSpans(line);
      for (const span of codeSpans) checkCommands(span, scripts, inFence, push);
      const pathCandidates = [...codeSpans];
      for (const m of line.matchAll(MD_LINK_RE)) pathCandidates.push(m[1]!);
      checkPaths(pathCandidates, repo, fileDir, push);
    }
  }
  findings.sort((a, b) => a.skillPath.localeCompare(b.skillPath) || a.line - b.line);
  return findings;
}
