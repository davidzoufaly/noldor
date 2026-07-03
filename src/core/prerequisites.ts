// Declared environmental prerequisites — the stack Noldor hard-assumes.
// `noldor doctor` probes these so a mismatched adopter fails at minute one
// with a named tool instead of mid-gate with a runtime error. The human-facing
// matrix twin lives at docs/noldor/adoption-guide.md#prerequisites; keep the
// two in sync (the matrix cites this module as its source of truth).
//
// Scope guard: this module only makes the floor visible. Abstraction decisions
// (other package managers, other agents) belong to
// `portable-gate-entrypoint-for-non-claude-runners`.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareDotted, type VersionProbe } from './agent-runner/doctor-runners.js';

export const MATRIX_LINK = 'docs/noldor/adoption-guide.md#prerequisites';

export interface BinaryPrerequisite {
  /** binary name, probed as `<id> --version` */
  id: string;
  /** minimum dotted version; below-floor is an error, not a warning */
  floor: string;
  /** one-line pointer to where the assumption lives, for the matrix + doctor detail */
  whereAssumed: string;
}

/**
 * Binaries every consumer needs on PATH. Agent runners (claude/codex/opencode)
 * are deliberately absent — `checkRunners` already probes the *configured*
 * ones, and flagging an unconfigured runner would be noise.
 */
export const BINARY_PREREQUISITES: readonly BinaryPrerequisite[] = [
  {
    id: 'node',
    floor: '20.0.0',
    whereAssumed: 'bin/noldor.mjs + tsx runtime execute all CLI surfaces',
  },
  {
    id: 'pnpm',
    floor: '9.0.0',
    whereAssumed: 'every lefthook job + gate/release/prep shell out via `pnpm …`',
  },
  {
    id: 'git',
    floor: '2.30.0',
    whereAssumed: 'worktrees, interpret-trailers, porcelain parsing across src/',
  },
  {
    id: 'gh',
    floor: '2.0.0',
    whereAssumed: 'pr-flow PR create/merge, release, drain salvage',
  },
  {
    id: 'lefthook',
    floor: '1.0.0',
    whereAssumed: 'runs every commit/push hook — without it gate enforcement never fires',
  },
];

export interface PrereqCheck {
  /** `<bin>` for binaries, `script:<name>` for package scripts */
  id: string;
  status: 'ok' | 'missing' | 'below-floor';
  detail: string;
}

function defaultProbe(bin: string): string | null {
  try {
    const out = execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000 });
    const m = out.match(/\d+(\.\d+)+/);
    return m ? m[0] : out.trim() || '0';
  } catch {
    return null;
  }
}

/** Presence + version-floor check for every declared binary prerequisite. */
export function checkBinaryPrerequisites(probe: VersionProbe = defaultProbe): PrereqCheck[] {
  return BINARY_PREREQUISITES.map((p) => {
    const version = probe(p.id);
    if (version === null) {
      return {
        id: p.id,
        status: 'missing' as const,
        detail: `'${p.id}' not found on PATH (${p.whereAssumed})`,
      };
    }
    if (compareDotted(version, p.floor) < 0) {
      return { id: p.id, status: 'below-floor' as const, detail: `${version} < floor ${p.floor}` };
    }
    return { id: p.id, status: 'ok' as const, detail: version };
  });
}

/**
 * package.json scripts the scaffolded lefthook template invokes on the
 * consumer (`pnpm lint`, `pnpm fmt`, `pnpm --silent fmt:check`) plus `test`,
 * which the verify lane and release pipeline run. Missing ones surface here
 * instead of as a mid-commit lefthook failure.
 */
export const REQUIRED_CONSUMER_SCRIPTS: readonly string[] = ['lint', 'fmt', 'fmt:check', 'test'];

/** Checks the consumer package.json declares every script the hooks invoke. */
export function checkConsumerScripts(cwd: string): PrereqCheck[] {
  let scripts: Record<string, unknown> = {};
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as {
      scripts?: Record<string, unknown>;
    };
    scripts = pkg.scripts ?? {};
  } catch {
    // absent/unreadable package.json → every required script reports missing
  }
  return REQUIRED_CONSUMER_SCRIPTS.map((name) => {
    if (typeof scripts[name] === 'string') {
      return { id: `script:${name}`, status: 'ok' as const, detail: String(scripts[name]) };
    }
    return {
      id: `script:${name}`,
      status: 'missing' as const,
      detail: `package.json has no "${name}" script — the scaffolded lefthook config invokes it`,
    };
  });
}
