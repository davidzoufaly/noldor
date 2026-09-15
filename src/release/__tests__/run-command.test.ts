// @tests: test-suites-read-live-repo-state-shifting-full-suite-failures
//
// The seam's own contract. `preflight.test.ts` injects a fake on every call, so
// nothing there exercises the default wiring or the normalization that makes
// "resolves rather than rejects" real rather than aspirational — a mis-typed
// `??` or a dropped field would otherwise leave the whole suite green.
import { describe, expect, it } from 'vitest';

import { makeProbeContext, runProbe, PROBE_TIMEOUT_MS } from '../preflight-probes.js';
import { defaultRunCommand, normalizeRunner, resultFromError } from '../run-command.js';
import type { ProbeContext } from '../preflight-probes.js';
import type { RunCommand } from '../run-command.js';

const ctxFor = (over: Partial<Parameters<typeof makeProbeContext>[0]> = {}): ProbeContext =>
  makeProbeContext({ cwd: '/nowhere', scanPaths: ['src'], nowMs: 0, ...over });

describe('makeProbeContext defaults', () => {
  it('defaults runCommand to the real spawn when the input omits it', async () => {
    // Identity against the exported symbol: the wrapper is transparent for a
    // runner that resolves, so unwrapping is not observable — instead prove the
    // default reaches the real spawn by running a command only it could answer.
    const { code, stdout } = await ctxFor().runCommand(process.execPath, [
      '-e',
      'process.stdout.write("real")',
    ]);
    expect({ code, stdout }).toStrictEqual({ code: 0, stdout: 'real' });
  });

  it('defaults budgetMs to PROBE_TIMEOUT_MS', () => {
    expect(ctxFor().budgetMs).toBe(PROBE_TIMEOUT_MS);
  });

  it('honours an injected runner and budget over the defaults', async () => {
    const injected: RunCommand = () => Promise.resolve({ code: 7, stdout: 'x', stderr: '' });
    const ctx = ctxFor({ runCommand: injected, budgetMs: 25 });
    expect(ctx.budgetMs).toBe(25);
    expect((await ctx.runCommand('anything', [])).code).toBe(7);
  });

  it('passes the context cwd through to the command', async () => {
    // Without cwd on the options the noldor CLI would run against process.cwd()
    // — the exact failure makeProbeContext's own comment warns about.
    const seen: (string | undefined)[] = [];
    const ctx = ctxFor({
      cwd: '/somewhere',
      runCommand: (_c, _a, opts) => {
        seen.push(opts?.cwd);
        return Promise.resolve({ code: 0, stdout: '', stderr: '' });
      },
    });
    await ctx.runCommand('gh', ['--version'], { cwd: ctx.cwd });
    expect(seen).toStrictEqual(['/somewhere']);
  });
});

describe(resultFromError, () => {
  it('keeps a numeric exit code and the captured streams', () => {
    expect(resultFromError({ code: 3, stdout: 'o', stderr: 'e' })).toStrictEqual({
      code: 3,
      stdout: 'o',
      stderr: 'e',
    });
  });

  it('folds the message into an empty stderr so an absent binary still says why', () => {
    // ENOENT puts nothing on stderr; only `message` carries `spawn npm ENOENT`.
    // Dropping it degrades npm-name's warn detail to `(no output)`.
    const r = resultFromError({ code: 'ENOENT', message: 'spawn npm ENOENT' });
    expect(r.stderr).toBe('spawn npm ENOENT');
    expect(r.code).toBe(1);
  });

  it('does not overwrite a non-empty stderr with the message', () => {
    const r = resultFromError({ code: 1, stderr: 'E404 Not Found', message: 'Command failed' });
    expect(r.stderr).toBe('E404 Not Found');
  });

  it('survives a rejection that is not an object at all', () => {
    // A runner that rejects with null would otherwise make the property read
    // throw from inside the function whose whole job is to stop a throw.
    for (const junk of [null, undefined, 'plain string', 42]) {
      const r = resultFromError(junk);
      expect(r.code).toBe(1);
      expect(typeof r.stdout).toBe('string');
      expect(typeof r.stderr).toBe('string');
    }
  });

  it('normalizes a bare Error, which carries no code or streams at all', () => {
    expect(resultFromError(new Error('boom'))).toStrictEqual({
      code: 1,
      stdout: '',
      stderr: 'boom',
    });
  });
});

