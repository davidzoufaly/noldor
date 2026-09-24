// @tests: scaffold-one-agent-rules-file-not-two
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const BIN = resolve(__dirname, '../../../bin/noldor.mjs');
/** Run `init` from the src tree under test, not a possibly stale `dist`. */
const env = { ...process.env, NOLDOR_RUNTIME: 'source' };

const START = '<!-- noldor:rules:start -->';
const END = '<!-- noldor:rules:end -->';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function consumer(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-init-agents-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'package.json'), '{"name":"c","version":"0.0.1","private":true}\n');
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(dir, rel), content);
  const git = (...args: string[]): void => void execFileSync('git', args, { cwd: dir });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  return dir;
}

function init(dir: string, ...flags: string[]) {
  return spawnSync('node', [BIN, 'init', ...flags], { cwd: dir, encoding: 'utf8', env });
}

describe('noldor init writes one agent-rules file', () => {
  it('scaffolds AGENTS.md for the default claude target, and no CLAUDE file', () => {
    const dir = consumer();
    expect(init(dir).status).toBe(0);
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    expect(agents).toContain(`\n${START}\n`);
    expect(agents).toContain(`\n${END}\n`);
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(dir, '.claude/CLAUDE.md'))).toBe(false);
    expect(existsSync(join(dir, '.claude/noldor.md'))).toBe(false);
  });

  it('appends the region to an AGENTS.md the repo already has, and reports a hiding CLAUDE.md without editing it', () => {
    const own = '# Our agent rules\n\nUse tabs.\n';
    const claude = '# Project\n';
    const dir = consumer({ 'AGENTS.md': own, 'CLAUDE.md': claude });
    const run = init(dir);
    expect(run.status).toBe(0);
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    expect(agents.startsWith(own)).toBe(true);
    expect(agents.endsWith(`${END}\n`)).toBe(true);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe(claude);
    expect(run.stdout).toMatch(/unwired\s+CLAUDE\.md imports no AGENTS\.md/);
  });

  it('refuses a drifted region without --update, then replaces only the region with it', () => {
    const drifted = `# Ours\n${START}\nstale framework text\n${END}\nour tail\n`;
    const dir = consumer({ 'AGENTS.md': drifted });

    const refused = init(dir);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('AGENTS.md');
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(drifted);

    expect(init(dir, '--update').status).toBe(0);
    const updated = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    expect(updated.startsWith(`# Ours\n${START}\n`)).toBe(true);
    expect(updated.endsWith(`${END}\nour tail\n`)).toBe(true);
    expect(updated).not.toContain('stale framework text');
  });
});
