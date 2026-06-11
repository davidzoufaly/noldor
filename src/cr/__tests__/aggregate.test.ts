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
    await copy('findings-blockers.json', 'x-spec-subagent.json');
    const r = await aggregate('x', 'spec', { cwd: root });
    expect(r.ok).toBe(false);
    expect(r.blockers[0].lane).toBe('subagent');
    expect(r.blockers[0].severity).toBe('high');
    expect(r.notes.subagent).toEqual(['Strengths: clear summary']);
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
    await copy('findings-blockers.json', 'x-plan-subagent.json');
    const r = await aggregate('x', undefined, { cwd: root });
    expect(r.ok).toBe(false);
    expect(Object.keys(r.summaries).toSorted()).toEqual(['manual', 'subagent']);
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
