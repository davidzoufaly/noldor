// @tests: noldor
import { describe, expect, it } from 'vitest';

import { extractFencedBlocks, lintSnippets } from '../lint-plan-snippets.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('extractFencedBlocks', () => {
  it('extracts a single fenced block with its language tag and line span', () => {
    const md = [
      'Some prose.',
      '',
      '```ts',
      'const x = 1;',
      'const y = 2;',
      '```',
      '',
      'More prose.',
      '',
    ].join('\n');
    const blocks = extractFencedBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      index: 0,
      lang: 'ts',
      content: 'const x = 1;\nconst y = 2;',
      startLine: 3,
      endLine: 6,
    });
  });

  it('extracts multiple blocks and assigns sequential indexes', () => {
    const md = ['```bash', 'echo a', '```', '', '```ts', 'const x = 1;', '```'].join('\n');
    const blocks = extractFencedBlocks(md);
    expect(blocks.map((b) => ({ index: b.index, lang: b.lang }))).toEqual([
      { index: 0, lang: 'bash' },
      { index: 1, lang: 'ts' },
    ]);
  });

  it('treats a block with no language tag as `lang: ""`', () => {
    const md = ['```', 'plain text', '```'].join('\n');
    const blocks = extractFencedBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lang).toBe('');
    expect(blocks[0].content).toBe('plain text');
  });

  it('ignores an unclosed fence (no terminating ```)', () => {
    const md = ['```ts', 'const x = 1;'].join('\n');
    expect(extractFencedBlocks(md)).toHaveLength(0);
  });

  it('returns an empty array when the markdown has no fences', () => {
    expect(extractFencedBlocks('just prose, no code')).toEqual([]);
  });
});

describe('rule R1 — strict-validator regex admits literal `-`', () => {
  it('flags `SHA_RE = /^[A-Za-z0-9._/-]+$/` (hyphen at end, position-literal)', () => {
    const md = ['```ts', 'const SHA_RE = /^[A-Za-z0-9._/-]+$/;', '```'].join('\n');
    const r1Findings = lintSnippets(md).filter((f) => f.rule === 'R1');
    expect(r1Findings).toHaveLength(1);
    expect(r1Findings[0].blockIndex).toBe(0);
    expect(r1Findings[0].message).toContain('SHA_RE');
    expect(r1Findings[0].message).toContain('`-`');
  });

  it('flags `ID_REGEX = /^[a-z0-9-]+$/` (suffix `_REGEX` variant)', () => {
    const md = ['```ts', 'const ID_REGEX = /^[a-z0-9-]+$/;', '```'].join('\n');
    expect(lintSnippets(md).filter((f) => f.rule === 'R1')).toHaveLength(1);
  });

  it('flags `TOKEN_RE = /^[-A-Z0-9]+$/` (hyphen at start, position-literal)', () => {
    const md = ['```ts', 'const TOKEN_RE = /^[-A-Z0-9]+$/;', '```'].join('\n');
    expect(lintSnippets(md).filter((f) => f.rule === 'R1')).toHaveLength(1);
  });

  it('flags `HASH_RE = /^[A-Z\\-0-9]+$/` (escaped hyphen mid-class)', () => {
    // The fenced ts block contains a literal `\-` — we write `\\-` here so
    // the JS string literal yields a single backslash followed by `-`.
    const md = ['```ts', 'const HASH_RE = /^[A-Z\\-0-9]+$/;', '```'].join('\n');
    expect(lintSnippets(md).filter((f) => f.rule === 'R1')).toHaveLength(1);
  });

  it('does NOT flag `SAFE_RE = /^[A-Za-z0-9_]+$/` (no hyphen at all, strict-named)', () => {
    const md = ['```ts', 'const SAFE_RE = /^[A-Za-z0-9_]+$/;', '```'].join('\n');
    expect(lintSnippets(md).filter((f) => f.rule === 'R1')).toHaveLength(0);
  });

  it('does NOT flag `HEX_RE = /^[A-Fa-f0-9]{40}$/` (canonical SHA validator, strict-named, no hyphen)', () => {
    const md = ['```ts', 'const HEX_RE = /^[A-Fa-f0-9]{40}$/;', '```'].join('\n');
    expect(lintSnippets(md).filter((f) => f.rule === 'R1')).toHaveLength(0);
  });

  it('does NOT flag `RANGE_RE = /^[A-Z]+$/` (range operator, no literal hyphen, strict-named)', () => {
    const md = ['```ts', 'const RANGE_RE = /^[A-Z]+$/;', '```'].join('\n');
    expect(lintSnippets(md).filter((f) => f.rule === 'R1')).toHaveLength(0);
  });

  it('does NOT flag a regex whose binding name is not strict-validator-shaped', () => {
    const md = ['```ts', 'const looseMatcher = /[a-z0-9-]+/;', '```'].join('\n');
    expect(lintSnippets(md).filter((f) => f.rule === 'R1')).toHaveLength(0);
  });

  it('emits one finding per flagged binding when multiple appear in one block', () => {
    const md = [
      '```ts',
      'const SHA_RE = /^[A-Za-z0-9._/-]+$/;',
      'const ID_REGEX = /^[a-z0-9-]+$/;',
      '```',
    ].join('\n');
    const r1Findings = lintSnippets(md).filter((f) => f.rule === 'R1');
    expect(r1Findings).toHaveLength(2);
    expect(r1Findings[0].message).toContain('SHA_RE');
    expect(r1Findings[1].message).toContain('ID_REGEX');
  });

  it('fires on `js` fenced blocks as well as `ts`', () => {
    const md = ['```js', 'const SHA_RE = /^[A-Za-z0-9._/-]+$/;', '```'].join('\n');
    const r1Findings = lintSnippets(md).filter((f) => f.rule === 'R1');
    expect(r1Findings).toHaveLength(1);
    expect(r1Findings[0].lang).toBe('js');
  });
});

