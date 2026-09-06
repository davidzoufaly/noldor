// @tests: acceptance-verify-lane, specs-cr-gate-multi-reviewer
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseSlug, type Slug } from '../../core/slug.js';
import { aggregate, describeStale } from '../aggregate.js';
import { writeExpectedLanes } from '../expected-lanes.js';

const FIX = resolve(__dirname, 'fixtures');

function slugOf(value: string): Slug {
  const parsed = parseSlug(value);
  if (!parsed.ok) throw new Error(`fixture slug is invalid: ${value}`);
  return parsed.slug;
}

let root: string;
let crDir: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agg-'));
  crDir = join(root, '.noldor', 'cr');
  await mkdir(crDir, { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const copy = (fixture: string, dest: string) => copyFile(join(FIX, fixture), join(crDir, dest));

describe('aggregate', () => {
  it('vacuous OK when dir empty', async () => {
    const r = await aggregate('x', undefined, { cwd: root });
    expect(r.ok).toBe(true);
    expect(r.blockers).toEqual([]);
  });
  it('clean single lane => ok', async () => {
    await copy('findings-clean.json', 'x-spec-manual.json');
    const r = await aggregate('x', 'spec', { cwd: root });
    expect(r.ok).toBe(true);
    expect(r.summaries.manual).toBe('operator approved');
  });
  it('blocker => not ok, blocker carries lane', async () => {
    await copy('findings-blockers.json', 'x-spec-reviewer.json');
    const r = await aggregate('x', 'spec', { cwd: root });
    expect(r.ok).toBe(false);
    expect(r.blockers[0].lane).toBe('reviewer');
    expect(r.blockers[0].severity).toBe('high');
    expect(r.notes.reviewer).toEqual(['Strengths: clear summary']);
  });
  it('unresolved (finishedAt unset) => not ok, lane in unresolved', async () => {
    await copy('findings-in-progress.json', 'x-spec-standalone.json');
    const r = await aggregate('x', 'spec', { cwd: root });
    expect(r.ok).toBe(false);
    expect(r.unresolved).toEqual(['standalone']);
  });
  it('payload-lane mismatch with filename => corruption blocker', async () => {
    // filename says manual; payload says codex
    await copy('findings-lane-mismatch.json', 'x-spec-manual.json');
    const r = await aggregate('x', 'spec', { cwd: root });
    expect(r.ok).toBe(false);
    expect(r.blockers[0].message).toMatch(/lane.*mismatch/i);
  });
  it('parse error => synthetic blocker', async () => {
    await writeFile(join(crDir, 'x-spec-manual.json'), '{not json', 'utf8');
    const r = await aggregate('x', 'spec', { cwd: root });
    expect(r.ok).toBe(false);
    expect(r.blockers[0].message).toMatch(/parse/i);
  });
  it('schema error => synthetic blocker', async () => {
    await writeFile(join(crDir, 'x-spec-manual.json'), JSON.stringify({ lane: 'manual' }), 'utf8');
    const r = await aggregate('x', 'spec', { cwd: root });
    expect(r.ok).toBe(false);
    expect(r.blockers[0].message).toMatch(/schema/i);
  });
  it('non-conforming filename => synthetic blocker', async () => {
    await writeFile(join(crDir, 'x-spec-unknown.json'), '{}', 'utf8');
    const r = await aggregate('x', 'spec', { cwd: root });
    expect(r.ok).toBe(false);
    expect(r.blockers[0].message).toMatch(/non-conforming/);
  });
  it('ignores .tmp files', async () => {
    await writeFile(join(crDir, 'x-spec-manual.json.tmp'), '{}', 'utf8');
    const r = await aggregate('x', 'spec', { cwd: root });
    expect(r.ok).toBe(true);
  });
  it('cross-kind union when kind omitted', async () => {
    await copy('findings-clean.json', 'x-spec-manual.json');
    await copy('findings-blockers.json', 'x-plan-reviewer.json');
    const r = await aggregate('x', undefined, { cwd: root });
    expect(r.ok).toBe(false);
    expect(Object.keys(r.summaries).toSorted()).toEqual(['manual', 'reviewer']);
  });
  describe('expected-lanes record (Q-0100)', () => {
    const writeExpected = async (kind: string, lanes: string[]) => {
      const dir = join(root, '.noldor', 'cr', 'expected');
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, `x-${kind}.json`),
        JSON.stringify({ slug: 'x', kind, lanes }),
        'utf8',
      );
    };

    it('expected lane with no sink => unresolved, not ok', async () => {
      await writeExpected('code', ['reviewer']);
      const r = await aggregate('x', 'code', { cwd: root });
      expect(r.ok).toBe(false);
      expect(r.unresolved).toEqual(['reviewer']);
    });
    it('every expected lane has a sink => ok', async () => {
      await writeExpected('spec', ['manual']);
      await copy('findings-clean.json', 'x-spec-manual.json');
      const r = await aggregate('x', 'spec', { cwd: root });
      expect(r.ok).toBe(true);
      expect(r.unresolved).toEqual([]);
    });
    it('legacy-named sink satisfies its canonical expected lane', async () => {
      await writeExpected('spec', ['reviewer']);
      await copy('findings-blockers.json', 'x-spec-subagent.json');
      const r = await aggregate('x', 'spec', { cwd: root });
      expect(r.unresolved).toEqual([]); // red via blockers, but not missing
    });
    it('corrupt expected record => blocker, not silent fail-open', async () => {
      const dir = join(root, '.noldor', 'cr', 'expected');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'x-spec.json'), '{not json', 'utf8');
      const r = await aggregate('x', 'spec', { cwd: root });
      expect(r.ok).toBe(false);
      expect(r.blockers[0].message).toMatch(/expected-lanes record corrupt/);
    });
    it('unions expected lanes across kinds when kind omitted', async () => {
      await writeExpected('spec', ['manual']);
      await writeExpected('code', ['reviewer']);
      await copy('findings-clean.json', 'x-spec-manual.json');
      const r = await aggregate('x', undefined, { cwd: root });
      expect(r.ok).toBe(false);
      expect(r.unresolved).toEqual(['reviewer']);
    });
    it('does not double-report a lane both in-progress and expected', async () => {
      await writeExpected('spec', ['standalone']);
      await copy('findings-in-progress.json', 'x-spec-standalone.json');
      const r = await aggregate('x', 'spec', { cwd: root });
      expect(r.unresolved).toEqual(['standalone']);
    });
  });

  describe('integrity tagging (Q-0154)', () => {
    it('a finding a lane filed is not tagged integrity', async () => {
      await copy('findings-blockers.json', 'x-spec-reviewer.json');
      const r = await aggregate('x', 'spec', { cwd: root });
      expect(r.blockers.map((b) => b.integrity)).toEqual([undefined]);
    });
    it('unparseable sink is tagged integrity', async () => {
      await writeFile(join(crDir, 'x-spec-manual.json'), '{not json', 'utf8');
      const r = await aggregate('x', 'spec', { cwd: root });
      expect(r.blockers[0].integrity).toBe(true);
    });
    it('schema-invalid sink is tagged integrity', async () => {
      await writeFile(
        join(crDir, 'x-spec-manual.json'),
        JSON.stringify({ lane: 'manual' }),
        'utf8',
      );
      const r = await aggregate('x', 'spec', { cwd: root });
      expect(r.blockers[0].integrity).toBe(true);
    });
    it('non-conforming filename is tagged integrity', async () => {
      await writeFile(join(crDir, 'x-spec-unknown.json'), '{}', 'utf8');
      const r = await aggregate('x', 'spec', { cwd: root });
      expect(r.blockers[0].integrity).toBe(true);
    });
    it('lane mismatch is tagged integrity', async () => {
      await copy('findings-lane-mismatch.json', 'x-spec-manual.json');
      const r = await aggregate('x', 'spec', { cwd: root });
      expect(r.blockers[0].integrity).toBe(true);
    });
    it('corrupt expected-lanes record is tagged integrity', async () => {
      const dir = join(root, '.noldor', 'cr', 'expected');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'x-spec.json'), '{not json', 'utf8');
      const r = await aggregate('x', 'spec', { cwd: root });
      expect(r.blockers[0].integrity).toBe(true);
    });
    it('separates a lane-filed finding from an integrity blocker in one round', async () => {
      await copy('findings-blockers.json', 'x-spec-reviewer.json');
      await writeFile(join(crDir, 'x-spec-manual.json'), '{not json', 'utf8');
      const r = await aggregate('x', 'spec', { cwd: root });
      expect(r.blockers.filter((b) => b.integrity === true)).toHaveLength(1);
      expect(r.blockers.filter((b) => b.integrity === undefined)).toHaveLength(1);
    });
  });

  // A sink is only as current as the round that wrote it. `orchestrate` refuses
  // at the round cap BEFORE it records the round, so nothing rewrites the sinks
  // and the previous round's findings read as live (PR #437: three blockers
  // reported, two already fixed in a later commit).
  describe('stale round detection (Q-0211)', () => {
    const SLUG = slugOf('x');
    let repo: string;

    const git = (args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    const head = () => git(['rev-parse', 'HEAD']).trim();
    const sink = (fixture: string, name: string) =>
      copyFile(join(FIX, fixture), join(repo, '.noldor', 'cr', name));
    /** The clean fixture's payload lane is `manual`; the sink name must agree. */
    const cleanCodeSink = () => sink('findings-clean.json', 'x-code-manual.json');
    /** A commit that changes content — the thing a re-review would be about. */
    const commitEdit = (body: string) => {
      writeFileSync(join(repo, 'a.txt'), body);
      git(['commit', '-aqm', `edit: ${body.trim()}`]);
    };

    beforeEach(() => {
      repo = mkdtempSync(join(tmpdir(), 'agg-stale-'));
      git(['init', '-q', '-b', 'main']);
      git(['config', 'user.email', 't@example.com']);
      git(['config', 'user.name', 'T']);
      writeFileSync(join(repo, 'a.txt'), 'one\n');
      git(['add', '-A']);
      git(['commit', '-qm', 'base']);
      // After the commit, so the sinks stay out of the tree the check reads —
      // matching the real repo, where `.noldor/` is ignored.
      mkdirSync(join(repo, '.noldor', 'cr', 'expected'), { recursive: true });
    });
    afterEach(() => rmSync(repo, { recursive: true, force: true }));

    it('a round dispatched against the current tree is not stale', async () => {
      await writeExpectedLanes(repo, SLUG, 'code', ['manual'], head());
      await cleanCodeSink();
      const r = await aggregate(SLUG, 'code', { cwd: repo });
      expect(r.stale).toEqual([]);
      expect(r.ok).toBe(true);
    });

    it('a commit after the round reds an otherwise-green verdict', async () => {
      await writeExpectedLanes(repo, SLUG, 'code', ['manual'], head());
      await cleanCodeSink();
      // Green first, so staleness is the only thing that can flip it below.
      expect((await aggregate(SLUG, 'code', { cwd: repo })).ok).toBe(true);

      const dispatched = head();
      commitEdit('two\n');

      const r = await aggregate(SLUG, 'code', { cwd: repo });
      expect(r.ok).toBe(false);
      expect(r.stale).toHaveLength(1);
      expect(r.stale[0]?.kind).toBe('code');
      expect(r.stale[0]?.headSha).toBe(dispatched);
      expect(r.stale[0]?.currentTree).toBe(git(['rev-parse', 'HEAD^{tree}']).trim());
    });

    it('keeps stale rounds out of `blockers`, which the round ledger fingerprints', async () => {
      await writeExpectedLanes(repo, SLUG, 'code', ['reviewer'], head());
      await sink('findings-blockers.json', 'x-code-reviewer.json');
      const before = await aggregate(SLUG, 'code', { cwd: repo });
      commitEdit('two\n');
      const after = await aggregate(SLUG, 'code', { cwd: repo });

      expect(after.stale).toHaveLength(1);
      expect(after.blockers).toEqual(before.blockers);
    });

    it('a message-only amend leaves the round current', async () => {
      // The receipt amend orchestrate performs after its lanes run is
      // tree-preserving, so a commit-sha comparison would call every green round
      // stale. This is the test that pins the comparison to the TREE.
      const dispatched = head();
      await writeExpectedLanes(repo, SLUG, 'code', ['manual'], dispatched);
      await cleanCodeSink();

      git(['commit', '--amend', '-qm', 'base + Noldor-Reviewed-Subagent trailer']);
      expect(head()).not.toBe(dispatched);

      const r = await aggregate(SLUG, 'code', { cwd: repo });
      expect(r.stale).toEqual([]);
      expect(r.ok).toBe(true);
    });

    it('a round whose commit no longer resolves is stale, not unknown', async () => {
      await writeExpectedLanes(repo, SLUG, 'code', ['manual'], '0'.repeat(40));
      await cleanCodeSink();
      const r = await aggregate(SLUG, 'code', { cwd: repo });
      expect(r.ok).toBe(false);
      expect(r.stale[0]?.roundTree).toBeNull();
      expect(describeStale(r.stale[0]!)).toMatch(/no longer resolves/);
    });

    it('a record with no head stamp is unknown, never stale', async () => {
      // Pre-Q-0211 records carry no stamp. Reporting those as stale would red
      // every round already on disk in a consumer repo.
      await writeExpectedLanes(repo, SLUG, 'code', ['manual']);
      await cleanCodeSink();
      commitEdit('two\n');
      const r = await aggregate(SLUG, 'code', { cwd: repo });
      expect(r.stale).toEqual([]);
      expect(r.ok).toBe(true);
    });

    it('disables itself where git cannot resolve HEAD', async () => {
      // `root` is a bare tmpdir from the outer setup — asserted, not assumed.
      expect(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root }).status).not.toBe(0);
      await mkdir(join(root, '.noldor', 'cr', 'expected'), { recursive: true });
      await writeExpectedLanes(root, SLUG, 'code', ['manual'], '0'.repeat(40));
      await copy('findings-clean.json', 'x-code-manual.json');
      const r = await aggregate(SLUG, 'code', { cwd: root });
      expect(r.stale).toEqual([]);
      expect(r.ok).toBe(true);
    });

    it('reports each kind separately when kind is omitted', async () => {
      const dispatched = head();
      await writeExpectedLanes(repo, SLUG, 'spec', ['manual'], dispatched);
      await writeExpectedLanes(repo, SLUG, 'code', ['manual'], dispatched);
      await sink('findings-clean.json', 'x-spec-manual.json');
      await cleanCodeSink();
      commitEdit('two\n');
      const r = await aggregate(SLUG, undefined, { cwd: repo });
      expect(r.stale.map((s) => s.kind).toSorted()).toEqual(['code', 'spec']);
    });
  });

  it('emits notes entry when standalone templateSha drifts vs current', async () => {
    await mkdir(join(root, 'src', 'cr'), { recursive: true });
    await writeFile(
      join(root, 'src', 'cr', 'standalone-prompt.md'),
      'current template body',
      'utf8',
    );
    const stub = {
      lane: 'standalone',
      artifact: 'docs/x.md',
      kind: 'spec',
      slug: 'x',
      blockers: [],
      suggestions: [],
      summary: 'done',
      startedAt: '2026-05-25T00:00:00.000Z',
      finishedAt: '2026-05-25T00:00:01.000Z',
      templateSha: '0000000000000000000000000000000000000000', // intentionally stale
    };
    await writeFile(join(crDir, 'x-spec-standalone.json'), JSON.stringify(stub), 'utf8');
    const r = await aggregate('x', 'spec', { cwd: root });
    expect(r.notes.standalone?.[0]).toMatch(/template SHA drifted/);
  });
});
