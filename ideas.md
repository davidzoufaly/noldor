# Ideas

Raw entry point for human-generated ideas. `/triage` promotes bullets into `docs/roadmap.md` (flat priority-ordered list) or `docs/backlog.md` (parking lot).

- 3 verticals: tooling, business, core product
- roadmap: flat priority-ordered list (file order = priority); H3 categories group related entries

## Notes

## Priority

## Not groomed
- triaged věcí by v ideas zůstat měli, ale můžou spadnout dolů někam do vlastní Heading sekce [triaged 2026-08-11 → triaged-bullet-archive-section]
- architecture part for consumer -> some extra folder with file/files -> diagramming [triaged 2026-08-11 → consumer-architecture-doc-surface]
- brainstorming of things is not that great as with superpowers [triaged 2026-08-11 → spec-brainstorming-depth-parity]
- mandatory codex review -> atleast one round on bigger tasks [triaged 2026-08-11 → mandatory-codex-review-round]
- reviewer-lane dispatch timeout too tight: `subagent-dispatch.ts` hard-codes `timeoutMs: 600_000`, and a med-effort full-spec review that follows the verify-before-flag protocol (runs typecheck/tests) can exceed 10 min — three consecutive `exit -1 (timeout)` failures in one session, each burning the full window and writing a synthetic red sink. Make the timeout configurable (`crReview.dispatchTimeoutMs`?) and/or retry once with backoff; consider telling the reviewer prompt to skip long commands when the artifact is markdown-only. (surfaced shipping charuy agent-skill-bundle, charuy PR #91) [triaged 2026-08-11 → reviewer-lane-dispatch-timeout-configurable]
- codex lane broken against codex-cli 0.133.0: (a) `--base-sha` path errors and the fallback still exits 1; (b) prompt passed as positional argv makes codex print "Reading additional input from stdin..." and hang/dump a 478KB models-cache error in headless runs — prompt must go via stdin (`codex exec - <<EOF`); (c) expired ChatGPT auth surfaces as bare exit 1 in the sink with no hint. Fix: stdin dispatch, auth preflight with a clear `codex login` message in the sink, and version-probe the installed CLI. (surfaced shipping charuy agent-skill-bundle, charuy PR #91) [triaged 2026-08-11 → codex-lane-headless-dispatch-breakage]
- `sync code-links` is destructive on consumers without `@fd:` tags: scanning tagged code and writing `links.code` on every FD means an untagged consumer gets all hand-curated `links.code` arrays wiped to `[]` (charuy: 35 FDs emptied in one run, caught only by git diff). Fix: never write an empty array over a non-empty one without `--force`, or skip FDs with zero matching tags and print a per-FD `skipped (no tags, existing links kept)` line. (surfaced shipping charuy agent-skill-bundle, charuy PR #91) [triaged 2026-08-11 → sync-code-links-destructive-without-fd-tags]

## Lessons

Raw capture point for operator/agent lessons + gotchas. `/noldor-absorb` classifies each unfiled bullet (`drop | gotcha | actionable | feedback`), files it into framework docs, and stamps `[absorbed YYYY-MM-DD → <dest>]`. Stamped bullets may be pruned — git history is the audit trail.

- `pnpm noldor worktrees create` writes an untracked `.env.local` (`PORT=<assigned>`) that is not in `.gitignore`, so every fresh worktree starts with a dirty tree: `ensureCleanTree` counts `??` entries, so `pr-flow` preflight refuses to ship until the operator deletes a file the framework itself created. Same shape as the known `.claude/settings.local.json` verify-lane fmt killer. Fix: add `.env.local` to `.gitignore` (self-host + `templates/`), or have `worktrees create` write it only under an already-ignored path. (surfaced shipping Q-0073, PR #268) [absorbed 2026-08-10 → ideas]
- repeated `cr orchestrate --kind code` runs across amend rounds APPEND a `Noldor-Reviewed-Subagent` trailer instead of replacing the existing one, so a commit that went through N CR rounds carries N receipts — all but the last stale, since each amend changes `HEAD^{tree}`. The pre-push hook validates against the tree, so a stale receipt is at best noise and at worst a false pass if the wrong one is read. Manual cleanup today: `git log -1 --format=%B | grep -v '^Noldor-Reviewed-Subagent:' > msg && git commit --amend --file=msg`, then re-run orchestrate. Fix: make the receipt amend replace any existing trailer of the same key. (surfaced shipping Q-0073, PR #268 — 14 CR rounds, 2 receipts accumulated) [absorbed 2026-08-10 → ideas]
- design lesson from 14 CR rounds on Q-0073: the first cut of finish-mode carried a `finishable` Set that had to be mutated at every ship / skip / merge / retry / timeout leaf, and rounds 5, 10, 11 and 13 each found a different missed `delete`. Replacing it with a verdict recomputed fresh immediately before each spawn (`resolveFinishPrompt`) made the whole class of finding vanish and left all 215 autonomous tests passing unchanged. Prefer a recomputed decision over maintained state whenever the state has many mutation sites — and read four rounds of "you missed another unwind" as the reviewer circling a design smell, not as four separate bugs. (surfaced shipping Q-0073, PR #268) [absorbed 2026-08-10 → workflow]

## Verticals

### Tooling

#### Now

- port ponytail's core (pre-generation "lazy senior dev" decision ladder) into the rules cascade as `.noldor/rules/lazy-decision-ladder.md` + `noldor:cut` marker wired into the CR simplification dimension [triaged 2026-08-10 → lazy-decision-ladder]

#### Next

#### Later

- `pnpm noldor worktrees create` writes an untracked `.env.local` (`PORT=<assigned>`) that is not in `.gitignore`, so every fresh worktree starts with a dirty tree: `ensureCleanTree` counts `??` entries, so `pr-flow` preflight refuses to ship until the operator deletes a file the framework itself created. Fix: add `.env.local` to `.gitignore` (self-host + `templates/`), or have `worktrees create` write it only under an already-ignored path. (surfaced shipping Q-0073, PR #268) [triaged 2026-08-10 → worktree-env-local-not-ignored]
- repeated `cr orchestrate --kind code` runs across amend rounds APPEND a second review-receipt trailer instead of replacing the existing one — the key is `Noldor-Reviewed-Subagent`, and a commit that went through N CR rounds carries N receipts, all but the last stale (each amend changes `HEAD^{tree}`); pre-push validates against the tree, so a stale receipt is noise at best, false pass at worst. Fix: receipt amend should replace any existing receipt of the same key. Manual cleanup meanwhile: `git log -1 --format=%B | grep -v '^Noldor-Reviewed-Subagent:' > msg && git commit --amend --file=msg`, then re-run orchestrate. (surfaced shipping Q-0073, PR #268) [triaged 2026-08-10 → cr-receipt-amend-must-replace-same-key-trailer]
- connect milestones to roadmap/backlog tasks: milestones (`docs/milestones/<slug>.md`) currently live independent of the queue — no way to say which roadmap/backlog entries belong to which milestone, or see milestone progress from the queue side. Idea: link entries to a milestone (e.g. `milestone:` field in schema-C blocks or milestone doc lists entry IDs) so dashboard/status can roll up milestone completion from its tasks. [triaged 2026-08-10 → milestone-queue-linking]
- cr-autofix polish residue from the Q-0075 ship (PR #276, CR rounds 9–16, overridden at round 16 with the sole med blocker fixed): (a) `DecideResult.baseSha` doc overstates its invariant — it is empty on ANY decline with git unreachable, not only `no-base-sha`; say "non-empty whenever verdict is auto-fix". (b) `no-base-sha` fires before `next` is known, so a MIXED round with git unreachable declines to operator even though `apply-then-stop` never needs a base-sha — forfeits an applicable mechanical subset on an unrelated failure. (c) `round: 3/2` prints on the round-cap decline (`priorRounds.length + 1` unconditionally) — clamp or relabel. (d) `prior-deferred` scanning every round leaves the seam dead for the rest of the session after one MIXED round, including the operator's own full-review follow-up where the laundering path cannot occur; the only reset is session end — deliberate, but say so in the docs or narrow it. (e) drain-mode/SKILL twins mention `record` without naming the exit-2 `--deferred` cross-check. All in `src/cr/autofix.ts` / `autofix-cli.ts`. (surfaced code-stage CR of Q-0075, PR #276) [triaged 2026-08-10 → cr-autofix-polish-residue]
- `doctor`'s framework-skew check compares the anchor by string `!==` (`src/cli/commands/doctor.ts:63`), so an anchor _ahead_ of the installed version prints `run 'noldor upgrade'` forever while `upgrade` correctly refuses to rewrite it backwards — an advisory dead end with no CLI exit, the same shape as Q-0076 in the opposite direction. Reachable after a downgrade (`pnpm add @david.zoufaly/noldor@<older>`) or a hand-edited anchor. Fix: compare with `semver.lt(anchored, installed)` and give the ahead case its own message (`anchored <a> is ahead of installed <i> — the install is behind, not the anchor`) rather than pointing at a command that cannot help. (surfaced in the code-stage CR of `upgrade-never-advances-a-stale-anchor-on-an-empty-migration-chain`, PR #270) [triaged 2026-08-10 → doctor-ahead-anchor-dead-end]
- `noldor upgrade` writes the framework anchor on the empty-chain path before the dirty-tree guard (`src/cli/commands/upgrade.ts:90` vs the `isDirty` check below it), so a dirty tree silently gets `.noldor/config.json` mutated while the non-empty-chain path refuses with `refusing to upgrade on a dirty git tree`. Pre-existing for the bootstrap case, broadened to the stale-advance case by Q-0076. Deliberately left as-is: hoisting `isDirty` above the block would make a pure `nothing to do` invocation throw on any dirty tree, and gating only the write would re-strand the very consumer Q-0076 unstrands. Decide whether the asymmetry is intended and say so in the code, or gate the write with a narrower guard. (surfaced in the code-stage CR of Q-0076, PR #270) [triaged 2026-08-10 → upgrade-empty-chain-dirty-tree-guard]
- `sdd:report` quotes untriaged idea bullets verbatim into `docs/sdd-report.md`, so idea PROSE can redden two live-tree tests in `src/garden/__tests__/sdd-report.test.ts`: non-oxfmt markdown in a bullet (e.g. star-italics) fails the "writes oxfmt-compliant markdown" test, and a bullet naming the review-receipt key followed later on the line by the word "trailer" trips the omit-gate-compliance regex. Harden the seam: fmt-normalize quoted idea text in the report generator, and scope the test's negative assertion to the Gate-compliance section heading instead of a whole-document regex. (surfaced pre-release sweep 2026-08-10 — two ideas.md bullets moved into `#### Later` by PR #279 broke `pnpm verify` on main) [triaged 2026-08-10 → sdd-report-quote-normalization]

#### Now

- better unit tests rules on top of https://github.com/gooddata/gdc-mastercard-panther/pull/2542 [triaged 2026-08-05 → better-unit-test-rules]

#### Next

#### Later
