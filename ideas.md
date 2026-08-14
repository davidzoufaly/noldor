# Ideas

Raw entry point for human-generated ideas. `/triage` promotes bullets into `docs/roadmap.md` (flat priority-ordered list) or `docs/backlog.md` (parking lot).

- 3 verticals: tooling, business, core product
- roadmap: flat priority-ordered list (file order = priority); H3 categories group related entries

## Notes

## Priority

## Not groomed

## Lessons

Raw capture point for operator/agent lessons + gotchas. `/noldor-absorb` classifies each unfiled bullet (`drop | gotcha | actionable | feedback`), files it into framework docs, and stamps `[absorbed YYYY-MM-DD → <dest>]`. Stamped bullets may be pruned — git history is the audit trail.

- `/noldor-gate --drain <slug>` invoked **by hand** (no supervisor) carries no `--finish` signal, yet the drain-mode Step 1 override says to force-recreate `fast/<slug>` and `git push origin --delete` it — "abandoned work safe to discard". Draining Q-0107 that branch held **7 commits with green tests** from a prior child that never opened a PR, i.e. exactly the finish-mode case; obeying the override literally would have destroyed ~13 min / ~170k tokens of finished work, unrecoverably on the remote side. The finish-vs-rebuild decision currently lives only in the supervisor (which knows whether the prior child exited 0); an interactively-invoked drain has no way to know it. Gate should derive the branch state itself before destroying anything — `git log origin/main..fast/<slug>` non-empty + clean worktree ⇒ treat as finish mode (deliver), empty or dirty ⇒ rebuild — so the destructive path is chosen from observable state rather than from an absent env var. (surfaced shipping Q-0107, PR #317)
- `cr autofix record --since` rejects a ref: `--since origin/main` exits 2 with `--since must be a hex sha (4-40 chars)`, while `cr orchestrate --base-sha origin/main` accepts the same ref happily. The gate skill prose says to pass "the printed base-sha", so the asymmetry only bites when a controller re-derives the value — but every caller then needs `$(git rev-parse origin/main)` for one command and not the other. Accept any `git rev-parse`-able ref in `record` (resolve it, store the sha) or the two commands keep disagreeing about what a base is. (surfaced shipping Q-0107, PR #317)
- `pnpm noldor <cmd> --json` is unparseable: pnpm prints its own `> @david.zoufaly/noldor@1.2.0 noldor …` banner on **stdout**, so `JSON.parse` dies on `Unexpected token '>'` while the exit code stays 0. Every `--json` consumer must call `node bin/noldor.mjs <cmd> --json` instead (or strip leading non-JSON lines). Worth either routing the banner away (`--silent`) or saying so wherever a `--json` flag is documented — a controller that pipes `pnpm noldor` output into a parser gets a crash whose message points at the payload rather than at the wrapper. (surfaced shipping Q-0122, PR #319)
- A clone-detector fix wants a *corpus* before/after, not just unit tests: the two matches the roadmap entry named (`baseline.ts` ↔ `data.ts`) had already been refactored away by the time Q-0122 shipped, so the fixtures had to be re-derived from a live `clones report --json` (4 schema-noise groups, incl. `autofix-ledger` ↔ dashboard `data`). Equally, the first "unrelated schemas" fixture was written *too* identical — same field count, same wrapper, only the schema name differing — so it was a genuine Type-2 clone and the test failed for the right reason. A detector-tuning change should always be measured as `groups/duplicatedTokens` before → after plus a named genuine group that must survive (here `session.ts` ↔ `release-state.ts`, 98 tokens). (surfaced shipping Q-0122, PR #319)
- The park map is the only working **selection filter** for a subset drain, and it is better than the `.noldor/drain-stop` sentinel the last batch used. Hand-writing `.noldor/drain-park.json` with a `roadmap:<slug>` key per unwanted-but-eligible entry makes `parkAwareSource` hide them, so `--max-features N` cannot overshoot even when an entry burns its retries and the loop advances — there is simply nothing else eligible left to advance to. Draining the 5 S/med/fix entries this way shipped exactly those 5 (skipped 8, all correctly "not a fast-track XS/S entry") with the supervisor's retry/lock/salvage/escalation intact, where the documented alternative (per-slug `claude --print "/noldor-gate --drain <slug>"`) forfeits all of it. Two rough edges: there is no `autonomous park` command to pair with `unpark`, so the operator edits state JSON by hand, and no `EscalationReason` means "operator scope hold" (`run-aborted` was borrowed), which makes `autonomous inbox` read as 4 repo-level failures for the duration. Give park a CLI and an `operator-hold` reason, or implement the `--only <slug,…>` / `--size` flags Q-0121 already asks for and the whole hack goes away. (surfaced draining the 2026-08-13 S/med/fix batch, PRs #315-#319)
- The 30-minute default `--iteration-timeout` is a poor fit for the S band: Q-0107 was killed at the cap mid-CR having already produced 4 commits with green tests, which is what left the finish-mode branch the lesson above describes. Two consequences worth encoding. A timeout is **recoverable, not wasted** — the retry inherited the same worktree and branch and shipped on attempt 2, so the cost was one wasted 30-min slot rather than the whole entry. And the cap should scale with `size:` the way routing already does (XS entries finished in ~15 min, S entries with real CR rounds want 45-60), or a batch of S entries systematically burns one retry each. Raise `--iteration-timeout` explicitly for any S batch until the default is size-aware. (surfaced draining the 2026-08-13 S/med/fix batch, PRs #315-#319)

- **A `commit-msg` hook validates a provisional file plus transient repo state — not the commit git will store.** That mismatch, not any individual bug, is what produced 15 defects over 8 CR rounds on the parked Q-0124 spike, every one the same shape: some git invocation reaches the hook in a state the classifier misreads. `git commit -v` appends a diff below the scissors that padded the last section, so `What — x` cleared a 24-char floor. `--amend` stages nothing. A conflicted `cherry-pick` sets `CHERRY_PICK_HEAD`, never `MERGE_HEAD`. `core.commentChar` accepts `//`, and `core.commentString` supersedes it. `--name-only` quotes non-ASCII paths so no glob matches. `--fixup=reword` writes an `amend!` subject. Each fix was correct and the next round found another. The structural answer (codex, 2026-08-14): validate **commit objects** at `pre-push` — message via `git log -1 --format=%B`, files via `git diff-tree -z`, merge via **parent count** — and keep `commit-msg` only as a non-blocking advisory. Generalisable rule: when a checker needs a growing list of environment states to stay correct, the input model is wrong, not the list. (surfaced parking Q-0124, 2026-08-14)
- **Rounds that keep finding real defects are not evidence of converging quality.** Q-0124's code CR went 3→3→2→2→1→1→3 blockers across 8 rounds; from round 2 on, nearly every finding was about the *previous round's fix* rather than the original design. The loop felt productive because each finding was genuine and verified. What it actually signalled was that the design forced the fixes to be case-by-case. Worth asking after ~3 rounds on one artifact: are these findings independent, or is each one repairing the last? If the latter, stop and question the design instead of running another round. (surfaced parking Q-0124, 2026-08-14)
- The `verifier` CR lane returned `pass` with 0 blockers on all 8 rounds of Q-0124 while the `reviewer` lane found 15 real defects — including a forgeable `Merge branch 'fake'` bypass and a 24-char floor that any interactive commit defeated. Acceptance-style verification confirms the feature does what it claims for the happy path; it does not probe the adversarial or edge-state cases. A green verifier is not a second opinion on correctness, and shipping on it alone would have shipped every one of those defects. (surfaced parking Q-0124, 2026-08-14)

## Verticals

### Tooling

#### Now

#### Next

#### Later

#### Now

#### Next

#### Later

## Triaged

- caveman directly to noldor? [triaged 2026-08-14 → caveman-output-mode-in-noldor]
- codex lane misdiagnoses a model/version failure as an auth failure. Installed `codex-cli 0.133.0` against a configured `gpt-5.6-sol` returns `400 invalid_request_error: "The 'gpt-5.6-sol' model requires a newer version of Codex"`, but `cr codex` reported `auth looks expired; run: codex login` — sending the operator to re-auth for a version problem. Parse the 400 body (or at least stop asserting auth when the payload names a model). Workaround today: `codex exec -c model=gpt-5.5`. (found 2026-08-14 running the codex lane on Q-0124) [triaged 2026-08-14 → codex-lane-misreports-a-model-version-400-as-expired-auth]
- main-module guard `import.meta.url === \`file://${process.argv[1]}\`` is wrong in ~10 entrypoints (`src/core/validate-noldor-scope.ts`, `validate-noldor.ts`, `validate-skill-catalog.ts`, `changelog.ts`, `rename-plan-only-tier.ts`, `pr-flow-cli.ts`, `src/design/{context,log}-cli.ts`, `src/prep/print-format.ts`). A repo path needing percent-encoding (one space is enough) makes it false → the module's CLI body never runs, exit 0, no diagnostic. For the commit-msg validators that means a **silently disabled gate**. `src/cli/index.ts` and `src/core/validate-summary-body.ts` already use the correct `pathToFileURL(process.argv[1]).href`. Sweep the rest. (found by code-stage CR on Q-0124, 2026-08-13) [triaged 2026-08-14 → main-module-guard-fails-on-percent-encoded-paths]
- do not suggest monitor -> use internal noldor tool instead [triaged 2026-08-14 → prefer-noldor-wait-over-harness-monitor-tools]
