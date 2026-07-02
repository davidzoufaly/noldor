// src/hooks/noldor-pre-edit-guard.ts
// PreToolUse guard: post-rollout, edits to tracked files require an active
// /gate session. Wired in .claude/settings.json as a PreToolUse hook on
// Edit|Write|NotebookEdit; also invocable as `noldor hooks pre-edit-guard <path>`.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { readSession } from '../core/session';
import { readRolloutMarker } from '../core/rollout-marker';

export interface PreEditResult {
  ok: boolean;
  reason?: string;
}

function gitToplevel(dir: string): string | null {
  const r = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.trim() || null;
}

function isTracked(root: string, filePath: string): boolean {
  const r = spawnSync('git', ['-C', root, 'ls-files', '--error-unmatch', '--', filePath], {
    stdio: 'ignore',
  });
  return r.status === 0;
}

/**
 * Post-rollout, block Edit/Write to a tracked file unless a /gate session is
 * active. The enforcement root is resolved FROM THE FILE being edited (its
 * repo's toplevel), not from the process cwd — the harness may run hooks from
 * the main workspace while the session edits inside a worktree, and each
 * worktree carries its own `.noldor/session.json`.
 *
 * Deliberately open for: files outside any git repo (scratch, memory),
 * untracked files (new-file scaffolding — the commit-stage gate catches
 * those), and any repo without a rollout marker (soft mode).
 */
export function runPreEditGuard(opts: { cwd: string; filePath?: string }): PreEditResult {
  const target = opts.filePath ?? '<unknown>';

  let root: string;
  let insideGitRepo: boolean;
  if (opts.filePath && isAbsolute(opts.filePath)) {
    const top = gitToplevel(dirname(opts.filePath));
    if (!top) return { ok: true }; // outside any repo — not gate territory
    root = top;
    insideGitRepo = true;
  } else {
    // Relative path (or none): resolve against cwd; a non-git cwd keeps the
    // legacy behavior of enforcing directly on cwd.
    const top = gitToplevel(opts.cwd);
    root = top ?? opts.cwd;
    insideGitRepo = top !== null;
  }

  if (!readRolloutMarker(root)) return { ok: true }; // soft mode pre-rollout
  if (readSession(root)) return { ok: true }; // gate already engaged
  if (insideGitRepo && opts.filePath && !isTracked(root, opts.filePath)) {
    return { ok: true }; // untracked file — commit-stage gate owns it
  }

  return {
    ok: false,
    reason: `edits to "${target}" require /gate. Run /gate before editing.`,
  };
}

interface PreToolUsePayload {
  cwd?: string;
  tool_input?: {
    file_path?: string;
    notebook_path?: string;
    path?: string;
  };
}

/** Extract the target file path from a Claude Code PreToolUse payload. */
export function filePathFromPayload(payload: PreToolUsePayload): string | undefined {
  const input = payload.tool_input ?? {};
  return input.file_path ?? input.notebook_path ?? input.path;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argPath = process.argv[2];
  let result: PreEditResult;
  if (argPath !== undefined) {
    // Direct invocation: `noldor hooks pre-edit-guard <path>`.
    result = runPreEditGuard({ cwd: process.cwd(), filePath: argPath });
  } else {
    // PreToolUse hook invocation: JSON payload on stdin. Fail open on any
    // read/parse problem — a guard bug must never brick the editor.
    let payload: PreToolUsePayload = {};
    try {
      payload = JSON.parse(readFileSync(0, 'utf8')) as PreToolUsePayload;
    } catch {
      process.exit(0);
    }
    result = runPreEditGuard({
      cwd: payload.cwd ?? process.cwd(),
      filePath: filePathFromPayload(payload),
    });
  }
  if (!result.ok) {
    console.error(`Noldor gate: ${result.reason}`);
    process.exit(2); // Claude Code PreToolUse blocking exit code
  }
}
