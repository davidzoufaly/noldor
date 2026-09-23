// @tests: refutation-judge-pass-before-a-blocker-can-red-a-round
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');

// The files a consumer's CR lanes read as review context (`readRules` in
// `src/cr/review-with-codex.ts`). A consumer has no `templates/` tree, so a
// rule naming one hands its reviewers a twin they will demand and cannot find.
const SHIPPED_RULE_CONTEXT = ['templates/.claude/engineering-rules.md', 'templates/AGENTS.md'];

describe('shipped rule context carries no framework-only text', () => {
  it.each(SHIPPED_RULE_CONTEXT)('%s names no templates/ path', (rel) => {
    const offending = readFileSync(join(ROOT, rel), 'utf8')
      .split('\n')
      .filter((line) => /\btemplates\//.test(line));
    expect(offending).toEqual([]);
  });
});
