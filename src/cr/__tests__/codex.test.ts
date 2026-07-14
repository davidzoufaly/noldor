// @tests: acceptance-verify-lane, noldor, specs-cr-gate-multi-reviewer
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runCli } from '../codex.js';
import { findingSchema } from '../findings-schema.js';

function makeRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'cr-codex-cli-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd });
  spawnSync('git', ['config', 'user.email', 'a@b'], { cwd });
  spawnSync('git', ['config', 'user.name', 'a'], { cwd });
  writeFileSync(join(cwd, 'a.ts'), 'export const x = 1\n');
  spawnSync('git', ['add', '.'], { cwd });
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd });
  return cwd;
}

const passing = JSON.stringify({ blockers: [], suggestions: [], summary: 'ok' });
const blocker = JSON.stringify({
  blockers: [{ file: 'a.ts', message: 'bug', line: null, severity: null, suggestion: null }],
  suggestions: [],
  summary: 'no',
});

describe('runCli', () => {
  it('gate lane writes trailer when codex returns zero blockers', async () => {
    const cwd = makeRepo();
    const code = await runCli({
      argv: [],
      cwd,
      spawn: async () => ({ stdout: passing, exitCode: 0 }),
    });
    expect(code).toBe(0);
    const msg = spawnSync('git', ['show', '-s', '--format=%B', 'HEAD'], {
      cwd,
      encoding: 'utf8',
    }).stdout;
    expect(msg).toMatch(/Noldor-Reviewed-Codex: [a-f0-9]{40}/);
  });

  it('gate lane: blocker output → no trailer, exit 1', async () => {
    const cwd = makeRepo();
    const code = await runCli({
      argv: [],
      cwd,
      spawn: async () => ({ stdout: blocker, exitCode: 0 }),
    });
    expect(code).toBe(1);
    const msg = spawnSync('git', ['show', '-s', '--format=%B', 'HEAD'], {
      cwd,
      encoding: 'utf8',
    }).stdout;
    expect(msg).not.toMatch(/Noldor-Reviewed-Codex/);
  });

  it('--dry-run never writes a trailer even on pass', async () => {
    const cwd = makeRepo();
    const code = await runCli({
      argv: ['--dry-run'],
      cwd,
      spawn: async () => ({ stdout: passing, exitCode: 0 }),
    });
    expect(code).toBe(0);
    const msg = spawnSync('git', ['show', '-s', '--format=%B', 'HEAD'], {
      cwd,
      encoding: 'utf8',
    }).stdout;
    expect(msg).not.toMatch(/Noldor-Reviewed-Codex/);
    const dir = join(cwd, '.noldor', 'cr-records');
    expect(existsSync(dir) ? readdirSync(dir).length : 0).toBe(0);
  });

  it('gate lane skips when trailer already present and --rerun absent', async () => {
    const cwd = makeRepo();
    // First run lands the trailer
    await runCli({ argv: [], cwd, spawn: async () => ({ stdout: passing, exitCode: 0 }) });
    // Second run without --rerun → should skip
    let spawnCount = 0;
    const code = await runCli({
      argv: [],
      cwd,
      spawn: async () => {
        spawnCount++;
        return { stdout: passing, exitCode: 0 };
      },
    });
    expect(code).toBe(0);
    expect(spawnCount).toBe(0);
  });

  it('gate lane re-runs when --rerun is passed', async () => {
    const cwd = makeRepo();
    await runCli({ argv: [], cwd, spawn: async () => ({ stdout: passing, exitCode: 0 }) });
    let spawnCount = 0;
    const code = await runCli({
      argv: ['--rerun'],
      cwd,
      spawn: async () => {
        spawnCount++;
        return { stdout: passing, exitCode: 0 };
      },
    });
    expect(code).toBe(0);
    expect(spawnCount).toBe(1);
  });

  it('--working writes a working- prefixed sidecar, no trailer', async () => {
    const cwd = makeRepo();
    const code = await runCli({
      argv: ['--working'],
      cwd,
      spawn: async () => ({ stdout: passing, exitCode: 0 }),
    });
    expect(code).toBe(0);
    const dir = join(cwd, '.noldor', 'cr-records');
    const files = existsSync(dir) ? readdirSync(dir) : [];
    expect(files.some((f: string) => f.startsWith('working-'))).toBe(true);
    const msg = spawnSync('git', ['show', '-s', '--format=%B', 'HEAD'], {
      cwd,
      encoding: 'utf8',
    }).stdout;
    expect(msg).not.toMatch(/Noldor-Reviewed-Codex/);
  });

  it('positional <sha> never amends', async () => {
    const cwd = makeRepo();
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).stdout.trim();
    const code = await runCli({
      argv: [head],
      cwd,
      spawn: async () => ({ stdout: passing, exitCode: 0 }),
    });
    expect(code).toBe(0);
    const msg = spawnSync('git', ['show', '-s', '--format=%B', 'HEAD'], {
      cwd,
      encoding: 'utf8',
    }).stdout;
    expect(msg).not.toMatch(/Noldor-Reviewed-Codex/);
  });
});

