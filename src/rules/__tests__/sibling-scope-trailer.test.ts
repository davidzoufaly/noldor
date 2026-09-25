// @tests: scope-sibling-trailer-for-doc-sync-commits, rules-cascade-v1
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadRulesFromDir } from '../load.js';
import { resolveRules } from '../resolve.js';

// The gate runs `rules brief --file <path> --stage code` before the first edit to a
// file, so a rule scoped to `docs/noldor/**` is how an operator hears about the
// sibling-scope trailer before the commit, rather than from the commit-msg rejection.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

describe.each([
  ['repo store', repoRoot],
  ['shipped template store', join(repoRoot, 'templates')],
])('sibling-scope-trailer rule (%s)', (_label, root) => {
  const { rules, errors } = loadRulesFromDir(root);

  it('surfaces the trailer when briefing a docs/noldor page', () => {
    expect(errors).toEqual([]);
    const { injected } = resolveRules(rules, { file: 'docs/noldor/pr-flow.md', stage: 'code' });
    const hit = injected.find((r) => r.id === 'sibling-scope-trailer');
    expect(hit?.body).toContain('Noldor-Sibling-Scope: noldor:<page>');
  });

  it('stays silent for a code-only file', () => {
    const { injected, enforce } = resolveRules(rules, {
      file: 'src/core/pr-flow.ts',
      stage: 'code',
    });
    expect([...injected, ...enforce].map((r) => r.id)).not.toContain('sibling-scope-trailer');
  });
});
