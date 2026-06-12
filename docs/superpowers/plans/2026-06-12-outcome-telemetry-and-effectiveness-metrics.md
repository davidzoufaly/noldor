# Outcome Telemetry and Effectiveness Metrics Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Derive auditable effectiveness metrics (cycle time, routing accuracy, CR effectiveness, drain reliability, override pressure, raw tokens per feature) from repo history + `.noldor/` artifacts; expose via `noldor metrics compute`, dashboard `/metrics`, and an sdd-report section. Spec: `docs/superpowers/specs/2026-06-12-outcome-telemetry-and-effectiveness-metrics-design.md`.

**Architecture:** One extraction pass (`src/metrics/facts.ts` → `RepoFacts`), pure collectors (`src/metrics/collect/*.ts` → `MetricResult` with mandatory `formula` + `blindSpots`), one `compute()` consumed by CLI, dashboard, sdd-report. Token capture: optional `tokens` on `AgentEvent`, filled by per-runner usage adapters (native usage records only, fail-to-null). No persistent store.

**Tech Stack:** TypeScript ESM, zod, gray-matter, vitest, node:child_process `execFileSync` for git.

---

## File Structure

- `src/features/feature-schema.ts` — add optional `since` (ISO date) to frontmatter schema
- `src/core/agent-events.ts` — add optional `tokens` field to `AgentEvent`
- `src/core/agent-runner/usage/types.ts` — `TokenUsage` + `UsageAdapter` contract
- `src/core/agent-runner/usage/claude.ts` — Claude Code transcript-JSONL usage adapter
- `src/core/agent-runner/usage/codex.ts` — codex session-store usage adapter
- `src/core/agent-runner/usage/opencode.ts` — opencode session-store usage adapter
- `src/core/agent-runner/registry.ts` — wire adapter into the post-spawn event append
- `src/metrics/types.ts` — `RepoFacts`, `MetricResult`, `Collector`, `MetricsReport`
- `src/metrics/facts.ts` — `extractFacts(cwd)`: git log, FD frontmatter, intake recovery, `.noldor` artifacts
- `src/metrics/collect/cycle-time.ts` — intake date → `v<introduced>` tag date
- `src/metrics/collect/routing-accuracy.ts` — `sizeToPath(size, hasParent)` vs actual path confusion table
- `src/metrics/collect/cr-effectiveness.ts` — lane findings vs 14-day corrective commits
- `src/metrics/collect/drain-reliability.ts` — last-run snapshot + event/escalation history
- `src/metrics/collect/override-pressure.ts` — override trailers per release window
- `src/metrics/collect/tokens-per-feature.ts` — sum of event `tokens.total` per slug
- `src/metrics/compute.ts` — collector registry + `compute(cwd)`
- `src/metrics/compute-cli.ts` — `noldor metrics compute` entrypoint
- `src/cli/manifest.ts` — register `metrics` group
- `src/dashboard/server.ts` — `/metrics` GET route + handler
- `src/dashboard/data.ts` — `loadMetricsReport()`
- `src/dashboard/views.ts` — `renderMetrics()`
- `src/garden/sdd-report.ts` — Metrics section (fail-open)
- `.gitignore` — `metrics.json`
- `docs/noldor/metrics.md` — formulas + blind spots page
- `docs/noldor/script-catalog.md` — `metrics compute` row
- `.claude/skills/promote/SKILL.md` + `templates/.claude/skills/promote/SKILL.md` — copy `since:` into FD frontmatter
- `docs/features/outcome-telemetry-and-effectiveness-metrics.md` — add `since: 2026-06-11` (first carrier)

---

## Task 1: `since` frontmatter field

**Files:**
- Modify: `src/features/feature-schema.ts`
- Modify: `docs/features/outcome-telemetry-and-effectiveness-metrics.md`
- Modify: `.claude/skills/promote/SKILL.md`, `templates/.claude/skills/promote/SKILL.md`
- Test: `src/features/__tests__/feature-schema-since.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @tests: outcome-telemetry-and-effectiveness-metrics
import { describe, expect, it } from 'vitest';
import { FeatureFrontmatterSchema } from '../feature-schema';

const BASE = {
  area: 'tooling',
  category: 'Tooling',
  links: { code: [], docs: [], tests: [] },
  name: 'X',
  packages: ['scripts'],
  phase: 'in-progress',
  'noldor-tier': 'full',
};

describe('since frontmatter field', () => {
  it('accepts an ISO date', () => {
    const r = FeatureFrontmatterSchema.safeParse({ ...BASE, since: '2026-06-11' });
    expect(r.success).toBe(true);
  });
  it('rejects a non-date string', () => {
    const r = FeatureFrontmatterSchema.safeParse({ ...BASE, since: 'yesterday' });
    expect(r.success).toBe(false);
  });
  it('stays optional', () => {
    expect(FeatureFrontmatterSchema.safeParse(BASE).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/features/__tests__/feature-schema-since.test.ts
```

Expected output: 2 failed (`accepts an ISO date` fails — `.strict()` rejects unknown key `since`; `rejects a non-date string` fails the same way), 1 passed.

- [ ] **Step 3: Implement.** In `src/features/feature-schema.ts`, inside the `z.object({...})` of `FeatureFrontmatterSchema`, after the `phase` line add:

```ts
    /** Roadmap intake date (ISO yyyy-mm-dd), copied from the source block's `- since:` by /promote. Optional — historical FDs recover intake from roadmap git history (metrics `intake[]`). */
    since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected ISO date (yyyy-mm-dd)').optional(),
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/features/__tests__/feature-schema-since.test.ts
```

Expected output: 3 passed.

