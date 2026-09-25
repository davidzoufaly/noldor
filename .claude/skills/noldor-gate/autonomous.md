# /noldor-gate — autonomous mode

Read by `full-*` sessions when the operator picks `proceed-autonomous` at the plan-stage continue dialog (`artifact-review.md`).

Activated when the operator picks `proceed-autonomous` at the plan-stage Step 2.5 continue-dialog. Persisted as `session.autonomous = true` in `.noldor/session.json` (via `pnpm noldor noldor set-autonomous`). Stays on through PR-merge — no operator-facing "exit autonomous" command; the session marker is cleared by the post-merge cleanup like any other session.

Once autonomous:

1. **Implementation phase runs INLINE.** Do not delegate execution to a plan-executor skill — checkpoint prompts between tasks/batches would bypass autonomous mode. Instead, the gate controller (Claude in this conversation) reads the plan MD, executes each task using normal Read / Edit / Bash / Write tools, and commits at each task's "Commit" step boundary per the plan. Treat the plan as a checklist; tick `- [x]` as you go.

2. **Step 4 omits all AskUserQuestion seams.** Specifically:
   - No commit-confirm `y` prompt around phase-flip / orchestrate / aggregate / pr-flow invocations.
   - No lane multi-select. `cr:orchestrate` is invoked with `--autonomous` and reads `crLanes.<kind>` from `.noldor/config.json`, falling back to the built-in `reviewer`-only defaults when that block is absent (a configured block overrides the defaults).
   - No continue-dialog after orchestrate. Exit 0 → proceed. Exit 1 → escalate (next bullet).

3. **`cr:orchestrate --autonomous`** for both artifact-stage (Step 2.5, already committed before autonomous activated) and code-stage (Step 4). The flag flows into the overwrite-guard (defaults `archive-and-overwrite`) and the standalone-in-progress guard (defaults `drop-lane`) so neither prompts.

4. **`cr:escalate --autonomous`** on `cr-red` or `test-red`. Outcome depends on `autonomous.onFailure`:
   - `abort` → exit 1, full halt. Operator manually resumes by clearing `session.autonomous` (e.g. re-run `/noldor-gate --resume <slug>` which rewrites the marker).
   - `spawn-deep-review` → exit 0 after spawning iTerm2 standalone; proceed to PR-flow.
   - `prompt` → falls back to interactive prompt despite autonomous mode. This is the documented escape hatch; operator must explicitly opt out of autonomy here.

5. **`pnpm noldor pr-flow`** reads `session.autonomous` via `shouldPromptForPrApproval` and skips the `requireHumanPrApproval` `y` prompt regardless of `.noldor/config.json` value. Push + PR-create + auto-merge run unsupervised.

6. **Cleanup** (worktree removal, main fast-forward, next-priority handoff) is already non-interactive in `/noldor-gate` Step 4 + Step 5 prose; nothing changes.

**Safety rails preserved:**

- Red CR aggregate → `cr:escalate` fires (interactive or autonomous per config).
- Red test/typecheck → `cr:escalate --reason test-red`.
- Override audit + commit hooks still run; commits still need `Noldor-FD:` / `Noldor-Reviewed-Subagent:` trailers.
- Pre-push hook still validates the receipt trailer against `HEAD^{tree}`.

**Trade-off:** Autonomous mode trades operator-visibility for momentum. If the plan was wrong, the cost is felt at Step 4 code-stage CR (subagent flags blockers → escalate fires). The escape hatch is `autonomous.onFailure: 'prompt'` (default), which keeps the interactive escalate dialog and lets the operator regain control without manually clearing the session flag.
