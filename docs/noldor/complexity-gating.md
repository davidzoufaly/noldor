---
noldor-page: complexity-gating
introduced: 0.4.0
---

# Complexity Gating

Every change picks exactly one of six gate paths, chosen via [`/gate`](../../.claude/skills/gate/SKILL.md) before any code edit. The path is recorded in the commit trailer (`Noldor-Path`) and — for paths that create a new FD — in the FD frontmatter (`noldor-tier`, see [feature-md-schema.md](feature-md-schema.md)).

## Gate paths

| #   | Path                | FD                       | Design Spec | Plan | Worktree | Reviewer | Use                                       |
| --- | ------------------- | ------------------------ | ----------- | ---- | -------- | -------- | ----------------------------------------- |
| 1   | `micro-chore`       | —                        | —           | —    | —        | —        | doc/policy edits matching allowlist       |
| 2   | `fast-track`        | —                        | —           | —    | ✓        | ✓        | small code change, no FD warranted        |
| 3   | `specs-only-new`    | new (tier: `specs-only`) | ✓           | —    | ✓        | ✓        | design needed, spec sufficient context    |
| 4   | `specs-only-attach` | parent (any tier)        | ✓           | —    | ✓        | ✓        | design-light enhancement under parent FD  |
| 5   | `full-new`          | new (tier: `full`)       | ✓           | ✓    | ✓        | ✓        | new design dialogue, new FD               |
| 6   | `full-attach`       | parent (any tier)        | ✓           | ✓    | ✓        | ✓        | substantial enhancement under existing FD |

**Design Spec** = a separate document under `docs/superpowers/specs/`, produced by `superpowers:brainstorming`. Both `specs-only` and `full` tiers produce one. The FD frontmatter + body always exists for FD-carrying paths regardless of tier. The difference between `specs-only-*` and `full-*` is whether `superpowers:writing-plans` runs after the spec — `specs-only` skips the plan-decomposition stage and goes directly to implementation.

A `specs-only` FD can receive a `full-attach` enhancement and vice versa. The parent FD's `noldor-tier` records its own creation depth, not the depth of subsequent attached work. Attach history is reconstructed from `Noldor-Path` trailers in attaching commits, not from the parent FD's frontmatter.

There is also a 7th internal path `release-automation` reserved for the `pnpm release` script's `chore(release): v…` commit. It carries `Noldor-Path: release-automation` and is the only path the hook accepts without `Noldor-FD` or `Noldor-Reviewed`. Users cannot pick this path via `/gate`; the release script provisions the session marker and the `prepare-commit-msg` hook injects the trailer from it.

## Size → path

Prep effort scales with an entry's `size:` field. Small entries are mechanical and ship without a design spec; medium-and-up entries warrant one. This is the default routing `/gate` applies to a roadmap pick — the operator can always override the prefilled path.

| `size:` | Spec? | Default path                                | Rationale                                      |
| ------- | ----- | ------------------------------------------- | ---------------------------------------------- |
| XS / S  | —     | `fast-track` (or `micro-chore` if pure-doc) | mechanical; a spec/plan is overhead, no FD     |
| M       | ✓     | `specs-only-new` / `specs-only-attach`      | design worth capturing; plan would be overkill |
| L / XL  | ✓     | `full-new` / `full-attach`                  | design **and** plan decomposition both warrant |

The `-attach` variant is chosen when the entry declares a `parent:` FD. A missing or unrecognized `size:` defaults to `specs-only` — the policy never silently drops review for an entry whose size it can't read.

The mapping is encoded once in [`sizeToPath()`](../../src/core/size-routing.ts) (with `sizeToTier()` and `sizeSkipsSpec()`); `getSuggestions()` stamps each entry surfaced at `/gate` Step 0 with a `suggestedPath` so the gate reads the verdict instead of re-deriving it in prose. Because XS/S route to `fast-track` (no FD, no `/promote`), `/gate` retires the source roadmap block itself when the fast-track ships — see the gate skill's "Roadmap-entry retirement" step.

