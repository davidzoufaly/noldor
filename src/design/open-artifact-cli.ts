// @fd: auto-open-design-artifacts
// `noldor design open <path> [--workspace-root <abs-path>] [--open]` — the runner-neutral
// half of auto-open. Always prints the path the operator's editor resolves a
// markdown link against; opens a tab only when `design.autoOpen` is on or
// `--open` is typed, because a launch can raise a different editor window and
// interrupt parallel work. Codex and opencode prose call this; Claude reaches the
// same unit through `noldor hooks open-artifact`.

import { readValueFlags, runIfDirect } from '../core/cli-entry.js';

import {
  WORKSPACE_ROOT_ENV,
  autoOpenEnabled,
  buildArtifactLink,
  isExistingDir,
  launchArtifact,
  resolveArtifact,
} from './open-artifact.js';

export interface OpenArtifactCliDeps {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /**
   * Injected so tests exercise the launch branches without spawning a real
   * editor window per case. Defaults to the real `code` spawn.
   */
  readonly launch?: Parameters<typeof launchArtifact>[2];
}

/**
 * Run the command. Exit 2 only for a usage error — a missing editor still prints
 * the path and exits 0, because other runners' prose is required to call this and
 * a cosmetic absence must not fail their gate step.
 */
export function runOpenArtifact(argv: readonly string[], deps: OpenArtifactCliDeps): number {
  // `readValueFlags`, not a hand-rolled scan: it finds positionals by INDEX
  // (so a path whose text equals a flag's value survives), rejects a flag-shaped
  // value, and reports an unknown `--flag` instead of ignoring it. A hand-rolled
  // `argv.find` here skipped index 0 whenever `--workspace-root` was absent,
  // because `indexOf` returns -1 and `-1 + 1` is the path's own slot.
  // `--open` is stripped BEFORE `readValueFlags`, which reports any leftover
  // `--flag` as unknown and would reject it — a boolean flag has to be consumed
  // ahead of that check, not read back out of the positionals afterwards.
  const forceOpen = argv.includes('--open');
  const read = readValueFlags(
    argv.filter((a) => a !== '--open'),
    ['--workspace-root'],
    'design open',
  );
  if (!read.ok) {
    deps.err(read.error);
    return 2;
  }

  // A typo in the TYPED flag is a usage error, reported before anything else is
  // judged — `design open --workspace-root /tmp/nope src/foo.ts` must name the
  // bad root, not the file. `resolveArtifact` validates the same value lazily
  // (after the artifact predicate) because there it also carries the ambient env
  // var, where an eager check would report a stale export on every unrelated
  // path. Typed-here versus ambient is the distinction; the CLI owns the first.
  const flagRoot = read.values.get('--workspace-root');
  if (flagRoot !== undefined && !isExistingDir(flagRoot)) {
    deps.err(
      `design open: --workspace-root must be an absolute existing directory (got '${flagRoot}')`,
    );
    return 2;
  }

  const resolved = resolveArtifact({
    path: read.positional[0],
    cwd: deps.cwd,
    // The flag wins over the env var: both are NAMED roots, and the one typed on
    // this invocation is the more specific statement of intent.
    workspaceRoot: flagRoot ?? deps.env[WORKSPACE_ROOT_ENV],
  });
  if (resolved.kind === 'rejected') {
    deps.err(`design open: ${resolved.message}`);
    return 2;
  }

  // Print before launching: this stdout may be read by a human or a pipe before
  // the command returns, so the deliverable goes out first.
  deps.out(resolved.linkPath);
  deps.out(`link: ${buildArtifactLink(resolved.linkPath)}`);
  if (resolved.warning !== undefined) deps.err(`design open: ${resolved.warning}`);

  // The link is unconditional; the tab is opt-in via `design.autoOpen` or a typed
  // `--open`. Suppression is ANNOUNCED rather than silent — a command named
  // `open` that opens nothing has to say why, or it reads as broken.
  if (!forceOpen && !autoOpenEnabled(resolved.checkoutRoot)) {
    deps.err(
      'design open: link reported, editor not launched — design.autoOpen is off in .noldor/config.json. Pass --open to open it now.',
    );
    return 0;
  }

  const launched = launchArtifact(resolved.absPath, deps.cwd, deps.launch);
  if (launched.kind === 'not-launched') deps.err(`design open: ${launched.warning}`);
  return 0;
}

export async function main(argv: string[], cwd: string = process.cwd()): Promise<number> {
  return runOpenArtifact(argv, {
    cwd,
    env: process.env,
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  });
}

runIfDirect('open-artifact-cli', 'design open', async () => main(process.argv.slice(2)));
