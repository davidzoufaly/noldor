// @tests: feature-md-links-overhaul

import { spawnAgent } from '../core/agent-runner/registry.js';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import matter from 'gray-matter';

import { isInfraFile, loadSddFeatures, walkRepo } from '../core/fd-load.js';

import { loadConsumerConfig } from '../core/consumer-config.js';
import { scanRoots } from '../core/repo-paths.js';

import type { FeatureFrontmatter } from '../core/feature-schema.js';

/**
 * One candidate-FD match for an unreferenced code file. Confidence indicates
 * whether the resolver is sure about ownership: `high` for unambiguous matches
 * (single package candidate, slug-substring hit), `medium` for multi-candidate
 * slug matches, `low` for broad multi-candidate fallback.
 */
export type CandidateMatch = {
  fdSlug: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
};

/**
 * Input for the path-only resolver: a code file path and the universe of
 * feature MDs to match against.
 */
export type ResolverInput = {
  filePath: string;
  features: { slug: string; frontmatter: FeatureFrontmatter }[];
  /** Override the consumer config's `appPathPrefix` (defaults to loadConsumerConfig). */
  appPathPrefix?: string;
};

/**
 * Match an unreferenced code file to candidate FD MDs by `packages` field
 * intersection plus slug-substring match against the filename. Returns
 * candidates sorted by confidence; empty array when no path-only match
 * applies (caller should fall back to LLM).
 *
 * @param input - The file to attribute and the FD universe
 * @returns Candidate matches; `[]` when no package match found
 */
export function resolveByPath({
  filePath,
  features,
  appPathPrefix = loadConsumerConfig().appPathPrefix,
}: ResolverInput): CandidateMatch[] {
  const segments = filePath.split('/');
  const pkgIdx = segments.indexOf('packages');
  const pkg = pkgIdx >= 0 ? segments[pkgIdx + 1] : undefined;

  let candidates: ResolverInput['features'];
  if (pkg) {
    candidates = features.filter((f) => f.frontmatter.packages.includes(pkg));
  } else if (filePath.startsWith(appPathPrefix)) {
    candidates = features.filter(
      (f) =>
        f.frontmatter.packages.includes('web') ||
        ['web', 'viewport', 'ui'].includes(f.frontmatter.area),
    );
  } else if (filePath.startsWith('scripts/')) {
    const scriptsGroup = segments[1];
    candidates = features.filter(
      (f) => f.frontmatter.packages.includes('scripts') || f.frontmatter.area === scriptsGroup,
    );
  } else {
    return [];
  }

  if (candidates.length === 1) {
    return [
      {
        fdSlug: candidates[0].slug,
        confidence: 'high',
        reason: `only candidate via packages.${pkg ?? 'area'}`,
      },
    ];
  }

  if (candidates.length > 1) {
    const filename = segments[segments.length - 1].replace(/\.tsx?$/, '');
    const slugMatches = candidates.filter(
      (f) => f.slug.includes(filename) || filename.includes(f.slug.split('-')[0]),
    );
    if (slugMatches.length === 1) {
      return [
        {
          fdSlug: slugMatches[0].slug,
          confidence: 'high',
          reason: `slug substring: ${filename}`,
        },
      ];
    }
    if (slugMatches.length > 1) {
      return slugMatches.map((f) => ({
        fdSlug: f.slug,
        confidence: 'medium' as const,
        reason: `multiple slug matches`,
      }));
    }
    return candidates.map((f) => ({
      fdSlug: f.slug,
      confidence: 'low' as const,
      reason: `multiple package candidates`,
    }));
  }

  return [];
}

/**
 * Parse the JSON response from a second-opinion agent spawn into a
 * CandidateMatch. Returns null on parse error or missing/invalid fields.
 *
 * @param raw - Raw stdout from the agent spawn
 * @returns Parsed CandidateMatch, or null when invalid
 */
export function parseLlmResponse(raw: string): CandidateMatch | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (
    typeof o.chosen_fd_slug === 'string' &&
    typeof o.reason === 'string' &&
    (o.confidence === 'high' || o.confidence === 'medium' || o.confidence === 'low')
  ) {
    return {
      fdSlug: o.chosen_fd_slug,
      confidence: o.confidence,
      reason: o.reason,
    };
  }
  return null;
}

