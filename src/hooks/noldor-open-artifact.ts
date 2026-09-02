// @fd: auto-open-design-artifacts
// `noldor hooks open-artifact` — the Claude wiring for auto-open. A PostToolUse
// hook matched on `Write` opens a newly written spec/plan and hands the agent a
// ready-to-paste markdown link.
//
// Two contracts hold unconditionally. It ALWAYS exits 0: a hook that can fail is
// a hook that can wedge a gate step for a cosmetic convenience. And it matches
// `Write` only, never `Edit` — the artifact is created by the strawman `Write`
// and refined by `Edit` for the rest of the design dialogue, so the tool boundary
// is a free stateless dedupe. Matching `Edit` too would re-launch `code` on every
// recorded decision, and `code` on an open tab steals focus.

import { readFileSync } from 'node:fs';

import {
  WORKSPACE_ROOT_ENV,
  buildArtifactLink,
  launchArtifact,
  resolveArtifact,
} from '../design/open-artifact.js';

import { filePathFromPayload } from './noldor-pre-edit-guard.js';

/** What a PostToolUse payload carries that this hook reads. Unknown keys ignored. */
interface PostToolUsePayload {
  cwd?: string;
  tool_input?: {
    file_path?: string;
    notebook_path?: string;
    path?: string;
  };
}

/**
 * The JSON a hook must emit for text to reach the MODEL. A `PostToolUse` hook's
 * plain stdout is transcript-only, so without this field the agent would still be
 * deriving the path — which is the defect being fixed.
 */
export interface HookOutput {
  hookSpecificOutput: {
    hookEventName: 'PostToolUse';
    additionalContext: string;
  };
}

/**
 * Decide what the hook should say for one payload, or `undefined` when it should
 * say nothing (every `Write` to a source file takes that branch).
 *
 * @param payload - The parsed PostToolUse payload.
 * @param env - Process environment, read for {@link WORKSPACE_ROOT_ENV}.
 * @param launch - Injected in tests; defaults to the real editor spawn.
 */
export function openArtifactForPayload(
  payload: PostToolUsePayload,
  env: Readonly<Record<string, string | undefined>>,
  launch?: Parameters<typeof launchArtifact>[2],
): HookOutput | undefined {
  const cwd = payload.cwd ?? process.cwd();
  const resolved = resolveArtifact({
    path: filePathFromPayload(payload),
    cwd,
    // The env var is the NAMED root; `payload.cwd` is only inferred, so it rides
    // `hintRoot`. Through the named field a cwd that is not an existing directory
    // would come back `bad-workspace-root` and report no path at all, where the
    // ladder says it should simply fall through.
    workspaceRoot: env[WORKSPACE_ROOT_ENV],
    hintRoot: payload.cwd,
  });
  if (resolved.kind === 'rejected') return undefined;

  // Launch BEFORE emitting, inverting the CLI's order deliberately: a hook's
  // stdout is read only after the process exits, so printing first buys nothing
  // here, while launching first lets one JSON object carry the launch warning.
  // EDITOR_TIMEOUT_MS is what makes that safe — the wait is bounded.
  const launched = launchArtifact(resolved.absPath, cwd, launch);
  const parts = [
    `Design artifact written. Report it with this exact markdown link: ${buildArtifactLink(resolved.linkPath)}`,
  ];
  if (resolved.warning !== undefined) parts.push(resolved.warning);
  if (launched.kind === 'not-launched') parts.push(`No editor tab opened — ${launched.warning}`);

  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: parts.join('\n'),
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    // An interactive TTY (operator ran it bare) has no payload; don't block on a
    // stdin read that will never complete — same guard as the pre-edit guard.
    if (!process.stdin.isTTY) {
      let payload: PostToolUsePayload = {};
      let parsed = true;
      try {
        payload = JSON.parse(readFileSync(0, 'utf8')) as PostToolUsePayload;
      } catch {
        parsed = false;
      }
      if (parsed) {
        const output = openArtifactForPayload(payload, process.env);
        if (output !== undefined) process.stdout.write(`${JSON.stringify(output)}\n`);
      }
    }
  } catch {
    // Unreachable in principle — resolveArtifact and launchArtifact both swallow
    // their own failures. Kept because the exit-0 contract must hold even if a
    // future edit breaks that, and a thrown hook is a wedged gate step.
  }
  process.exit(0);
}