describe(normalizeRunner, () => {
  it('turns a throwing runner into a non-zero result instead of a rejection', async () => {
    // A type cannot prevent this: `Promise<never>` satisfies RunCommand, so an
    // async fake that throws type-checks. The wrapper is the enforcement.
    const throwing: RunCommand = () => {
      throw new Error('hand-written fake forgot the contract');
    };
    const r = await normalizeRunner(throwing)('gh', ['--version']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('forgot the contract');
  });

  it('passes a well-behaved runner through untouched', async () => {
    const ok: RunCommand = () => Promise.resolve({ code: 2, stdout: 'a', stderr: 'b' });
    expect(await normalizeRunner(ok)('x', [])).toStrictEqual({ code: 2, stdout: 'a', stderr: 'b' });
  });
});

describe(defaultRunCommand, () => {
  it('resolves a non-zero exit rather than rejecting', async () => {
    const r = await defaultRunCommand(process.execPath, [
      '-e',
      'process.stderr.write("nope"); process.exit(4)',
    ]);
    expect(r.code).toBe(4);
    expect(r.stderr).toBe('nope');
  });

  it('resolves a spawn that never started, with the reason on stderr', async () => {
    const r = await defaultRunCommand('definitely-not-a-real-binary-xyz', []);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/ENOENT|not found/i);
  });
});

describe('runProbe budget', () => {
  it('returns a blocking row rather than hanging when the probe outlives the budget', async () => {
    // The whole point of the inversion: a probe bounded at 15s inside a harness
    // bounded at 10s could never return its own row — the test died first.
    const ctx = ctxFor({
      budgetMs: 20,
      runCommand: () => new Promise(() => {}),
    });
    const row = await runProbe('gh-auth', ctx);
    expect(row.status).toBe('blocking');
    // gh-auth overrides the generic row, so its keychain advice survives.
    expect(row.fix).toContain('keychain');
  });

  it('gives a probe without an override a generic row naming the budget', async () => {
    const ctx = ctxFor({ budgetMs: 20, runCommand: () => new Promise(() => {}) });
    const row = await runProbe('validate-features', ctx);
    expect(row.status).toBe('blocking');
    expect(row.detail).toContain('20ms');
  });

  it('shares one budget across a probe that runs two commands, rather than one each', async () => {
    // gh-auth spawns `gh --version` then `gh auth status`, each well inside the
    // budget on its own but over it together. The VERDICT is what separates the
    // two designs: a per-command ceiling lets both finish and returns `ok`; one
    // shared deadline times out. Asserting the verdict rather than an elapsed-ms
    // ceiling is deliberate — a wall-clock bound would be exactly the
    // load-sensitive assertion this whole feature exists to remove, and load can
    // only make this timeout more certain, never less.
    const ctx = ctxFor({
      budgetMs: 120,
      runCommand: () =>
        new Promise((r) => setTimeout(() => r({ code: 0, stdout: '', stderr: '' }), 100)),
    });
    const row = await runProbe('gh-auth', ctx);
    expect(row.status).toBe('blocking');
    expect(row.fix).toContain('keychain');
  });

  it('lets a probe whose two commands fit inside the budget answer normally', async () => {
    // The other direction, so the case above cannot pass by timing out for any
    // reason at all: same two commands, a budget that comfortably covers both.
    const ctx = ctxFor({
      budgetMs: 5_000,
      runCommand: () =>
        new Promise((r) => setTimeout(() => r({ code: 0, stdout: '', stderr: '' }), 20)),
    });
    const row = await runProbe('gh-auth', ctx);
    expect(row.status).toBe('ok');
  });

  it('hands every command the probe deadline, so a timeout cancels the child', async () => {
    // The observable half of the one-signal design: a probe cannot forget to
    // pass the deadline, because runProbe scopes the runner rather than relying
    // on each call site. Without this the race would return a row while the real
    // child kept running.
    const seen: (AbortSignal | undefined)[] = [];
    const ctx = ctxFor({
      budgetMs: 40,
      runCommand: (_c, _a, opts) => {
        seen.push(opts?.signal);
        return new Promise(() => {});
      },
    });
    const row = await runProbe('gh-auth', ctx);

    expect(row.status).toBe('blocking');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    // And it is the deadline, not an inert signal: it aborted when the budget
    // ran out, which is what kills a real `execFile` child.
    expect(seen[0]!.aborted).toBe(true);
  });
});
