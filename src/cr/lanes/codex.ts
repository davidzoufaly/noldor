import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { writeJsonAtomic } from '../atomic-write.js';
import type { Finding, LaneFindings } from '../findings-schema.js';
import type { LaneInput, LaneResult } from '../lane-types.js';

interface ExecResult {
  stdout: string;
  stderr: string;
}

function exec(cmd: string, args: string[], opts: { timeout: number }): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/**
 * Extract the `{ summary, findings }` JSON object from a command's stdout,
 * tolerating any non-JSON noise around it. `--silent` already strips pnpm's
 * lifecycle banner, but a pnpm flag is not the only thing that can pollute
 * stdout (codex CLI warnings, an `.npmrc`-driven notice, a deprecation line),
 * and a leading `>` makes a bare `JSON.parse` throw. Slicing from the first `{`
 * to the last `}` recovers the object regardless of surrounding lines.
 */
function extractLaneJson(stdout: string): CodexRawOutput {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end < start) {
    throw new Error(`codex lane: no JSON object in stdout: ${stdout.slice(0, 200)}`);
  }
  return JSON.parse(stdout.slice(start, end + 1)) as CodexRawOutput;
}

export interface CodexOpts {
  supportsBaseSha?: boolean;
}

export async function codexSupportsBaseSha(): Promise<boolean> {
  try {
    const { stdout } = await exec('pnpm', ['--silent', 'noldor', 'cr', 'codex', '--help'], {
      timeout: 5000,
    });
    return /--base-sha/.test(stdout);
  } catch {
    return false;
  }
}

interface CodexRawOutput {
  summary: string;
  findings: Finding[];
}

export async function runCodex(input: LaneInput, opts: CodexOpts = {}): Promise<LaneResult> {
  const sinkPath = join(input.repoRoot, '.noldor', 'cr', `${input.slug}-${input.kind}-codex.json`);
  const startedAt = new Date().toISOString();
  const mode = input.kind === 'spec' ? '--spec' : '--plan';
  // `--silent` suppresses pnpm's lifecycle banner (`> pkg@ver` / `> node bin/...`) so the only
  // thing on stdout is the codex lane's `{ summary, findings }` JSON — otherwise `JSON.parse`
  // below chokes on the leading `>`. Must precede the `noldor` script name (it is a pnpm flag).
  const args = ['--silent', 'noldor', 'cr', 'codex', mode, input.artifact, '--slug', input.slug];

  if (input.baseSha && !input.fullReview) {
    if (opts.supportsBaseSha) {
      args.push('--base-sha', input.baseSha);
    } else {
      console.warn(
        `codex lane: --base-sha unsupported by installed CLI — fall back to full review`,
      );
    }
  }

  let payload: LaneFindings;
  try {
    const { stdout } = await exec('pnpm', args, { timeout: 120_000 });
    const raw = extractLaneJson(stdout);
    payload = {
      lane: 'codex',
      artifact: input.artifact,
      kind: input.kind,
      slug: input.slug,
      blockers: raw.findings.filter((f) => f.severity === 'high'),
      suggestions: raw.findings.filter((f) => f.severity !== 'high'),
      summary: raw.summary,
      startedAt,
      finishedAt: new Date().toISOString(),
      ...(input.baseSha && opts.supportsBaseSha ? { baseSha: input.baseSha } : {}),
      ...(input.fullReview ? { fullReview: true } : {}),
    };
  } catch (err) {
    const errMsg = (err as NodeJS.ErrnoException).message ?? String(err);
    payload = {
      lane: 'codex',
      artifact: input.artifact,
      kind: input.kind,
      slug: input.slug,
      blockers: [
        {
          severity: 'high',
          file: input.artifact,
          message: `codex lane errored: ${errMsg}`,
        },
      ],
      suggestions: [],
      summary: 'codex error',
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  await writeJsonAtomic(sinkPath, payload);
  return { lane: 'codex', sinkPath, ok: payload.blockers.length === 0 };
}
