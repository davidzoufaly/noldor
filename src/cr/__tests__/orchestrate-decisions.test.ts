// @tests: cr-re-round-cap-enforcement-and-oscillation-detector
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Slug } from '../../core/slug.js';
import type { Finding, LaneFindings } from '../findings-schema.js';
import type { LaneInput } from '../lane-types.js';

// The lane seam: each mocked lane writes a real sink from the next scripted body, so orchestrate
// reads what a lane would have written — `resolved`, blockers — after the round.
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

import { readDecisions, updateDecisions, upsertDecision } from '../decisions.js';
import type { Decision } from '../decisions.js';
import { fingerprintBlocker } from '../fingerprint.js';
import { runCodex } from '../lanes/codex.js';
import { runSubagent } from '../lanes/subagent.js';
import { run } from '../orchestrate.js';

const SLUG = 'x' as Slug;
let root: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}
function commit(text: string): string {
  writeFileSync(join(root, 'src', 'a.ts'), text);
  git('add', '-A');
  git('commit', '-q', '-m', 'edit', '--no-verify');
  return git('rev-parse', 'HEAD');
}
const writeSession = (): void =>
  writeFileSync(
    join(root, '.noldor', 'session.json'),
    JSON.stringify({ path: 'fast-track', startedAt: 'S1' }),
  );

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orch-decisions-'));
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, '.noldor', 'cr'), { recursive: true });
  commit('line 1\nline 2\nline 3\n');
  writeSession();
  script.reviewer = [];
  script.codex = [];
  vi.mocked(runSubagent).mockClear();
  vi.mocked(runCodex).mockClear();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const X: Finding = {
  file: 'src/a.ts',
  severity: 'high',
  message: 'the fallback hides a failure',
  locations: [{ file: 'src/a.ts', line: 2 }],
};
const Y: Finding = { file: 'src/a.ts', severity: 'high', message: 'off by one' };
const Z: Finding = { file: 'docs/x.md', severity: 'med', message: 'the scope is too wide' };

async function decide(
  kind: 'spec' | 'code',
  d: Partial<Decision> & { finding: Finding },
): Promise<void> {
  const w = await updateDecisions(root, SLUG, kind, 'S1', (cur) =>
    upsertDecision(cur, {
      id: fingerprintBlocker(d.finding),
      lanes: ['reviewer'],
      disposition: 'rejected',
      reason: 'intentional',
      round: 1,
      cites: [{ file: 'src/a.ts', line: 2, text: 'line 2' }],
      ...d,
    }),
  );
  expect(w.ok).toBe(true);
}

function writePriorSink(
  lane: 'reviewer' | 'codex',
  kind: 'spec' | 'code',
  blockers: Finding[],
): void {
  writeFileSync(
    join(root, '.noldor', 'cr', `x-${kind}-${lane}.json`),
    JSON.stringify({
      lane,
      artifact: 'src/a.ts',
      kind,
      slug: 'x',
      blockers,
      suggestions: [],
      summary: 'blockers found',
      startedAt: '2026-09-23T00:00:00.000Z',
      finishedAt: '2026-09-23T00:01:00.000Z',
    }),
  );
}

const args = (over: Record<string, unknown> = {}) => ({
  slug: SLUG,
  artifact: 'src/a.ts',
  kind: 'spec' as const,
  lanes: ['reviewer' as const, 'codex' as const],
  autonomous: true,
  headSha: git('rev-parse', 'HEAD'),
  ...over,
});

const reviewerInput = (): LaneInput => vi.mocked(runSubagent).mock.calls.at(-1)![0];
const codexInput = (): LaneInput => vi.mocked(runCodex).mock.calls.at(-1)![0];

