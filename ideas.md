# Ideas

Raw entry point for human-generated ideas. `/triage` promotes bullets into `docs/roadmap.md` (flat priority-ordered list) or `docs/backlog.md` (parking lot).

- 3 verticals: tooling, business, core product
- roadmap: flat priority-ordered list (file order = priority); H3 categories group related entries

## Notes

## Priority

## Not groomed

- Noldor-native long-task wait primitive — runner-agnostic alternative to the harness `Monitor` tool. Scope is the CONSUMER side only: a `noldor wait <state-file> --until <terminal-cond> [--emit <jsonpath>]` that polls until a job reaches a terminal state and surfaces progress. Do NOT invent a new progress format — reuse the existing producer-side state files (`.noldor/drain-state.json` heartbeat, `.noldor/cr/<slug>-<kind>-<lane>.json` sinks). The "write one side / read other" channel already exists; the gap is a portable wait/poll the controller calls instead of the host harness's Monitor (which can be blocked + isn't cross-runner). Lower priority — background-task completion notifications already cover most waiting. Touches: `src/autonomous/` (watch shares the poll loop), a `noldor wait` CLI.

## Verticals

### Business

#### Now

#### Next

#### Later

### Tooling

#### Now

#### Next

#### Later

### Core Product

#### Now


#### Next


#### Later
