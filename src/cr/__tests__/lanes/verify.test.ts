// @tests: acceptance-verify-lane, specs-cr-gate-multi-reviewer, cr-lane-verdicts-blocked-by-serialization-not-substance
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setVerifyDispatcher } from '../../lanes/verify-dispatch.js';
import { reapPort, runVerify, setSmokeRunner } from '../../lanes/verify.js';
import type { LaneInput } from '../../lane-types.js';

const GREEN_SMOKE = {
  ok: true,
  surfaces: [{ name: 'doctor', ok: true, evidence: { command: 'doctor', observed: 'exit 0' } }],
  notes: [],
};
const RED_SMOKE = {
  ok: false,
  surfaces: [
    { name: 'doctor', ok: true, evidence: { command: 'doctor', observed: 'exit 0' } },
    {
      name: 'web',
      ok: false,
      evidence: { command: 'pnpm dev', observed: 'no HTTP 200 within 30000ms' },
    },
  ],
  notes: [],
};

function repo(verifyMode?: string): { cwd: string; input: LaneInput } {
  const cwd = mkdtempSync(join(tmpdir(), 'noldor-verify-'));
  mkdirSync(join(cwd, '.noldor'), { recursive: true });
  mkdirSync(join(cwd, 'docs', 'features'), { recursive: true });
  writeFileSync(
    join(cwd, '.noldor', 'config.json'),
    JSON.stringify({ autonomous: verifyMode ? { verifyMode } : {} }),
  );
  writeFileSync(
    join(cwd, 'docs', 'features', 'feat-x.md'),
    '## Summary\n\nEndpoint /x returns an object.\n\n## Usage\n\n- GET /x\n',
  );
  const input: LaneInput = {
    slug: 'feat-x',
    artifact: '.',
    kind: 'code',
    fdPath: join(cwd, 'docs', 'features', 'feat-x.md'),
    artifactSha: 'head',
    baseSha: 'base',
    repoRoot: cwd,
  };
  return { cwd, input };
}

function readSink(cwd: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(cwd, '.noldor', 'cr', 'feat-x-code-verifier.json'), 'utf8'));
}

beforeEach(() => {
  setSmokeRunner(async () => GREEN_SMOKE);
  setVerifyDispatcher(
    async () =>
      '```json\n{"verdict":"pass","evidence":[{"command":"curl /x","observed":"{}"}],"mismatches":[]}\n```',
  );
});

