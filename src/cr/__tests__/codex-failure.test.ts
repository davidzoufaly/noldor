// @tests: specs-cr-gate-multi-reviewer, review-run-lifecycle-module
import { describe, expect, it, vi } from 'vitest';
import {
  AUTH_HINT_RE,
  MODEL_VERSION_RE,
  MODEL_REQUEST_ERROR_RE,
  STDERR_TAIL_CHARS,
  unknownVersion,
  describeCodexFailure,
  formatStderrTail,
  probeCodexVersion,
  PROBE_TIMEOUT_MS,
} from '../codex-failure.js';

/** The models-cache noise codex 0.133.0 emits on a perfectly healthy run. */
const MODELS_NOISE =
  'ERROR codex_models_manager::cache: failed to load models cache: unknown variant `max`, expected one of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`';

/** The measured 400 body codex-cli 0.133.0 returned for a configured gpt-5.6-sol (2026-08-14). */
const MODEL_VERSION_400 =
  "ERROR: request failed: 400 invalid_request_error: The 'gpt-5.6-sol' model requires a newer version of Codex. Please update to continue.";

describe('AUTH_HINT_RE', () => {
  it.each([
    'ERROR: no valid credentials found',
    'You are not logged in. Run codex login.',
    'not logged-in',
    'request failed: 401 Unauthorized',
    'authentication expired',
    'auth failed',
    'Please run `codex login` to continue',
  ])('matches auth-shaped stderr: %s', (line) => {
    expect(AUTH_HINT_RE.test(line)).toBe(true);
  });

  it('does not match the models-cache noise a healthy run emits', () => {
    // A false positive here would tell an operator to re-authenticate over an
    // upstream CLI bug that has nothing to do with credentials.
    expect(AUTH_HINT_RE.test(MODELS_NOISE)).toBe(false);
  });

  it('does not match ordinary review output', () => {
    expect(AUTH_HINT_RE.test('Reading prompt from stdin...')).toBe(false);
  });
});

describe('MODEL_VERSION_RE', () => {
  it('matches the measured model-version 400 body', () => {
    expect(MODEL_VERSION_RE.test(MODEL_VERSION_400)).toBe(true);
  });

  it('does not match the models-cache noise a healthy run emits', () => {
    expect(MODEL_VERSION_RE.test(MODELS_NOISE)).toBe(false);
  });

  it('does not match auth-shaped stderr', () => {
    expect(MODEL_VERSION_RE.test('ERROR: no valid credentials found')).toBe(false);
  });
});

describe('MODEL_REQUEST_ERROR_RE', () => {
  it('matches an invalid_request_error that names a model', () => {
    expect(
      MODEL_REQUEST_ERROR_RE.test(
        "400 invalid_request_error: The 'gpt-9' model does not exist or you do not have access",
      ),
    ).toBe(true);
  });

  it('does not match an invalid_request_error that names no model', () => {
    expect(MODEL_REQUEST_ERROR_RE.test('400 invalid_request_error: prompt too long')).toBe(false);
  });

  it('does not match the models-cache noise (no invalid_request_error)', () => {
    expect(MODEL_REQUEST_ERROR_RE.test(MODELS_NOISE)).toBe(false);
  });
});

describe('formatStderrTail', () => {
  it('returns empty for empty stderr', () => {
    expect(formatStderrTail('')).toBe('');
  });

  it('passes short stderr through whole, reporting its true size', () => {
    const out = formatStderrTail('boom\n');
    expect(out).toContain('of 5 bytes');
    expect(out).toContain('boom');
  });

  it('caps a huge stderr but still reports the full size', () => {
    const huge = 'x'.repeat(326_525);
    const out = formatStderrTail(huge);
    expect(out).toContain('of 326525 bytes');
    // The whole rendering, header included, stays near the cap rather than the input size.
    expect(out.length).toBeLessThan(STDERR_TAIL_CHARS + 200);
  });

  it('keeps the TAIL, since the terminating error is what lands last', () => {
    const out = formatStderrTail(`${'x'.repeat(10_000)}FINAL_LINE`, 100);
    expect(out).toContain('FINAL_LINE');
  });

  it('reports bytes, not code units, for multi-byte stderr', () => {
    // 'é' is 2 bytes in UTF-8 but 1 JS code unit; the header claims bytes.
    expect(formatStderrTail('é')).toContain('of 2 bytes');
  });
});

