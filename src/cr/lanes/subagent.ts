import { join } from 'node:path';
import { discoverChangedFiles } from '../../core/branch-added.js';
import { renderBrief, unionResults } from '../../rules/brief.js';
import { runResolve } from '../../rules/cli-cores.js';
import { writeJsonAtomic } from '../atomic-write.js';
import type { Finding, LaneFindings } from '../findings-schema.js';
import type { LaneInput, LaneResult } from '../lane-types.js';
import { readFdSummary } from '../read-fd-summary.js';
import { splitClassTag } from '../finding-class.js';
import { extractLocations } from '../locations.js';
import { dispatchSubagent } from './subagent-dispatch.js';

interface ParsedMarkdown {
  strengths: string;
  critical: string[];
  important: string[];
  minor: string[];
  assessment: string;
}

/**
 * Tolerates leading `**`, `###`, `- ` decorations on the heading labels.
 * Subagents in practice deviate from a strict plain-text format; the parser
 * normalizes by stripping common markdown decorations from BOTH sides
 * (label and value) of each heading line before matching.
 */
function stripDecorations(s: string): string {
  return s.replace(/^[#\-*\s]+/, '').replace(/[*\s]+$/, '');
}

export function parseSubagentMarkdown(md: string): ParsedMarkdown | null {
  const normalized = md
    .split('\n')
    .map((line) => {
      const m = line.match(
        /^[#\-*\s]*(Strengths|Issues|Critical|Important|Minor|Assessment):\*?\*?\s*(.*)$/,
      );
      if (!m) return line;
      const label = stripDecorations(m[1]);
      const value = stripDecorations(m[2]);
      return `${label}:${value ? ' ' + value : ''}`;
    })
    .join('\n');

  const sMatch = normalized.match(/^Strengths:\s*(.+)$/im);
  const iMatch = normalized.match(/^Issues:\s*\n([\s\S]*?)(?=^Assessment:|$(?![\s\S]))/im);
  const aMatch = normalized.match(/^Assessment:\s*(.+)$/im);
  if (!sMatch || !iMatch || !aMatch) return null;

  const bucket = (label: string): string[] => {
    // Two shapes seen in real subagent output: a same-line item
    // (`Critical: - foo`, whose bullet dash normalization has already stripped
    // into the value) and/or `- foo` bullets on the following lines.
    const re = new RegExp(`^${label}:[^\\S\\n]*(.*)\\n?((?:\\s*-\\s+.+\\n?)*)`, 'im');
    const m = iMatch[1].match(re);
    if (!m) return [];
    const items: string[] = [];
    if (m[1]?.trim()) items.push(m[1].trim());
    if (m[2]) {
      items.push(
        ...m[2]
          .split(/\n/)
          .map((l) => l.replace(/^\s*-\s+/, '').trim())
          .filter(Boolean),
      );
    }
    return items;
  };

  return {
    strengths: sMatch[1].trim(),
    critical: bucket('Critical'),
    important: bucket('Important'),
    minor: bucket('Minor'),
    assessment: aMatch[1].trim(),
  };
}

/**
 * The files the round's range changed — the confinement boundary and basename
 * resolver for {@link extractLocations}.
 *
 * Deliberately NOT reused from {@link resolveBindingRules} below, which returns
 * at its first line for every `kind !== 'code'`: rules are code-only, locations
 * are not, and folding the two would leave spec and plan reviews with no set to
 * match against at all.
 *
 * Best-effort — a git failure yields `[]`, which costs locations for the round
 * and nothing else. Turning a review into a lane error over a git hiccup is the
 * one outcome worth avoiding here.
 */
export function resolveChangedFiles(opts: {
  repoRoot: string;
  base: string;
  head: string;
}): string[] {
  try {
    return discoverChangedFiles({ cwd: opts.repoRoot, base: opts.base, head: opts.head });
  } catch {
    return [];
  }
}

/**
 * Pre-render the cascade rules that BIND the changed files, for the reviewer
 * prompt. `undefined` (field omitted) whenever there is nothing binding to say.
 *
 * `--kind code` only: a spec or plan artifact has no source files to resolve
 * rules against. Best-effort — a git failure here must not turn a review into a
 * lane error, so it degrades to no rules section rather than throwing.
 *
 * The empty check is on the resolved bucket, never on `renderBrief`'s output:
 * that function returns an explanatory "no rules match" line by contract, so an
 * emptiness test on the string would ship that line into every prompt.
 */
function resolveBindingRules(input: LaneInput, baseSha: string): string | undefined {
  if (input.kind !== 'code') return undefined;
  let files: string[];
  try {
    files = discoverChangedFiles({
      cwd: input.repoRoot,
      base: baseSha,
      head: input.artifactSha,
    });
  } catch {
    return undefined;
  }
  if (files.length === 0) return undefined;
  // Keep only the files that actually carry a binding rule. A feature diff is
  // mostly docs, fixtures and state files that no `**/*.ts` rule can match, and
  // naming all of them in the header would spend prompt tokens implying the
  // rules govern paths they do not.
  const binding = files
    .map((file) => ({ file, resolved: runResolve(input.repoRoot, { file, stage: 'code' }) }))
    .filter(({ resolved }) => resolved.enforce.length > 0);
  if (binding.length === 0) return undefined;
  const { enforce } = unionResults(binding.map(({ resolved }) => resolved));
  return renderBrief(
    { enforce, injected: [] },
    { files: binding.map(({ file }) => file), stage: 'code', enforceOnly: true },
  );
}

/**
 * Bullet text -> {@link Finding}, curried on severity, the artifact label and
 * the round's changed files. Exported so the location and class parsing is
 * testable without a dispatch.
 *
 * `file` keeps its existing meaning — the artifact LABEL, not a location.
 * Rewriting it to the first resolved location would change what every existing
 * sink reader sees, and `fingerprintBlockers` hashes it, so the change would
 * silently invalidate every digest already in a ledger.
 */
export const mkFindingFor =
  (severity: 'high' | 'med' | 'low', artifact: string, changedFiles: readonly string[]) =>
  (bullet: string): Finding => {
    const { class: cls, message } = splitClassTag(bullet);
    const locations = extractLocations(message, changedFiles);
    return {
      file: artifact,
      severity,
      message,
      ...(cls ? { class: cls } : {}),
      ...(locations.length > 0 ? { locations } : {}),
    };
  };

export async function runSubagent(input: LaneInput): Promise<LaneResult> {
  const sinkPath = join(
    input.repoRoot,
    '.noldor',
    'cr',
    `${input.slug}-${input.kind}-reviewer.json`,
  );
  const startedAt = new Date().toISOString();
  // Two shas, two jobs. The PROMPT range honors `fullReview` — equal shas select
  // buildPrompt's "review the whole artifact" branch (before this, the
  // fullReviewOverride path deleted baseSha, the flag was ignored, and the
  // whole-artifact intent never reached the reviewer). RULES resolution keeps
  // the real change base: `git diff <head> <head>` names no files, which would
  // silently drop the binding-rules section from every code-kind full review.
  const rulesBaseSha = input.baseSha ?? `${input.artifactSha}~1`;
  const promptBaseSha = input.fullReview ? input.artifactSha : rulesBaseSha;
  // Resolved here, beside `rulesBaseSha`, so the two error paths below (dispatch
  // failure, parse failure) are unaffected — those write findings with no
  // location, which is correct.
  const changedFiles = resolveChangedFiles({
    repoRoot: input.repoRoot,
    base: rulesBaseSha,
    head: input.artifactSha,
  });

  let markdown: string;
  try {
    // Fast-track ships no FD, so a missing FD file is a legitimate state
    // (drain-mode code review), not an error — review the diff without the
    // summary context. A present-but-malformed FD still errors below.
    const fdSummary = await readFdSummary(input.fdPath).catch((err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT')
        return '(no FD — fast-track change; review the diff on its own merits)';
      throw err;
    });
    const rulesBrief = resolveBindingRules(input, rulesBaseSha);
    markdown = await dispatchSubagent({
      artifact: input.artifact,
      fdSummary,
      baseSha: promptBaseSha,
      headSha: input.artifactSha,
      description: `${input.kind} for FD ${input.slug}`,
      ...(input.reviewProfile ? { reviewProfile: input.reviewProfile } : {}),
      ...(rulesBrief !== undefined ? { rulesBrief } : {}),
      ...(input.priorReview !== undefined ? { priorReview: input.priorReview } : {}),
      ...(input.dispatchTimeoutMs !== undefined ? { timeoutMs: input.dispatchTimeoutMs } : {}),
    });
  } catch (err) {
    const errMsg = (err as NodeJS.ErrnoException).message ?? String(err);
    const payload: LaneFindings = {
      lane: 'reviewer',
      artifact: input.artifact,
      kind: input.kind,
      slug: input.slug,
      blockers: [
        {
          severity: 'high',
          file: input.artifact,
          message: `subagent lane errored: ${errMsg}`,
        },
      ],
      suggestions: [],
      summary: 'subagent error',
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(sinkPath, payload);
    return { lane: 'reviewer', sinkPath, ok: false };
  }

  const parsed = parseSubagentMarkdown(markdown);
  if (!parsed) {
    const payload: LaneFindings = {
      lane: 'reviewer',
      artifact: input.artifact,
      kind: input.kind,
      slug: input.slug,
      blockers: [
        {
          severity: 'high',
          file: input.artifact,
          message: `subagent returned malformed markdown: ${markdown.slice(0, 80)}…`,
        },
      ],
      suggestions: [],
      summary: 'subagent parse error',
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(sinkPath, payload);
    return { lane: 'reviewer', sinkPath, ok: false };
  }

  // Each bullet may carry a leading `[mechanical]` / `[design]` tag (see
  // buildPrompt). `splitClassTag` strips it into `class`; an untagged bullet
  // yields no `class` key, which `cr autofix` reads as `design`.
  const mkFinding = (severity: 'high' | 'med' | 'low') =>
    mkFindingFor(severity, input.artifact, changedFiles);

  const blockers = [
    ...parsed.critical.map(mkFinding('high')),
    ...parsed.important.map(mkFinding('med')),
  ];
  const suggestions = parsed.minor.map(mkFinding('low'));
  const payload: LaneFindings = {
    lane: 'reviewer',
    artifact: input.artifact,
    kind: input.kind,
    slug: input.slug,
    blockers,
    suggestions,
    summary: parsed.assessment,
    notes: [`Strengths: ${parsed.strengths}`],
    startedAt,
    finishedAt: new Date().toISOString(),
    ...(input.baseSha ? { baseSha: input.baseSha } : {}),
    ...(input.fullReview ? { fullReview: true } : {}),
  };

  await writeJsonAtomic(sinkPath, payload);
  return { lane: 'reviewer', sinkPath, ok: blockers.length === 0 };
}
