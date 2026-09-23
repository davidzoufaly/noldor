// @tests: cr-re-round-cap-enforcement-and-oscillation-detector
//
// Q-0261's deletion test, end to end: a real reviewer lane (only its child is faked, at the
// dispatch seam), the real `cr arbitration dispose` CLI, and two orchestrate rounds in a real repo.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Slug } from '../../core/slug.js';
import { fingerprintBlocker } from '../fingerprint.js';
import type { Finding, LaneFindings } from '../findings-schema.js';
import { buildPrompt, setDispatcher } from '../lanes/subagent-dispatch.js';
import type { DispatchInput } from '../lanes/subagent-dispatch.js';
import { run } from '../orchestrate.js';

const BIN = resolve(import.meta.dirname, '../../../bin/noldor.mjs');
const SLUG = 'settled-e2e' as Slug;
const PLAN = 'docs/design/plans/p.md';
const MESSAGE = 'the fallback hides a failure at src/a.ts:2';

let root: string;
let prompts: string[];
let answers: string[];

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}
function write(path: string, text: string): void {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), text);
}
function commit(): string {
  git('add', '-A');
  git('commit', '-q', '-m', 'change', '--no-verify');
  return git('rev-parse', 'HEAD');
}
const sink = (): LaneFindings =>
  JSON.parse(readFileSync(join(root, '.noldor', 'cr', `${SLUG}-plan-reviewer.json`), 'utf8'));

/** The reviewer child's answer: it files the same blocker, word for word, every round. */
const refiles = (prior: unknown[] = []): string =>
  JSON.stringify({
    assessment: 'request changes',
    strengths: 's',
    findings: [{ severity: 'critical', blocking: true, class: 'design', message: MESSAGE }],
    prior,
  });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'settled-e2e-'));
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  write('README.md', 'seed\n');
  commit();
  mkdirSync(join(root, '.noldor', 'cr'), { recursive: true });
  writeFileSync(
    join(root, '.noldor', 'session.json'),
    JSON.stringify({ path: 'fast-track', startedAt: 'S1' }),
  );
  prompts = [];
  answers = [];
  setDispatcher(async (input: DispatchInput) => {
    prompts.push(buildPrompt(input));
    return answers.shift() ?? '';
  });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function round(headSha: string, baseSha?: string): Promise<number> {
  const r = await run({
    args: {
      slug: SLUG,
      artifact: PLAN,
      kind: 'plan',
      lanes: ['reviewer'],
      autonomous: true,
      headSha,
      ...(baseSha !== undefined ? { baseSha } : {}),
    },
    cwd: root,
  });
  return r.exitCode;
}

function dispose(id: string): void {
  execFileSync(
    'node',
    [
      BIN,
      'cr',
      'arbitration',
      'dispose',
      '--slug',
      SLUG,
      '--kind',
      'plan',
      '--blocker',
      id,
      '--disposition',
      'rejected',
      '--note',
      'the fallback is intentional',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NOLDOR_DRAIN: '' },
    },
  );
}

/** Round 1 files the blocker; the operator rejects it. Returns the ruled finding. */
async function ruleOnRoundOne(): Promise<Finding> {
  const base = git('rev-parse', 'HEAD');
  write(PLAN, '# plan\n');
  write('src/a.ts', 'line 1\nline 2\nline 3\n');
  const head = commit();
  answers.push(refiles());
  expect(await round(head, base)).toBe(1);
  const [ruled] = sink().blockers;
  expect(ruled.locations).toEqual([{ file: 'src/a.ts', line: 2 }]);
  dispose(fingerprintBlocker(ruled));
  return ruled;
}

describe('a finding rejected in round N (Q-0261 deletion test)', () => {
  it('filed again word for word in round N+1, while its lines are unchanged, is a suggestion and the round is green', async () => {
    const ruled = await ruleOnRoundOne();
    answers.push(refiles());
    expect(await round(git('rev-parse', 'HEAD'))).toBe(0);

    const s = sink();
    expect(s.blockers).toEqual([]);
    expect(s.suggestions).toEqual([ruled]);
    expect(s.notes?.join('\n')).toContain('restates settled S1 (rejected)');
    // Round N+1 was shown the ruling, and was not handed the finding as a prior to answer.
    expect(prompts[1]).toContain(`S1 [rejected r1][high] ${MESSAGE} — the fallback is intentional`);
    expect(prompts[1]).not.toMatch(/^P1 /m);
  });

  it('comes back as a prior, and blocks, once the lines it cites change', async () => {
    const ruled = await ruleOnRoundOne();
    write('src/a.ts', 'line 1\nline 2 — reworked\nline 3\n');
    const edited = commit();
    answers.push(refiles([{ n: 1, resolved: false, why: 'the rework kept the fallback' }]));
    expect(await round(edited)).toBe(1);

    expect(sink().blockers[0]).toEqual(ruled);
    expect(prompts[1]).toMatch(/^P1 \[high\]\[design\] the fallback hides a failure/m);
    expect(prompts[1]).toContain('its cited content has changed since the ruling');
  });
});