describe("orchestrate hands the series' decisions to every prior-aware lane (Q-0261)", () => {
  it("leaves a ruling that holds out of every lane's priors, and shows both lanes the decided list", async () => {
    writePriorSink('reviewer', 'spec', [X, Y]);
    await decide('spec', { finding: X });
    await run({ args: args(), cwd: root });
    expect(reviewerInput().priorReview?.blockers).toEqual([Y]);
    expect(reviewerInput().priorReview?.decided).toEqual([
      expect.objectContaining({ id: fingerprintBlocker(X), disposition: 'rejected', holds: true }),
    ]);
    // codex has no sink of its own yet, so it has no priors — it still sees the ruling.
    expect(codexInput().priorReview?.blockers).toEqual([]);
    expect(codexInput().priorReview?.decided).toHaveLength(1);
  });

  it('hands a ruling back as a prior once the lines it cites change, marked as not holding', async () => {
    writePriorSink('reviewer', 'spec', [X]);
    await decide('spec', { finding: X });
    const edited = commit('line 1\nline 2 — edited\nline 3\n');
    await run({ args: args({ headSha: edited }), cwd: root });
    expect(reviewerInput().priorReview?.blockers).toEqual([X]);
    expect(reviewerInput().priorReview?.decided?.[0]?.holds).toBe(false);
  });

  it('with no session marker, reads no ruling and records nothing', async () => {
    writePriorSink('reviewer', 'spec', [X]);
    await decide('spec', { finding: X });
    rmSync(join(root, '.noldor', 'session.json'));
    script.reviewer = [{ resolved: [{ finding: Y, why: 'gone' }] }];
    await run({ args: args({ lanes: ['reviewer'] }), cwd: root });
    expect(reviewerInput().priorReview?.blockers).toEqual([X]);
    expect(reviewerInput().priorReview?.decided).toBeUndefined();
    const stored = await readDecisions(root, SLUG, 'spec', 'S1');
    expect(stored.ok && stored.decisions.map((d) => d.disposition)).toEqual(['rejected']);
  });

  it('reads an unreadable store as nothing decided, and still runs the round', async () => {
    writePriorSink('reviewer', 'spec', [X]);
    mkdirSync(join(root, '.noldor', 'cr', 'decisions'), { recursive: true });
    writeFileSync(join(root, '.noldor', 'cr', 'decisions', 'x-spec.json'), '{not json');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await run({ args: args({ lanes: ['reviewer'] }), cwd: root });
    expect(reviewerInput().priorReview?.blockers).toEqual([X]);
    expect(err.mock.calls.flat().join('\n')).toContain('decision store unreadable');
    err.mockRestore();
  });
});

describe('orchestrate records fixed findings after a round (Q-0261)', () => {
  it('records a fixed decision for each prior a lane answered resolved', async () => {
    script.reviewer = [{ resolved: [{ finding: Y, why: 'the check is back' }] }];
    await run({ args: args({ lanes: ['reviewer'] }), cwd: root });
    const stored = await readDecisions(root, SLUG, 'spec', 'S1');
    expect(stored.ok && stored.decisions).toEqual([
      {
        id: fingerprintBlocker(Y),
        finding: Y,
        lanes: ['reviewer'],
        disposition: 'fixed',
        reason: 'the check is back',
        round: 1,
      },
    ]);
  });

  it('drops a fixed decision once a lane files that finding again, and never replaces a ruling', async () => {
    await decide('spec', {
      finding: Y,
      disposition: 'fixed',
      reason: 'was fixed',
      cites: undefined,
    });
    await decide('spec', { finding: X });
    script.reviewer = [{ blockers: [Y], resolved: [{ finding: X, why: 'claims fixed' }] }];
    await run({ args: args({ lanes: ['reviewer'] }), cwd: root });
    const stored = await readDecisions(root, SLUG, 'spec', 'S1');
    expect(stored.ok && stored.decisions.map((d) => [d.id, d.disposition])).toEqual([
      [fingerprintBlocker(X), 'rejected'],
    ]);
  });
});