/**
 * Resolve via LLM: spawn a second-opinion-role agent (via the agent-runner
 * registry) with FD candidates plus file path and first 30 lines of source.
 * The prompt asks for JSON-only output matching the parseLlmResponse contract.
 *
 * @param filePath - Code file to attribute
 * @param candidates - Pre-filtered FD candidates from path-only resolver
 * @returns CandidateMatch from LLM, or null if call/parse fails
 */
export async function resolveByLlm(
  filePath: string,
  candidates: { slug: string; name: string; summary: string }[],
): Promise<CandidateMatch | null> {
  let sourceHead = '';
  try {
    sourceHead = readFileSync(filePath, 'utf8').split('\n').slice(0, 30).join('\n');
  } catch {
    return null;
  }
  const prompt = `Pick which feature MD owns this code file. Return JSON only: {"chosen_fd_slug": "<slug>", "confidence": "high|medium|low", "reason": "<one sentence>"}.

File: ${filePath}

Source (first 30 lines):
${sourceHead}

Candidates:
${candidates.map((c) => `- ${c.slug}: ${c.name} — ${c.summary.slice(0, 200)}`).join('\n')}`;

  let raw: string;
  try {
    const r = await spawnAgent(prompt, {
      role: 'second-opinion',
      timeoutMs: 60_000,
      site: 'features.fill-links-code-gaps',
    });
    if (r.timedOut || r.exitCode !== 0) return null;
    raw = r.stdout;
  } catch {
    return null;
  }
  return parseLlmResponse(raw);
}

/**
 * One file → FD assignment. Used in proposal generation and apply.
 */
export type Assignment = {
  filePath: string;
  match: CandidateMatch;
};

/**
 * One file the resolver couldn't confidently assign. Operator decides.
 */
export type Unassigned = {
  filePath: string;
  candidates: string[];
};

export type ProposalInput = {
  assignments: Assignment[];
  unassigned: Unassigned[];
};

/**
 * Render the proposal markdown for operator review. Groups assignments by
 * FD slug, sorts files within each group alphabetically, lists ambiguous
 * files in an UNASSIGNED section (omitted when empty).
 *
 * @param input - Assignments and unassigned files from the resolver
 * @returns Markdown body for `docs/.backfill-links-code.proposal.md`
 */
