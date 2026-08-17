# Ideas

Raw entry point for human-generated ideas. `/triage` promotes bullets into `docs/roadmap.md` (flat priority-ordered list) or `docs/backlog.md` (parking lot).

- 3 verticals: tooling, business, core product
- roadmap: flat priority-ordered list (file order = priority); every entry is a `### <Entry Name>` heading at one fixed level — never a `### <Category>` container (`validate:triage` errors on `empty-group-heading`)

## Notes

## Priority

## Not groomed

## Lessons

Raw capture point for operator/agent lessons + gotchas. `/noldor-absorb` classifies each unfiled bullet (`drop | gotcha | actionable | feedback`), files it into framework docs, and stamps `[absorbed YYYY-MM-DD → <dest>]`. Stamped bullets may be pruned — git history is the audit trail.

- specs-only-attach commit-order trap: the trailer validator demands the live spec at its exact `docs/design/specs/<date>-<parent>-<enhancement>-design.md` path for EVERY commit on the path (bypass = `Noldor-Phase-Revert: 1` trailer only). Two bites on Q-0132: (1) the scaffold's roadmap-retirement commit red before the spec existed → fold retirement into the phase-revert commit (it carries the bypass); (2) a staged `design archive` move reds any LATER commit — the Step 4 summary-body reword had to restore the spec live, commit code, then re-archive+flip. Gate prose could state the invariant: on attach paths, no plain commit may land while the spec is absent from its live path. (found 2026-08-15 shipping Q-0132)
- `cr escalate` `override-with-trailer` prints `escalate outcome: override` but stamps nothing — the receipt hook exempts on a tip `Noldor-Path-Override` trailer that the controller must amend by hand (`git commit --amend --no-edit --trailer "Noldor-Path-Override: <reason>"`). Either escalate should amend it itself or its output should say "now amend the trailer". (found 2026-08-15 shipping Q-0132)
- summary-body gate rejects `Why:`/`How:`/`What:` colon labels (git interpret-trailers absorbs them as trailers) — use `Why —` em-dash labels in commit bodies. Cheap to catch author-side: the gate error names the fix, but a one-line note in the gate skill's commit prose would save the rebase. (found 2026-08-15, first body written on Q-0132)
- Q-0132 shipped as the dogfood case for its own problem: spec CR ran 7 rounds (1-3 substantive incl. a false-green-laundering catch and a latent fullReviewOverride range flaw in shipped code; 4-6 pure self-consistency tail on freshly-written prose; 7 green), then code-stage red with 2 design blockers that re-litigated spec-adjudicated Risks — exactly the class the shipped prior-context feature suppresses from round 2 on. Fresh evidence for the bounded-re-rounds + spec-size entries. (2026-08-15)
- Non-TTY code-stage delta re-round trips `guardLaneOverwrite`'s inquirer prompt on the round-1 sink and dies with `ExitPromptError: User force closed` — pass `--autonomous` on any orchestrate re-run from a non-interactive shell (defaults archive-and-overwrite, preserves prior-round context for #328's re-round prompts). (found 2026-08-16 shipping Q-0130)

## Verticals

### Tooling

#### Now

#### Next

#### Later

- `/noldor-gate --drain <slug>` invoked **by hand** (no supervisor) carries no `--finish` signal, yet the drain-mode Step 1 override says to force-recreate `fast/<slug>` and delete it on the remote as "abandoned work safe to discard". On Q-0107 that branch held 7 commits with green tests from a prior child that never opened a PR — obeying the override literally would have destroyed finished work, unrecoverably on the remote side. The finish-vs-rebuild decision lives only in the supervisor (which knows whether the prior child exited 0), so an interactively-invoked drain has no way to know it. Gate should derive the branch state itself before destroying anything: `git log origin/main..fast/<slug>` non-empty + clean worktree ⇒ finish mode (deliver), empty or dirty ⇒ rebuild. (absorbed from a lesson, surfaced shipping Q-0107, PR #317)
- `cr autofix record --since` rejects a ref that `cr orchestrate --base-sha` accepts: `--since origin/main` exits 2 with `--since must be a hex sha (4-40 chars)`. The gate skill says to pass "the printed base-sha", so the asymmetry only bites a controller re-deriving the value — but then every caller needs `$(git rev-parse origin/main)` for one command and not the other. Accept any `git rev-parse`-able ref in `record` (resolve it, store the sha). (absorbed from a lesson, surfaced shipping Q-0107, PR #317)
- Gate Step 4's "wait for in-flight" `cr aggregate --slug <slug>` (no `--kind`) re-reds on a stale addressed spec sink: fix-and-proceed at the re-round cap leaves the artifact-stage sink red by design (no re-dispatch), so the kind-less aggregate exits 1 on findings already fixed in commits, and the controller has to recognise the staleness by hand and proceed on the Q-0069 precedent (code-stage green earns the receipt). Either kind-scope the wait step to running/standalone lanes, or have fix-and-proceed archive/annotate the sink it consciously leaves red. (absorbed from a lesson, surfaced shipping Q-0131 attach, PR #331)
- `autonomous` needs a `park` CLI to pair with `unpark`, plus an `operator-hold` EscalationReason. The park map is today the only working selection filter for a subset drain (recipe now in `docs/noldor/autonomy.md`), but it is a hand-edit of `.noldor/drain-park.json`, and borrowing `run-aborted` for a scope hold makes `autonomous inbox` read as repo-level failures for the whole batch. Either give park a CLI and the reason code, or implement the `--only <slug,…>` / `--size` flags Q-0121 already asks for and the hack goes away. (absorbed from a lesson, surfaced draining the 2026-08-13 S/med/fix batch, PRs #315-#319)
- `--iteration-timeout` should scale with `size:` the way routing already does — XS entries finish in ~15 min while S entries with real CR rounds want 45-60, so a batch of S entries on the 30-minute default systematically burns one retry each (Q-0107 was killed mid-CR with 4 commits and green tests already produced). Operator workaround documented in `docs/noldor/autonomy.md`; the fix is a size-aware cap. (absorbed from a lesson, surfaced draining the 2026-08-13 S/med/fix batch, PRs #315-#319)

#### Now

#### Next

#### Later

## Triaged