describe('a green code round names every ruling of the session on its receipt (Q-0261)', () => {
  const settledLines = (): string[] =>
    git('log', '-1', '--format=%B')
      .split('\n')
      .filter((l) => l.startsWith('Noldor-CR-Settled:'));

  it('writes one trailer per operator ruling across kinds, and none for a fixed finding', async () => {
    await decide('code', { finding: X });
    await decide('code', { finding: Y, disposition: 'fixed', reason: 'fixed', cites: undefined });
    await decide('spec', {
      finding: Z,
      disposition: 'deferred',
      reason: 'a later slice',
      cites: undefined,
    });
    const r = await run({ args: args({ kind: 'code', lanes: ['reviewer'] }), cwd: root });
    expect(r.exitCode).toBe(0);
    expect(settledLines().toSorted()).toEqual(
      [
        `Noldor-CR-Settled: code rejected ${fingerprintBlocker(X).slice(0, 12)} — intentional`,
        `Noldor-CR-Settled: spec deferred ${fingerprintBlocker(Z).slice(0, 12)} — a later slice`,
      ].toSorted(),
    );
    expect(git('log', '-1', '--format=%B')).toContain('Noldor-Reviewed-Subagent:');
  });

  it('writes no ruling trailer in a session that ruled on nothing', async () => {
    const r = await run({ args: args({ kind: 'code', lanes: ['reviewer'] }), cwd: root });
    expect(r.exitCode).toBe(0);
    expect(settledLines()).toEqual([]);
  });

  it("keeps an earlier session's ruling line when a later session rules on something else", async () => {
    await decide('code', { finding: X });
    expect(
      (await run({ args: args({ kind: 'code', lanes: ['reviewer'] }), cwd: root })).exitCode,
    ).toBe(0);
    // A later session on the same tip: its store starts empty, and it rules only on Y.
    writeFileSync(
      join(root, '.noldor', 'session.json'),
      JSON.stringify({ path: 'fast-track', startedAt: 'S2' }),
    );
    const w = await updateDecisions(root, SLUG, 'code', 'S2', (cur) =>
      upsertDecision(cur, {
        id: fingerprintBlocker(Y),
        finding: Y,
        lanes: ['codex'],
        disposition: 'deferred',
        reason: 'next slice',
        round: 1,
      }),
    );
    expect(w.ok).toBe(true);
    expect(
      (await run({ args: args({ kind: 'code', lanes: ['reviewer'] }), cwd: root })).exitCode,
    ).toBe(0);
    expect(settledLines().toSorted()).toEqual(
      [
        `Noldor-CR-Settled: code rejected ${fingerprintBlocker(X).slice(0, 12)} — intentional`,
        `Noldor-CR-Settled: code deferred ${fingerprintBlocker(Y).slice(0, 12)} — next slice`,
      ].toSorted(),
    );
  });

  it("replaces a ruling's own line, rather than adding a second one, when the ruling changes", async () => {
    await decide('code', { finding: X });
    expect(
      (await run({ args: args({ kind: 'code', lanes: ['reviewer'] }), cwd: root })).exitCode,
    ).toBe(0);
    await decide('code', { finding: X, disposition: 'accepted', reason: 'the debt is taken' });
    expect(
      (await run({ args: args({ kind: 'code', lanes: ['reviewer'] }), cwd: root })).exitCode,
    ).toBe(0);
    expect(settledLines()).toEqual([
      `Noldor-CR-Settled: code accepted ${fingerprintBlocker(X).slice(0, 12)} — the debt is taken`,
    ]);
  });

  it('keeps the ruling trailers a re-minted receipt finds on the tip once the stores are gone', async () => {
    await decide('code', { finding: X });
    expect(
      (await run({ args: args({ kind: 'code', lanes: ['reviewer'] }), cwd: root })).exitCode,
    ).toBe(0);
    const named = settledLines();
    expect(named).toHaveLength(1);
    // The gate's clean-exit cleanup removes the stores; a later fix amended into the tip
    // re-mints the receipt.
    rmSync(join(root, '.noldor', 'cr', 'decisions'), { recursive: true, force: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'line 1\nline 2\nline 3\nline 4\n');
    git('add', '-A');
    git('commit', '-q', '--amend', '--no-edit', '--no-verify');
    const r = await run({
      args: args({ kind: 'code', lanes: ['reviewer'], headSha: git('rev-parse', 'HEAD') }),
      cwd: root,
    });
    expect(r.exitCode).toBe(0);
    expect(settledLines()).toEqual(named);
  });
});
