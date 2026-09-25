// @tests: refutation-judge-pass-before-a-blocker-can-red-a-round, cr-re-round-cap-enforcement-and-oscillation-detector, specs-cr-gate-multi-reviewer, unvalidated-slug-path-traversal-across-cli-entry-points
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Slug } from '../../core/slug.js';
import type { Finding, LaneFindings } from '../findings-schema.js';
import type { LaneInput } from '../lane-types.js';

// The lane seam: each mocked lane writes a real sink from the next scripted body, so the judge
// and orchestrate read exactly what a lane would have written.
const { script } = vi.hoisted(() => ({
  script: { reviewer: [] as Partial<LaneFindings>[], codex: [] as Partial<LaneFindings>[] },
}));
function laneMock(lane: 'reviewer' | 'codex') {
  return vi.fn(async (input: LaneInput) => {
    const { writeJsonAtomic } = await import('../atomic-write.js');
    const path = join(input.repoRoot, '.noldor', 'cr', `${input.slug}-${input.kind}-${lane}.json`);
    const body = script[lane].shift() ?? {};
    await writeJsonAtomic(path, {
      lane,
      artifact: input.artifact,
      kind: input.kind,
      slug: input.slug,
      blockers: [],
      suggestions: [],
      summary: 'mock',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      ...body,
    });
    return { lane, sinkPath: path, ok: (body.blockers ?? []).length === 0 };
  });
}
vi.mock('../lanes/subagent.js', () => ({ runSubagent: laneMock('reviewer') }));
vi.mock('../lanes/codex.js', () => ({ runCodex: laneMock('codex') }));

import { readLedger } from '../autofix-ledger.js';
import { fingerprintBlocker } from '../fingerprint.js';
import { setJudgeDispatcher, type JudgeInput } from '../judge.js';
import { run } from '../orchestrate.js';

const SLUG = 'x' as Slug;
const SOURCE = [
  'export const retries = 3;',
  'export function run(): number {',
  '  if (retries > 0) return retry();',
  '  return 0;',
  '}',
  '',
].join('\n');
let root: string;
let judged: number;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}
const writeSession = (): void =>
  writeFileSync(
    join(root, '.noldor', 'session.json'),
    JSON.stringify({ path: 'fast-track', startedAt: 'S1' }),
  );

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orch-judge-'));
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, '.noldor', 'cr'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), SOURCE);
  git('add', '-A');
  git('commit', '-q', '-m', 'feat: retries', '--no-verify');
  writeSession();
  script.reviewer = [];
  script.codex = [];
  judged = 0;
});
afterEach(() => {
  setJudgeDispatcher(undefined);
  rmSync(root, { recursive: true, force: true });
});

const WRONG: Finding = {
  file: 'src/a.ts',
  severity: 'high',
  message: 'run never checks retries before retrying',
  locations: [{ file: 'src/a.ts', line: 3 }],
};
const REFUTE = {
  n: 1,
  verdict: 'refuted',
  why: 'run returns early unless retries is positive',
  evidence: [{ file: 'src/a.ts', line: 3, quote: 'if (retries > 0) return retry();' }],
};
const judgeAnswers = (answer: string): void =>
  setJudgeDispatcher(async () => {
    judged++;
    return answer;
  });
const args = (over: Record<string, unknown> = {}) => ({
  slug: SLUG,
  artifact: 'src/a.ts',
  kind: 'spec' as const,
  lanes: ['reviewer' as const],
  autonomous: true,
  headSha: git('rev-parse', 'HEAD'),
  ...over,
});
const tipLines = (key: string): string[] =>
  git('log', '-1', '--format=%B')
    .split('\n')
    .filter((l) => l.startsWith(`${key}:`));
const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});