describe('runVerify', () => {
  it('pass → ok with evidence in the sink', async () => {
    const { cwd, input } = repo();
    const r = await runVerify(input);
    expect(r.ok).toBe(true);
    const sink = readSink(cwd);
    expect(sink.verdict).toBe('pass');
    expect((sink.evidence as unknown[]).length).toBe(1);
  });

  it('reads a pass whose evidence quotes fenced code (Q-0239 replay)', async () => {
    setVerifyDispatcher(
      async () =>
        '```json\n{"verdict":"pass","evidence":[{"command":"pnpm noldor validate","observed":"docs:\\n```bash\\npnpm release\\n```\\nOK"}],"mismatches":[]}\n```',
    );
    const { cwd, input } = repo('blocking');
    expect((await runVerify(input)).ok).toBe(true);
    const sink = readSink(cwd);
    expect(sink.verdict).toBe('pass');
    expect(JSON.stringify(sink.evidence)).toContain('```bash');
  });

  it('an empty child fails closed in blocking mode, with no repair round', async () => {
    let calls = 0;
    setVerifyDispatcher(async () => {
      calls++;
      return null;
    });
    const { cwd, input } = repo('blocking');
    expect((await runVerify(input)).ok).toBe(false);
    expect(calls).toBe(1);
    expect(readSink(cwd)).toMatchObject({ verdict: 'fail', reason: 'malformed-output' });
  });

  it('drops placeholder mismatches before judging the verdict', async () => {
    setVerifyDispatcher(async () => '{"verdict":"pass","evidence":[],"mismatches":["(none)"]}');
    const { cwd, input } = repo('blocking');
    expect((await runVerify(input)).ok).toBe(true);
    expect(readSink(cwd).verdict).toBe('pass');
  });

  it('forwards LaneInput.dispatchTimeoutMs to the verify dispatcher as timeoutMs', async () => {
    let seen: number | undefined = -1;
    setVerifyDispatcher(async (i) => {
      seen = i.timeoutMs;
      return '```json\n{"verdict":"pass","evidence":[],"mismatches":[]}\n```';
    });
    const { input } = repo();
    await runVerify({ ...input, dispatchTimeoutMs: 888_000 });
    expect(seen).toBe(888_000);
    // No lane value → key absent, so the dispatch default applies.
    await runVerify(input);
    expect(seen).toBeUndefined();
  });

  it('smoke fail → blockers and ok:false in BOTH modes', async () => {
    setSmokeRunner(async () => RED_SMOKE);
    for (const mode of ['advisory', 'blocking']) {
      const { cwd, input } = repo(mode);
      const r = await runVerify(input);
      expect(r.ok).toBe(false);
      const sink = readSink(cwd);
      expect(sink.verdict).toBe('fail');
      expect((sink.blockers as Array<{ message: string }>)[0].message).toContain('no HTTP 200');
    }
  });

  it('agent fail + blocking → mismatches become blockers', async () => {
    setVerifyDispatcher(
      async () =>
        '```json\n{"verdict":"fail","evidence":[{"command":"curl /x","observed":"[]"}],"mismatches":["object promised, array observed"]}\n```',
    );
    const { cwd, input } = repo('blocking');
    const r = await runVerify(input);
    expect(r.ok).toBe(false);
    expect((readSink(cwd).blockers as Array<{ message: string }>)[0].message).toContain(
      'object promised',
    );
  });

  it('agent fail + advisory → suggestions, ok:true, ADVISORY FAIL summary', async () => {
    setVerifyDispatcher(
      async () => '```json\n{"verdict":"fail","evidence":[],"mismatches":["m1"]}\n```',
    );
    const { cwd, input } = repo('advisory');
    const r = await runVerify(input);
    expect(r.ok).toBe(true);
    const sink = readSink(cwd);
    expect(sink.blockers).toEqual([]);
    expect((sink.suggestions as unknown[]).length).toBe(1);
    expect(String(sink.summary)).toMatch(/^ADVISORY FAIL:/);
  });

  it('cannot-verify → ok:true in both modes with reason note', async () => {
    setVerifyDispatcher(
      async () =>
        '```json\n{"verdict":"cannot-verify","evidence":[],"mismatches":[],"reason":"no boot path"}\n```',
    );
    for (const mode of ['advisory', 'blocking']) {
      const { cwd, input } = repo(mode);
      const r = await runVerify(input);
      expect(r.ok).toBe(true);
      expect(JSON.stringify(readSink(cwd).notes)).toContain('no boot path');
    }
  });

  it('malformed output: blocking → fail-closed blocker; advisory → cannot-verify note', async () => {
    setVerifyDispatcher(async () => 'I am confused and emit no JSON');
    const blocking = repo('blocking');
    expect((await runVerify(blocking.input)).ok).toBe(false);
    expect((readSink(blocking.cwd).blockers as Array<{ message: string }>)[0].message).toContain(
      'verify lane errored',
    );
    const advisory = repo('advisory');
    expect((await runVerify(advisory.input)).ok).toBe(true);
    expect(readSink(advisory.cwd).verdict).toBe('cannot-verify');
  });

  it('sectionless FD → commit-prose fallback; sink still written (no rethrow)', async () => {
    const { cwd, input } = repo();
    writeFileSync(input.fdPath, '# Title\nno sections here\n');
    // tmpdir has no git repo → commit prose is '' → cannot-verify, sink written
    const r = await runVerify(input);
    expect(r.ok).toBe(true);
    expect(readSink(cwd).verdict).toBe('cannot-verify');
  });

  it('dispatch throw: same no-trustworthy-verdict mapping', async () => {
    setVerifyDispatcher(async () => {
      throw new Error('spawn-failed: ENOENT');
    });
    const { cwd, input } = repo('blocking');
    expect((await runVerify(input)).ok).toBe(false);
    expect((readSink(cwd).blockers as Array<{ message: string }>)[0].message).toContain(
      'spawn-failed',
    );
  });

  it('repair round recovers a verdict when the first answer was not JSON', async () => {
    const seen: Array<string | null | undefined> = [];
    setVerifyDispatcher(async (_i, repair) => {
      seen.push(repair?.rejected);
      return repair === undefined
        ? 'Verified end-to-end. I forgot the JSON.'
        : '{"verdict":"pass","evidence":[{"command":"curl /x","observed":"{}"}],"mismatches":[]}';
    });
    const { cwd, input } = repo('blocking');
    const r = await runVerify(input);
    expect(r.ok).toBe(true);
    const sink = readSink(cwd);
    expect(sink.verdict).toBe('pass');
    expect((sink.evidence as unknown[]).length).toBe(1);
    expect(JSON.stringify(sink.notes)).toContain('repair round');
    // Exactly one repair, and it carried the first answer to transcribe.
    expect(seen).toEqual([undefined, 'Verified end-to-end. I forgot the JSON.']);
  });

  it('repair round is not attempted when the dispatch itself failed', async () => {
    let calls = 0;
    setVerifyDispatcher(async () => {
      calls++;
      throw new Error('verify dispatch failed: exit 1 (timeout)');
    });
    const { cwd, input } = repo('blocking');
    expect((await runVerify(input)).ok).toBe(false);
    expect(calls).toBe(1);
    expect(readSink(cwd).reason).toBe('dispatch-failed');
  });

  it('prose with no valid answer fails closed in blocking mode, however green it sounds', async () => {
    setVerifyDispatcher(
      async () => 'Verified all clauses through real CLI/HTTP/API. Everything works.',
    );
    const { cwd, input } = repo('blocking');
    expect((await runVerify(input)).ok).toBe(false);
    const sink = readSink(cwd);
    expect(sink.verdict).toBe('fail');
    expect(sink.reason).toBe('malformed-output');
  });

  it('keeps the unparseable payload verbatim in the sink, not truncated to 200 chars', async () => {
    const prose = `${'boot log line. '.repeat(40)}THE-TAIL-THAT-MATTERS: mismatch on /x`;
    expect(prose.length).toBeGreaterThan(200);
    setVerifyDispatcher(async () => prose);
    const { cwd, input } = repo('blocking');
    // Failure-shaped prose stays fail-closed — the raw payload is what changes.
    expect((await runVerify(input)).ok).toBe(false);
    const sink = readSink(cwd);
    expect(JSON.stringify(sink.notes)).toContain('THE-TAIL-THAT-MATTERS');
    expect(JSON.stringify(sink.notes)).toContain('repair round');
    expect(sink.reason).toBe('malformed-output');
  });
});