- [ ] **Step 5: First carrier + promote skill.** In `docs/features/outcome-telemetry-and-effectiveness-metrics.md` frontmatter, after the `phase: in-progress` line add `since: 2026-06-11`. In BOTH `.claude/skills/promote/SKILL.md` and `templates/.claude/skills/promote/SKILL.md`, in the step-6 frontmatter template after the `phase: in-progress` line add `since: <since-from-source-block, omit line when absent>` (and mention `since` in step 2's parsed bullet fields: change "Parse the block's bullet fields: `area`, `since?`, `deps?`, `parent?`" — already lists `since?`, so only the template needs the new line).

- [ ] **Step 6: Verify validators still green**

```bash
pnpm noldor validate features
```

Expected output: `Validated 39 feature MD(s) — all OK.`

- [ ] **Step 7: Commit**

```bash
git add src/features/feature-schema.ts src/features/__tests__/feature-schema-since.test.ts docs/features/outcome-telemetry-and-effectiveness-metrics.md .claude/skills/promote/SKILL.md templates/.claude/skills/promote/SKILL.md
NOLDOR_ALLOW_SHARED=1 git commit -m "feat(metrics): add optional since frontmatter field, promote copies it forward" -m "Noldor-FD: outcome-telemetry-and-effectiveness-metrics"
```

## Task 2: `tokens` field on `AgentEvent`

**Files:**
- Modify: `src/core/agent-events.ts`
- Test: `src/core/__tests__/agent-events.test.ts` (extend)

- [ ] **Step 1: Write the failing test.** Append to `src/core/__tests__/agent-events.test.ts`:

```ts
describe('tokens field', () => {
  it('serializes tokens when present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-events-'));
    appendAgentEvent(dir, {
      ...EVENT,
      tokens: { input: 1200, output: 340, total: 1540, source: 'claude-jsonl' },
    });
    const line = readFileSync(join(dir, '.noldor', 'agent-events.jsonl'), 'utf8').trim();
    expect(JSON.parse(line).tokens).toEqual({
      input: 1200,
      output: 340,
      total: 1540,
      source: 'claude-jsonl',
    });
  });
});
```

- [ ] **Step 2: Run to verify FAIL (type-level red).** Vitest transforms via esbuild with no type-check, and `appendAgentEvent` JSON-stringifies whatever it gets — so the runtime test would pass even before the schema change. The red gate for this task is the compiler:

```bash
pnpm exec tsc --noEmit
```

Expected output: error in `src/core/__tests__/agent-events.test.ts` — `'tokens' does not exist in type 'AgentEvent'` (object literal may only specify known properties).

- [ ] **Step 3: Implement.** In `src/core/agent-events.ts`, after the `timedOut: boolean;` line inside `AgentEvent` add:

```ts
  /**
   * Raw token usage, read VERBATIM from the runner's native usage records
   * (never estimated, never derived from text length). Absent when the
   * runner exposed no trustworthy usage data. NEVER converted to cost.
   */
  tokens?: { input: number; output: number; total: number; source: string };
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/core/__tests__/agent-events.test.ts
```

Expected output: all tests passed (previous suite + 1 new).

- [ ] **Step 5: Commit**

```bash
git add src/core/agent-events.ts src/core/__tests__/agent-events.test.ts
git commit -m "feat(metrics): optional raw-token usage field on AgentEvent" -m "Noldor-FD: outcome-telemetry-and-effectiveness-metrics"
```

## Task 3: usage adapters (claude / codex / opencode) + registry wiring

**Files:**
- Create: `src/core/agent-runner/usage/types.ts`, `src/core/agent-runner/usage/claude.ts`, `src/core/agent-runner/usage/codex.ts`, `src/core/agent-runner/usage/opencode.ts`, `src/core/agent-runner/usage/index.ts`
- Modify: `src/core/agent-runner/registry.ts`
- Test: `src/core/agent-runner/usage/__tests__/adapters.test.ts`

- [ ] **Step 1: Contract.** Create `src/core/agent-runner/usage/types.ts`:

```ts
export interface TokenUsage {
  input: number;
  output: number;
  total: number;
  /** Names the artifact the numbers came from: 'claude-jsonl' | 'codex-session' | 'opencode-session'. */
  source: string;
}

export interface UsageLookup {
  /** Worktree the agent ran in (transcript/session stores key off it or off mtime). */
  cwd: string;
  /** Spawn start, epoch ms — sessions modified before this are not ours. */
  startedAtMs: number;
  /** Override for the store root (tests inject a fixture dir; prod = os.homedir()). */
  homeDir?: string;
}

/**
 * A usage adapter reads the runner's OWN usage records and returns them
 * verbatim, or null when no trustworthy record is found. HARD RULE: no
 * estimation, no tokenizer fallback, no text-length heuristics — measuring
 * nothing beats hallucinating something. Adapters never throw (fail-open).
 */
export type UsageAdapter = (lookup: UsageLookup) => TokenUsage | null;
```

- [ ] **Step 2: Write the failing tests.** Create `src/core/agent-runner/usage/__tests__/adapters.test.ts`:

```ts
// @tests: outcome-telemetry-and-effectiveness-metrics
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeUsage, claudeProjectDirName } from '../claude';
import { codexUsage } from '../codex';
import { opencodeUsage } from '../opencode';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'noldor-usage-'));
}

describe('claudeUsage', () => {
  it('sums usage from assistant records of the session started after spawn', () => {
    const home = tmp();
    const cwd = '/Users/x/code/repo';
    const dir = join(home, '.claude', 'projects', claudeProjectDirName(cwd));
    mkdirSync(dir, { recursive: true });
    const lines = [
      JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 100, output_tokens: 20 } } }),
      JSON.stringify({ type: 'user' }),
      JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 50, output_tokens: 5 } } }),
    ].join('\n');
    writeFileSync(join(dir, 'sess.jsonl'), lines, 'utf8');
    const usage = claudeUsage({ cwd, startedAtMs: Date.now() - 60_000, homeDir: home });
    expect(usage).toEqual({ input: 150, output: 25, total: 175, source: 'claude-jsonl' });
  });
  it('returns null when no session file is newer than spawn start', () => {
    const home = tmp();
    const cwd = '/Users/x/code/repo';
    const dir = join(home, '.claude', 'projects', claudeProjectDirName(cwd));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'old.jsonl'), '{}', 'utf8');
    const past = (Date.now() - 3_600_000) / 1000;
    utimesSync(join(dir, 'old.jsonl'), past, past);
    expect(claudeUsage({ cwd, startedAtMs: Date.now(), homeDir: home })).toBeNull();
  });
  it('returns null on missing store (never throws)', () => {
    expect(claudeUsage({ cwd: '/none', startedAtMs: Date.now(), homeDir: tmp() })).toBeNull();
  });
});

describe('codexUsage', () => {
  it('reads the last token_count event of a session modified during the spawn window', () => {
    const home = tmp();
    const dir = join(home, '.codex', 'sessions');
    mkdirSync(dir, { recursive: true });
    const lines = [
      JSON.stringify({ type: 'token_count', input_tokens: 10, output_tokens: 1 }),
      JSON.stringify({ type: 'token_count', input_tokens: 900, output_tokens: 80 }),
    ].join('\n');
    writeFileSync(join(dir, 's1.jsonl'), lines, 'utf8');
    const usage = codexUsage({ cwd: '/any', startedAtMs: Date.now() - 60_000, homeDir: home });
    expect(usage).toEqual({ input: 900, output: 80, total: 980, source: 'codex-session' });
  });
  it('returns null when records lack token fields', () => {
    const home = tmp();
    const dir = join(home, '.codex', 'sessions');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 's1.jsonl'), JSON.stringify({ type: 'other' }), 'utf8');
    expect(codexUsage({ cwd: '/any', startedAtMs: Date.now() - 60_000, homeDir: home })).toBeNull();
  });
});

describe('opencodeUsage', () => {
  it('sums tokens from message-store records modified during the spawn window', () => {
    const home = tmp();
    const dir = join(home, '.local', 'share', 'opencode', 'storage', 'message');
    mkdirSync(join(dir, 'ses1'), { recursive: true });
    writeFileSync(
      join(dir, 'ses1', 'm1.json'),
      JSON.stringify({ role: 'assistant', tokens: { input: 40, output: 9 } }),
      'utf8',
    );
    const usage = opencodeUsage({ cwd: '/any', startedAtMs: Date.now() - 60_000, homeDir: home });
    expect(usage).toEqual({ input: 40, output: 9, total: 49, source: 'opencode-session' });
  });
  it('returns null when store absent', () => {
    expect(opencodeUsage({ cwd: '/any', startedAtMs: Date.now(), homeDir: tmp() })).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify FAIL**

```bash
pnpm vitest run src/core/agent-runner/usage/__tests__/adapters.test.ts
```

Expected output: failure — modules `../claude`, `../codex`, `../opencode` do not exist.

- [ ] **Step 4: Implement claude adapter.** Create `src/core/agent-runner/usage/claude.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TokenUsage, UsageLookup } from './types.js';

/** Claude Code transcript dir name: cwd with every non-alphanumeric char replaced by '-'. */
export function claudeProjectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Sum native `usage` fields from assistant records of the newest session
 * JSONL modified after spawn start. Returns null when no such session or
 * no usage records exist — never estimates.
 */
export function claudeUsage(lookup: UsageLookup): TokenUsage | null {
  try {
    const root = join(lookup.homeDir ?? homedir(), '.claude', 'projects', claudeProjectDirName(lookup.cwd));
    const candidates = readdirSync(root)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => join(root, f))
      .filter((p) => statSync(p).mtimeMs >= lookup.startedAtMs)
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (candidates.length === 0) return null;
    let input = 0;
    let output = 0;
    let seen = false;
    for (const line of readFileSync(candidates[0], 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as {
          type?: string;
          message?: { usage?: { input_tokens?: number; output_tokens?: number } };
        };
        const u = rec.type === 'assistant' ? rec.message?.usage : undefined;
        if (u && typeof u.input_tokens === 'number' && typeof u.output_tokens === 'number') {
          input += u.input_tokens;
          output += u.output_tokens;
          seen = true;
        }
      } catch {
        // skip malformed line
      }
    }
    return seen ? { input, output, total: input + output, source: 'claude-jsonl' } : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Implement codex adapter.** Create `src/core/agent-runner/usage/codex.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TokenUsage, UsageLookup } from './types.js';

/**
 * Read the LAST `token_count` record (codex emits running totals) of the
 * newest session file under ~/.codex/sessions modified after spawn start.
 * Null when absent — never estimates.
 */
export function codexUsage(lookup: UsageLookup): TokenUsage | null {
  try {
    const root = join(lookup.homeDir ?? homedir(), '.codex', 'sessions');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.jsonl') && statSync(p).mtimeMs >= lookup.startedAtMs) files.push(p);
      }
    };
    walk(root);
    files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (files.length === 0) return null;
    let last: { input: number; output: number } | null = null;
    for (const line of readFileSync(files[0], 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as { type?: string; input_tokens?: number; output_tokens?: number };
        if (rec.type === 'token_count' && typeof rec.input_tokens === 'number' && typeof rec.output_tokens === 'number') {
          last = { input: rec.input_tokens, output: rec.output_tokens };
        }
      } catch {
        // skip malformed line
      }
    }
    return last ? { ...last, total: last.input + last.output, source: 'codex-session' } : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: Implement opencode adapter.** Create `src/core/agent-runner/usage/opencode.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TokenUsage, UsageLookup } from './types.js';

/**
 * Sum `tokens` from assistant message records in opencode's storage
 * (~/.local/share/opencode/storage/message/<session>/<msg>.json) modified
 * after spawn start. Null when absent — never estimates.
 */
