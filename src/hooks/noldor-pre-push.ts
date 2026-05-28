// scripts/hooks/noldor-pre-push.ts
// pre-push stage: blocks direct pushes to origin/main, enforcing the Noldor PR flow.
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

export interface PrePushInput {
  remoteName: string;
  refLines: string[];
  env: Record<string, string | undefined>;
}

export interface PrePushResult {
  ok: boolean;
  override?: 'release';
  reason?: string;
}

const REJECTION_MESSAGE = `Direct push to origin/main is blocked by Noldor PR flow.

All paths land on main via PR. Use the gate end-of-flow:
  1. Ensure session marker is set (.noldor/session.json).
  2. /gate end-of-flow runs PR creation + auto-merge automatically.

Bypass (release script only): set NOLDOR_RELEASE_PUSH=1 in the
invoking environment. Audited via the .noldor/release-pushes.log
receipt and /garden override detector.`;

function pushesMain(refLines: string[]): boolean {
  // Per `git help githooks`, each line is:
  //   <local ref> SP <local sha1> SP <remote ref> SP <remote sha1>
  // The DESTINATION (third field) determines what gets mutated on origin.
  // `git push origin feature-x:main` writes feature-x to remote main — must block.
  return refLines.some((line) => {
    const fields = line.trim().split(/\s+/);
    const remoteRef = fields[2];
    return remoteRef === 'refs/heads/main';
  });
}

export function evaluatePrePush(input: PrePushInput): PrePushResult {
  if (input.remoteName !== 'origin') return { ok: true };
  if (!pushesMain(input.refLines)) return { ok: true };
  if (input.env.NOLDOR_RELEASE_PUSH === '1') {
    return { ok: true, override: 'release' };
  }
  return { ok: false, reason: REJECTION_MESSAGE };
}

export function recordReleasePush(opts: {
  cwd: string;
  iso: string;
  sha: string;
  version: string;
}): void {
  const dir = join(opts.cwd, '.noldor');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const line = `${opts.iso} ${opts.sha} ${opts.version}\n`;
  appendFileSync(join(dir, 'release-pushes.log'), line, 'utf8');
}

async function main(): Promise<number> {
  const remoteName = process.argv[2] ?? 'origin';
  const stdinResult = await readStdinWithTimeout(process.stdin, 5_000);
  if (!stdinResult.ok) {
    const reason =
      stdinResult.reason === 'timeout'
        ? 'stdin read timed out after 5s. Lefthook may not be proxying git’s stdin (check use_stdin: true on the pre-push job)'
        : 'stdin emitted an error before end-of-input';
    process.stderr.write(
      `noldor-pre-push: ${reason} ` +
        `(see docs/noldor/pr-flow.md "Push runbook — fast-fail diagnosis").\n`,
    );
    return 2;
  }
  const refLines = stdinResult.data.split('\n').filter((l) => l.trim().length > 0);
  const result = evaluatePrePush({ remoteName, refLines, env: process.env });
  if (!result.ok) {
    process.stderr.write(`${result.reason}\n`);
    return 1;
  }
  if (result.override === 'release') {
    const sha = (refLines[0] ?? '').split(/\s+/)[1] ?? 'unknown';
    const { execFileSync } = await import('node:child_process');
    let version = 'unknown';
    try {
      const pkg = execFileSync('node', ['-p', "require('./package.json').version"], {
        encoding: 'utf8',
      });
      version = pkg.trim();
    } catch {
      // best-effort; leave 'unknown'
    }
    recordReleasePush({ cwd: process.cwd(), iso: new Date().toISOString(), sha, version });
  }
  return 0;
}

export interface ReadStdinOk {
  ok: true;
  data: string;
}
export interface ReadStdinErr {
  ok: false;
  reason: 'timeout' | 'stream-error';
}
export type ReadStdinResult = ReadStdinOk | ReadStdinErr;

export function readStdinWithTimeout(
  stream: Readable,
  timeoutMs: number,
): Promise<ReadStdinResult> {
  return new Promise<ReadStdinResult>((resolve) => {
    let data = '';
    let settled = false;
    const settle = (result: ReadStdinResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => settle({ ok: false, reason: 'timeout' }), timeoutMs);
    stream.on('data', (chunk: Buffer | string) => {
      data += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });
    stream.on('end', () => settle({ ok: true, data }));
    stream.on('error', () => settle({ ok: false, reason: 'stream-error' }));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().then((code) => process.exit(code));
}
