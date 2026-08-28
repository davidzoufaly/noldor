// @fd: consumer-architecture-doc-surface
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join, sep } from 'node:path';

import { loadDocRoots } from '../core/doc-roots.js';
import { scanRoots, toPosixRelative } from '../core/repo-paths.js';
import {
  ARCH_PAGE_PROSE_WORD_THRESHOLD,
  ARCH_PARAGRAPH_WORD_THRESHOLD,
  SECTION_CUT_TOKEN,
  assessPageBloat,
  assessPageForm,
} from './architecture-form.js';
import {
  ARCHITECTURE_PAGES,
  PLACEHOLDER_MARKER,
  pageFilename,
  type ArchitecturePageId,
} from './architecture-schema.js';

/** Why one registry page failed. One finding per rule per page, never more. */
export type ArchitectureRule = 'missing' | 'no-fence' | 'bad-kind' | 'placeholder' | 'unreadable';

/** A blocking problem with a registry page. A non-empty list means `incomplete`. */
export interface ArchitectureFinding {
  /** Repo-relative path, POSIX separators. */
  readonly page: string;
  readonly rule: ArchitectureRule;
  readonly message: string;
}

/**
 * Shared fields on every advisory row.
 *
 * The page is carried twice on purpose: `pageId` is the registry id, so a
 * construction site cannot invent a page, while `page` stays the repo-relative
 * label the module rows already print.
 */
interface AdvisoryBase {
  readonly pageId: ArchitecturePageId;
  /** Repo-relative path, POSIX separators. */
  readonly page: string;
  readonly message: string;
}

/**
 * A non-blocking observation about a page.
 *
 * Advisory by design: none of these reach `status`, so none reaches the release
 * probe. Keeping that promise also constrains how they may be reported —
 * routing them into garden's `sddGaps` would gate the auto-restamp and block a
 * release, so they ride their own `GardenFindings` key. See
 * `src/garden/detectors/architecture.ts`.
 *
 * One discriminated channel rather than an array per class: its only consumer
 * (`src/garden/garden-detect.ts`) reads one array today, and a second array
 * would make every future consumer enumerate classes.
 */
export type ArchitectureAdvisory =
  | (AdvisoryBase & { readonly kind: 'module'; readonly module: string })
  | (AdvisoryBase & { readonly kind: 'section'; readonly section: string })
  | (AdvisoryBase & {
      readonly kind: 'unknown-cut';
      readonly section: string;
      readonly ordinal: number;
    })
  | (AdvisoryBase & { readonly kind: 'flow-headings'; readonly count: number })
  | (AdvisoryBase & {
      readonly kind: 'long-paragraph';
      readonly index: number;
      readonly words: number;
    })
  | (AdvisoryBase & { readonly kind: 'page-bloat'; readonly words: number });

export interface ArchitectureReport {
  /**
   * `absent` — the folder does not exist, OR every page is still exactly as
   * scaffolded. Callers skip on it. `incomplete` — at least one finding.
   */
  readonly status: 'absent' | 'ok' | 'incomplete';
  readonly findings: readonly ArchitectureFinding[];
  readonly advisories: readonly ArchitectureAdvisory[];
}

/**
 * Directory names never drawn on an architecture diagram: generated output and
 * test scaffolding. Names beginning `.` or `_` are excluded separately, which
 * already covers `__tests__` / `__mocks__` — they are listed anyway so the
 * intent survives a change to the prefix rule.
 */
const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '__tests__',
  '__mocks__',
]);

/**
 * Every mermaid fence kind declared in a markdown body, lowercased.
 *
 * A fence's kind is the first token of its first content line, after skipping
 * blank lines, `%%` comment and `%%{init: …}%%` directive lines, and a leading
 * `---` YAML block — all legal mermaid preambles that a naive first-line read
 * would misclassify. An unterminated YAML block or fence yields no kind rather
 * than consuming the rest of the document.
 *
 * noldor:cut backtick fences only — add tilde-fence support if a consumer's
 * pages use them (the same CommonMark gap Q-0113 tracks for queue documents).
 *
 * @param body - Raw markdown
 * @returns Lowercased kinds, in document order, one per mermaid fence that declared one
 */