export function generateProposal({ assignments, unassigned }: ProposalInput): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    '# links.code Backfill Proposal',
    '',
    `Generated: ${today} by \`pnpm gaps:links-code --dry-run\`.`,
    '',
  ];

  const byFd = new Map<string, Assignment[]>();
  for (const a of assignments) {
    if (!byFd.has(a.match.fdSlug)) byFd.set(a.match.fdSlug, []);
    byFd.get(a.match.fdSlug)!.push(a);
  }

  for (const [fdSlug, items] of [...byFd.entries()].toSorted()) {
    lines.push(`## ${fdSlug}`, '');
    for (const a of items.toSorted((x, y) => x.filePath.localeCompare(y.filePath))) {
      lines.push(`- ${a.filePath} (${a.match.confidence} — ${a.match.reason})`);
    }
    lines.push('');
  }

  if (unassigned.length > 0) {
    lines.push('## UNASSIGNED (operator must choose)', '');
    for (const u of unassigned) {
      lines.push(`- ${u.filePath} (LLM low confidence: candidates [${u.candidates.join(', ')}])`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Parse a (possibly operator-edited) proposal markdown into FD slug → file
 * paths. Skips lines starting with `#` (operator-commented), skips the
 * UNASSIGNED section heading and its body.
 *
 * @param md - Proposal markdown contents
 * @returns Map of FD slug → array of file paths in the order they appeared
 */
export function parseProposal(md: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let currentFd: string | null = null;
  for (const rawLine of md.split('\n')) {
    const line = rawLine.trimEnd();
    if (line.startsWith('## ')) {
      const heading = line.slice(3).trim();
      if (heading.startsWith('UNASSIGNED')) {
        currentFd = null;
        continue;
      }
      currentFd = heading;
      out.set(currentFd, []);
      continue;
    }
    if (!currentFd) continue;
    const fileMatch = line.match(/^- ([^ #][^ ]*)/);
    if (fileMatch) {
      out.get(currentFd)!.push(fileMatch[1]);
    }
  }
  return out;
}

/**
 * Apply a parsed proposal to FD MDs: for each FD slug in the map, write its
 * file paths into `links.code` (deduped, sorted alphabetically). Skips FDs
 * where the array would be unchanged.
 *
 * @param parsed - Output of parseProposal
 * @param featuresDir - Path to docs/features (e.g. 'docs/features')
 * @returns Number of FD MDs modified
 */
export function applyProposal(parsed: Map<string, string[]>, featuresDir: string): number {
  let modified = 0;
  for (const [fdSlug, files] of parsed.entries()) {
    const path = `${featuresDir}/${fdSlug}.md`;
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    const fm = matter(raw);
    const links = (fm.data.links ?? {}) as Record<string, unknown>;
    const existing = Array.isArray(links.code) ? (links.code as string[]) : [];
    const merged = [...new Set([...existing, ...files])].toSorted();
    if (JSON.stringify(merged) === JSON.stringify(existing)) continue;
    fm.data.links = { ...links, code: merged };
    const out = matter.stringify(fm.content, fm.data);
    writeFileSync(path, out, 'utf8');
    modified += 1;
  }
  return modified;
}

/**
 * Copy all `.md` files in featuresDir to a timestamped backup directory.
 * The backup lives outside featuresDir to avoid `validate-features.ts walkDir`
 * picking it up as duplicate FDs.
 *
 * @param featuresDir - Path to docs/features (e.g. 'docs/features')
 * @param backupRoot - Parent dir for timestamped backups (default '.cache/backfill-backups')
 * @returns The created backup directory path
 */
export function backupFeatures(
  featuresDir: string,
  backupRoot = join('.cache', 'backfill-backups'),
): string {
  const ts = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const backupDir = join(backupRoot, ts);
  mkdirSync(backupDir, { recursive: true });
  const files = readdirSync(featuresDir).filter((f) => f.endsWith('.md'));
  for (const f of files) {
    copyFileSync(join(featuresDir, f), join(backupDir, f));
  }
  return backupDir;
}

const PROPOSAL_PATH = 'docs/.backfill-links-code.proposal.md';
const FEATURES_DIR = 'docs/features';

/**
 * Extract the first paragraph after `## Summary` from a feature MD body.
 * Returns empty string if no Summary section.
 *
 * @param body - Feature MD body (without frontmatter)
 */
function extractSummary(body: string): string {
  const match = body.match(/##\s+Summary\s*\n+([^\n]+(?:\n[^\n]+)*)/);
  return match ? match[1].split('\n\n')[0].replaceAll(/\s+/g, ' ').trim() : '';
}

/**
 * Main runner: dispatches between --dry-run (default), --apply, and
 * --auto-high modes. `--auto-high` is the non-interactive variant safe
 * for pre-commit hooks: it applies only deterministic single-match
 * `confidence: 'high'` assignments from {@link resolveByPath}, skipping
 * the LLM step and any ambiguous candidates entirely.
 */
async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const autoHigh = args.has('--auto-high');

  if (apply) {
    if (!existsSync(PROPOSAL_PATH)) {
      console.error(`No proposal at ${PROPOSAL_PATH}. Run --dry-run first.`);
      process.exit(1);
    }
    backupFeatures(FEATURES_DIR);
    const md = readFileSync(PROPOSAL_PATH, 'utf8');
    const parsed = parseProposal(md);
    const modified = applyProposal(parsed, FEATURES_DIR);
    unlinkSync(PROPOSAL_PATH);
    console.log(`Applied: ${modified} FD MDs updated. Proposal removed.`);
    return;
  }

  if (autoHigh) {
    await runAutoHigh();
    return;
  }

  const features = await loadSddFeatures(FEATURES_DIR);
  const referenced = new Set<string>();
  for (const f of features) {
    for (const c of f.frontmatter.links.code) referenced.add(c);
  }

  const candidateFiles = await collectCandidateFiles(referenced);

  const featureRows = features.map((f) => ({ slug: f.slug, frontmatter: f.frontmatter }));
  const summaryByFd = new Map<string, string>();
  for (const f of features) {
    const raw = readFileSync(join(FEATURES_DIR, `${f.slug}.md`), 'utf8');
    summaryByFd.set(f.slug, extractSummary(matter(raw).content));
  }

  const assignments: Assignment[] = [];
  const unassigned: Unassigned[] = [];

  for (const file of candidateFiles) {
    const matches = resolveByPath({ filePath: file, features: featureRows });
    if (matches.length === 1 && matches[0].confidence === 'high') {
      assignments.push({ filePath: file, match: matches[0] });
      continue;
    }
    if (matches.length === 0) {
      unassigned.push({ filePath: file, candidates: [] });
      continue;
    }
    const candidates = matches.map((m) => {
      const fd = features.find((f) => f.slug === m.fdSlug);
      return {
        slug: m.fdSlug,
        name: fd?.frontmatter.name ?? m.fdSlug,
        summary: summaryByFd.get(m.fdSlug) ?? '',
      };
    });
    const llmResult = await resolveByLlm(file, candidates);
    if (llmResult && llmResult.confidence !== 'low') {
      assignments.push({ filePath: file, match: llmResult });
    } else {
      unassigned.push({ filePath: file, candidates: candidates.map((c) => c.slug) });
    }
  }

  const md = generateProposal({ assignments, unassigned });
  writeFileSync(PROPOSAL_PATH, md, 'utf8');
  console.log(
    `Proposal written to ${PROPOSAL_PATH}. ${assignments.length} assigned, ${unassigned.length} unassigned. Review + edit, then run --apply.`,
  );
}

/**
 * Walk the consumer scan roots and return unreferenced candidate code files
 * for links-code gap filling. Shared by the interactive proposal flow and
 * `--auto-high`; exported for the standalone-layout regression tests.
 *
 * @param referenced - Code paths already present in some FD's `links.code`
 * @returns Repo-relative candidate file paths
 */
export async function collectCandidateFiles(referenced: Set<string>): Promise<string[]> {
  const allPaths: string[] = [];
  for (const root of scanRoots()) {
    await walkRepo(root, allPaths);
  }
  return allPaths.filter(
    (p) =>
      (p.endsWith('.ts') || p.endsWith('.tsx')) &&
      !p.includes('/__tests__/') &&
      !p.includes('/node_modules/') &&
      !p.endsWith('.test.ts') &&
      !p.endsWith('.test.tsx') &&
      !p.endsWith('.spec.ts') &&
      !p.includes('/dist/') &&
      !isInfraFile(p) &&
      !referenced.has(p),
  );
}

/**
 * Non-interactive backfill: deterministically assign code files to FDs
 * when `resolveByPath` returns a single high-confidence match. Skip
 * everything else (zero / multi-candidate / LLM-needed) silently.
 *
 * Safe to run from pre-commit hooks — no Claude invocation, no proposal
 * file, no operator prompts.
 */
async function runAutoHigh(): Promise<void> {
  const features = await loadSddFeatures(FEATURES_DIR);
  const referenced = new Set<string>();
  for (const f of features) {
    for (const c of f.frontmatter.links.code) referenced.add(c);
  }

  const candidateFiles = await collectCandidateFiles(referenced);

  const featureRows = features.map((f) => ({ slug: f.slug, frontmatter: f.frontmatter }));
  const proposal = new Map<string, string[]>();
  let skipped = 0;

  for (const file of candidateFiles) {
    const matches = resolveByPath({ filePath: file, features: featureRows });
    if (matches.length === 1 && matches[0].confidence === 'high') {
      const list = proposal.get(matches[0].fdSlug) ?? [];
      list.push(file);
      proposal.set(matches[0].fdSlug, list);
    } else {
      skipped += 1;
    }
  }

  const modified = applyProposal(proposal, FEATURES_DIR);
  console.log(
    `gaps:links-code --auto-high: applied ${[...proposal.values()].flat().length} file(s) to ${modified} FD(s); skipped ${skipped} ambiguous/unmatched (run \`pnpm gaps:links-code\` interactively to resolve).`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
