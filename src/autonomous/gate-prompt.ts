// @fd: portable-gate-entrypoint-for-non-claude-runners

/**
 * Runner-aware gate entry prompts for the autonomous drain (portable gate
 * entrypoint, spec Unit 2).
 *
 * 'slash-command' dispatch (claude, stub) returns the battle-tested strings
 * byte-identical to the pre-extraction `drain-source.ts` literals — Claude
 * Code expands them via the vendored gate skill. 'prose' dispatch (codex,
 * opencode) returns a self-contained directive: those runners have no
 * slash-command system, so the contract must ride the prompt itself (PR #33
 * rule: directives ride the prompt, never env) and points at the canonical
 * runner-neutral page `docs/noldor/drain-mode.md` so the prompt stays a thin
 * pointer rather than a second copy of the gate skill.
 */
export type PromptDispatch = 'slash-command' | 'prose';

/**
 * Drain entry (roadmap source): ship one fast-track entry on `fast/<slug>`.
 * Slash-command branch: an explicit drain entry that short-circuits the
 * interactive Step 0 — a headless model ignores an env-var-only signal, so
 * the assigned slug must ride the prompt itself.
 */
export function buildDrainGatePrompt(slug: string, dispatch: PromptDispatch): string {
  if (dispatch === 'slash-command') return `/noldor-gate --drain ${slug}`;
  return [
    'Autonomous Noldor drain run. Read docs/noldor/drain-mode.md and follow it exactly.',
    '',
    `Ship roadmap entry '${slug}' end-to-end on branch 'fast/${slug}' with ZERO interactive`,
    'questions. Force-recreate the branch from main, implement the entry, remove its roadmap',
    `block (\`pnpm noldor roadmap remove-block ${slug}\`), mark the session autonomous`,
    '(`pnpm noldor noldor set-autonomous`), run code-stage CR',
    `(\`pnpm noldor cr orchestrate --slug ${slug} --artifact . --kind code --profile fast-track --autonomous\`),`,
    'and ship via `pnpm noldor pr-flow`. On CR-red or test-red run',
    '`pnpm noldor cr escalate --autonomous` and exit non-zero.',
  ].join('\n');
}

/**
 * Resume entry (plans source): resume one designed in-progress FD on
 * `feat/<slug>`. Plan-drain is headless: the resumed gate MUST run
 * autonomously or it stalls at the autonomous-vs-interactive / lane-picker /
 * PR-approval seams a headless child can't answer. Per the PR #33 rule the
 * directive rides the prompt (never env): the `--autonomous` flag (slash) or
 * explicit prose tell the gate to set `session.autonomous` immediately and
 * ship end-to-end without pausing.
 */
export function buildResumeGatePrompt(slug: string, dispatch: PromptDispatch): string {
  if (dispatch === 'slash-command') {
    return [
      `/noldor-gate --resume ${slug} --autonomous`,
      '',
      'Autonomous plan-drain context: run this resume end-to-end with NO interactive prompts.',
      'Immediately set autonomous mode (`pnpm noldor noldor set-autonomous`) right after the',
      'session marker is written — do NOT ask autonomous-vs-interactive. Implement the plan',
      'inline, run code-stage CR, and ship via pr-flow. On CR-red or test-red run',
      '`cr escalate --autonomous` (config `autonomous.onFailure` governs). Never pause for a',
      'lane picker or PR approval.',
    ].join('\n');
  }
  return [
    'Autonomous Noldor plan-drain resume. Read docs/noldor/drain-mode.md (Resume path) and',
    'follow it exactly.',
    '',
    `Resume the designed in-progress feature '${slug}' end-to-end on branch 'feat/${slug}'`,
    'with NO interactive prompts. Its approved spec and plan are committed under',
    'docs/design/ — read both and execute the plan inline; if either is missing, exit',
    'non-zero. Immediately set autonomous mode (`pnpm noldor noldor set-autonomous`) right',
    'after the session marker is written — never ask autonomous-vs-interactive. Implement',
    'the plan, run code-stage CR',
    `(\`pnpm noldor cr orchestrate --slug ${slug} --artifact . --kind code --autonomous\`),`,
    'and ship via `pnpm noldor pr-flow`. On CR-red or test-red run',
    '`pnpm noldor cr escalate --autonomous` (config `autonomous.onFailure` governs).',
    'Never pause for a lane picker or PR approval.',
  ].join('\n');
}
