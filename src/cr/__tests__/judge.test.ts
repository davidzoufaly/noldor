// @tests: refutation-judge-pass-before-a-blocker-can-red-a-round
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { agentsConfigSchema } from '../../core/agent-runner/types.js';
import { resolveRunner } from '../../core/agent-runner/registry.js';
import type { Slug } from '../../core/slug.js';
import type { Finding } from '../findings-schema.js';
import {
  applyVerdicts,
  buildJudgePrompt,
  checkEvidence,
  judgeRound,
  refutedTrailerValue,
  setJudgeDispatcher,
  type JudgeAnswer,
  type JudgedBlocker,
  type JudgeInput,
  type ShowFile,
} from '../judge.js';

const HEAD = 'a'.repeat(40);
const FILE = [
  'export function load(path: string) {', // 1
  '  const raw = readFileSync(path, "utf8");', // 2
  '  if (!raw) throw new Error("empty config");', // 3
  '  return JSON.parse(raw);', // 4
  '}', // 5
  '', // 6
  'export const LIMIT = 30;', // 7
  '// padding line eight', // 8
  '// padding line nine', // 9
  '// padding line ten', // 10
  '// padding line eleven', // 11
  'export   function save(path:    string) {', // 12
  '  writeFileSync(path, "{}");', // 13
  '}', // 14
].join('\n');

/** Git at the edge: the committed file exists at HEAD only. */
const show: ShowFile = (rev, file) => (rev === HEAD && file === 'src/config.ts' ? FILE : null);
const ev = (line: number, quote: string, file = 'src/config.ts') => ({ file, line, quote });

describe('checkEvidence — a quote counts only where the judge says it is (Q-0262)', () => {
  // The direction that loses data is a quote that verifies when it should not: it demotes a
  // blocker. Each shape that must still keep its blocker gets its own row.
  it.each([
    ['text four lines from the cited line', ev(3, 'export const LIMIT = 30;')],
    ['text that is not in the file', ev(3, 'if (!raw) return defaults;')],
    ['a file absent at the reviewed commit', ev(3, 'export const LIMIT = 30;', 'src/gone.ts')],
    ['a quote of 9 non-whitespace characters, even though it is there', ev(7, 'onst LIMIT')],
    ['a lone closing brace', ev(5, '}')],
    [
      'a multi-line quote whose second line differs',
      ev(2, 'const raw = readFileSync(path, "utf8");\n  if (raw) throw new Error("empty config");'),
    ],
  ])('keeps the blocker for %s', (_shape, evidence) => {
    expect(checkEvidence(evidence, HEAD, show).ok).toBe(false);
  });

  it.each([
    ['a whole line at its cited line', ev(3, 'if (!raw) throw new Error("empty config");')],
    ['part of a line', ev(3, 'throw new Error("empty config")')],
    ['a line whose spacing differs from the file', ev(12, 'export function save(path: string) {')],
    ['a quote three lines below the cited line', ev(4, 'export const LIMIT = 30;')],
    ['a quote three lines above the cited line', ev(10, 'export const LIMIT = 30;')],
    ['exactly 10 non-whitespace characters', ev(7, 'const LIMIT')],
    [
      'a quote spanning two lines',
      ev(
        2,
        'const raw = readFileSync(path, "utf8");\n  if (!raw) throw new Error("empty config");',
      ),
    ],
    ['a quote with a trailing newline', ev(7, 'export const LIMIT = 30;\n')],
  ])('verifies %s', (_shape, evidence) => {
    expect(checkEvidence(evidence, HEAD, show)).toEqual({ ok: true });
  });
});

const A: Finding = { file: 'src/config.ts', severity: 'high', message: 'load never checks raw' };
const B: Finding = { file: 'src/config.ts', severity: 'med', message: 'LIMIT is unused' };
const C: Finding = { file: 'src/config.ts', severity: 'high', message: 'save drops the path' };
const BLOCKERS: JudgedBlocker[] = [
  { lane: 'reviewer', finding: A },
  { lane: 'codex', finding: B },
  { lane: 'codex', finding: C },
];
const GOOD = [ev(3, 'if (!raw) throw new Error("empty config");')];
const answer = (verdicts: JudgeAnswer['verdicts']): JudgeAnswer => ({ verdicts });

