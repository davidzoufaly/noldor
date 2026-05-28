---
name: release-sweep
description: Orchestrate the full pre-release sweep — /graphify → pnpm toon → /refactor against the new GRAPH_REPORT.md → README drift check → /graphify + pnpm toon to capture the refactor → commit sweep results → pause for explicit user confirmation → pnpm release. Use when the user signals they're ready to release. Never runs pnpm release without explicit confirmation.
user_invocable: true
---

# Release sweep — graphify → refactor → README → graphify → release

This skill runs the non-negotiable pre-release sweep documented in `.claude/CLAUDE.md` `## Graphify` as a single continuous flow, instead of stopping after graphify like the bare `/graphify` skill does.

## Pre-flight

1. **Branch + clean check**:
   - Run `git status` and `git rev-parse --abbrev-ref HEAD`. Must be on `main` and tree must be clean (any uncommitted state aborts — ask the user to commit/stash first).
2. **Verify project state**:
   - `pnpm verify` must pass before starting. If it fails, abort with the exact failure and let the user fix it. The sweep is a release prerequisite — you don't run it on a broken main.
3. **Open a sweep branch and write the session marker**:

   ```bash
   ts=$(date -u +%s)
   git switch -c "release-sweep/$ts"
   ```

   Then write `.noldor/session.json` via:

   ```bash
   pnpm exec tsx -e "(async () => { const {writeSession} = await import('./scripts/noldor/session.ts'); writeSession(process.cwd(), { path: 'release-sweep', startedAt: new Date().toISOString() }); })()"
   ```

   All sweep-step commits below land on this branch; `noldor-inject-trailers` reads the session marker and stamps `Noldor-Path: release-sweep` on every commit automatically. No manual `Noldor-Path-Override` trailers needed.

If any check fails, stop and report. Do not proceed.

## Steps

### 1. First graphify pass

Invoke the `graphify` skill (Skill tool, name `graphify`). Wait for it to finish — it generates `graphify-out/graph.json`, `graphify-out/GRAPH_REPORT.md`, and the HTML graph. Do NOT engage with its trailing "want me to trace it?" exploration prompt — you have downstream work to do.

### 2. Toon files

```bash
pnpm toon
```

This regenerates `graphify-out/graph.brainstorm.toon`, `graphify-out/graph.brainstorm-summary.toon`. Required for downstream toon-aware reads.

### 3. /refactor against the fresh GRAPH_REPORT

Invoke the `refactor` skill (Skill tool, name `refactor`). Pass the freshly-generated `graphify-out/GRAPH_REPORT.md` as input. The skill identifies god nodes, low-cohesion communities, and dead exports flagged by the audit and proposes targeted fixes.

**This is where the sweep can stretch into real work.** If the refactor skill produces structural changes, accept them and let it commit per its own conventions. If the refactor surfaces nothing actionable (clean audit), skip ahead — that's a valid outcome.

After the refactor settles (skill returns), run `pnpm verify` again. The refactor must not break anything.

### 4. README drift check

Read `README.md`. Compare against current state:

- **Architecture section** — does it list every package in `packages/` + `apps/`?
- **Tech stack** — every major dep present?
- **Getting Started commands** — every command actually exists in root `package.json` `scripts`?

If you find drift, hand-edit the README. Stage but don't commit yet — bundle with the sweep commit in step 6.

If README looks current, say so explicitly: "README reflects current state — no drift."

### 5. Second graphify pass + toon

Invoke the `graphify` skill again to capture the refactor. Then `pnpm toon` again. The post-refactor graph is the snapshot that ships with the release tag.

### 5.5. Drift pre-empt — docs:build + sdd:report

Run the two regen steps that `pnpm release` itself enforces as gates:

```bash
pnpm docs:build
pnpm noldor garden sdd-report --release
```

Then check the working tree:

```bash
git status --short docs/user/ docs/sdd-report.md
```

If either command produced a diff, stage and commit it on the current sweep branch using two separate commits so bisection stays clean if one of them later turns out to be non-idempotent:

```bash
git add docs/user/
git commit -m "chore(release-sweep): pre-empt docs:build drift"

git add docs/sdd-report.md
git commit -m "chore(release-sweep): pre-empt sdd:report drift"
```

The `release-sweep` allowlist admits `docs/user/reference/api/**/*.md` (typedoc output) and `docs/sdd-report.md`. If `git status` shows nothing for either, skip the corresponding commit silently.

**Why this step exists.** v0.5.0 shipped without these regens pre-empted; the release script's `ensureCleanTree`-after-`docs:build` gate at `scripts/release/index.ts:132-138` and the equivalent for `sdd:report` at `:140-146` aborted the release. Two follow-up PRs landed the regen output on `main`, then the release re-ran. Pre-empting in the sweep folds those two PRs into the sweep PR.

