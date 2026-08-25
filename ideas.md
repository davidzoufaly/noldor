# Ideas

Raw entry point for human-generated ideas. `/triage` promotes bullets into `docs/roadmap.md` (flat priority-ordered list) or `docs/backlog.md` (parking lot).

- 3 verticals: tooling, business, core product
- roadmap: flat priority-ordered list (file order = priority); every entry is a `### <Entry Name>` heading at one fixed level — never a `### <Category>` container (`validate:triage` errors on `empty-group-heading`)

## Notes

https://github.com/davidzoufaly/noldor/pull/372 has so many duplicates of the same text -> drift risk -> what to do with it? text imports?

## Priority
- The plan-split rules can manufacture public API. `noldor-plan` step 6 caps a part at 1000 rows and requires each `-part<N>` to be independently shippable software, and the only way to satisfy both on a feature whose payload is one internal lane is to invent CLI surfaces: the geometry-compare plan grew `design geometry-validate`, `design geometry-diff`, `design geometry-export` and `design geometry-review` — four commands, four manifest rows, four twinned catalog entries — purely so each part could register a runnable surface. Two of them turned out genuinely useful (they are what let the feature ship at all when the lane was parked), which is why this is a trade-off to state rather than a bug to fix: the vertical rule buys shippability at the price of API surface, and nothing in the guidance says to weigh that. Wanted: a note in the P1 remedy prose that a part may also be shippable as an internal capability behind an existing entry point, plus an explicit "is this command worth owning forever?" check before a split mints one. (found 2026-08-25 planning Q-0180) [triaged 2026-08-25 → plan-split-guidance-permits-a-part-that-ships-nothing]
- Neither UI-design review lane is enabled anywhere, four days after the second one shipped. noldor declares no `consumer.uiPaths`; charuy declares `uiPaths` but no `uiSurfaces`, no `uiBoot`, and `crLanes.code: [reviewer]`. Q-0144's design phase has traction (3 `.pen` files tracked in charuy) but Q-0145 `ui-reviewer` and Q-0146 `render-compare` have zero installs, so a third sibling lane was carved back to the roadmap rather than built. Worth a habit at triage: for an entry that extends a feature, check whether the feature it extends is switched on in any repo before sizing the work. A `pnpm noldor doctor` row or a triage-time hint that reports "the parent feature's opt-in is unset in every known consumer" would make that check mechanical instead of remembered. (found 2026-08-25 deciding to park Q-0180)

## Not groomed

## Lessons

Raw capture point for operator/agent lessons + gotchas. `/noldor-absorb` classifies each unfiled bullet (`drop | gotcha | actionable | feedback`), files it into framework docs, and stamps `[absorbed YYYY-MM-DD → <dest>]`. Stamped bullets may be pruned — git history is the audit trail.

- `/noldor-gate` Step 4 prescribes `--lanes reviewer` for the code-stage CR, but `.noldor/config.json` sets `crLanes.code: ['reviewer', 'verifier']`. Passing `--lanes reviewer` explicitly silently under-runs the repo's own configured review posture — the verifier lane never runs and the aggregate still reads green. The skill should tell the controller to prefer `--autonomous` (which reads `crLanes.code`) over the hardcoded `--lanes reviewer` example, or at minimum to check the config first. (found 2026-08-24 shipping Q-0158)
- Re-running `cr orchestrate` over an existing sink without `--autonomous` fires `guardLaneOverwrite`'s interactive prompt, which dies instantly with `ExitPromptError: User force closed the prompt` in any non-TTY runner (the Claude Code Bash tool included) — indistinguishable from a real failure. The delta-re-earn recipe in Step 4 shows the command without `--autonomous`, so it is a trap on the second pass by construction. (found 2026-08-24 shipping Q-0158)
- A commit that touches `src/**` *and* `docs/noldor/**` needs a `Noldor-Sibling-Scope: noldor:<page>` trailer, and the `noldor-scope` hook only says so after the commit is rejected. Worth pre-empting in the gate prose for any change whose fix spans code plus its runner-neutral doc twin. (found 2026-08-24 shipping Q-0158)
- `gh pr merge --auto` is rejected on this repo (`Auto merge is not allowed for this repository (enablePullRequestAutoMerge)`); `pr-flow` falls back to a direct squash-merge and ships fine. The fallback is silent-by-design, but the repo setting means the `--auto` path is dead code here — either enable auto-merge in repo settings or stop attempting it first.
- CR round arithmetic: the bounded re-round cap (2) governs *arbitration* rounds, but the `Noldor-Reviewed-Subagent` receipt still has to be earned by a green reviewer run over the final tree. At the cap with a red round, those two rules pull opposite ways and the skill does not say which wins. Q-0158 needed a 4th dispatch purely to re-earn the receipt after the cap-round fix. (found 2026-08-24 shipping Q-0158)

## Verticals

### Tooling

#### Now

#### Next

#### Later

#### Now

#### Next

#### Later

## Triaged

- architecture -> hodně ukecaná -> přidat do frameworku i formu textu -> strukturu dokumentu -> víc 4C -> víc technické, k věci [triaged 2026-08-24 → architecture-doc-prose-form-and-structure]
- provázat milestone s featurama -> backlogem + roadmapou [triaged 2026-08-24 → milestone-queue-linking]
- ui module should use vscode of pen.dev by default then desktop app -> agent can find a .pen file and open it or create a new one if needed [triaged 2026-08-25 → pencil-bridge-editor-default-and-auto-open]
