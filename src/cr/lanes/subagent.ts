import { join } from 'node:path';
import { writeJsonAtomic } from '../atomic-write.js';
import type { Finding, LaneFindings } from '../findings-schema.js';
import type { LaneInput, LaneResult } from '../lane-types.js';
import { readFdSummary } from '../read-fd-summary.js';
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
    const re = new RegExp(`^${label}:\\s*\\n?((?:\\s*-\\s+.+\\n?)*)`, 'im');
    const m = iMatch[1].match(re);
    if (!m || !m[1]) return [];
    return m[1]
      .split(/\n/)
      .map((l) => l.replace(/^\s*-\s+/, '').trim())
      .filter(Boolean);
  };

  return {
    strengths: sMatch[1].trim(),
    critical: bucket('Critical'),
    important: bucket('Important'),
    minor: bucket('Minor'),
    assessment: aMatch[1].trim(),
  };
}

export async function runSubagent(input: LaneInput): Promise<LaneResult> {
  const sinkPath = join(
    input.repoRoot,
    '.noldor',
    'cr',
    `${input.slug}-${input.kind}-subagent.json`,
  );
  const startedAt = new Date().toISOString();
  const baseShaForSlot = input.baseSha ?? `${input.artifactSha}~1`;

  let markdown: string;
  try {
    const fdSummary = await readFdSummary(input.fdPath);
    markdown = await dispatchSubagent({
      artifact: input.artifact,
      fdSummary,
      baseSha: baseShaForSlot,
      headSha: input.artifactSha,
      description: `${input.kind} for FD ${input.slug}`,
    });
  } catch (err) {
    const errMsg = (err as NodeJS.ErrnoException).message ?? String(err);
    const payload: LaneFindings = {
      lane: 'subagent',
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
    return { lane: 'subagent', sinkPath, ok: false };
  }

  const parsed = parseSubagentMarkdown(markdown);
  if (!parsed) {
    const payload: LaneFindings = {
      lane: 'subagent',
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
    return { lane: 'subagent', sinkPath, ok: false };
  }

  const mkFinding =
    (severity: 'high' | 'med' | 'low') =>
    (message: string): Finding => ({
      file: input.artifact,
      severity,
      message,
    });

  const blockers = [
    ...parsed.critical.map(mkFinding('high')),
    ...parsed.important.map(mkFinding('med')),
  ];
  const suggestions = parsed.minor.map(mkFinding('low'));
  const payload: LaneFindings = {
    lane: 'subagent',
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
  return { lane: 'subagent', sinkPath, ok: blockers.length === 0 };
}