**Known limitation — `sdd:report` non-idempotency.** `pnpm noldor garden sdd-report --release` is non-idempotent: the `Review-skip count (last 30 days)` line increments by 1 per branch commit (each sweep commit lacks `Noldor-Reviewed` and counts as a review-skip). Committing the regen here pre-empts `docs:build` drift fully, but `pnpm release`'s sdd:report gate will fire ONCE on the first release attempt after sweep PR merge — operator needs to `git pull main`, commit the regen on main, and re-run `pnpm release`. Tracked as roadmap entry `Release Script sdd:report Skip-If-Only-Count-Line-Changed`; eliminated once that ships.

### 6. Commit sweep results

```bash
git status --short
```

Stage and commit anything the sweep produced — `graphify-out/`, README edits, refactor changes that haven't been committed yet (the refactor skill commits its own structural edits, but the toon + graph regen typically lands here). Use a single commit:

```bash
git add graphify-out README.md  # plus any uncommitted refactor leftover
git commit -m "chore(release): pre-release graphify + refactor sweep"
```

If `git status --short` shows nothing, skip this step.

### 6.5. Garden pass

Invoke the `garden` skill (Skill tool, name `garden`). It produces a checklist of stale plans/specs, unused backlog entries, rule contradictions, and SDD gaps. Confirm auto-actions; the regen chain at the end of the flow runs `pnpm noldor garden receipt` which stamps `.noldor/garden-receipt`. **Note:** `pnpm release` now auto-stamps the receipt at start when `garden:detect` is clean (see [release-sweep-process-hardening](../../../docs/features/release-sweep-process-hardening.md) §3.2), so the receipt may be stamped twice in a sweep+release run — that's harmless. The manual `/garden` step here remains useful for surfacing the operator-visible checklist of stale plans / unused backlog / SDD gaps.

### 7. Final verify

```bash
pnpm verify
```

Must pass. This is the last gate before opening the sweep PR.

### 8. Open + auto-merge the sweep PR

Invoke `pnpm noldor pr-flow`. The CLI reads `.noldor/session.json` (written at pre-flight step 3), pushes the `release-sweep/<ts>` branch to `origin`, opens a PR with the release-sweep body template (see `scripts/noldor/pr-flow.ts:composeBody` release-sweep branch), and sets `gh pr merge --auto --squash`. It polls until merged or until the 10-minute timeout (20-minute when behind base) fires.

After merge, run:

```bash
git switch main
git pull --ff-only origin main
```

If the ff-only fails — **most likely cause is a concurrent PR merging to `origin/main` while the sweep PR auto-merge was polling**. The sweep itself doesn't cause divergence, but unrelated work landing on `origin/main` from another machine can. Behavior on ff-only failure:

1. STOP the skill flow. Don't force-pull, don't reset, don't rebase silently.
2. Surface to the operator: `Local main diverged from origin/main while the sweep PR was merging. Run 'git pull --rebase origin main' manually to reconcile, then re-invoke /release-sweep from step 9 (release confirmation).` Include `git log HEAD..origin/main --oneline` output so the operator sees what merged in.
3. Skill exits with the session marker still in place — operator's choice whether to clear it before retrying.

### 9. EXPLICIT USER CONFIRMATION

**Stop here. Do not run `pnpm release` without explicit confirmation.**

Show the user:

- The merged sweep PR URL.
- `git log -1 --oneline` confirming main now carries the sweep squash commit.
- The fact that `pnpm release` will push a `v*` tag and create a public GitHub Release — irreversible.

Ask: "Type `release now` to proceed, or `cancel` to stop. Anything else = cancel."

If the user types `release now` (exact match, case-insensitive): run `pnpm release` and tail the output.

If anything else: tell the user the sweep PR is merged and they can run `pnpm release` manually when ready.

### 10. Clear session marker

Regardless of release outcome (run, cancelled, deferred), clear the session marker:

```bash
pnpm exec tsx -e "(async () => { const {clearSession} = await import('./scripts/noldor/session.ts'); clearSession(); })()"
```

The release-sweep session ends here. The next gate path writes its own session marker; leaving the stale `release-sweep` marker would cause subsequent commits to be misclassified.

## Rules

- **Never run `pnpm release` without `release now` confirmation.** Even if the user said "ready for release" earlier in the conversation. Even if they seem to expect it. The explicit gate is non-negotiable per CLAUDE.md.
- **Never `--no-verify` or `--amend`** at any stage.
- **Don't engage with `/graphify`'s post-run exploration prompt.** The skill ends with "want me to trace [question]?" — answer no implicitly by moving on to step 2.
- **If `pnpm verify` fails at step 1, 3, or 7** — stop. Don't paper over. The sweep can only ship a green main.
- **If `/refactor` opens a substantial scope** (multi-day work) — pause and ask whether to continue or defer. The sweep should not silently turn into a multi-hour refactor.

## When NOT to use

- Mid-feature work. The sweep is for the moment between "feature merged to main" and "tag the release".
- Routine rebuilds of the graph during development. Use `/graphify` directly.
- After a hotfix that doesn't bump a minor version. Patches can ship without the full sweep if the change is small enough that god-node / cohesion drift is impossible (e.g. one-line bug fix).