function captureStdout(): { restore: () => void; text: () => string } {
  let buf = '';
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    buf += typeof chunk === 'string' ? chunk : String(chunk);
    return true;
  });
  return { restore: () => spy.mockRestore(), text: () => buf };
}

describe('runCli — plan/spec review mode', () => {
  const planBlocker = JSON.stringify({
    blockers: [
      {
        file: 'plan.md',
        message: 'no acceptance criteria',
        line: 4,
        severity: null,
        suggestion: null,
      },
    ],
    suggestions: [
      {
        file: 'plan.md',
        message: 'clarify scope',
        line: null,
        severity: 'medium',
        suggestion: 'add a scope bullet',
      },
    ],
    summary: 'plan needs work',
  });

  it('--plan prints {summary, findings} to stdout and exits 0 even with blockers', async () => {
    const cwd = makeRepo();
    writeFileSync(join(cwd, 'plan.md'), '# Plan\n\n## Steps\n- do thing\n');
    const cap = captureStdout();
    let code: number;
    try {
      code = await runCli({
        argv: ['--plan', 'plan.md', '--slug', 'my-feat'],
        cwd,
        spawn: async () => ({ stdout: planBlocker, exitCode: 0 }),
      });
    } finally {
      cap.restore();
    }
    expect(code).toBe(0);
    const out = JSON.parse(cap.text());
    expect(out.summary).toBe('plan needs work');
    // blocker maps to severity 'high'; suggestion stays non-high so the lane keeps it a suggestion
    const high = out.findings.filter((f: { severity: string }) => f.severity === 'high');
    const nonHigh = out.findings.filter((f: { severity: string }) => f.severity !== 'high');
    expect(high).toHaveLength(1);
    expect(high[0]).toMatchObject({ file: 'plan.md', message: 'no acceptance criteria', line: 4 });
    expect(nonHigh).toHaveLength(1);
    expect(nonHigh[0].severity).toBe('med');
  });

  it('--plan feeds the artifact content into the codex prompt', async () => {
    const cwd = makeRepo();
    writeFileSync(join(cwd, 'plan.md'), 'UNIQUE-PLAN-MARKER');
    const cap = captureStdout();
    let captured = '';
    try {
      await runCli({
        argv: ['--plan', 'plan.md'],
        cwd,
        spawn: async ({ stdin }) => {
          captured = stdin;
          return { stdout: passing, exitCode: 0 };
        },
      });
    } finally {
      cap.restore();
    }
    expect(captured).toContain('UNIQUE-PLAN-MARKER');
    expect(captured).toMatch(/Plan to review/);
  });

  it('--plan never amends a trailer and never writes a CrRecord sidecar', async () => {
    const cwd = makeRepo();
    writeFileSync(join(cwd, 'plan.md'), '# Plan');
    const cap = captureStdout();
    try {
      await runCli({
        argv: ['--plan', 'plan.md'],
        cwd,
        spawn: async () => ({ stdout: passing, exitCode: 0 }),
      });
    } finally {
      cap.restore();
    }
    const msg = spawnSync('git', ['show', '-s', '--format=%B', 'HEAD'], {
      cwd,
      encoding: 'utf8',
    }).stdout;
    expect(msg).not.toMatch(/Noldor-Reviewed-Codex/);
    const dir = join(cwd, '.noldor', 'cr-records');
    expect(existsSync(dir) ? readdirSync(dir).length : 0).toBe(0);
  });

  it('--base-sha scopes the prompt to the artifact diff since that sha', async () => {
    const cwd = makeRepo();
    writeFileSync(join(cwd, 'plan.md'), 'ORIGINAL LINE\n');
    spawnSync('git', ['add', 'plan.md'], { cwd });
    spawnSync('git', ['commit', '-q', '-m', 'add plan'], { cwd });
    const base = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).stdout.trim();
    writeFileSync(join(cwd, 'plan.md'), 'ORIGINAL LINE\nNEWLY ADDED LINE\n');
    spawnSync('git', ['add', 'plan.md'], { cwd });
    spawnSync('git', ['commit', '-q', '-m', 'edit plan'], { cwd });
    const cap = captureStdout();
    let captured = '';
    try {
      await runCli({
        argv: ['--plan', 'plan.md', '--base-sha', base],
        cwd,
        spawn: async ({ stdin }) => {
          captured = stdin;
          return { stdout: passing, exitCode: 0 };
        },
      });
    } finally {
      cap.restore();
    }
    expect(captured).toContain('NEWLY ADDED LINE');
    expect(captured).toMatch(/diff --git|^\+NEWLY/m);
  });

  it('--help prints usage advertising --base-sha and exits 0', async () => {
    const cwd = makeRepo();
    const cap = captureStdout();
    let code: number;
    try {
      code = await runCli({
        argv: ['--help'],
        cwd,
        spawn: async () => ({ stdout: passing, exitCode: 0 }),
      });
    } finally {
      cap.restore();
    }
    expect(code).toBe(0);
    expect(cap.text()).toMatch(/--base-sha/);
    expect(cap.text()).toMatch(/--plan/);
  });

  it('--base-sha with a bad sha emits a synthetic blocker and still exits 0', async () => {
    const cwd = makeRepo();
    writeFileSync(join(cwd, 'plan.md'), '# Plan');
    spawnSync('git', ['add', 'plan.md'], { cwd });
    spawnSync('git', ['commit', '-q', '-m', 'add plan'], { cwd });
    const cap = captureStdout();
    let code: number;
    try {
      code = await runCli({
        argv: ['--plan', 'plan.md', '--base-sha', 'deadbeefnope'],
        cwd,
        spawn: async () => ({ stdout: passing, exitCode: 0 }),
      });
    } finally {
      cap.restore();
    }
    expect(code).toBe(0);
    const out = JSON.parse(cap.text());
    expect(out.findings.some((f: { severity: string }) => f.severity === 'high')).toBe(true);
    for (const f of out.findings) expect(findingSchema.safeParse(f).success).toBe(true);
  });

  it('defaults a document-level finding with an empty file to the artifact path', async () => {
    const cwd = makeRepo();
    writeFileSync(join(cwd, 'plan.md'), '# Plan');
    const emptyFile = JSON.stringify({
      blockers: [
        { file: '', message: 'doc-level gap', line: null, severity: null, suggestion: null },
      ],
      suggestions: [],
      summary: 's',
    });
    const cap = captureStdout();
    try {
      await runCli({
        argv: ['--plan', 'plan.md'],
        cwd,
        spawn: async () => ({ stdout: emptyFile, exitCode: 0 }),
      });
    } finally {
      cap.restore();
    }
    const out = JSON.parse(cap.text());
    expect(out.findings[0].file).toBe('plan.md');
    // every emitted finding must satisfy the consumer's findings-schema
    for (const f of out.findings) expect(findingSchema.safeParse(f).success).toBe(true);
  });

  it('coerces empty message/summary so the consumer min(1) schemas never reject', async () => {
    const cwd = makeRepo();
    writeFileSync(join(cwd, 'plan.md'), '# Plan');
    const emptyText = JSON.stringify({
      blockers: [{ file: 'plan.md', message: '', line: null, severity: null, suggestion: null }],
      suggestions: [],
      summary: '',
    });
    const cap = captureStdout();
    try {
      await runCli({
        argv: ['--plan', 'plan.md'],
        cwd,
        spawn: async () => ({ stdout: emptyText, exitCode: 0 }),
      });
    } finally {
      cap.restore();
    }
    const out = JSON.parse(cap.text());
    expect(out.summary.length).toBeGreaterThan(0);
    expect(out.findings[0].message.length).toBeGreaterThan(0);
    for (const f of out.findings) expect(findingSchema.safeParse(f).success).toBe(true);
  });
});