export function opencodeUsage(lookup: UsageLookup): TokenUsage | null {
  try {
    const root = join(lookup.homeDir ?? homedir(), '.local', 'share', 'opencode', 'storage', 'message');
    let input = 0;
    let output = 0;
    let seen = false;
    for (const ses of readdirSync(root, { withFileTypes: true })) {
      if (!ses.isDirectory()) continue;
      const sesDir = join(root, ses.name);
      for (const f of readdirSync(sesDir)) {
        const p = join(sesDir, f);
        if (!f.endsWith('.json') || statSync(p).mtimeMs < lookup.startedAtMs) continue;
        try {
          const rec = JSON.parse(readFileSync(p, 'utf8')) as {
            role?: string;
            tokens?: { input?: number; output?: number };
          };
          if (rec.role === 'assistant' && typeof rec.tokens?.input === 'number' && typeof rec.tokens?.output === 'number') {
            input += rec.tokens.input;
            output += rec.tokens.output;
            seen = true;
          }
        } catch {
          // skip malformed file
        }
      }
    }
    return seen ? { input, output, total: input + output, source: 'opencode-session' } : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 7: Adapter index.** Create `src/core/agent-runner/usage/index.ts`:

```ts
import type { RunnerId } from '../types.js';
import type { UsageAdapter } from './types.js';
import { claudeUsage } from './claude.js';
import { codexUsage } from './codex.js';
import { opencodeUsage } from './opencode.js';

export const USAGE_ADAPTERS: Record<RunnerId, UsageAdapter> = {
  claude: claudeUsage,
  codex: codexUsage,
  opencode: opencodeUsage,
};
```

(If `RunnerId` is named differently in `src/core/agent-runner/types.ts` — check it: it is the union behind `ResolvedRunner.runner` — import that exact type name instead.)

- [ ] **Step 8: Run to verify PASS**

```bash
pnpm vitest run src/core/agent-runner/usage/__tests__/adapters.test.ts
```

Expected output: 7 passed.

- [ ] **Step 9: Wire into registry.** In `src/core/agent-runner/registry.ts`, import `USAGE_ADAPTERS` from `./usage/index.js`. In the `child.on('close', ...)` handler, before `appendAgentEvent(cwd, {...})`, resolve usage and attach:

```ts
      const usage = USAGE_ADAPTERS[resolved.runner]({ cwd, startedAtMs: started });
      appendAgentEvent(cwd, {
        ts: new Date().toISOString(),
        // ...existing fields stay unchanged...
        ...(usage ? { tokens: usage } : {}),
      });
```

(Keep every existing field; only add the spread. `started` already exists in scope.)

- [ ] **Step 10: Full suite + typecheck**

```bash
pnpm vitest run src/core/agent-runner && pnpm exec tsc --noEmit
```

Expected output: agent-runner suites pass; tsc clean.

- [ ] **Step 11: Commit**

```bash
git add src/core/agent-runner/usage src/core/agent-runner/registry.ts
git commit -m "feat(metrics): per-runner token usage adapters (claude/codex/opencode), wired into spawn events" -m "Noldor-FD: outcome-telemetry-and-effectiveness-metrics"
```

## Task 4: metrics types + `extractFacts`

**Files:**
- Create: `src/metrics/types.ts`, `src/metrics/facts.ts`
- Test: `src/metrics/__tests__/facts.test.ts`

- [ ] **Step 1: Types.** Create `src/metrics/types.ts`:

```ts
import type { AgentEvent } from '../core/agent-events.js';
import type { EscalationRow } from '../autonomous/escalations.js';
import type { DrainState } from '../autonomous/drain-state.js';
import type { LaneFindings } from '../cr/findings-schema.js';
import type { FeatureFrontmatter } from '../features/feature-schema.js';

export interface CommitFact {
  sha: string;
  /** Committer date, ISO. */
  date: string;
  subject: string;
  trailers: Record<string, string>;
  insertions: number;
  deletions: number;
}

export interface FeatureFact {
  slug: string;
  fm: FeatureFrontmatter;
}

/** Intake metadata recovered from roadmap/backlog git history (promotion deletes the source block). */
export interface IntakeFact {
  slug: string;
  since?: string;
  parent?: string;
  size?: string;
}

export interface ReleaseFact {
  /** Without the leading 'v'. */
  version: string;
  /** Tag (committer) date, ISO. */
  date: string;
}

export interface RepoFacts {
  commits: CommitFact[];
  features: FeatureFact[];
  intake: IntakeFact[];
  laneFindings: LaneFindings[];
  agentEvents: AgentEvent[];
  escalations: EscalationRow[];
  drainState: DrainState | null;
  releases: ReleaseFact[];
  warnings: string[];
}

export interface MetricResult {
  id: string;
  value: unknown;
  unit: string;
  /** Human-readable derivation. REQUIRED — the honesty rail lives in code. */
  formula: string;
  /** REQUIRED, never empty — every metric has at least one blind spot. */
  blindSpots: string[];
  /** Underlying rows, for audit. */
  samples: unknown[];
}

export type Collector = (facts: RepoFacts) => MetricResult;

export interface MetricsReport {
  generatedAt: string;
  head: string;
  factsWarnings: string[];
  metrics: MetricResult[];
}
```

- [ ] **Step 2: Write the failing test.** Create `src/metrics/__tests__/facts.test.ts`:

```ts
// @tests: outcome-telemetry-and-effectiveness-metrics
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractFacts } from '../facts';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function scratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-facts-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  return dir;
}

describe('extractFacts', () => {
  it('extracts commits with trailers, features, releases, and intake recovery', async () => {
    const dir = scratchRepo();
    mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
    writeFileSync(
      join(dir, 'docs', 'roadmap.md'),
      '# Roadmap\n\n#### My Feature\n\n- area: tooling\n- since: 2026-01-01\n- size: L\n- parent: noldor\n\nBody.\n',
      'utf8',
    );
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'docs: seed roadmap');
    writeFileSync(
      join(dir, 'docs', 'features', 'my-feature.md'),
      [
        '---',
        'area: tooling',
        'category: Tooling',
        'links:',
        '  code: []',
        'name: My Feature',
        'packages:',
        '  - scripts',
        'phase: done',
        'noldor-tier: full',
        'introduced: 1.0.0',
        '---',
        '',
        '## Summary',
        '',
        'x',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(join(dir, 'docs', 'roadmap.md'), '# Roadmap\n', 'utf8');
    git(dir, 'add', '.');
    git(
      dir,
      'commit',
      '-q',
      '-m',
      'feat(my-feature): ship\n\nNoldor-FD: my-feature\nNoldor-Path: full-new',
    );
    git(dir, 'tag', 'v1.0.0');
    const facts = await extractFacts(dir);
    expect(facts.commits.some((c) => c.trailers['Noldor-FD'] === 'my-feature')).toBe(true);
    expect(facts.features).toHaveLength(1);
    expect(facts.features[0].slug).toBe('my-feature');
    expect(facts.releases).toEqual([{ version: '1.0.0', date: expect.any(String) }]);
    const intake = facts.intake.find((i) => i.slug === 'my-feature');
    expect(intake).toMatchObject({ since: '2026-01-01', size: 'L', parent: 'noldor' });
    expect(facts.drainState).toBeNull();
    expect(facts.agentEvents).toEqual([]);
  });

  it('is fail-open per source: malformed events line is skipped + warned', async () => {
    const dir = scratchRepo();
    mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
    mkdirSync(join(dir, '.noldor'), { recursive: true });
    writeFileSync(join(dir, 'README.md'), 'x', 'utf8');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'init');
    writeFileSync(
      join(dir, '.noldor', 'agent-events.jsonl'),
      '{"ts":"2026-06-12T00:00:00Z","runner":"claude","role":"drain-implementer","exitCode":0,"durationMs":5,"timedOut":false}\nNOT-JSON\n',
      'utf8',
    );
    const facts = await extractFacts(dir);
    expect(facts.agentEvents).toHaveLength(1);
    expect(facts.warnings.some((w) => w.includes('agent-events'))).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify FAIL**

```bash
pnpm vitest run src/metrics/__tests__/facts.test.ts
```

Expected output: failure — `../facts` does not exist.

- [ ] **Step 4: Implement.** Create `src/metrics/facts.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { parseTrailers } from '../core/trailers.js';
import { FeatureFrontmatterSchema } from '../features/feature-schema.js';
import { laneFindingsSchema } from '../cr/findings-schema.js';
import { slugify } from '../utils/slugify.js';
import type { AgentEvent } from '../core/agent-events.js';
import type { EscalationRow } from '../autonomous/escalations.js';
import type { DrainState } from '../autonomous/drain-state.js';
import type { CommitFact, FeatureFact, IntakeFact, ReleaseFact, RepoFacts } from './types.js';

const REC_SEP = '\x1e';
const FIELD_SEP = '\x1f';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function extractCommits(cwd: string): CommitFact[] {
  const raw = git(cwd, [
    'log',
    `--format=${REC_SEP}%H${FIELD_SEP}%cI${FIELD_SEP}%s${FIELD_SEP}%b`,
    '--shortstat',
  ]);
  const commits: CommitFact[] = [];
  for (const rec of raw.split(REC_SEP)) {
    if (!rec.trim()) continue;
    const [sha, date, subject, rest] = rec.split(FIELD_SEP);
    if (!sha || !date) continue;
    const stat = /(\d+) insertions?\(\+\)/.exec(rest ?? '');
    const del = /(\d+) deletions?\(-\)/.exec(rest ?? '');
    commits.push({
      sha: sha.trim(),
      date,
      subject: subject ?? '',
      trailers: parseTrailers(`${subject}\n\n${rest ?? ''}`) as unknown as Record<string, string>,
      insertions: stat ? Number(stat[1]) : 0,
      deletions: del ? Number(del[1]) : 0,
    });
  }
  return commits;
}

function extractFeatures(cwd: string, warnings: string[]): FeatureFact[] {
  const dir = join(cwd, 'docs', 'features');
  if (!existsSync(dir)) {
    warnings.push('features: docs/features absent');
    return [];
  }
  const out: FeatureFact[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    const parsed = FeatureFrontmatterSchema.safeParse(matter(readFileSync(join(dir, f), 'utf8')).data);
    if (parsed.success) out.push({ slug: f.replace(/\.md$/, ''), fm: parsed.data });
    else warnings.push(`features: ${f} failed frontmatter parse`);
  }
  return out;
}

/** Recover since/parent/size per promoted entry from the added-lines history of roadmap/backlog. */
function recoverIntake(cwd: string): IntakeFact[] {
  let raw = '';
  try {
    raw = git(cwd, ['log', '--reverse', '-p', '--', 'docs/roadmap.md', 'docs/backlog.md']);
  } catch {
    return [];
  }
  const map = new Map<string, IntakeFact>();
  let current: IntakeFact | null = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git') || line.startsWith('@@')) {
      current = null;
      continue;
    }
    const h = /^\+#{3,4} (.+)$/.exec(line);
    if (h) {
      const slug = slugify(h[1]);
      current = map.get(slug) ?? { slug };
      map.set(slug, current);
      continue;
    }
    const f = /^\+- (since|parent|size): (.+)$/.exec(line);
    if (f && current) {
      const key = f[1] as 'since' | 'parent' | 'size';
      if (current[key] === undefined) current[key] = f[2].trim();
    }
  }
  return [...map.values()];
}

