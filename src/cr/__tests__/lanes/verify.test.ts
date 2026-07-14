// @tests: acceptance-verify-lane, specs-cr-gate-multi-reviewer
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
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