## Allowlist for `micro-chore`

The pre-commit hook enforces that `micro-chore` diffs match this set of globs only:

- `docs/**/*.md`
- `.claude/**`
- Root `*.md` (e.g. `ideas.md`, `README.md`, `CLAUDE.md`)

Any diff that escapes the allowlist must use a heavier path (`fast-track` at minimum).

## Override

When the `/gate` hook genuinely cannot run (broken hook, mid-flight migration), use the override trailer instead of `--no-verify`:

```
Noldor-Path-Override: <human-readable reason>
```

`<reason>` must be human-readable text explaining why the normal path was bypassed. The entry is appended to `.noldor/overrides.log` and audited by `/garden`'s `override-audit` detector (see [`garden-and-drift.md`](garden-and-drift.md)).

`--no-verify` is forbidden by repo conventions. The override trailer is the only sanctioned escape.

### Pre-commit layer: `NOLDOR_PATH_OVERRIDE`

The trailer above is read at the **commit-msg** layer. Git runs the **pre-commit** hook *before* the commit message exists, so the trailer cannot release a pre-commit block (e.g. a stale `micro-chore` session whose allowlist rejects code edits). For that, set the `NOLDOR_PATH_OVERRIDE` env var on the `git commit` invocation — pair it with the trailer:

```
NOLDOR_PATH_OVERRIDE="reason" git commit -m "msg" -m "Noldor-Path-Override: reason"
```

The env var unlocks the pre-commit hook (releasing both the allowlist check and the no-`/gate`-session hard wall) and always writes a `(pre-commit)`-tagged breadcrumb to `.noldor/overrides.log`. The `Noldor-Path-Override` trailer **should** be paired with it: only the *override* trailer lands in git history for the cross-clone `/garden` `override-audit` detector. The commit-msg layer accepts any valid `Noldor-Path` (including the unlogged `fast-track`), so an env-var bypass with a non-override trailer is captured only in the local `overrides.log`, not the cross-clone audit — still strictly better than `--no-verify`, which leaves no record at all.

## Review handoff after spec/plan

For paths that produce a spec or plan artifact (`specs-only-new`, `specs-only-attach`, `full-new`, `full-attach`), `/gate` pauses after the artifact is written and **does not auto-chain into the next skill** (implementation, `/draft-feature-md`, etc.). The operator picks one of three:

- **manual review** — read the artifact, return with feedback or approval before continuing
- **codex review** — invoke `pnpm noldor cr codex --paths <artifact-path>` for an independent pass (today: code-review semantics applied to the MD; a dedicated `--plan <path>` mode is tracked as backlog)
- **proceed** — explicit go-ahead, advance to the next skill in the path

This pause is mandatory and catches architectural drift, missing edge cases, and scope misalignment at the cheapest possible point — before a 10-commit implementation locks the decisions in. `fast-track` and `micro-chore` skip this step because they produce no spec/plan artifact.

`full-new` and `full-attach` hit this pause twice: once after `superpowers:brainstorming` (spec, `kind=spec`) and again after `superpowers:writing-plans` (plan, `kind=plan`). `specs-only-new` and `specs-only-attach` hit this pause once at `kind=spec` — no plan stage; implementation follows directly from the spec.

Because the `specs-only-*` pause is the **only** review surface before implementation, `/gate` prints a detailed summary of the committed spec to chat at that handoff — scope bullets, files touched, acceptance criteria, and deferred risks / open questions, with uncovered sections marked `(not specified in spec)` — instead of a minimal "spec written, proceed?" prompt. The operator can approve or send back the spec without opening the file. See [`gate/SKILL.md`](../../.claude/skills/gate/SKILL.md) Step 2.5 "Detailed spec summary (specs-only handoff)".

**Commit-on-confirm.** When the operator approves the artifact at the review handoff, `/gate` commits the spec or plan before invoking the next skill — see [`gate/SKILL.md`](../../.claude/skills/gate/SKILL.md) Step 2.5 for the canonical commit messages. The worktree branch becomes self-documenting: spec, then plan, then implementation, each as its own commit.

