// @tests: cr-lane-verdicts-blocked-by-serialization-not-substance
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AgentResult, SpawnAgentOpts } from '../../core/agent-runner/types.js';
import type { Slug } from '../../core/slug.js';
import type { LaneAnswerContract } from '../lane-answer.js';
import { createAnswerSeam, setLaneSpawn } from '../lane-spawn.js';

const schema = z.object({ verdict: z.enum(['pass', 'fail']) }).strict();
type Answer = z.infer<typeof schema>;
const CONTRACT: LaneAnswerContract<Answer> = {
  lane: 'verifier',
  shape: '{"verdict": "pass" | "fail"}',
  schema,
  repairPrompt: (ctx) => `REPAIR because ${ctx.error}; rejected=${ctx.rejected ?? 'none'}`,
};
const seam = createAnswerSeam<{ timeoutMs?: number }, Answer>(() => 'REVIEW THE CHANGE', {
  role: 'verifier',
  site: 'test.lane-spawn',
  contract: CONTRACT,
  onFailure: (f) => {
    throw new Error(`${f.reason}: ${f.detail ?? `exit ${f.exitCode}`}`);
  },
});

function repo(agents?: unknown): {
  root: string;
  at: { repoRoot: string; slug: Slug; kind: 'code' };
} {
  const root = mkdtempSync(join(tmpdir(), 'noldor-answer-seam-'));
  mkdirSync(join(root, '.noldor'), { recursive: true });
  writeFileSync(
    join(root, '.noldor', 'config.json'),
    JSON.stringify(agents === undefined ? {} : { agents }),
  );
  return { root, at: { repoRoot: root, slug: 'feat-x' as Slug, kind: 'code' } };
}

/** The path the agent-writes instruction names — a real child reads it from the prompt too. */
const pathIn = (prompt: string): string | undefined =>
  /write your answer to the file `([^`]+)`/.exec(prompt)?.[1];

type Step = { file?: string; stdout?: string; exitCode?: number; timedOut?: boolean };

function child(steps: Step[]): Array<{ prompt: string; opts: SpawnAgentOpts }> {
  const calls: Array<{ prompt: string; opts: SpawnAgentOpts }> = [];
  setLaneSpawn(async (prompt, opts): Promise<AgentResult> => {
    const step = steps[calls.length] ?? {};
    calls.push({ prompt, opts });
    const target = opts.lastMessagePath ?? pathIn(prompt);
    if (step.file !== undefined && target !== undefined) writeFileSync(target, step.file);
    return {
      exitCode: step.exitCode ?? 0,
      stdout: step.stdout ?? '',
      stderr: '',
      stderrBytes: 0,
      timedOut: step.timedOut ?? false,
    };
  });
  return calls;
}

afterEach(() => setLaneSpawn(undefined));

describe('createAnswerSeam', () => {
  it('reads the answer from the file the prompt names, never from stdout', async () => {
    const { at } = repo();
    child([{ file: '{"verdict":"pass"}', stdout: '{"verdict":"fail"}' }]);
    expect(await seam.dispatch({}, at)).toEqual({
      ok: true,
      answer: { verdict: 'pass' },
      notes: [],
    });
  });

  it('treats a verdict printed on stdout with no file as no answer, after one repair', async () => {
    const { at } = repo();
    const calls = child([{ stdout: '{"verdict":"pass"}' }, { stdout: '{"verdict":"pass"}' }]);
    const r = await seam.dispatch({}, at);
    expect(r).toMatchObject({ ok: false, detail: 'no answer file was written' });
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(r.notes)).toContain('child output (kept verbatim)');
  });

  it('recovers through one repair round that sees the rejected answer and why', async () => {
    const { at } = repo();
    const calls = child([{ file: 'looks green to me' }, { file: '{"verdict":"pass"}' }]);
    const r = await seam.dispatch({}, at);
    expect(r).toMatchObject({ ok: true, answer: { verdict: 'pass' } });
    expect(JSON.stringify(r.notes)).toContain('repair round');
    expect(calls[1]!.prompt).toContain('REPAIR because answer is not valid JSON');
    expect(calls[1]!.prompt).toContain('rejected=looks green to me');
  });

  it('gives every dispatch its own answer file and keeps the latest as a debug copy', async () => {
    const { root, at } = repo();
    const calls = child([{ file: 'nope' }, { file: '{"verdict":"fail"}' }]);
    await seam.dispatch({}, at);
    const [first, second] = calls.map((c) => pathIn(c.prompt));
    expect(first).toMatch(/\.noldor\/cr\/answers\/feat-x-code-verifier-[0-9a-f-]{36}\.json$/);
    expect(second).not.toBe(first);
    const answers = join(root, '.noldor', 'cr', 'answers');
    expect(readdirSync(answers)).toEqual(['feat-x-code-verifier.json']);
    expect(readFileSync(join(answers, 'feat-x-code-verifier.json'), 'utf8')).toBe(
      '{"verdict":"fail"}',
    );
  });

  it('pins the resolved runner and model, and lets a cli-writes runner write the file', async () => {
    const { at } = repo({ roles: { verifier: { runner: 'codex', model: 'gpt-x' } } });
    const calls = child([{ file: '{"verdict":"pass"}' }]);
    expect(await seam.dispatch({}, at)).toMatchObject({ ok: true });
    expect(calls[0]!.opts).toMatchObject({ runner: 'codex', model: 'gpt-x' });
    expect(calls[0]!.opts.lastMessagePath).toMatch(/feat-x-code-verifier-.+\.json$/);
    expect(calls[0]!.prompt).toContain('your FINAL message');
    expect(calls[0]!.prompt).not.toContain('write your answer to the file');
  });

  it('does not repair a child that produced nothing at all', async () => {
    const { at } = repo();
    const calls = child([{}]);
    expect(await seam.dispatch({}, at)).toMatchObject({
      ok: false,
      detail: 'no answer file was written',
    });
    expect(calls).toHaveLength(1);
  });

  it('does not repair a dispatch that timed out, and leaves no orphaned answer file', async () => {
    const { root, at } = repo();
    const calls = child([{ file: '{"verdict":"pass"', timedOut: true, exitCode: -1 }]);
    await expect(seam.dispatch({}, at)).rejects.toThrow(/timeout/);
    expect(calls).toHaveLength(1);
    expect(readdirSync(join(root, '.noldor', 'cr', 'answers'))).toEqual([
      'feat-x-code-verifier.json',
    ]);
  });

  it('fails the dispatch when the answers directory cannot be made', async () => {
    const { root, at } = repo();
    mkdirSync(join(root, '.noldor', 'cr'), { recursive: true });
    writeFileSync(join(root, '.noldor', 'cr', 'answers'), 'a file where the directory goes');
    child([{ file: '{"verdict":"pass"}' }]);
    await expect(seam.dispatch({}, at)).rejects.toThrow();
  });

  it('runs the reader and the repair round for an injected child too', async () => {
    const { at } = repo();
    const seen: Array<string | null | undefined> = [];
    seam.setDispatcher(async (_input, repair) => {
      seen.push(repair?.rejected);
      return repair === undefined
        ? '{"verdict":"pass","extra":1}'
        : '```json\n{"verdict":"pass"}\n```';
    });
    try {
      expect(await seam.dispatch({}, at)).toMatchObject({ ok: true, answer: { verdict: 'pass' } });
      expect(seen).toEqual([undefined, '{"verdict":"pass","extra":1}']);
    } finally {
      seam.setDispatcher(undefined);
    }
  });
});
