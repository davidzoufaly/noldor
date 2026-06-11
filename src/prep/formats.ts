/**
 * Canonical spec/plan format contracts — the single source consumed by the
 * prep drafting prompts (`draft.ts` imports the consts), the vendored
 * `noldor-spec` / `noldor-plan` skills, and any agent in any repo via
 * `pnpm noldor prep format <spec|plan>` (see `print-format.ts`).
 */

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
  '- TDD order per task: failing test -> run-to-verify-FAIL -> implement -> run-to-verify-PASS -> Commit (fenced bash: git add <paths> ; git commit -m "<conventional-commit>" -m "Noldor-FD: <slug>").',
  '- Each step = ONE 2-5 min action; code steps show COMPLETE real code; command steps show the exact command + Expected output. NO placeholders.',
].join('\n');