describe('orchestrate runs the refutation judge before the verdict (Q-0262)', () => {
  it('turns a round green when its only blocker is refuted, and records the refutation', async () => {
    script.reviewer = [{ blockers: [WRONG] }];
    judgeAnswers(JSON.stringify({ verdicts: [REFUTE] }));
    const err = quiet();
    const r = await run({ args: args(), cwd: root });
    expect(r.exitCode).toBe(0);
    const ledger = await readLedger(root, SLUG, 'spec', 'S1');
    expect(ledger?.rounds.at(-1)).toMatchObject({
      verdict: 'green',
      refuted: [{ id: fingerprintBlocker(WRONG), lane: 'reviewer', why: REFUTE.why }],
    });
    expect(err.mock.calls.flat().join('\n')).toContain('judge: refuted 1 of 1');
    err.mockRestore();
  });

  it('leaves the round red, and the sink as written, when the judge gives no usable answer', async () => {
    script.reviewer = [{ blockers: [WRONG] }];
    judgeAnswers('this is not an answer');
    const err = quiet();
    const r = await run({ args: args(), cwd: root });
    err.mockRestore();
    expect(r.exitCode).toBe(1);
    const sink = JSON.parse(
      readFileSync(join(root, '.noldor', 'cr', 'x-spec-reviewer.json'), 'utf8'),
    );
    expect(sink.blockers).toEqual([WRONG]);
    expect((await readLedger(root, SLUG, 'spec', 'S1'))?.rounds.at(-1)?.verdict).toBe('red');
  });

  it.each([
    [
      'crReview.judge is false',
      () =>
        writeFileSync(
          join(root, '.noldor', 'config.json'),
          JSON.stringify({ crReview: { judge: false } }),
        ),
      {},
    ],
    ['HEAD could not be resolved', () => {}, { headSha: '' }],
  ])('dispatches no judge when %s, and the round stays red', async (_why, setup, over) => {
    setup();
    script.reviewer = [{ blockers: [WRONG] }];
    judgeAnswers(JSON.stringify({ verdicts: [REFUTE] }));
    const err = quiet();
    const r = await run({ args: args(over), cwd: root });
    err.mockRestore();
    expect(r.exitCode).toBe(1);
    expect(judged).toBe(0);
  });

  it('tells the judge the range the lanes reviewed, and no range when they reviewed the whole artifact', async () => {
    const base = git('rev-parse', 'HEAD');
    writeFileSync(join(root, 'src', 'a.ts'), `${SOURCE}// one more line\n`);
    git('add', '-A');
    git('commit', '-q', '-m', 'feat: more', '--no-verify');
    const head = git('rev-parse', 'HEAD');
    script.reviewer = [{ blockers: [WRONG] }, { blockers: [WRONG] }];
    const inputs: JudgeInput[] = [];
    setJudgeDispatcher(async (input) => {
      inputs.push(input);
      return JSON.stringify({ verdicts: [] });
    });
    const err = quiet();
    await run({ args: args({ baseSha: base, headSha: head }), cwd: root });
    await run({ args: args({ baseSha: base, headSha: head, fullReview: true }), cwd: root });
    err.mockRestore();
    expect(inputs.map((i) => i.baseSha)).toEqual([base, undefined]);
  });

  it('names the refutation on the code receipt, though the round reaches the ledger after the amend', async () => {
    script.reviewer = [{ blockers: [WRONG] }];
    judgeAnswers(JSON.stringify({ verdicts: [REFUTE] }));
    const err = quiet();
    const r = await run({ args: args({ kind: 'code' }), cwd: root });
    err.mockRestore();
    expect(r.exitCode).toBe(0);
    expect(tipLines('Noldor-CR-Refuted')).toEqual([
      `Noldor-CR-Refuted: code reviewer ${fingerprintBlocker(WRONG).slice(0, 12)} — ${REFUTE.why}`,
    ]);
    expect(tipLines('Noldor-Reviewed-Subagent')).toHaveLength(1);
  });

  it("names an earlier spec round's refutation on a later code receipt of the same session", async () => {
    script.reviewer = [{ blockers: [WRONG] }, {}];
    judgeAnswers(JSON.stringify({ verdicts: [REFUTE] }));
    const err = quiet();
    expect((await run({ args: args(), cwd: root })).exitCode).toBe(0);
    expect((await run({ args: args({ kind: 'code' }), cwd: root })).exitCode).toBe(0);
    err.mockRestore();
    expect(tipLines('Noldor-CR-Refuted')).toEqual([
      `Noldor-CR-Refuted: spec reviewer ${fingerprintBlocker(WRONG).slice(0, 12)} — ${REFUTE.why}`,
    ]);
    // The green code round had nothing to judge, so it dispatched no judge of its own.
    expect(judged).toBe(1);
  });
});