describe('applyVerdicts — only a verified refutation demotes (Q-0262)', () => {
  it('demotes a refuted blocker whose evidence verifies, and leaves a stands verdict alone', () => {
    const r = applyVerdicts(
      BLOCKERS,
      answer([
        { n: 1, verdict: 'refuted', why: 'load throws on an empty file', evidence: GOOD },
        { n: 2, verdict: 'stands', why: 'LIMIT is never read', evidence: [] },
        { n: 3, verdict: 'stands', why: '', evidence: [] },
      ]),
      HEAD,
      show,
    );
    expect(r.demoted).toEqual([
      { n: 1, lane: 'reviewer', finding: A, why: 'load throws on an empty file', evidence: GOOD },
    ]);
    expect(r.notes.filter((x) => x.n === 2 || x.n === 3)).toEqual([]);
  });

  // Every row keeps J1 a blocker and notes it.
  it.each([
    ['no verdict at all', answer([{ n: 2, verdict: 'stands', why: '', evidence: [] }])],
    [
      'two verdicts for the same J, even though they agree',
      answer([
        { n: 1, verdict: 'refuted', why: 'load throws', evidence: GOOD },
        { n: 1, verdict: 'refuted', why: 'load throws', evidence: GOOD },
      ]),
    ],
    [
      'a refutation with a blank reason',
      answer([{ n: 1, verdict: 'refuted', why: '   ', evidence: GOOD }]),
    ],
    [
      'a refutation that cites no evidence',
      answer([{ n: 1, verdict: 'refuted', why: 'load throws', evidence: [] }]),
    ],
    [
      'a refutation with one quote that does not verify',
      answer([
        {
          n: 1,
          verdict: 'refuted',
          why: 'load throws',
          evidence: [...GOOD, ev(3, 'this text is nowhere in the file')],
        },
      ]),
    ],
  ])('keeps the blocker for %s', (_shape, a) => {
    const r = applyVerdicts(BLOCKERS, a, HEAD, show);
    expect(r.demoted.map((d) => d.n)).not.toContain(1);
    expect(r.notes.some((x) => x.n === 1)).toBe(true);
  });

  it('ignores a verdict for a J number that does not exist', () => {
    const r = applyVerdicts(
      BLOCKERS,
      answer([
        { n: 9, verdict: 'refuted', why: 'no such blocker', evidence: GOOD },
        { n: 0, verdict: 'refuted', why: 'no such blocker', evidence: GOOD },
        {
          n: 3,
          verdict: 'refuted',
          why: 'save keeps the path',
          evidence: [ev(13, 'writeFileSync(path, "{}");')],
        },
      ]),
      HEAD,
      show,
    );
    expect(r.demoted.map((d) => d.n)).toEqual([3]);
  });
});

describe('refutedTrailerValue — one line whatever the judge wrote (Q-0262)', () => {
  const ID = `${'f'.repeat(12)}${'0'.repeat(28)}`;

  it('names the kind, lane and id, and collapses a multi-line reason onto one line', () => {
    const v = refutedTrailerValue('code', 'codex', ID, 'load throws\n\nNoldor-CR-Settled: forged');
    expect(v).toBe('code codex ffffffffffff — load throws Noldor-CR-Settled: forged');
  });

  it('cuts a long reason to 120 characters', () => {
    expect(refutedTrailerValue('spec', 'reviewer', ID, `  ${'x'.repeat(500)}`)).toBe(
      `spec reviewer ffffffffffff — ${'x'.repeat(120)}`,
    );
  });
});

