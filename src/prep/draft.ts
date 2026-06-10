import type { PrepEntry } from './types.js';

const SPEC_FORMAT = [
  'SPEC FORMAT (mirror the modern Noldor convention):',
  '- H1: "# <Human Name> — Design"',
  '- metadata block (bold lines) after H1: **Slug:**, **FD:** docs/features/<slug>.md, **Date:** <today>, **Tier:** <tier>, **Deps:** if any',
  '- ## Problem / ## Goals / ## Non-goals',
  '- ## Design (named units; reference the REAL files/functions you read — no hand-waving)',
  '- ## Acceptance criteria (testable bullets) / ## Risks / trade-offs',
  '- ## User Story (REQUIRED — "As a <user/agent>, I want <action>, so that <outcome>." The promote step lifts this verbatim into the FD.)',
  '- ## Usage (REQUIRED — CLI steps / agent API / keyboard surface. Lifted into the FD too.)',
  '- ## Open questions (resolved) (REQUIRED — numbered; for EACH open question state it in italics, then "-> <your recommended answer>" + a one-line rationale (D1),(D2)... You ANSWER your own questions so the operator ratifies, not originates.)',
].join('\n');

const PLAN_FORMAT = [
  'PLAN FORMAT (full tier only — mirror superpowers:writing-plans):',
  '- H1: "# <Feature Name> Implementation Plan"',
  '- blockquote: "> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking."',
  '- **Goal:** / **Architecture:** / **Tech Stack:** lines, then a --- rule',
  '- ## File Structure (one bullet per touched file: path — responsibility), then --- ',
  '- ## Task N: <name> blocks; each: **Files:** (Create:/Modify:/Test: exact paths) then "- [ ] **Step N: <imperative>**".',
  '- TDD order per task: failing test -> run-to-verify-FAIL -> implement -> run-to-verify-PASS -> Commit (fenced bash: git add <paths> ; git commit -m "<conventional-commit>" -m "Noldor-FD: <slug>").',
  '- Each step = ONE 2-5 min action; code steps show COMPLETE real code; command steps show the exact command + Expected output. NO placeholders.',
].join('\n');

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
