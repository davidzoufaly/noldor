// @tests: noldor
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractArtifactLinks,
  fixArtifactLink,
  indexSrcByBasename,
  migrateOne,
  rewriteScriptsPaths,
  LOST_SENTINEL,
} from '../migrate-link-rot.js';

/** Repo fixture with a src tree + archive dirs. */
function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'mlr-'));
  mkdirSync(join(repo, 'src', 'cr'), { recursive: true });
  mkdirSync(join(repo, 'src', 'core'), { recursive: true });
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  mkdirSync(join(repo, 'docs', 'superpowers', 'plans', 'archive'), { recursive: true });
  mkdirSync(join(repo, 'docs', 'superpowers', 'specs', 'archive'), { recursive: true });
  writeFileSync(join(repo, 'src', 'cr', 'orchestrate.ts'), 'x');
  writeFileSync(join(repo, 'src', 'core', 'session.ts'), 'x');
  writeFileSync(join(repo, 'scripts', 'live.mjs'), 'x'); // still-live scripts file
  writeFileSync(join(repo, 'docs', 'superpowers', 'plans', 'archive', 'my-plan.md'), 'x');
  return repo;
}

describe('rewriteScriptsPaths', () => {
  it('direct-swaps, basename-maps, keeps live scripts, reports unresolved', () => {
    const repo = makeRepo();
    const byBasename = indexSrcByBasename(repo);
    const raw = [
      'a scripts/cr/orchestrate.ts b', // direct swap
      'c scripts/noldor/session.ts d', // basename map → src/core/session.ts
      'e scripts/live.mjs f', // still exists — untouched
      'g scripts/gone/never-existed.ts h', // unresolved
    ].join('\n');
    const { out, stats } = rewriteScriptsPaths(raw, repo, byBasename);
    expect(out).toContain('a src/cr/orchestrate.ts b');
    expect(out).toContain('c src/core/session.ts d');
    expect(out).toContain('e scripts/live.mjs f');
    expect(out).toContain('g scripts/gone/never-existed.ts h');
    expect(stats).toEqual({
      directSwaps: 1,
      basenameSwaps: 1,
      unresolved: ['scripts/gone/never-existed.ts'],
    });
  });

  it('leaves an ambiguous basename unresolved', () => {
    const repo = makeRepo();
    writeFileSync(join(repo, 'src', 'cr', 'session.ts'), 'x'); // second session.ts
    const byBasename = indexSrcByBasename(repo);
    const { out, stats } = rewriteScriptsPaths('scripts/noldor/session.ts', repo, byBasename);
    expect(out).toBe('scripts/noldor/session.ts');
    expect(stats.unresolved).toEqual(['scripts/noldor/session.ts']);
  });
});

describe('extractArtifactLinks', () => {
  it('collects plain, folded, and list artifact paths from frontmatter only', () => {
    const raw = [
      '---',
      'links:',
      '  spec: docs/superpowers/specs/a-design.md',
      '  plan: >-',
      '    docs/superpowers/plans/b.md',
      '---',
      '',
      'body mentions docs/superpowers/specs/body-only-design.md',
    ].join('\n');
    expect(extractArtifactLinks(raw)).toEqual([
      'docs/superpowers/specs/a-design.md',
      'docs/superpowers/plans/b.md',
    ]);
  });
});

describe('fixArtifactLink', () => {
  it('re-points a dead link to its archive twin file-wide', () => {
    const repo = makeRepo();
    const raw = [
      '---',
      'links:',
      '  plan: docs/superpowers/plans/my-plan.md',
      '---',
      'see docs/superpowers/plans/my-plan.md',
    ].join('\n');
    const r = fixArtifactLink(raw, 'docs/superpowers/plans/my-plan.md', repo);
    expect(r.action).toBe('archive');
    expect(r.out).toContain('plan: docs/superpowers/plans/archive/my-plan.md');
    expect(r.out).toContain('see docs/superpowers/plans/archive/my-plan.md');
  });

  it('sentinels a lost link in frontmatter only, leaving body prose', () => {
    const repo = makeRepo();
    const raw = [
      '---',
      'links:',
      '  spec: docs/superpowers/specs/archive/lost-design.md',
      '---',
      'see docs/superpowers/specs/archive/lost-design.md',
    ].join('\n');
    const r = fixArtifactLink(raw, 'docs/superpowers/specs/archive/lost-design.md', repo);
    expect(r.action).toBe('lost');
    expect(r.out).toContain(`spec: ${LOST_SENTINEL}`);
    expect(r.out).toContain('see docs/superpowers/specs/archive/lost-design.md');
  });

  it('no-ops on live links and on the sentinel itself (idempotent)', () => {
    const repo = makeRepo();
    const live = '---\nlinks:\n  plan: docs/superpowers/plans/archive/my-plan.md\n---\n';
    expect(fixArtifactLink(live, 'docs/superpowers/plans/archive/my-plan.md', repo).action).toBe(
      'none',
    );
    expect(fixArtifactLink(live, LOST_SENTINEL, repo).action).toBe('none');
  });
});

describe('migrateOne', () => {
  it('is idempotent: a second pass changes nothing', () => {
    const repo = makeRepo();
    const byBasename = indexSrcByBasename(repo);
    const raw = [
      '---',
      'links:',
      '  spec: docs/superpowers/specs/archive/lost-design.md',
      '  plan: docs/superpowers/plans/my-plan.md',
      '  code:',
      '    - scripts/cr/orchestrate.ts',
      '---',
      'body scripts/noldor/session.ts',
    ].join('\n');
    const first = migrateOne('x.md', raw, repo, byBasename);
    expect(first.result.changed).toBe(true);
    const second = migrateOne('x.md', first.out, repo, byBasename);
    expect(second.result.changed).toBe(false);
  });
});