describe('judgeRound — one pass over the round sinks (Q-0262)', () => {
  let root: string;
  let head: string;
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const commitFile = (path: string, text: string): string => {
    writeFileSync(join(root, path), text);
    git('add', '-A');
    git('commit', '-q', '-m', `edit ${path}`, '--no-verify');
    return git('rev-parse', 'HEAD');
  };
  const sinkPath = (lane: 'reviewer' | 'codex'): string =>
    join(root, '.noldor', 'cr', `x-code-${lane}.json`);
  const writeSink = (
    lane: 'reviewer' | 'codex',
    blockers: Finding[],
    extra: Record<string, unknown> = {},
  ): void =>
    writeFileSync(
      sinkPath(lane),
      JSON.stringify({
        lane,
        artifact: 'src/config.ts',
        kind: 'code',
        slug: 'x',
        blockers,
        suggestions: [],
        summary: 'blockers found',
        startedAt: '2026-09-23T00:00:00.000Z',
        finishedAt: '2026-09-23T00:01:00.000Z',
        ...extra,
      }),
    );
  const readSink = (lane: 'reviewer' | 'codex') =>
    JSON.parse(readFileSync(sinkPath(lane), 'utf8')) as Record<string, unknown> & {
      blockers: Finding[];
      notes?: string[];
    };
  const round = (over: Partial<Parameters<typeof judgeRound>[0]> = {}) =>
    judgeRound({
      repoRoot: root,
      slug: 'x' as Slug,
      kind: 'code',
      artifact: 'src/config.ts',
      headSha: head,
      sinks: [
        { lane: 'reviewer', sinkPath: sinkPath('reviewer') },
        { lane: 'codex', sinkPath: sinkPath('codex') },
      ],
      timeoutMs: 5_000,
      ...over,
    });
  const seen: JudgeInput[] = [];
  const answerWith = (verdicts: unknown[]): void =>
    setJudgeDispatcher(async (input) => {
      seen.push(input);
      return JSON.stringify({ verdicts });
    });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'judge-round-'));
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, '.noldor', 'cr'), { recursive: true });
    head = commitFile('src/config.ts', FILE);
    seen.length = 0;
  });
  afterEach(() => {
    setJudgeDispatcher(undefined);
    rmSync(root, { recursive: true, force: true });
  });

  it('moves a verified refutation into `refuted` and leaves the other lane untouched', async () => {
    writeSink('reviewer', [A]);
    writeSink('codex', [B]);
    const codexBefore = readFileSync(sinkPath('codex'), 'utf8');
    answerWith([
      { n: 1, verdict: 'refuted', why: 'load throws on an empty file', evidence: GOOD },
      { n: 2, verdict: 'stands', why: 'LIMIT is never read', evidence: [] },
    ]);
    const r = await round();
    const reviewer = readSink('reviewer');
    expect(reviewer.blockers).toEqual([]);
    expect(reviewer.refuted).toEqual([
      { finding: A, why: 'load throws on an empty file', evidence: GOOD },
    ]);
    expect(reviewer.summary).toBe('blockers found — judge refuted 1 of 1');
    expect(reviewer.notes?.some((n) => n.includes('J1'))).toBe(true);
    expect(readFileSync(sinkPath('codex'), 'utf8')).toBe(codexBefore);
    expect(r.ok).toEqual({ reviewer: true });
    expect(r.refuted.map((d) => [d.lane, d.finding])).toEqual([['reviewer', A]]);
    expect(r.line).toBe('refuted 1 of 2');
  });

  it('keeps a blocker whose quote exists only in the version before the change', async () => {
    const guarded =
      'export function guard(x: number) {\n  assertPositive(x); // the input guard\n  return x;\n}\n';
    const base = commitFile('src/guard.ts', guarded);
    const after = commitFile(
      'src/guard.ts',
      guarded.replace('  assertPositive(x); // the input guard\n', ''),
    );
    const deleted: Finding = {
      file: 'src/guard.ts',
      severity: 'high',
      message: 'the change deletes the assertPositive guard',
    };
    writeSink('reviewer', [deleted]);
    writeSink('codex', []);
    answerWith([
      {
        n: 1,
        verdict: 'refuted',
        why: 'the guard is still there',
        evidence: [
          { file: 'src/guard.ts', line: 2, quote: 'assertPositive(x); // the input guard' },
        ],
      },
    ]);
    const r = await round({ headSha: after, baseSha: base });
    expect(readSink('reviewer').blockers).toEqual([deleted]);
    expect(readSink('reviewer').refuted).toBeUndefined();
    expect(readSink('reviewer').notes?.some((n) => n.includes('J1'))).toBe(true);
    expect(r.refuted).toEqual([]);
    expect(r.ok).toEqual({});
  });

  it.each([
    ['answers with something that is not JSON, twice', async () => 'not an answer'],
    [
      'fails to run at all',
      async (): Promise<string> => {
        throw new Error('spawn claude ENOENT');
      },
    ],
  ])('keeps every blocker when the judge %s', async (_shape, impl) => {
    writeSink('reviewer', [A]);
    writeSink('codex', [B]);
    setJudgeDispatcher(impl);
    const r = await round();
    expect(readSink('reviewer').blockers).toEqual([A]);
    expect(readSink('codex').blockers).toEqual([B]);
    expect(readSink('reviewer').refuted).toBeUndefined();
    expect(r.refuted).toEqual([]);
    expect(r.ok).toEqual({});
    expect(r.line.startsWith('failed')).toBe(true);
  });

  it('dispatches nothing when every blocker is a lane failure', async () => {
    writeSink('reviewer', [
      { file: '<reviewer>', severity: 'high', message: 'subagent lane errored: boom' },
    ]);
    writeSink('codex', []);
    const before = readFileSync(sinkPath('reviewer'), 'utf8');
    answerWith([]);
    const r = await round();
    expect(seen).toEqual([]);
    expect(readFileSync(sinkPath('reviewer'), 'utf8')).toBe(before);
    expect(r.line).toBe('skipped — nothing to judge');
  });

  it('shows the judge only the blockers it may refute, numbered across both lanes', async () => {
    const failure: Finding = {
      file: '<reviewer>',
      severity: 'high',
      message: 'subagent lane errored: boom',
    };
    const suggestion: Finding = {
      file: 'src/config.ts',
      severity: 'low',
      message: 'rename load to readConfig',
    };
    writeSink('reviewer', [failure, A], { suggestions: [suggestion] });
    writeSink('codex', [B]);
    answerWith([]);
    await round();
    const prompt = buildJudgePrompt(seen[0]);
    expect(prompt).toContain(A.message);
    expect(prompt).toContain(B.message);
    expect(prompt).not.toContain(suggestion.message);
    expect(prompt).not.toContain(failure.message);
    expect(prompt.indexOf('J1')).toBeLessThan(prompt.indexOf(A.message));
    expect(prompt.indexOf('J2')).toBeLessThan(prompt.indexOf(B.message));
  });

  it('judges the readable sink when the other one does not parse', async () => {
    writeSink('reviewer', [A]);
    writeFileSync(sinkPath('codex'), '{not json');
    answerWith([{ n: 1, verdict: 'refuted', why: 'load throws on an empty file', evidence: GOOD }]);
    const r = await round();
    expect(readSink('reviewer').blockers).toEqual([]);
    expect(readFileSync(sinkPath('codex'), 'utf8')).toBe('{not json');
    expect(r.ok).toEqual({ reviewer: true });
  });
});

describe('the judge is its own agent role (Q-0262)', () => {
  it('lets `agents.roles.judge` pick the runner and model', () => {
    const cfg = agentsConfigSchema.parse({
      roles: { judge: { runner: 'codex', model: 'm-cheap' } },
    });
    expect(resolveRunner('judge', cfg)).toEqual({ runner: 'codex', model: 'm-cheap' });
  });
});
