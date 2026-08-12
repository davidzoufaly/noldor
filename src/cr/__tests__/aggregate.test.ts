// @tests: acceptance-verify-lane, specs-cr-gate-multi-reviewer
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aggregate } from '../aggregate.js';

const FIX = resolve(__dirname, 'fixtures');

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
