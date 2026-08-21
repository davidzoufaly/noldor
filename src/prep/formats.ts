/**
 * Canonical spec/plan format contracts — the single source consumed by the
 * prep drafting prompts (`draft.ts` imports the consts), the vendored
 * `noldor-spec` / `noldor-plan` skills, and any agent in any repo via
 * `pnpm noldor prep format <spec|plan>` (see `print-format.ts`).
 */

import { MIN_SECTION_CHARS, sectionMarkers } from '../core/summary-body-contract.js';

export const SPEC_FORMAT = [
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

export const PLAN_FORMAT = [
  'PLAN FORMAT (full tier only):',
  '- H1: "# <Feature Name> Implementation Plan"',
  '- blockquote: "> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task\'s Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor."',
  '- **Goal:** / **Architecture:** / **Tech Stack:** lines, then a --- rule',
  '- ## File Structure (one bullet per touched file: path — responsibility), then --- ',
  '- ## Task N: <name> blocks; each: **Files:** (Create:/Modify:/Test: exact paths) then "- [ ] **Step N: <imperative>**".',
  `- TDD order per task: failing test -> run-to-verify-FAIL -> implement -> run-to-verify-PASS -> Commit (fenced bash: git add <paths> ; git commit -F <message-file>). The message file is a conventional-commit subject, a blank line, a free-form body explaining the change, then ONE trailing paragraph with every trailer ("Noldor-FD: <slug>", plus any other) — a second -m starts a new paragraph, after which \`git interpret-trailers --parse\` returns only the last one and strands Noldor-FD. The FIRST substantive commit's body becomes the PR Summary and pr-flow REJECTS the PR unless it carries sections starting with the markers ${sectionMarkers()} verbatim (em dash, NOT "Why:" — a colon is a valid git trailer and interpret-trailers absorbs it), each with at least ${String(MIN_SECTION_CHARS)} non-whitespace characters; write that body's three sections in the plan's first code-bearing task.`,
  '- Each step = ONE 2-5 min action; code steps show COMPLETE real code; command steps show the exact command + Expected output. NO placeholders.',
].join('\n');
