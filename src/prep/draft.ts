import { PLAN_FORMAT, SPEC_FORMAT } from './formats.js';

import type { PrepEntry } from './types.js';

/** Instruction for one drafting child: research the entry, write spec [+plan] + meta.json to staging. */
export function buildDraftPrompt(entry: PrepEntry, today: string, batchDir: string): string {
  const specPath = `${batchDir}/${entry.slug}.spec.md`;
  const planPath = `${batchDir}/${entry.slug}.plan.md`;
  const metaPath = `${batchDir}/${entry.slug}.meta.json`;
  const wantsPlan = entry.tier === 'full';
  return [
    'You are drafting design artifacts for ONE Noldor roadmap entry so the operator can batch-review many at once. Repo root is the current working directory.',
    '',
    'ENTRY (JSON):',
    JSON.stringify(entry, null, 2),
    '',
    `today=${today}  batchDir=${batchDir}`,
    '',
    'STEP 1 — GROUND YOURSELF. Read docs/vision.md.',
    entry.parent
      ? `Read the parent FD docs/features/${entry.parent}.md (this entry attaches to it).`
      : 'No parent FD; standalone entry.',
    'Grep/read the actual code, docs, and tests this entry touches (use area + body to locate them). Cite concrete file paths and function names in your design. A spec that does not reference real code is a failure. If the body has a "Touches:" line, treat those paths as the implementation surface.',
    '',
    `STEP 2 — WRITE THE SPEC to ${specPath} (the batchDir already exists).`,
    SPEC_FORMAT,
    '',
    wantsPlan
      ? `STEP 3 — WRITE THE PLAN to ${planPath} (tier is full).\n${PLAN_FORMAT}`
      : 'STEP 3 — NO PLAN. Tier is specs-only (size M): the spec is the design artifact; implementation proceeds directly from it. Do NOT write a plan file.',
    '',
    `STEP 4 — WRITE METADATA to ${metaPath} as JSON with this exact shape:`,
    '{ "summary": "<one-line summary for the review table>", "confidence": "high|med|low", "risks": ["..."], "openQuestions": [ { "question": "...", "recommendation": "...", "rationale": "..." } ] }',
    'openQuestions must match the spec\'s "## Open questions (resolved)" section. If there were no genuine open questions, use an empty array — do not invent filler.',
    '',
    `Touch ONLY these files under ${batchDir}: ${entry.slug}.spec.md${wantsPlan ? `, ${entry.slug}.plan.md` : ''}, ${entry.slug}.meta.json. Do NOT edit docs/roadmap.md, docs/features/, the real docs/superpowers/ dirs, or any other entry's files — other agents run in parallel and share this tree.`,
  ].join('\n');
}
