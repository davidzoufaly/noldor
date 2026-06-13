---
noldor-page: agent-runtimes
introduced: 0.5.0
---

# Agent Runtimes

Noldor supports three agent runtimes as simultaneous first-class peers:
**Claude Code, Codex, opencode**. Every framework spawn resolves through the
runner registry (`src/core/agent-runner/registry.ts`): a call site declares a
*role*, the consumer's `agents:` config maps roles to runners, and the
registry builds the runner-specific argv. Absent config ≡ claude everywhere.

## Flag mapping

| Noldor need | Claude Code | Codex | opencode |
| --- | --- | --- | --- |
| headless spawn | `claude --print "<prompt>"` | `codex exec` (prompt via stdin) | `opencode run "<prompt>"` |
| auto-permissions | `--permission-mode bypassPermissions` | `--sandbox workspace-write` (read-only for review roles) | `--dangerously-skip-permissions` (respects explicit `deny`) |
| no-questions kill-switch | `--disallowed-tools AskUserQuestion` | non-interactive by design | `permission.question: "deny"` in `opencode.json` |
| model / role selection | `--model` | `--model` / `config.toml` | `--model <provider/model>` |
| structured output | parse stdout prose | `--output-schema <json-schema>` | `--format json` (reserved; treated as prose v1) |
| rules file | `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` |
| guards | `.claude` hooks + `src/hooks/` | sandbox modes (coarse) | `opencode.json` glob permission rules |
| local models | no | no | yes (ollama et al.) |

Capability matrix as code: `src/core/agent-runner/capabilities.ts`.

## Config

```jsonc
// .noldor/config.json — all fields optional
"agents": {
  "default": "claude",
  "roles": {
    "implementer":    { "runner": "claude" },
    "reviewer":       { "runner": "codex" },
    "second-opinion": { "runner": "opencode", "model": "ollama/qwen3" },
    "polish":         { "runner": "opencode", "model": "ollama/llama3.2" }
  },
  "versionFloors": { "opencode": "0.6.0" },
  "targets": ["claude", "codex", "opencode"]
}
```

Roles: `implementer` (drain gate runs, prep fanout), `reviewer` (CR subagent
lane), `second-opinion` (codex CR lane — pinned to the codex runner by name;
role config cannot re-route it — plus FD-attribution classification), `polish`
(release-notes summary). `targets` selects which driver shim sets
`noldor init --agents` writes, which template subtrees `noldor doctor` and the
template-sync check verify, and joins the runner presence/floor check set
(a targeted runner is checked even when no role references it).

## Rollout guidance (mixed fleet)

Adopt by risk tier: `polish` first (pure text, no tools — cheapest local-model
win), CR lanes second, `implementer` last — and only per-runner once outcome
telemetry shows ship/retry/revert parity. v1 shims are thin command pointers
(fat CLI, thin skills); a non-Claude implementer cannot drive the full `/gate`
skill flow yet.

## Events and doctor

Every spawn appends one line to `.noldor/agent-events.jsonl`
(`runner` / `role` / `site` / `exitCode` / `durationMs` / `timedOut`).
`noldor doctor` verifies presence + version floor for every *configured*
runner. The interactive deep-review window (`noldor cr escalate` →
spawn-deep-review) stays Claude + macOS/iTerm only by design — it is the
operator-facing escalation seam, not a headless lane.