describe('describeCodexFailure', () => {
  it('names the version and the exit code', () => {
    const msg = describeCodexFailure({ exitCode: 1, stderr: '', version: 'codex-cli 0.133.0' });
    expect(msg).toContain('codex-cli 0.133.0');
    expect(msg).toContain('exit code 1');
  });

  it('appends the login hint when the stderr looks auth-shaped', () => {
    const msg = describeCodexFailure({
      exitCode: 1,
      stderr: 'no valid credentials',
      version: 'v',
    });
    expect(msg).toContain('codex login');
  });

  it('scans the WHOLE stderr, not just the tail it prints', () => {
    // The actionable line sits at the very start of 326 KB — far outside any tail
    // worth putting in a sink. Scanning only the tail would miss it.
    const stderr = `ERROR: no valid credentials found\n${'x'.repeat(326_525)}`;
    expect(describeCodexFailure({ exitCode: 1, stderr, version: 'v' })).toContain('codex login');
  });

  it('adds no hint for a non-auth failure, but still carries the stderr tail', () => {
    const msg = describeCodexFailure({ exitCode: 2, stderr: MODELS_NOISE, version: 'v' });
    expect(msg).not.toContain('codex login');
    expect(msg).toContain('unknown variant');
  });

  it('sends the operator to upgrade, not to re-authenticate, on a model-version 400', () => {
    // The measured failure: codex-cli 0.133.0 against gpt-5.6-sol. The old message said
    // "auth looks expired; run: codex login" — re-authenticating a session that never
    // expired. The upgrade is what actually cleared it (0.133.0 → 0.147.0).
    const msg = describeCodexFailure({
      exitCode: 1,
      stderr: MODEL_VERSION_400,
      version: 'codex-cli 0.133.0',
    });
    expect(msg).toContain('npm install -g @openai/codex@latest');
    expect(msg).not.toContain('codex login');
  });

  it('lets the upgrade hint win even when the same stderr also looks auth-shaped', () => {
    // Codex appends generic "run codex login" advice to API failures; the model-version
    // line is the real cause and must own the remedy.
    const stderr = `${MODEL_VERSION_400}\nIf this persists, run codex login.`;
    const msg = describeCodexFailure({ exitCode: 1, stderr, version: 'v' });
    expect(msg).toContain('npm install -g @openai/codex@latest');
    expect(msg).not.toContain('auth looks expired');
  });

  it('never asserts auth when an invalid_request_error names a model', () => {
    // A model-shaped 400 is a request problem, not a credential problem — even when the
    // body happens to trip the loose auth regex (e.g. carries "401" in a request id).
    const stderr =
      "400 invalid_request_error: The 'gpt-9' model does not exist (req_401abc). Run codex login if needed.";
    const msg = describeCodexFailure({ exitCode: 1, stderr, version: 'v' });
    expect(msg).not.toContain('auth looks expired');
    expect(msg).toContain('not an auth failure');
  });
});

describe('probeCodexVersion', () => {
  const ok = (stdout: string) => vi.fn(async () => stdout);

  it('returns the first line of a successful probe', async () => {
    expect(await probeCodexVersion('codex', ok('codex-cli 0.133.0\n'))).toBe('codex-cli 0.133.0');
  });

  it('asks the binary it is given, and can be asked for nothing else', async () => {
    // The seam takes only `bin`. There is no argv to pass, so no caller and no test can
    // turn the probe into a review spawn — the hole that made this rework necessary.
    const exec = ok('codex-cli 0.133.0');
    await probeCodexVersion('/opt/bin/codex-wrapper', exec);
    expect(exec).toHaveBeenCalledWith('/opt/bin/codex-wrapper');
    expect(exec.mock.calls[0]).toHaveLength(1);
  });

  it.each([
    ['empty output', ok('   \n')],
    ['a rejecting child', vi.fn(async () => Promise.reject(new Error('boom')))],
  ])('falls back to the unknown marker on %s', async (_label, exec) => {
    expect(await probeCodexVersion('codex', exec as never)).toBe(unknownVersion());
  });

  it('never throws, even when the exec itself throws synchronously', async () => {
    // An attribution helper that fails must not mask the failure it is attributing.
    const boom = vi.fn(() => {
      throw new Error('exec exploded');
    });
    await expect(probeCodexVersion('codex', boom as never)).resolves.toBe(unknownVersion());
  });

  it('names the probed binary when the version is unknown', async () => {
    const out = await probeCodexVersion('/opt/bin/wrapper', ok(''));
    expect(out).toBe('/opt/bin/wrapper (version unknown)');
    expect(out).not.toBe(unknownVersion());
  });

  it('settles at the cap even when the child never answers', async () => {
    // The property the cap exists for, asserted AT THE PROBE rather than only at the
    // helper: `execFile`'s own timeout settles on stream close, which a wedged child or a
    // surviving grandchild can withhold forever.
    vi.useFakeTimers();
    const never = vi.fn(() => new Promise<string>(() => {}));
    const p = probeCodexVersion('codex', never as never);
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS + 1);
    await expect(p).resolves.toBe(unknownVersion());
    vi.useRealTimers();
  });
});

describe('bounded stderr is reported honestly', () => {
  it('reports the TRUE pre-elision size, not the length of what survived', () => {
    // The failure this guards: a bounded capture elides the middle, the `[… elided …]` marker
    // sits at the head/tail seam far outside the 4000-char tail, and measuring the string we
    // were handed would silently under-report megabytes as kilobytes.
    const elided = `${'head'.padEnd(50, 'h')}\n[… elided 9000000 bytes …]\ntail`;
    const honest = formatStderrTail(elided, STDERR_TAIL_CHARS, 9_000_123);
    expect(honest).toContain('of 9000123 bytes');
    expect(honest).not.toContain(`of ${Buffer.byteLength(elided)} bytes`);
  });

  it('falls back to measuring the string when no true total is supplied', () => {
    expect(formatStderrTail('abc')).toContain('of 3 bytes');
  });

  it('threads the true total through describeCodexFailure', () => {
    const msg = describeCodexFailure({
      exitCode: 1,
      stderr: 'boom',
      version: 'codex 1.0',
      stderrBytes: 777_000,
    });
    expect(msg).toContain('of 777000 bytes');
  });
});