describe('runVerify worktree backstop', () => {
  const PASS = '```json\n{"verdict":"pass","evidence":[],"mismatches":[]}\n```';
  const scratch: string[] = [];
  afterEach(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  /** A non-existent sibling path outside the repo — where a verifier's `/tmp` test bed lands. */
  function scratchPath(tag: string): string {
    const dir = mkdtempSync(join(tmpdir(), `noldor-verify-${tag}-`));
    scratch.push(dir);
    return join(dir, 'wt');
  }
  function gitRepo(): { cwd: string; input: LaneInput; git: (...args: string[]) => string } {
    const { cwd, input } = repo('blocking');
    const git = (...args: string[]): string =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        cwd,
        stdio: 'pipe',
      }).toString();
    git('init', '-q');
    git('commit', '-q', '--allow-empty', '-m', 'init');
    return { cwd, input, git };
  }

  it('removes a detached worktree the child registered and left behind (Q-0250 replay)', async () => {
    const { cwd, input, git } = gitRepo();
    const before = git('worktree', 'list', '--porcelain');
    const leak = scratchPath('leak');
    mkdirSync(join(cwd, 'node_modules', 'pkg'), { recursive: true });
    setVerifyDispatcher(async () => {
      git('worktree', 'add', '-q', '--detach', leak, 'HEAD');
      symlinkSync(join(cwd, 'node_modules'), join(leak, 'node_modules'));
      return PASS;
    });
    expect((await runVerify(input)).ok).toBe(true);
    expect(git('worktree', 'list', '--porcelain')).toBe(before);
    expect(existsSync(leak)).toBe(false);
    expect(existsSync(join(cwd, 'node_modules', 'pkg'))).toBe(true);
    const notes = JSON.stringify(readSink(cwd).notes);
    expect(notes).toContain('removed leaked worktree');
    expect(notes).toContain(realpathSync(join(leak, '..')));
  });

  it('leaves a worktree that existed before the round alone', async () => {
    const { cwd, input, git } = gitRepo();
    const pre = scratchPath('pre');
    git('worktree', 'add', '-q', '--detach', pre, 'HEAD');
    const before = git('worktree', 'list', '--porcelain');
    setVerifyDispatcher(async () => PASS);
    await runVerify(input);
    expect(git('worktree', 'list', '--porcelain')).toBe(before);
    expect(existsSync(pre)).toBe(true);
    expect(JSON.stringify(readSink(cwd).notes ?? [])).not.toContain('worktree');
  });

  it("leaves a sibling session's checkout under .worktrees/ alone when it appears mid-dispatch", async () => {
    const { cwd, input, git } = gitRepo();
    const sibling = join(cwd, '.worktrees', 'other-slug');
    setVerifyDispatcher(async () => {
      git('worktree', 'add', '-q', '-b', 'fast/other-slug', sibling, 'HEAD');
      return PASS;
    });
    await runVerify(input);
    expect(existsSync(sibling)).toBe(true);
    expect(git('worktree', 'list', '--porcelain')).toContain(realpathSync(sibling));
    expect(JSON.stringify(readSink(cwd).notes ?? [])).not.toContain('worktree');
  });

  it('records that the audit was skipped when the root is not a git repo', async () => {
    const { cwd, input } = repo('blocking');
    await runVerify(input);
    expect(JSON.stringify(readSink(cwd).notes)).toContain('worktree audit skipped');
  });
});

describe('reapPort', () => {
  it('kills a process still listening on the port', async () => {
    // The leak must live in a SEPARATE process — reapPort kill -9s whatever
    // holds the port, and an in-process listener would be the vitest worker.
    const { spawn } = await import('node:child_process');
    const { resolvePort } = await import('../../../verify/port.js');
    const port = await resolvePort(mkdtempSync(join(tmpdir(), 'noldor-reap-')));
    const leak = spawn(
      'node',
      ['-e', `require('node:http').createServer((q,s)=>s.end('leak')).listen(${port},'127.0.0.1')`],
      { detached: true, stdio: 'ignore' },
    );
    leak.unref();
    const waitFor = async (want: boolean): Promise<boolean> => {
      for (let i = 0; i < 30; i++) {
        const up = await fetch(`http://127.0.0.1:${port}/`).then(
          () => true,
          () => false,
        );
        if (up === want) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    };
    expect(await waitFor(true)).toBe(true);
    await reapPort(port);
    expect(await waitFor(false)).toBe(true);
  });
});