export function fenceKinds(body: string): string[] {
  const lines = body.split('\n');
  const kinds: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!/^\s*```+\s*mermaid\s*$/i.test(lines[i])) {
      i += 1;
      continue;
    }
    i += 1;
    let inYaml = false;
    while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) {
      const line = lines[i].trim();
      i += 1;
      if (inYaml) {
        if (line === '---') inYaml = false;
        continue;
      }
      if (line.length === 0 || line.startsWith('%%')) continue;
      if (line === '---') {
        inYaml = true;
        continue;
      }
      const token = /^[A-Za-z0-9_]+/.exec(line);
      if (token) kinds.push(token[0].toLowerCase());
      break;
    }
    // Skip to the closing fence (or EOF — an unterminated fence just ends here).
    while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) i += 1;
    i += 1;
  }
  return kinds;
}

/**
 * True when `body` names `modulePath` as a path token.
 *
 * The body is split on everything outside `[A-Za-z0-9_./-]`, and a module counts
 * as named when its path equals a resulting token, with any trailing `/`
 * stripped. Substring matching would let a root named `app` match the word
 * "apply"; ignoring `/` would let a bare `src` satisfy `src/core`. Mentions
 * anywhere count, including inside the mermaid fences — which is where a module
 * diagram names its modules.
 *
 * @param body - Raw markdown
 * @param modulePath - Repo-relative POSIX path, e.g. `src/core`
 */
export function mentionsModule(body: string, modulePath: string): boolean {
  for (const raw of body.split(/[^A-Za-z0-9_./-]+/)) {
    if (raw.replace(/\/+$/, '') === modulePath) return true;
  }
  return false;
}

/**
 * The module set: directories one level INSIDE each existing scan root.
 *
 * Not the roots themselves — `scanRoots()` returns `['src']` in this repo and in
 * the shipped template, so checking the roots would reduce to "does the page
 * contain the string `src`", which any path mention satisfies and which would
 * therefore never fire. One level in is the granularity a module diagram draws.
 *
 * Non-existent roots, unreadable roots, symlinks, dot/underscore-prefixed names
 * and generated directories contribute nothing; overlapping roots cannot yield
 * the same module twice.
 *
 * @param cwd - Consumer root
 * @returns Sorted, deduplicated repo-relative POSIX paths
 */
export async function listModuleDirs(cwd: string): Promise<string[]> {
  const found = new Set<string>();
  let roots: string[];
  try {
    roots = scanRoots(cwd);
  } catch {
    // `scanRoots` parses `.noldor/config.json` and throws on a malformed one.
    // Fail open with no modules rather than crashing garden or the release
    // preflight — `validate noldor-config` is the surface that reports a bad
    // config, the same split `loadOverrideAuditOptions` documents.
    return [];
  }
  for (const root of roots) {
    const abs = join(cwd, root);
    try {
      if (!(await stat(abs)).isDirectory()) continue;
      for (const entry of await readdir(abs, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        found.add(`${root.split(sep).join('/')}/${entry.name}`);
      }
    } catch {
      // A root that cannot be stat'd or read contributes nothing — the same
      // ENOENT-tolerance every other walker applies to scan roots.
      continue;
    }
  }
  return [...found].sort();
}

/** One page's body, or the reason it could not be read. */
type PageRead = { ok: true; body: string } | { ok: false; missing: boolean; message: string };

async function readPage(path: string): Promise<PageRead> {
  try {
    return { ok: true, body: await readFile(path, 'utf8') };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: false, missing: true, message: 'file not found' };
    return { ok: false, missing: false, message: (err as Error).message };
  }
}

/**
 * Check the architecture surface: are the registry's pages present, filled in,
 * and drawn with an allowed diagram kind — and does the modules page still name
 * every module the code has.
 *
 * Every filesystem read is caught here, at the boundary it enters, so a folder
 * that is a file, an unreadable directory or a non-UTF-8 page becomes a finding
 * rather than a throw reaching the CLI, garden or release preflight.
 *
 * **Opt-in.** `absent` covers both a missing folder and one whose pages are all
 * still exactly as scaffolded. Without the second half, `noldor init` would hand
 * every fresh consumer a blocking release row — the opposite of what the
 * absent-skip exists for. Editing any one page opts the repo in.
 *
 * @param cwd - Consumer root
 * @returns Report whose `findings` are blocking and whose `advisories` are not
 */
export async function checkArchitecture(cwd: string): Promise<ArchitectureReport> {
  const dir = loadDocRoots(cwd).architecture;
  const dirLabel = toPosixRelative(cwd, dir);

  try {
    if (!(await stat(dir)).isDirectory()) {
      return {
        status: 'incomplete',
        findings: [
          {
            page: dirLabel,
            rule: 'unreadable',
            message: `${dirLabel} exists but is not a directory`,
          },
        ],
        advisories: [],
      };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'absent', findings: [], advisories: [] };
    }
    return {
      status: 'incomplete',
      findings: [
        {
          page: dirLabel,
          rule: 'unreadable',
          message: `cannot read ${dirLabel}: ${(err as Error).message}`,
        },
      ],
      advisories: [],
    };
  }

  // Read every page once — the opt-in test and the rule checks share the bodies.
  const reads = await Promise.all(
    ARCHITECTURE_PAGES.map(async (page) => ({
      page,
      path: join(dir, pageFilename(page)),
      label: toPosixRelative(cwd, join(dir, pageFilename(page))),
      read: await readPage(join(dir, pageFilename(page))),
    })),
  );

  const untouched = reads.every((r) => r.read.ok && r.read.body.includes(PLACEHOLDER_MARKER));
  if (untouched) return { status: 'absent', findings: [], advisories: [] };

  // Registry order, then rule order within a page — nothing depends on the
  // order the filesystem happened to return.
  const findings: ArchitectureFinding[] = [];
  for (const { page, label, read } of reads) {
    if (!read.ok) {
      findings.push({
        page: label,
        rule: read.missing ? 'missing' : 'unreadable',
        message: read.missing
          ? `${label} is missing — ${page.purpose}`
          : `${label} could not be read: ${read.message}`,
      });
      continue;
    }
    const kinds = fenceKinds(read.body);
    if (kinds.length === 0) {
      findings.push({
        page: label,
        rule: 'no-fence',
        message: `${label} carries no mermaid fence`,
      });
      // Membership is tested allowed-against-declared, not the reverse: the
      // registry is `as const`, so `allowedKinds.includes(someString)` narrows
      // its parameter to the page's own literal union and rejects a plain
      // `string`. Intersecting in this direction is the same test without a cast.
    } else if (!page.allowedKinds.some((allowed) => kinds.includes(allowed))) {
      findings.push({
        page: label,
        rule: 'bad-kind',
        message: `${label} declares ${kinds.join(', ')}; expected one of ${page.allowedKinds.join(', ')}`,
      });
    }
    if (read.body.includes(PLACEHOLDER_MARKER)) {
      findings.push({
        page: label,
        rule: 'placeholder',
        message: `${label} still carries a ${PLACEHOLDER_MARKER} placeholder`,
      });
    }
  }

  // A page is blocked when any rule fired for it — that page's form rows stay silent.
  const blocked = new Set(
    reads.filter((r) => findings.some((f) => f.page === r.label)).map((r) => r.page.id),
  );
  const advisories = [
    ...(await collectModuleAdvisories(cwd, reads)),
    ...collectFormAdvisories(reads, blocked),
  ];
  return { status: findings.length > 0 ? 'incomplete' : 'ok', findings, advisories };
}

/**
 * Modules the code has that the modules page never names.
 *
 * Skipped entirely when the modules page is absent or unreadable: that is
 * already one finding, and burying it under one advisory per module would make
 * the real problem harder to see.
 */
/**
 * Form advisories for the pages the blocking rules accepted.
 *
 * Gated deliberately: a page that is missing, unreadable, still scaffolded or
 * undrawable produces its blocking finding and nothing else. Piling advisory
 * rows onto a page whose real problem is that it does not exist yet is how the
 * channel loses its reader.
 *
 * Module advisories are NOT gated this way and are collected separately —
 * `collectModuleAdvisories` skips only an unreadable modules page, so a readable
 * placeholder page emits its module rows today. That is shipped behaviour and
 * gating it here would silently delete rows a consumer already sees.
 */
function collectFormAdvisories(
  reads: readonly {
    page: (typeof ARCHITECTURE_PAGES)[number];
    label: string;
    read: PageRead;
  }[],
  blocked: ReadonlySet<string>,
): ArchitectureAdvisory[] {
  const out: ArchitectureAdvisory[] = [];
  for (const { page, label, read } of reads) {
    if (!read.ok || blocked.has(page.id)) continue;
    const form = assessPageForm(page, read.body);

    for (const section of form.missing) {
      out.push({
        kind: 'section',
        pageId: page.id,
        page: label,
        section,
        message:
          `${label} does not name section "${section}" — add a \`## ${section}\` heading, ` +
          `or record why it does not apply: ` +
          `\`<!-- ${SECTION_CUT_TOKEN} ${section} — <reason> -->\``,
      });
    }

    for (const cut of form.unknownCuts) {
      out.push({
        kind: 'unknown-cut',
        pageId: page.id,
        page: label,
        section: cut.name,
        ordinal: cut.ordinal,
        message:
          `${label} declines "${cut.name}", which is not one of its sections or carries no ` +
          `reason — a decline reads \`<!-- ${SECTION_CUT_TOKEN} <section> — <reason> -->\`.`,
      });
    }

    const bloat = assessPageBloat(read.body);
    for (const paragraph of bloat.longParagraphs) {
      out.push({
        kind: 'long-paragraph',
        pageId: page.id,
        page: label,
        index: paragraph.index,
        words: paragraph.words,
        message:
          `${label} has a ${paragraph.words}-word paragraph (threshold ` +
          `${ARCH_PARAGRAPH_WORD_THRESHOLD}) at prose paragraph ${paragraph.index + 1} — split ` +
          `it into labelled facts or a table.`,
      });
    }
    if (bloat.pageWords !== null) {
      out.push({
        kind: 'page-bloat',
        pageId: page.id,
        page: label,
        words: bloat.pageWords,
        message:
          `${label} carries ${bloat.pageWords} prose words (threshold ` +
          `${ARCH_PAGE_PROSE_WORD_THRESHOLD}) — the page has grown into an essay.`,
      });
    }

    if (form.flowHeadings !== null && form.flowHeadings < 1) {
      out.push({
        kind: 'flow-headings',
        pageId: page.id,
        page: label,
        count: form.flowHeadings,
        message: `${label} names no flow as a heading — give each load-bearing flow its own \`## \` section.`,
      });
    }
  }
  return out;
}