describe('rule R2 — `git commit --amend --no-edit` with message-providing flag', () => {
  it('flags `git commit --amend --no-edit -F MSG`', () => {
    const md = ['```bash', 'git commit --amend --no-edit -F .git/COMMIT_MSG', '```'].join('\n');
    const findings = lintSnippets(md).filter((f) => f.rule === 'R2');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('--no-edit');
    expect(findings[0].message).toContain('-F');
  });

  it('flags `git commit --amend -m "msg" --no-edit`', () => {
    const md = ['```bash', 'git commit --amend -m "msg" --no-edit', '```'].join('\n');
    expect(lintSnippets(md).filter((f) => f.rule === 'R2')).toHaveLength(1);
  });

  it('flags `git commit --amend --file=MSG --no-edit`', () => {
    const md = ['```bash', 'git commit --amend --file=MSG --no-edit', '```'].join('\n');
    expect(lintSnippets(md).filter((f) => f.rule === 'R2')).toHaveLength(1);
  });

  it('does NOT flag `git commit --amend --no-edit` alone', () => {
    const md = ['```bash', 'git commit --amend --no-edit', '```'].join('\n');
    expect(lintSnippets(md).filter((f) => f.rule === 'R2')).toHaveLength(0);
  });

  it('does NOT flag `git commit -m "msg"` (no amend, no no-edit)', () => {
    const md = ['```bash', 'git commit -m "msg"', '```'].join('\n');
    expect(lintSnippets(md).filter((f) => f.rule === 'R2')).toHaveLength(0);
  });

  it('does NOT flag a git commit invocation inside a quoted echo string', () => {
    const md = ['```bash', 'echo "git commit --amend --no-edit -F MSG"', '```'].join('\n');
    expect(lintSnippets(md).filter((f) => f.rule === 'R2')).toHaveLength(0);
  });
});

describe('CLI', () => {
  // pnpm --silent normalises any non-zero exit to 1, so we invoke tsx directly
  // via pnpm exec to get the real exit code from the script.
  const rootDir = new URL('../../..', import.meta.url).pathname;
  function runCli(artifact: string, extraArgs: string[] = []): { stdout: string; status: number } {
    try {
      const stdout = execFileSync(
        'pnpm',
        ['exec', 'tsx', join(rootDir, 'src/core/lint-plan-snippets.ts'), artifact, ...extraArgs],
        {
          encoding: 'utf8',
          cwd: rootDir,
        },
      );
      return { stdout, status: 0 };
    } catch (err) {
      const e = err as { stdout?: Buffer | string; status?: number };
      const stdout = typeof e.stdout === 'string' ? e.stdout : (e.stdout?.toString() ?? '');
      return { stdout, status: e.status ?? 1 };
    }
  }

  it('exits 0 with empty output for a clean artifact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lint-clean-'));
    const path = join(dir, 'plan.md');
    writeFileSync(path, '```ts\nconst x = 1;\n```\n');
    const { stdout, status } = runCli(path);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe('');
  });

  it('exits 2 and prints findings for an artifact with R1 + R2 violations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lint-dirty-'));
    const path = join(dir, 'plan.md');
    writeFileSync(
      path,
      [
        '```ts',
        'const SHA_RE = /^[A-Za-z0-9._/-]+$/;',
        '```',
        '',
        '```bash',
        'git commit --amend --no-edit -F MSG',
        '```',
      ].join('\n'),
    );
    const { stdout, status } = runCli(path);
    expect(status).toBe(2);
    expect(stdout).toContain('R1');
    expect(stdout).toContain('R2');
  });

  it('emits JSON when --json is passed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lint-json-'));
    const path = join(dir, 'plan.md');
    writeFileSync(path, '```ts\nconst SHA_RE = /^[A-Za-z0-9._/-]+$/;\n```\n');
    const { stdout, status } = runCli(path, ['--json']);
    expect(status).toBe(2);
    const parsed = JSON.parse(stdout) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
    expect((parsed as Array<{ rule: string }>)[0].rule).toBe('R1');
  });

  it('exits 1 with a usage message when no artifact path is supplied', () => {
    const { stdout, status } = runCli('--json');
    expect(status).toBe(1);
    expect(stdout.toLowerCase()).toContain('usage');
  });

  it('emits `[]` and exits 0 when --json runs against a clean artifact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lint-json-clean-'));
    const path = join(dir, 'plan.md');
    writeFileSync(path, '```ts\nconst x = 1;\n```\n');
    const { stdout, status } = runCli(path, ['--json']);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
    expect((parsed as unknown[]).length).toBe(0);
  });
});