function readJsonl<T>(path: string, label: string, warnings: string[]): T[] {
  if (!existsSync(path)) return [];
  const rows: T[] = [];
  let skipped = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as T);
    } catch {
      skipped += 1;
    }
  }
  if (skipped > 0) warnings.push(`${label}: skipped ${skipped} malformed line(s)`);
  return rows;
}

function readLaneFindings(cwd: string, warnings: string[]): RepoFacts['laneFindings'] {
  const out: RepoFacts['laneFindings'] = [];
  for (const dir of [join(cwd, '.noldor', 'cr'), join(cwd, '.noldor', 'cr', 'archive')]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const parsed = laneFindingsSchema.safeParse(JSON.parse(readFileSync(join(dir, f), 'utf8')));
        if (parsed.success) out.push(parsed.data);
        else warnings.push(`cr: ${f} failed LaneFindings parse`);
      } catch {
        warnings.push(`cr: ${f} unreadable`);
      }
    }
  }
  return out;
}

function extractReleases(cwd: string): ReleaseFact[] {
  const raw = git(cwd, [
    'for-each-ref',
    'refs/tags/v*',
    `--format=%(refname:short)${FIELD_SEP}%(creatordate:iso-strict)`,
  ]);
  const out: ReleaseFact[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const [tag, date] = line.split(FIELD_SEP);
    if (tag?.startsWith('v') && date) out.push({ version: tag.slice(1), date });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * One extraction pass over every metrics source. Fail-open PER SOURCE:
 * absent file → empty list + warning; malformed row → skipped + warning.
 * Only a non-git cwd throws.
 */
export async function extractFacts(cwd: string): Promise<RepoFacts> {
  const warnings: string[] = [];
  let drainState: DrainState | null = null;
  try {
    drainState = JSON.parse(readFileSync(join(cwd, '.noldor', 'drain-state.json'), 'utf8')) as DrainState;
  } catch {
    drainState = null;
  }
  return {
    commits: extractCommits(cwd),
    features: extractFeatures(cwd, warnings),
    intake: recoverIntake(cwd),
    laneFindings: readLaneFindings(cwd, warnings),
    agentEvents: readJsonl<AgentEvent>(join(cwd, '.noldor', 'agent-events.jsonl'), 'agent-events', warnings),
    escalations: readJsonl<EscalationRow>(join(cwd, '.noldor', 'escalations.jsonl'), 'escalations', warnings),
    drainState,
    releases: extractReleases(cwd),
    warnings,
  };
}
```

Note: `parseTrailers` returns the repo's `Trailers` type — check `src/core/trailers.ts:20` and, if it is a typed object rather than a string map, convert with a small helper instead of the `as unknown as` cast; the cast above is a placeholder for whichever of the two shapes the real type has — resolve it while implementing, the test pins the behavior (`trailers['Noldor-FD'] === 'my-feature'`).

- [ ] **Step 5: Run to verify PASS**

```bash
pnpm vitest run src/metrics/__tests__/facts.test.ts
```

Expected output: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add src/metrics/types.ts src/metrics/facts.ts src/metrics/__tests__/facts.test.ts
git commit -m "feat(metrics): RepoFacts extraction pass (commits, features, intake recovery, .noldor artifacts)" -m "Noldor-FD: outcome-telemetry-and-effectiveness-metrics"
```

## Task 5: cycle-time collector

**Files:**
- Create: `src/metrics/collect/cycle-time.ts`
- Test: `src/metrics/__tests__/cycle-time.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/metrics/__tests__/cycle-time.test.ts`:

```ts
// @tests: outcome-telemetry-and-effectiveness-metrics
import { describe, expect, it } from 'vitest';
import { collectCycleTime } from '../collect/cycle-time';
import { emptyFacts, feature, commit } from './fixtures';

describe('collectCycleTime', () => {
  it('computes days from intake to release-tag date, segmented by path', () => {
    const facts = emptyFacts({
      features: [feature('a', { introduced: '1.0.0', since: '2026-01-01' })],
      releases: [{ version: '1.0.0', date: '2026-01-11T00:00:00+00:00' }],
      commits: [commit({ trailers: { 'Noldor-FD': 'a', 'Noldor-Path': 'full-new' } })],
    });
    const r = collectCycleTime(facts);
    const v = r.value as { medianDays: number; rows: { slug: string; days: number; path: string }[] };
    expect(v.medianDays).toBe(10);
    expect(v.rows[0]).toMatchObject({ slug: 'a', days: 10, path: 'full-new' });
    expect(r.formula.length).toBeGreaterThan(0);
    expect(r.blindSpots.length).toBeGreaterThan(0);
  });

  it('falls back to intake[] recovery and tallies unrecoverable FDs', () => {
    const facts = emptyFacts({
      features: [
        feature('b', { introduced: '1.0.0' }),
        feature('c', { introduced: '1.0.0' }),
        feature('d', { introduced: '9.9.9' }),
      ],
      intake: [{ slug: 'b', since: '2026-01-06' }],
      releases: [{ version: '1.0.0', date: '2026-01-11T00:00:00+00:00' }],
    });
    const v = collectCycleTime(facts).value as {
      rows: unknown[];
      excluded: { noIntake: number; noTag: number };
    };
    expect(v.rows).toHaveLength(1);
    expect(v.excluded).toEqual({ noIntake: 1, noTag: 1 });
  });
});
```

- [ ] **Step 2: Fixtures.** Create `src/metrics/__tests__/fixtures.ts`:

```ts
import type { CommitFact, FeatureFact, RepoFacts } from '../types';
import type { FeatureFrontmatter } from '../../features/feature-schema';

export function emptyFacts(overrides: Partial<RepoFacts> = {}): RepoFacts {
  return {
    commits: [],
    features: [],
    intake: [],
    laneFindings: [],
    agentEvents: [],
    escalations: [],
    drainState: null,
    releases: [],
    warnings: [],
    ...overrides,
  };
}

export function feature(slug: string, fm: Partial<FeatureFrontmatter> = {}): FeatureFact {
  return {
    slug,
    fm: {
      area: 'tooling',
      category: 'Tooling',
      deps: [],
      links: { code: [], docs: [], tests: [] },
      name: slug,
      packages: ['scripts'],
      phase: 'done',
      'noldor-tier': 'full',
      ...fm,
    } as FeatureFrontmatter,
  };
}

export function commit(overrides: Partial<CommitFact> = {}): CommitFact {
  return {
    sha: 'abc123',
    date: '2026-01-10T00:00:00+00:00',
    subject: 'feat: x',
    trailers: {},
    insertions: 1,
    deletions: 0,
    ...overrides,
  };
}
```

- [ ] **Step 3: Run to verify FAIL**

```bash
pnpm vitest run src/metrics/__tests__/cycle-time.test.ts
```

Expected output: failure — `../collect/cycle-time` does not exist.

- [ ] **Step 4: Implement.** Create `src/metrics/collect/cycle-time.ts`:

```ts
import type { Collector, MetricResult, RepoFacts } from '../types.js';

interface Row {
  slug: string;
  days: number;
  path: string;
  provenance: 'autonomous' | 'operator' | 'unknown-provenance';
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export const collectCycleTime: Collector = (facts: RepoFacts): MetricResult => {
  const tagDates = new Map(facts.releases.map((r) => [r.version, r.date]));
  const intakeBySlug = new Map(facts.intake.map((i) => [i.slug, i]));
  const commitsBySlug = new Map<string, RepoFacts['commits']>();
  for (const c of facts.commits) {
    const slug = c.trailers['Noldor-FD'];
    if (!slug) continue;
    const list = commitsBySlug.get(slug) ?? [];
    list.push(c);
    commitsBySlug.set(slug, list);
  }
  const eventSlugs = new Set(facts.agentEvents.map((e) => e.slug).filter(Boolean));
  const rows: Row[] = [];
  let noIntake = 0;
  let noTag = 0;
  for (const f of facts.features) {
    const version = f.fm.introduced;
    if (!version) continue;
    const end = tagDates.get(version);
    if (!end) {
      noTag += 1;
      continue;
    }
    const start = f.fm.since ?? intakeBySlug.get(f.slug)?.since;
    if (!start) {
      noIntake += 1;
      continue;
    }
    const days = Math.round(((Date.parse(end) - Date.parse(start)) / 86_400_000) * 10) / 10;
    const cs = commitsBySlug.get(f.slug) ?? [];
    const paths = [...new Set(cs.map((c) => c.trailers['Noldor-Path']).filter(Boolean))];
    const path = paths.length === 0 ? 'unknown' : paths.length === 1 ? paths[0] : 'mixed';
    const provenance = eventSlugs.has(f.slug)
      ? 'autonomous'
      : paths.length > 0
        ? 'operator'
        : 'unknown-provenance';
    rows.push({ slug: f.slug, days, path, provenance });
  }
  const sorted = rows.map((r) => r.days).sort((a, b) => a - b);
  const byPath: Record<string, number[]> = {};
  for (const r of rows) (byPath[r.path] ??= []).push(r.days);
  const perPath = Object.fromEntries(
    Object.entries(byPath).map(([p, ds]) => [p, percentile([...ds].sort((a, b) => a - b), 50)]),
  );
  return {
    id: 'cycle-time',
    unit: 'days',
    value: {
      medianDays: percentile(sorted, 50),
      p90Days: percentile(sorted, 90),
      medianByPath: perPath,
      excluded: { noIntake, noTag },
    },
    formula:
      'days(intake → release): intake = FD frontmatter `since` else roadmap-history recovery; release = creator date of tag v<introduced>. Median + p90 over FDs with both endpoints.',
    blindSpots: [
      'FDs with unrecoverable intake or an introduced version without a matching v-tag are excluded (see excluded tally).',
      'Provenance segmentation approximates: autonomous = any agent-event for the slug; pre-event-log autonomous ships read as operator/unknown.',
      'Pre-Noldor-Path commits make path segmentation read `unknown`.',
    ],
    samples: rows,
  };
};
```

- [ ] **Step 5: Run to verify PASS**

```bash
pnpm vitest run src/metrics/__tests__/cycle-time.test.ts
```

Expected output: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add src/metrics/collect/cycle-time.ts src/metrics/__tests__/cycle-time.test.ts src/metrics/__tests__/fixtures.ts
git commit -m "feat(metrics): cycle-time collector (intake → release-tag date)" -m "Noldor-FD: outcome-telemetry-and-effectiveness-metrics"
```

## Task 6: routing-accuracy collector

**Files:**
- Create: `src/metrics/collect/routing-accuracy.ts`
- Test: `src/metrics/__tests__/routing-accuracy.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/metrics/__tests__/routing-accuracy.test.ts`:

```ts
// @tests: outcome-telemetry-and-effectiveness-metrics
import { describe, expect, it } from 'vitest';
import { collectRoutingAccuracy } from '../collect/routing-accuracy';
import { emptyFacts, feature, commit } from './fixtures';

describe('collectRoutingAccuracy', () => {
  it('builds a suggestion×actual confusion table using sizeToPath(size, hasParent)', () => {
    const facts = emptyFacts({
      features: [feature('a', { introduced: '1.0.0' })],
      releases: [{ version: '1.0.0', date: '2026-01-11T00:00:00+00:00' }],
      intake: [{ slug: 'a', size: 'L', parent: 'noldor' }],
      commits: [commit({ trailers: { 'Noldor-FD': 'a', 'Noldor-Path': 'full-new' } })],
    });
    const v = collectRoutingAccuracy(facts).value as {
      table: Record<string, Record<string, number>>;
      matches: number;
      total: number;
    };
    // size L + hasParent → suggestion 'full-attach'; actual 'full-new' → mismatch cell
    expect(v.table['full-attach']['full-new']).toBe(1);
    expect(v.matches).toBe(0);
    expect(v.total).toBe(1);
  });

  it('excludes entries with no recoverable size or no actual path', () => {
    const facts = emptyFacts({
      features: [feature('a', { introduced: '1.0.0' })],
      releases: [{ version: '1.0.0', date: '2026-01-11T00:00:00+00:00' }],
    });
    const v = collectRoutingAccuracy(facts).value as { total: number; excluded: number };
    expect(v.total).toBe(0);
    expect(v.excluded).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/metrics/__tests__/routing-accuracy.test.ts
```

Expected output: failure — module does not exist.

- [ ] **Step 3: Implement.** Create `src/metrics/collect/routing-accuracy.ts`:

```ts
import { sizeToPath } from '../../core/size-routing.js';
import type { Collector, MetricResult, RepoFacts } from '../types.js';

const LAST_N = 10;

export const collectRoutingAccuracy: Collector = (facts: RepoFacts): MetricResult => {
  const tagDates = new Map(facts.releases.map((r) => [r.version, r.date]));
  const intakeBySlug = new Map(facts.intake.map((i) => [i.slug, i]));
  const actualBySlug = new Map<string, string>();
  for (const c of facts.commits) {
    const slug = c.trailers['Noldor-FD'];
    const path = c.trailers['Noldor-Path'];
    if (slug && path && !actualBySlug.has(slug)) actualBySlug.set(slug, path);
  }
  const shipped = facts.features
    .filter((f) => f.fm.introduced && tagDates.has(f.fm.introduced))
    .sort((a, b) =>
      (tagDates.get(b.fm.introduced as string) as string).localeCompare(
        tagDates.get(a.fm.introduced as string) as string,
      ),
    )
    .slice(0, LAST_N);
  const table: Record<string, Record<string, number>> = {};
  const samples: { slug: string; suggested: string; actual: string }[] = [];
  let matches = 0;
  let excluded = 0;
  for (const f of shipped) {
    const intake = intakeBySlug.get(f.slug);
    const actual = actualBySlug.get(f.slug);
    if (!intake?.size || !actual) {
      excluded += 1;
      continue;
    }
    const suggested = sizeToPath(intake.size, intake.parent !== undefined);
    ((table[suggested] ??= {})[actual] ??= 0), (table[suggested][actual] += 1);
    if (suggested === actual) matches += 1;
    samples.push({ slug: f.slug, suggested, actual });
  }
  return {
    id: 'routing-accuracy',
    unit: 'entries',
    value: { table, matches, total: samples.length, excluded, window: LAST_N },
    formula: `sizeToPath(intake.size, intake.parent != null) vs first Noldor-Path trailer of the FD's commits, over the last ${LAST_N} shipped FDs (by release-tag date).`,
    blindSpots: [
      'Entries whose roadmap size/parent could not be recovered from history, or whose commits predate the Noldor-Path trailer, are excluded (see excluded count).',
      'First-trailer-wins: a feature shipped across mixed paths is judged by its first commit path.',
    ],
    samples,
  };
};
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/metrics/__tests__/routing-accuracy.test.ts
```

Expected output: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/metrics/collect/routing-accuracy.ts src/metrics/__tests__/routing-accuracy.test.ts
git commit -m "feat(metrics): routing-accuracy collector (sizeToPath suggestion vs actual path)" -m "Noldor-FD: outcome-telemetry-and-effectiveness-metrics"
```

## Task 7: cr-effectiveness + override-pressure collectors

**Files:**
- Create: `src/metrics/collect/cr-effectiveness.ts`, `src/metrics/collect/override-pressure.ts`
- Test: `src/metrics/__tests__/cr-and-override.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/metrics/__tests__/cr-and-override.test.ts`:

```ts
// @tests: outcome-telemetry-and-effectiveness-metrics
import { describe, expect, it } from 'vitest';
import { collectCrEffectiveness } from '../collect/cr-effectiveness';
import { collectOverridePressure } from '../collect/override-pressure';
import { emptyFacts, feature, commit } from './fixtures';
import type { LaneFindings } from '../../cr/findings-schema';

const LF: LaneFindings = {
  lane: 'subagent',
  artifact: 'docs/x.md',
  kind: 'code',
  slug: 'a',
  blockers: [{ file: 'x', severity: 'high', message: 'm' }],
  suggestions: [{ file: 'x', severity: 'low', message: 's' }],
  summary: 'sum',
  startedAt: '2026-01-10T00:00:00.000Z',
} as LaneFindings;

describe('collectCrEffectiveness', () => {
  it('counts per-lane findings and 14-day corrective commits', () => {
    const facts = emptyFacts({
      features: [feature('a', { introduced: '1.0.0' })],
      releases: [{ version: '1.0.0', date: '2026-01-11T00:00:00+00:00' }],
      laneFindings: [LF],
      commits: [
        commit({ subject: 'fix: broken thing', date: '2026-01-15T00:00:00+00:00', trailers: { 'Noldor-FD': 'a' } }),
        commit({ subject: 'fix: too late', date: '2026-02-15T00:00:00+00:00', trailers: { 'Noldor-FD': 'a' } }),
      ],
    });
    const v = collectCrEffectiveness(facts).value as {
      perLane: Record<string, { blockers: number; suggestions: number }>;
      correctiveBySlug: Record<string, number>;
    };
    expect(v.perLane.subagent).toEqual({ blockers: 1, suggestions: 1 });
    expect(v.correctiveBySlug.a).toBe(1);
  });
});

describe('collectOverridePressure', () => {
  it('buckets override trailers by the release window containing the commit', () => {
    const facts = emptyFacts({
      releases: [{ version: '1.0.0', date: '2026-01-11T00:00:00+00:00' }],
      commits: [
        commit({ date: '2026-01-10T00:00:00+00:00', trailers: { 'Noldor-Override-Gate': 'reason' } }),
      ],
    });
    const v = collectOverridePressure(facts).value as Record<string, Record<string, number>>;
    expect(v['1.0.0']['Noldor-Override-Gate']).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/metrics/__tests__/cr-and-override.test.ts
```

Expected output: failure — modules do not exist.

- [ ] **Step 3: Implement cr-effectiveness.** Create `src/metrics/collect/cr-effectiveness.ts`:

```ts
import type { Collector, MetricResult, RepoFacts } from '../types.js';

const CORRECTIVE_WINDOW_DAYS = 14;

export const collectCrEffectiveness: Collector = (facts: RepoFacts): MetricResult => {
  const perLane: Record<string, { blockers: number; suggestions: number }> = {};
  for (const lf of facts.laneFindings) {
    const lane = (perLane[lf.lane] ??= { blockers: 0, suggestions: 0 });
    lane.blockers += lf.blockers.length;
    lane.suggestions += lf.suggestions.length;
  }
  const tagDates = new Map(facts.releases.map((r) => [r.version, r.date]));
  const correctiveBySlug: Record<string, number> = {};
  for (const f of facts.features) {
    const shipDate = f.fm.introduced ? tagDates.get(f.fm.introduced) : undefined;
    if (!shipDate) continue;
    const shipMs = Date.parse(shipDate);
    const windowEnd = shipMs + CORRECTIVE_WINDOW_DAYS * 86_400_000;
    const n = facts.commits.filter((c) => {
      if (c.trailers['Noldor-FD'] !== f.slug) return false;
      if (!/^(fix|revert)\b/.test(c.subject)) return false;
      const t = Date.parse(c.date);
      return t > shipMs && t <= windowEnd;
    }).length;
    if (n > 0) correctiveBySlug[f.slug] = n;
  }
  return {
    id: 'cr-effectiveness',
    unit: 'findings / corrective commits',
    value: { perLane, correctiveBySlug, windowDays: CORRECTIVE_WINDOW_DAYS },
    formula: `Per-lane blockers+suggestions from .noldor/cr LaneFindings vs fix:/revert: commits carrying the same Noldor-FD within ${CORRECTIVE_WINDOW_DAYS} days after the FD's release-tag date.`,
    blindSpots: [
      'Approximation: a corrective commit is attributed by trailer + subject prefix; refactors that silently fix, or fixes without the FD trailer, are invisible.',
      'CR sinks are operator-local and pruned/archived — historical lanes may be missing entirely.',
    ],
    samples: facts.laneFindings.map((lf) => ({
      slug: lf.slug,
      lane: lf.lane,
      kind: lf.kind,
      blockers: lf.blockers.length,
      suggestions: lf.suggestions.length,
    })),
  };
};
```

- [ ] **Step 4: Implement override-pressure.** Create `src/metrics/collect/override-pressure.ts`:

```ts
import type { Collector, MetricResult, RepoFacts } from '../types.js';

/** First release whose tag date >= commit date; commits after the last tag bucket to 'unreleased'. */
function releaseWindow(commitDate: string, releases: RepoFacts['releases']): string {
  for (const r of releases) {
    if (commitDate <= r.date) return r.version;
  }
  return 'unreleased';
}

export const collectOverridePressure: Collector = (facts: RepoFacts): MetricResult => {
  const buckets: Record<string, Record<string, number>> = {};
  const samples: { sha: string; trailer: string; window: string }[] = [];
  for (const c of facts.commits) {
    for (const key of Object.keys(c.trailers)) {
      if (!key.startsWith('Noldor-Override')) continue;
      const window = releaseWindow(c.date, facts.releases);
      ((buckets[window] ??= {})[key] ??= 0), (buckets[window][key] += 1);
      samples.push({ sha: c.sha, trailer: key, window });
    }
  }
  return {
    id: 'override-pressure',
    unit: 'override commits',
    value: buckets,
    formula:
      'Count of commits carrying a Noldor-Override* trailer, grouped by trailer key and by release window (first tag dated >= commit date; after last tag → unreleased).',
    blindSpots: [
      'Only trailer-carrying overrides count; env-var bypasses (e.g. RELEASE_SKIP_*) leave no commit trace.',
      'Rising counts can mean a stricter gate OR more violations — the metric flags friction, not fault.',
    ],
    samples,
  };
};
```

- [ ] **Step 5: Run to verify PASS**

```bash
pnpm vitest run src/metrics/__tests__/cr-and-override.test.ts
```

Expected output: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add src/metrics/collect/cr-effectiveness.ts src/metrics/collect/override-pressure.ts src/metrics/__tests__/cr-and-override.test.ts
git commit -m "feat(metrics): cr-effectiveness + override-pressure collectors" -m "Noldor-FD: outcome-telemetry-and-effectiveness-metrics"
```

## Task 8: drain-reliability + tokens-per-feature collectors

**Files:**
- Create: `src/metrics/collect/drain-reliability.ts`, `src/metrics/collect/tokens-per-feature.ts`
- Test: `src/metrics/__tests__/drain-and-tokens.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/metrics/__tests__/drain-and-tokens.test.ts`:

```ts
// @tests: outcome-telemetry-and-effectiveness-metrics
import { describe, expect, it } from 'vitest';
import { collectDrainReliability } from '../collect/drain-reliability';
import { collectTokensPerFeature } from '../collect/tokens-per-feature';
import { emptyFacts } from './fixtures';
import type { AgentEvent } from '../../core/agent-events';

const EV = (over: Partial<AgentEvent>): AgentEvent => ({
  ts: '2026-06-12T00:00:00Z',
  runner: 'claude',
  role: 'drain-implementer',
  exitCode: 0,
  durationMs: 60_000,
  timedOut: false,
  ...over,
});

describe('collectDrainReliability', () => {
  it('separates last-run snapshot from event history', () => {
    const facts = emptyFacts({
      drainState: {
        pid: 1,
        startedAt: 'x',
        phase: 'idle',
        inFlight: [],
        merging: null,
        currentSlug: null,
        shipped: 2,
        skip: ['s1'],
        retries: { s2: 1 },
      },
      agentEvents: [EV({ slug: 'a', kind: 'salvaged' }), EV({ slug: 'b' })],
      escalations: [
        {
          ts: '2026-06-12T01:00:00Z',
          slug: 'c',
          source: 'roadmap',
          reason: 'retries-exhausted',
          evidence: 'e',
          stateSnapshot: { shipped: 0, skipped: [] },
          suggestedAction: 'x',
        },
      ],
    });
    const v = collectDrainReliability(facts).value as {
      lastRun: { shipped: number; skipped: number; retried: number } | null;
      history: { salvaged: number; escalatedTotal: number; meanDurationMs: number };
    };
    expect(v.lastRun).toEqual({ shipped: 2, skipped: 1, retried: 1 });
    expect(v.history.salvaged).toBe(1);
    expect(v.history.escalatedTotal).toBe(1);
    expect(v.history.meanDurationMs).toBe(60_000);
  });

  it('emits null history parts when event sources are absent', () => {
    const v = collectDrainReliability(emptyFacts()).value as { lastRun: null; history: null };
    expect(v.lastRun).toBeNull();
    expect(v.history).toBeNull();
  });
});

describe('collectTokensPerFeature', () => {
  it('sums tokens.total per slug, only over token-bearing events', () => {
    const facts = emptyFacts({
      agentEvents: [
        EV({ slug: 'a', tokens: { input: 100, output: 10, total: 110, source: 'claude-jsonl' } }),
        EV({ slug: 'a', tokens: { input: 50, output: 5, total: 55, source: 'codex-session' } }),
        EV({ slug: 'a' }),
        EV({ slug: 'b' }),
      ],
    });
    const v = collectTokensPerFeature(facts).value as Record<string, number | null>;
    expect(v.a).toBe(165);
    expect(v.b).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/metrics/__tests__/drain-and-tokens.test.ts
```

Expected output: failure — modules do not exist.

- [ ] **Step 3: Implement drain-reliability.** Create `src/metrics/collect/drain-reliability.ts`:

```ts
import type { Collector, MetricResult, RepoFacts } from '../types.js';

export const collectDrainReliability: Collector = (facts: RepoFacts): MetricResult => {
  const lastRun = facts.drainState
    ? {
        shipped: facts.drainState.shipped,
        skipped: facts.drainState.skip.length,
        retried: Object.keys(facts.drainState.retries).length,
      }
    : null;
  const hasHistory = facts.agentEvents.length > 0 || facts.escalations.length > 0;
  const durations = facts.agentEvents.map((e) => e.durationMs);
  const escalatedBySlug: Record<string, number> = {};
  for (const e of facts.escalations) escalatedBySlug[e.slug] = (escalatedBySlug[e.slug] ?? 0) + 1;
  const history = hasHistory
    ? {
        salvaged: facts.agentEvents.filter((e) => e.kind === 'salvaged').length,
        escalatedTotal: facts.escalations.length,
        escalatedBySlug,
        meanDurationMs:
          durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
      }
    : null;
  return {
    id: 'drain-reliability',
    unit: 'runs / events',
    value: { lastRun, history },
    formula:
      'lastRun: shipped/skip/retries from .noldor/drain-state.json (live snapshot, overwritten per run). history: salvaged = agent-events kind=salvaged; escalated = escalations.jsonl counts (total/per-slug — rows carry no run id); mean duration over all agent-events.',
    blindSpots: [
      'drain-state.json is the LATEST run only — it cannot yield per-run history or trends.',
      'Event/escalation history starts at the event-log epoch (2026-06-12); earlier drains are invisible.',
      'EscalationRow has no run identifier — per-run escalation grouping is not derivable (run-id is out of v1 scope).',
    ],
    samples: facts.escalations.map((e) => ({ slug: e.slug, reason: e.reason, ts: e.ts })),
  };
};
```

- [ ] **Step 4: Implement tokens-per-feature.** Create `src/metrics/collect/tokens-per-feature.ts`:

```ts
import type { Collector, MetricResult, RepoFacts } from '../types.js';

export const collectTokensPerFeature: Collector = (facts: RepoFacts): MetricResult => {
  const totals: Record<string, number | null> = {};
  for (const e of facts.agentEvents) {
    if (!e.slug) continue;
    if (e.tokens) totals[e.slug] = (totals[e.slug] ?? 0) + e.tokens.total;
    else totals[e.slug] ??= null;
  }
  return {
    id: 'tokens-per-feature',
    unit: 'raw tokens (NEVER cost)',
    value: totals,
    formula:
      'Sum of agent-event tokens.total per slug. Tokens are read verbatim from runner usage records (claude-jsonl / codex-session / opencode-session); events without trustworthy usage carry no tokens.',
    blindSpots: [
      'null = no usage data, not zero usage: operator-driven interactive sessions and runners without locatable usage records are invisible.',
      'Only spawn-captured agents count; epoch-limited to when token capture shipped.',
    ],
    samples: facts.agentEvents
      .filter((e) => e.tokens)
      .map((e) => ({ slug: e.slug, runner: e.runner, total: e.tokens?.total, source: e.tokens?.source })),
  };
};
```

- [ ] **Step 5: Run to verify PASS**

```bash
pnpm vitest run src/metrics/__tests__/drain-and-tokens.test.ts
```

Expected output: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add src/metrics/collect/drain-reliability.ts src/metrics/collect/tokens-per-feature.ts src/metrics/__tests__/drain-and-tokens.test.ts
git commit -m "feat(metrics): drain-reliability + tokens-per-feature collectors" -m "Noldor-FD: outcome-telemetry-and-effectiveness-metrics"
```

## Task 9: compute() + honesty-rail test

**Files:**
- Create: `src/metrics/compute.ts`
- Test: `src/metrics/__tests__/compute.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/metrics/__tests__/compute.test.ts`:

```ts
// @tests: outcome-telemetry-and-effectiveness-metrics
import { describe, expect, it } from 'vitest';
import { COLLECTORS } from '../compute';
import { emptyFacts } from './fixtures';

describe('honesty rail', () => {
  it('every collector emits non-empty formula and blindSpots, even on empty facts', () => {
    for (const collect of COLLECTORS) {
      const r = collect(emptyFacts());
      expect(r.id.length, r.id).toBeGreaterThan(0);
      expect(r.formula.length, r.id).toBeGreaterThan(0);
      expect(r.blindSpots.length, r.id).toBeGreaterThan(0);
    }
  });
  it('registers all six v1 metrics', () => {
    const ids = COLLECTORS.map((c) => c(emptyFacts()).id).sort();
    expect(ids).toEqual([
      'cr-effectiveness',
      'cycle-time',
      'drain-reliability',
      'override-pressure',
      'routing-accuracy',
      'tokens-per-feature',
    ]);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/metrics/__tests__/compute.test.ts
```

Expected output: failure — `../compute` does not exist.

- [ ] **Step 3: Implement.** Create `src/metrics/compute.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { extractFacts } from './facts.js';
import { collectCycleTime } from './collect/cycle-time.js';
import { collectRoutingAccuracy } from './collect/routing-accuracy.js';
import { collectCrEffectiveness } from './collect/cr-effectiveness.js';
import { collectDrainReliability } from './collect/drain-reliability.js';
import { collectOverridePressure } from './collect/override-pressure.js';
import { collectTokensPerFeature } from './collect/tokens-per-feature.js';
import type { Collector, MetricsReport } from './types.js';

export const COLLECTORS: readonly Collector[] = [
  collectCycleTime,
  collectRoutingAccuracy,
  collectCrEffectiveness,
  collectDrainReliability,
  collectOverridePressure,
  collectTokensPerFeature,
];

/** Derive-on-demand: one facts pass, all collectors. No persistent store — git is the store. */
export async function compute(cwd: string = process.cwd()): Promise<MetricsReport> {
  const facts = await extractFacts(cwd);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  return {
    generatedAt: new Date().toISOString(),
    head,
    factsWarnings: facts.warnings,
    metrics: COLLECTORS.map((c) => c(facts)),
  };
}
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/metrics/__tests__/compute.test.ts
```

Expected output: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/metrics/compute.ts src/metrics/__tests__/compute.test.ts
git commit -m "feat(metrics): compute() registry + honesty-rail test (formula + blindSpots mandatory)" -m "Noldor-FD: outcome-telemetry-and-effectiveness-metrics"
```

## Task 10: CLI + manifest + .gitignore

**Files:**
- Create: `src/metrics/compute-cli.ts`
- Modify: `src/cli/manifest.ts`, `.gitignore`
- Test: `src/metrics/__tests__/compute-cli.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/metrics/__tests__/compute-cli.test.ts`:

```ts
// @tests: outcome-telemetry-and-effectiveness-metrics
import { describe, expect, it } from 'vitest';
import { formatReport, parseArgs } from '../compute-cli';
import type { MetricsReport } from '../types';

const REPORT: MetricsReport = {
  generatedAt: '2026-06-12T00:00:00.000Z',
  head: 'abc',
  factsWarnings: ['w1'],
  metrics: [
    { id: 'cycle-time', unit: 'days', value: { medianDays: 3 }, formula: 'f', blindSpots: ['b'], samples: [] },
  ],
};

describe('parseArgs', () => {
  it('reads --json and --metric', () => {
    expect(parseArgs(['--json', 'out.json', '--metric', 'cycle-time'])).toEqual({
      jsonPath: 'out.json',
      metric: 'cycle-time',
    });
    expect(parseArgs([])).toEqual({ jsonPath: undefined, metric: undefined });
  });
});

describe('formatReport', () => {
  it('renders one block per metric with formula + blind spots', () => {
    const text = formatReport(REPORT, undefined);
    expect(text).toContain('cycle-time');
    expect(text).toContain('formula: f');
    expect(text).toContain('blind spots: b');
    expect(text).toContain('warnings: w1');
  });
  it('filters to a single metric', () => {
    expect(formatReport(REPORT, 'nope')).toContain('no metric with id');
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/metrics/__tests__/compute-cli.test.ts
```

Expected output: failure — `../compute-cli` does not exist.

- [ ] **Step 3: Implement.** Create `src/metrics/compute-cli.ts`:

```ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compute } from './compute.js';
import type { MetricsReport } from './types.js';

export interface CliArgs {
  jsonPath: string | undefined;
  metric: string | undefined;
}

export function parseArgs(argv: string[]): CliArgs {
  const jsonIdx = argv.indexOf('--json');
  const metricIdx = argv.indexOf('--metric');
  return {
    jsonPath: jsonIdx >= 0 ? argv[jsonIdx + 1] : undefined,
    metric: metricIdx >= 0 ? argv[metricIdx + 1] : undefined,
  };
}

export function formatReport(report: MetricsReport, onlyMetric: string | undefined): string {
  const metrics = onlyMetric ? report.metrics.filter((m) => m.id === onlyMetric) : report.metrics;
  if (onlyMetric && metrics.length === 0) return `no metric with id '${onlyMetric}'\n`;
  const lines: string[] = [`metrics @ ${report.head.slice(0, 7)} (${report.generatedAt})`, ''];
  for (const m of metrics) {
    lines.push(`## ${m.id} [${m.unit}]`);
    lines.push(JSON.stringify(m.value, null, 2));
    lines.push(`formula: ${m.formula}`);
    lines.push(`blind spots: ${m.blindSpots.join(' | ')}`);
    lines.push('');
  }
  if (report.factsWarnings.length > 0) lines.push(`warnings: ${report.factsWarnings.join(' | ')}`);
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await compute(process.cwd());
  const outPath = args.jsonPath ?? join(process.cwd(), 'metrics.json');
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(formatReport(report, args.metric));
  process.stdout.write(`wrote ${outPath}\n`);
}

const isDirectRun = process.argv[1]?.endsWith('compute-cli.ts') || process.argv[1]?.endsWith('compute-cli.js');
if (isDirectRun) {
  main().catch((err) => {
    process.stderr.write(`metrics compute failed: ${String(err)}\n`);
    process.exit(1);
  });
}
```

(Match the direct-run guard idiom used by other `src/` entrypoints loaded via the CLI router — check one, e.g. `src/garden/sdd-report.ts` tail, and copy its exact pattern if it differs.)

- [ ] **Step 4: Register in manifest.** In `src/cli/manifest.ts`, add to `MANIFEST` (alphabetical position among groups):

```ts
  metrics: {
    desc: 'Effectiveness metrics derived from repo history',
    subs: {
      compute: {
        src: 'metrics/compute-cli.ts',
        desc: 'Derive all metrics → stdout table + metrics.json (--json <path>, --metric <id>)',
      },
    },
  },
```

- [ ] **Step 5: gitignore.** Append to `.gitignore`:

```
metrics.json
```

- [ ] **Step 6: Run to verify PASS + live smoke**

```bash
pnpm vitest run src/metrics/__tests__/compute-cli.test.ts && pnpm noldor metrics compute | head -30
```

Expected output: 3 tests passed; live run prints `metrics @ <sha>` header, six `## <id>` blocks each with `formula:` + `blind spots:`, ends `wrote .../metrics.json`. Exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/metrics/compute-cli.ts src/metrics/__tests__/compute-cli.test.ts src/cli/manifest.ts .gitignore
git commit -m "feat(metrics): noldor metrics compute CLI (stdout table + metrics.json)" -m "Noldor-FD: outcome-telemetry-and-effectiveness-metrics"
```

## Task 11: dashboard `/metrics` page

**Files:**
- Modify: `src/dashboard/server.ts`, `src/dashboard/data.ts`, `src/dashboard/views.ts`
- Test: `src/dashboard/__tests__/metrics-view.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/dashboard/__tests__/metrics-view.test.ts`:

```ts
// @tests: outcome-telemetry-and-effectiveness-metrics
import { describe, expect, it } from 'vitest';
import { renderMetrics } from '../views';
import type { MetricsReport } from '../../metrics/types';

const REPORT: MetricsReport = {
  generatedAt: '2026-06-12T00:00:00.000Z',
  head: 'abc1234',
  factsWarnings: [],
  metrics: [
    {
      id: 'cycle-time',
      unit: 'days',
      value: { medianDays: 4, p90Days: 9, medianByPath: { 'full-new': 5 }, excluded: { noIntake: 1, noTag: 0 } },
      formula: 'days(intake → release)',
      blindSpots: ['epoch-limited'],
      samples: [],
    },
  ],
};

describe('renderMetrics', () => {
  it('renders headline card, formula and blind spots', () => {
    const html = renderMetrics(REPORT);
    expect(html).toContain('cycle-time');
    expect(html).toContain('days(intake → release)');
    expect(html).toContain('epoch-limited');
  });
  it('renders the degraded state on null report', () => {
    expect(renderMetrics(null)).toContain('metrics unavailable');
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/dashboard/__tests__/metrics-view.test.ts
```

Expected output: failure — `renderMetrics` is not exported.

- [ ] **Step 3: Data loader.** In `src/dashboard/data.ts`, add (near the other loaders):

```ts
import { compute } from '../metrics/compute.js';
import type { MetricsReport } from '../metrics/types.js';

/** Fail-open: any compute error → null; the view renders a labeled degraded state. */
export async function loadMetricsReport(): Promise<MetricsReport | null> {
  try {
    return await compute(getDocRoot());
  } catch {
    return null;
  }
}
```

(`getDocRoot()` already exists in data.ts — it resolves the dashboard's docs/repo root override; verify it returns the repo root and if it returns `docs/`, use the existing repo-root helper next to it instead.)

- [ ] **Step 4: View.** In `src/dashboard/views.ts`, add:

```ts
import type { MetricsReport } from '../metrics/types.js';

export function renderMetrics(report: MetricsReport | null): string {
  if (!report) {
    return '<section class="card"><h2>Metrics</h2><p>metrics unavailable: compute failed — run <code>pnpm noldor metrics compute</code> for the error.</p></section>';
  }
  const cards = report.metrics
    .map((m) => {
      const blind = m.blindSpots.map((b) => `<li>${escapeHtml(b)}</li>`).join('');
      return [
        '<section class="card">',
        `<h2>${escapeHtml(m.id)} <small>[${escapeHtml(m.unit)}]</small></h2>`,
        `<pre>${escapeHtml(JSON.stringify(m.value, null, 2))}</pre>`,
        '<details><summary>formula + blind spots</summary>',
        `<p><strong>Formula:</strong> ${escapeHtml(m.formula)}</p>`,
        `<ul>${blind}</ul>`,
        '</details>',
        '</section>',
      ].join('\n');
    })
    .join('\n');
  const warnings =
    report.factsWarnings.length > 0
      ? `<p class="muted">warnings: ${escapeHtml(report.factsWarnings.join(' | '))}</p>`
      : '';
  return `<h1>Metrics</h1><p class="muted">head ${escapeHtml(report.head.slice(0, 7))} · ${escapeHtml(report.generatedAt)}</p>${warnings}${cards}`;
}
```

(`escapeHtml` — views.ts already has an HTML-escape helper; find its exact name with `grep -n "escapeHtml\|escape(" src/dashboard/views.ts` and use that. If none exists, add the standard 5-entity replacer above `renderMetrics`.)

- [ ] **Step 5: Route.** In `src/dashboard/server.ts` `matchRoute`, after the `/worktrees` line add:

```ts
    if (pathname === '/metrics') return { handler: handleMetrics, pathParams: {} };
```

and alongside the other handlers:

```ts
async function handleMetrics(): Promise<RouteResult> {
  const report = await loadMetricsReport();
  return {
    status: 200,
    body: renderMetrics(report),
    title: 'Metrics',
    activeNav: '/metrics',
  };
}
```

Import `loadMetricsReport` from `./data.js` and `renderMetrics` from `./views.js` next to the existing imports. Add a `metrics` entry to the nav model — find where `activeNav` keys map to the nav bar (grep `'worktrees'` in `layout.ts`/`views.ts`) and add `metrics` → `/metrics` beside it.

- [ ] **Step 6: Run to verify PASS + smoke**

```bash
pnpm vitest run src/dashboard && pnpm exec tsc --noEmit
```

Expected output: dashboard suites pass (existing + 2 new); tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/server.ts src/dashboard/data.ts src/dashboard/views.ts src/dashboard/__tests__/metrics-view.test.ts
git commit -m "feat(metrics): dashboard /metrics page (cards + formula/blind-spots expander)" -m "Noldor-FD: outcome-telemetry-and-effectiveness-metrics"
```

## Task 12: sdd-report section + docs

**Files:**
- Modify: `src/garden/sdd-report.ts`, `src/garden/sdd-report-format.ts`
- Create: `docs/noldor/metrics.md`
- Modify: `docs/noldor/script-catalog.md`
- Test: `src/garden/__tests__/sdd-report-metrics.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/garden/__tests__/sdd-report-metrics.test.ts`:

```ts
// @tests: outcome-telemetry-and-effectiveness-metrics
import { describe, expect, it } from 'vitest';
import { renderMetricsSection } from '../sdd-report-format';
import type { MetricsReport } from '../../metrics/types';

describe('renderMetricsSection', () => {
  it('renders headline lines with formulas', () => {
    const report: MetricsReport = {
      generatedAt: '2026-06-12T00:00:00.000Z',
      head: 'abc',
      factsWarnings: [],
      metrics: [
        { id: 'cycle-time', unit: 'days', value: { medianDays: 4 }, formula: 'f', blindSpots: ['b'], samples: [] },
      ],
    };
    const lines = renderMetricsSection(report);
    expect(lines[0]).toBe('## Metrics');
    expect(lines.join('\n')).toContain('cycle-time');
    expect(lines.join('\n')).toContain('formula: f');
  });
  it('degrades to a labeled unavailable line on null', () => {
    expect(renderMetricsSection(null)).toEqual(['## Metrics', '', 'metrics unavailable: compute failed', '']);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/garden/__tests__/sdd-report-metrics.test.ts
```

Expected output: failure — `renderMetricsSection` is not exported.

- [ ] **Step 3: Formatter.** In `src/garden/sdd-report-format.ts`, add:

```ts
import type { MetricsReport } from '../metrics/types.js';

/** Release-cut metrics snapshot. Null report (compute failure) degrades to a labeled line — never blocks release. */
export function renderMetricsSection(report: MetricsReport | null): string[] {
  if (!report) return ['## Metrics', '', 'metrics unavailable: compute failed', ''];
  const lines: string[] = ['## Metrics', ''];
  for (const m of report.metrics) {
    lines.push(`### ${m.id} [${m.unit}]`);
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(m.value, null, 2));
    lines.push('```');
    lines.push(`formula: ${m.formula}`);
    lines.push(`blind spots: ${m.blindSpots.join(' | ')}`);
    lines.push('');
  }
  return lines;
}
```

- [ ] **Step 4: Wire into the report.** `renderReportMd` (`src/garden/sdd-report.ts:1003`) is **synchronous** — do NOT `await` inside it. Three sub-edits:

(a) Add a trailing parameter `metricsReport: MetricsReport | null` to `renderReportMd`'s signature.

(b) Inside `renderReportMd`, immediately before the `lines.push('## Gap details')` line (~1057), insert:

```ts
  lines.push(...renderMetricsSection(metricsReport));
```

(c) In the async caller (~line 1183), before the `renderReportMd(...)` call, compute fail-open and pass it as the new argument:

```ts
  let metricsReport: MetricsReport | null = null;
  try {
    const { compute } = await import('../metrics/compute.js');
    metricsReport = await compute(process.cwd());
  } catch {
    metricsReport = null;
  }
```

Import `renderMetricsSection` from `./sdd-report-format.js` beside the existing `reviewSkipCountLine` import, and `type MetricsReport` from `../metrics/types.js`. Grep for other `renderReportMd(` call sites (tests included) and pass `null` there. (Dynamic import keeps sdd-report loadable even if metrics modules fail to resolve — fail-open by contract.)

- [ ] **Step 5: Run to verify PASS**

```bash
pnpm vitest run src/garden && pnpm exec tsc --noEmit
```

Expected output: garden suites pass (existing + 2 new); tsc clean.

- [ ] **Step 6: Docs.** Create `docs/noldor/metrics.md` — one `##` section per metric (cycle-time, routing-accuracy, cr-effectiveness, drain-reliability, override-pressure, tokens-per-feature), each with: **Formula** (copy the collector's `formula` string verbatim), **Sources**, **Blind spots** (copy the collector's `blindSpots` verbatim), **Epoch limits**. Open with the honesty-rails paragraph: "No metric without a documented formula; the collectors' `formula`/`blindSpots` fields are canonical — this page mirrors them." Close with a **Tokens** note: raw counts only, never cost; per-runner native usage records (claude-jsonl / codex-session / opencode-session); null = no data, never estimated. Add a `metrics compute` row to `docs/noldor/script-catalog.md` following the existing table format.

- [ ] **Step 7: Full verification**

```bash
pnpm vitest run && pnpm exec tsc --noEmit && pnpm noldor validate features
```

Expected output: full suite green; tsc clean; `Validated 39 feature MD(s) — all OK.`

- [ ] **Step 8: Commit**

```bash
git add src/garden/sdd-report.ts src/garden/sdd-report-format.ts src/garden/__tests__/sdd-report-metrics.test.ts docs/noldor/metrics.md docs/noldor/script-catalog.md
git commit -m "feat(metrics): sdd-report Metrics section + docs/noldor/metrics.md" -m "Noldor-FD: outcome-telemetry-and-effectiveness-metrics"
```