async function collectModuleAdvisories(
  cwd: string,
  reads: readonly { page: { id: ArchitecturePageId }; label: string; read: PageRead }[],
): Promise<ArchitectureAdvisory[]> {
  const modulesPage = reads.find((r) => r.page.id === 'modules');
  if (!modulesPage?.read.ok) return [];
  const body = modulesPage.read.body;
  const label = modulesPage.label;
  return (await listModuleDirs(cwd))
    .filter((module) => !mentionsModule(body, module))
    .map((module) => ({
      kind: 'module' as const,
      pageId: modulesPage.page.id,
      page: label,
      module,
      message: `${label} does not name ${module}`,
    }));
}

/**
 * `noldor docs architecture [--check]` — `--check` is the only mode and the
 * default, so the bare invocation behaves identically.
 *
 * Findings go to stderr and advisories to stdout: advisories print on runs that
 * exit 0, so they must not read as failures.
 */
async function main(): Promise<void> {
  const report = await checkArchitecture(process.cwd());

  if (report.status === 'absent') {
    console.log('architecture: no opted-in docs/architecture/ — nothing to check.');
    return;
  }

  for (const advisory of report.advisories) {
    console.log(`advisory: ${advisory.message}`);
  }

  if (report.findings.length === 0) {
    console.log(`architecture: ${ARCHITECTURE_PAGES.length} page(s) OK.`);
    return;
  }

  for (const finding of report.findings) {
    console.error(`${finding.rule}: ${finding.message}`);
  }
  console.error(`\n${report.findings.length} architecture finding(s).`);
  process.exitCode = 1;
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('docs-architecture');
if (invokedDirect) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
