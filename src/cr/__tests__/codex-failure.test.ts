// @tests: specs-cr-gate-multi-reviewer
import { describe, expect, it, vi } from 'vitest';
import type { Spawn } from '../codex-spawn.js';
import {
  AUTH_HINT_RE,
  STDERR_TAIL_CHARS,
  unknownVersion,
  describeCodexFailure,
  formatStderrTail,
  probeCodexVersion,
} from '../codex-failure.js';

/** The models-cache noise codex 0.133.0 emits on a perfectly healthy run. */
const MODELS_NOISE =
  'ERROR codex_models_manager::cache: failed to load models cache: unknown variant `max`, expected one of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`';

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
});

describe('probeCodexVersion', () => {
  const version = (r: { stdout: string; exitCode: number }): Spawn =>
    vi.fn(async () => ({ stdout: r.stdout, stderr: '', exitCode: r.exitCode }));

  it('returns the first line of a successful probe', async () => {
    expect(await probeCodexVersion(version({ stdout: 'codex-cli 0.133.0\n', exitCode: 0 }))).toBe(
      'codex-cli 0.133.0',
    );
  });

  it('asks the CLI for --version', async () => {
    const spawn = version({ stdout: 'codex-cli 0.133.0', exitCode: 0 });
    await probeCodexVersion(spawn);
    const call = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.cmd).toBe('codex');
    expect(call.args).toEqual(['--version']);
  });

  it.each([
    ['a non-zero exit', version({ stdout: 'whatever', exitCode: 1 })],
    ['empty output', version({ stdout: '   \n', exitCode: 0 })],
  ])('falls back to the unknown marker on %s', async (_label, spawn) => {
    expect(await probeCodexVersion(spawn)).toBe(unknownVersion());
  });

  it('never throws, even when the spawn itself throws', async () => {
    // An attribution helper that fails must not mask the failure it is attributing.
    const boom: Spawn = vi.fn(async () => {
      throw new Error('spawn exploded');
    });
    await expect(probeCodexVersion(boom)).resolves.toBe(unknownVersion());
  });

  it('probes the command it is given, not a hard-coded `codex`', async () => {
    // runCodex accepts a `cmd` override. Probing a hard-coded `codex` would report the
    // version of a binary that was never run — misattributing the failure at exactly the
    // point where attribution is the whole purpose.
    const spawn = version({ stdout: 'wrapper 9.9.9', exitCode: 0 });
    await probeCodexVersion(spawn, '/opt/bin/codex-wrapper');
    const call = (spawn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.cmd).toBe('/opt/bin/codex-wrapper');
  });

  it('names the probed binary when the version is unknown', async () => {
    const out = await probeCodexVersion(version({ stdout: '', exitCode: 1 }), '/opt/bin/wrapper');
    expect(out).toBe('/opt/bin/wrapper (version unknown)');
    expect(out).not.toBe(unknownVersion());
  });
});
