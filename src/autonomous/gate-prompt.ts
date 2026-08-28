import { parseSlug, type Slug } from '../core/slug.js';

/**
 * Parse a slug destined for a rendered command line.
 *
 * Not a path build, so no builder covers it — but the value is interpolated
 * into a command a headless child then executes, so an unchecked one is
 * argument injection. Branding `DrainSource.gatePrompt` would cascade through
 * the whole supervisor for a string-rendering concern, so the check lives here,
 * at the point the value becomes a command.
 */
function requireSlug(slug: string): Slug {
  const parsed = parseSlug(slug);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.slug;
}

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
 * The code-stage CR invocation both roadmap-source prompts hand the child. Shared so a flag change
 * (profile, artifact pathspec) is one edit rather than two silently-diverging prompt literals. The
 * runner-neutral page `docs/noldor/drain-mode.md` carries a third, prose rendering — keep it in sync
 * by hand; there is no code seam between a TS literal and a Markdown page.
 */
function fastTrackCrCommand(slug: Slug): string {
  return `(\`pnpm noldor cr orchestrate --slug ${slug} --artifact . --kind code --profile fast-track --autonomous\`),`;
}

/**
 * Drain entry (roadmap source): ship one fast-track entry on `fast/<slug>`.
 * Slash-command branch: an explicit drain entry that short-circuits the
 * interactive Step 0 — a headless model ignores an env-var-only signal, so
 * the assigned slug must ride the prompt itself.
 */
export function buildDrainGatePrompt(rawSlug: string, dispatch: PromptDispatch): string {
  const slug = requireSlug(rawSlug);
  if (dispatch === 'slash-command') return `/noldor-gate --drain ${slug}`;
  return [
    'Autonomous Noldor drain run. Read docs/noldor/drain-mode.md and follow it exactly.',
    '',
    `Ship roadmap entry '${slug}' end-to-end on branch 'fast/${slug}' with ZERO interactive`,
    'questions. Force-recreate the branch from main, implement the entry, remove its roadmap',
    `block (\`pnpm noldor roadmap remove-block ${slug}\`), mark the session autonomous`,
    '(`pnpm noldor noldor set-autonomous`), run code-stage CR',
    fastTrackCrCommand(slug),
    'and ship via `pnpm noldor pr-flow`. On CR-red or test-red run',
    '`pnpm noldor cr escalate --autonomous` and exit non-zero.',
  ].join('\n');
}

/**
 * Finish entry (roadmap source): a prior child for this slug committed its work
 * on `fast/<slug>` and then ended its turn without pushing or opening a PR —
 * typically by backgrounding the code-stage CR lane and reporting "waiting on
 * the reviewer". The supervisor detects that state (clean exit, no PR, branch
 * ahead of `origin/main`) and re-spawns with THIS prompt instead of the
 * from-scratch {@link buildDrainGatePrompt}: the child reuses the existing
 * branch and runs Step 4 end-of-flow only, turning a ~13min/~170k-token rebuild
 * into a delivery-only pass.
 *
 * Two invariants ride the prompt (PR #33 rule — directives never ride env
 * alone): (1) do NOT force-recreate the branch, which would destroy the very
 * commits being finished; (2) never background the end-of-flow commands, and
 * never end the turn before `pr-flow` printed the PR URL — the child-side
 * assertion that closes the false-retry loop at its source.
 */
export function buildFinishGatePrompt(rawSlug: string, dispatch: PromptDispatch): string {
  const slug = requireSlug(rawSlug);
  const shared = [
    `Branch 'fast/${slug}' ALREADY carries committed work for roadmap entry '${slug}' from a`,
    'prior child that ended without opening a PR. Do NOT force-recreate or delete the branch,',
    'and do NOT re-implement the entry — reuse the existing branch/worktree and deliver it.',
    `Ensure the roadmap block is gone (\`pnpm noldor roadmap remove-block ${slug}\` is idempotent),`,
    'mark the session autonomous (`pnpm noldor noldor set-autonomous`), run code-stage CR',
    fastTrackCrCommand(slug),
    'and ship via `pnpm noldor pr-flow`. Run every one of those commands in the FOREGROUND and',
    'wait for it to exit — never background them. Do NOT end your turn before `pr-flow` has',
    'printed the PR URL. On CR-red or test-red run `pnpm noldor cr escalate --autonomous` and',
    'exit non-zero.',
  ];
  if (dispatch === 'slash-command')
    return [
      `/noldor-gate --drain ${slug} --finish`,
      '',
      'Finish-mode drain context.',
      ...shared,
    ].join('\n');
  return [
    'Autonomous Noldor drain FINISH run. Read docs/noldor/drain-mode.md (Finish path) and',
    'follow it exactly.',
    '',
    ...shared,
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
