// @tests: architecture-invariants

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeRuleConflictsInvariant } from '../../invariants/rule-conflicts.js';

async function makeRepo() {
  const root = await mkdtemp(join(tmpdir(), 'inv-rule-'));
  await mkdir(join(root, 'docs'), { recursive: true });
  return root;
}

describe('rule-conflicts plugin', () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await rm(repo, { force: true, recursive: true });
  });

  it('passes when both docs match the canonical phrasing', async () => {
    await writeFile(join(repo, 'a.md'), 'foo owns bar field');
    await writeFile(join(repo, 'b.md'), 'foo owns bar field');
    const inv = makeRuleConflictsInvariant(repo, [
      {
        docA: 'a.md',
        docB: 'b.md',
        message: 'must agree',
        name: 'test',
        patternA: /owns/,
        patternB: /owns/,
      },
    ]);
    const result = await inv.run();
    expect(result.violations).toHaveLength(0);
  });

  it('flags when only one side matches', async () => {
    await writeFile(join(repo, 'a.md'), 'foo owns bar field');
    await writeFile(join(repo, 'b.md'), 'unrelated content');
    const inv = makeRuleConflictsInvariant(repo, [
      {
        docA: 'a.md',
        docB: 'b.md',
        message: 'must agree',
        name: 'test',
        patternA: /owns/,
        patternB: /owns/,
      },
    ]);
    const result = await inv.run();
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.message).toContain('must agree');
  });

  it('passes when neither side matches (rule absent in both)', async () => {
    await writeFile(join(repo, 'a.md'), 'unrelated');
    await writeFile(join(repo, 'b.md'), 'unrelated');
    const inv = makeRuleConflictsInvariant(repo, [
      {
        docA: 'a.md',
        docB: 'b.md',
        message: 'must agree',
        name: 'test',
        patternA: /owns/,
        patternB: /owns/,
      },
    ]);
    const result = await inv.run();
    expect(result.violations).toHaveLength(0);
  });
});