describe('runCli — engineering-rules fallback', () => {
  async function capturePrompt(cwd: string): Promise<string> {
    writeFileSync(join(cwd, 'plan.md'), '# Plan\n');
    const cap = captureStdout();
    let captured = '';
    try {
      await runCli({
        argv: ['--plan', 'plan.md'],
        cwd,
        spawn: async ({ stdin }) => {
          captured = stdin;
          return { stdout: passing, exitCode: 0 };
        },
      });
    } finally {
      cap.restore();
    }
    return captured;
  }

  it('falls back to AGENTS.md when .claude/engineering-rules.md is absent', async () => {
    const cwd = makeRepo();
    writeFileSync(join(cwd, 'AGENTS.md'), 'AGENTS-RULES-MARKER\n');
    const prompt = await capturePrompt(cwd);
    expect(prompt).toContain('AGENTS-RULES-MARKER');
  });

  it('prefers .claude/engineering-rules.md over AGENTS.md when both exist', async () => {
    const cwd = makeRepo();
    mkdirSync(join(cwd, '.claude'), { recursive: true });
    writeFileSync(join(cwd, '.claude', 'engineering-rules.md'), 'CLAUDE-RULES-MARKER\n');
    writeFileSync(join(cwd, 'AGENTS.md'), 'AGENTS-RULES-MARKER\n');
    const prompt = await capturePrompt(cwd);
    expect(prompt).toContain('CLAUDE-RULES-MARKER');
    expect(prompt).not.toContain('AGENTS-RULES-MARKER');
  });
});