At each Step 2.5 pause, `/gate` runs `pnpm noldor noldor lint-plan-snippets <artifact-path>` automatically and surfaces any findings in the review-handoff prompt. The linter is purely static today — it catches a small high-precision rule set (currently R1: permissive `*_RE` regex with `-` literal in char class; R2: `git commit --amend --no-edit` paired with a message-providing flag) seeded from bugs that shipped verbatim from past plans. Findings are informational; the operator still picks manual review / codex review / proceed. LLM-judged lint over the same snippets is tracked separately under the `Codex CR Plan-Review Mode` roadmap entry.

### Autonomous mode (post-plan-confirm)

Autonomous mode triggers on plan-confirm — the operator picks `proceed-autonomous` at the kind=plan continue-dialog. Because `specs-only-*` paths have no plan stage, they cannot enter autonomous mode. Operators wanting autonomy through implementation should use `full-new` or `full-attach`.

For `full-new` / `full-attach` paths, the plan-stage continue-dialog gains a fourth option `proceed-autonomous`. Selecting it sets `session.autonomous = true` and switches all downstream seams to non-interactive defaults through PR-merge. Safety rails (`cr:escalate` on red) still pause unless `autonomous.onFailure: 'abort' | 'spawn-deep-review'` is configured. See [`.claude/skills/gate/SKILL.md`](../../.claude/skills/gate/SKILL.md) "Autonomous mode" section for the full rules.

Autonomous mode is opt-in per session. The default continue-dialog choice remains `proceed` (interactive between-step checkpoints).

Autonomous CR needs **no** config to work: when `crLanes.<kind>` is absent, orchestrate falls back to the built-in `subagent`-only defaults (`DEFAULT_CR_LANES`). Add a `crLanes` / `autonomous` block to `.noldor/config.json` only to override those defaults (e.g. opt codex back in, or set `onFailure: 'abort'`). See [`cr-pipeline.md`](cr-pipeline.md#config-driven-defaults) for the full reference.

## Picking your path

**Example 1 — `micro-chore`:** You want to fix a typo in a doc file.

Path 1 applies. Run `/gate`, pick `micro-chore`. No worktree, no FD. Confirm the diff is within the allowlist, then commit directly. Hook validates the allowlist at pre-commit.

**Example 2 — `fast-track`:** You spotted a bug in a single function — a one-line off-by-one. The fix is obvious and doesn't warrant its own FD.

Path 2 applies. Run `/gate`, pick `fast-track`. A worktree is created (`fast/<short-desc>`). Implement, get the reviewer pass, then push. No FD scaffolding.

**Example 3 — `specs-only-new`:** You're adding a small but design-meaningful feature — say, a new validator that needs to integrate with existing schema rules. Implementation is small enough that a separate plan would be overkill, but the design decisions (which rule slots to use, how to surface errors) need to be captured.

Path 3 applies. Run `/gate`, pick `specs-only-new`. `/gate` prompts for a slug and category, runs `/promote <slug> --tier=specs-only`, creates a worktree, and launches `superpowers:brainstorming`. Spec is produced, reviewed at Step 2.5 (`--kind spec`), then implementation flows directly from the spec.

**Example 4 — `full-new`:** You are designing a new export format — new UX flow, new API surface, design ambiguity AND plan decomposition both warranted.

Path 5 applies. Run `/gate`, pick `full-new`. `/gate` prompts for a slug and category, runs `/promote <slug> --tier=full` (or `/new-feature <slug> --tier=full`), creates a worktree, and launches `superpowers:brainstorming`. Spec is produced, reviewed at Step 2.5 (`--kind spec`), then `superpowers:writing-plans` builds the plan, reviewed again at Step 2.5 (`--kind plan`). Implementation follows.

---

See [`/gate`](../../.claude/skills/gate/SKILL.md) — invoke before any code edit.
