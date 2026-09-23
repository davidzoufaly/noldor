// @tests: noldor, spec-stage-cr-stopping-rule, refutation-judge-pass-before-a-blocker-can-red-a-round
import { execFile, execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const CLI = resolve(__dirname, '..', 'aggregate-cli.ts');
const FIX = resolve(__dirname, 'fixtures');
// Use repo-local tsx binary directly. `pnpm exec tsx` errors when invoked from
// a cwd outside the pnpm workspace (the test tmp dir).
const TSX = resolve(__dirname, '..', '..', '..', 'node_modules', '.bin', 'tsx');

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agg-cli-'));
  await mkdir(join(root, '.noldor', 'cr'), { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('aggregate CLI', () => {
  it('prints a refuted blocker with its reason and evidence, and never gates on it (Q-0262)', async () => {
    await writeFile(
      join(root, '.noldor', 'cr', 'x-code-codex.json'),
      JSON.stringify({
        lane: 'codex',
        artifact: 'src/a.ts',
        kind: 'code',
        slug: 'x',
        blockers: [],
        suggestions: [],
        refuted: [
          {
            finding: { file: 'src/a.ts', severity: 'high', message: 'run never checks retries' },
            why: 'run returns early unless retries is positive',
            evidence: [{ file: 'src/a.ts', line: 3, quote: 'if (retries > 0) return retry();' }],
          },
        ],
        summary: 'blockers found — judge refuted 1 of 1',
        startedAt: '2026-09-23T00:00:00.000Z',
        finishedAt: '2026-09-23T00:00:05.000Z',
      }),
    );
    const r = await exec(TSX, [CLI, '--slug', 'x', '--kind', 'code'], { cwd: root });
    expect(r.stdout).toMatch(/ok=true/);
    expect(r.stdout).toMatch(
      /refuted.*\[high\] codex src\/a\.ts: run never checks retries.*run returns early unless retries is positive.*src\/a\.ts:3/,
    );
  });

  it('exits 0 when clean', async () => {
    await copyFile(
      join(FIX, 'findings-clean.json'),
      join(root, '.noldor', 'cr', 'x-spec-manual.json'),
    );
    const r = await exec(TSX, [CLI, '--slug', 'x', '--kind', 'spec'], {
      cwd: root,
    });
    expect(r.stdout).toMatch(/manual.*operator approved/);
  });
  it('exits 1 when blockers', async () => {
    await copyFile(
      join(FIX, 'findings-blockers.json'),
      join(root, '.noldor', 'cr', 'x-spec-reviewer.json'),
    );
    await expect(
      exec(TSX, [CLI, '--slug', 'x', '--kind', 'spec'], { cwd: root }),
    ).rejects.toMatchObject({ code: 1 });
  });
  it("prints a spec blocker's basis beside its severity, and nothing for a blocker without one (Q-0263)", async () => {
    const blocker = (message: string, basis?: string) => ({
      file: 'docs/design/specs/x.md',
      severity: 'high',
      message,
      ...(basis ? { basis } : {}),
    });
    await writeFile(
      join(root, '.noldor', 'cr', 'x-spec-reviewer.json'),
      JSON.stringify({
        lane: 'reviewer',
        artifact: 'docs/design/specs/x.md',
        kind: 'spec',
        slug: 'x',
        blockers: [
          blocker('the design needs a hook that does not exist', 'feasibility'),
          blocker('old sink'),
        ],
        suggestions: [],
        summary: 'blockers found (2)',
        startedAt: '2026-09-23T00:00:00.000Z',
        finishedAt: '2026-09-23T00:00:05.000Z',
      }),
    );
    await expect(
      exec(TSX, [CLI, '--slug', 'x', '--kind', 'spec'], { cwd: root }),
    ).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringMatching(
        /\[high\]\[feasibility\] reviewer docs\/design\/specs\/x\.md: the design needs a hook[\s\S]*\[high\] reviewer docs\/design\/specs\/x\.md: old sink/,
      ),
    });
  });

  // The gate's kind-less "wait for in-flight lanes" step asks whether a lane is
  // still writing, not whether its verdict was green. A spec sink left red by a
  // fix-and-proceed at the re-round cap used to re-red that step and force a
  // manual override on every such session.
  describe('--unresolved-only (Q-0154)', () => {
    it('exits 0 on a finished-but-red sink, still printing the finding', async () => {
      await copyFile(
        join(FIX, 'findings-blockers.json'),
        join(root, '.noldor', 'cr', 'x-spec-reviewer.json'),
      );
      const r = await exec(TSX, [CLI, '--slug', 'x', '--unresolved-only'], { cwd: root });
      expect(r.stdout).toMatch(/missing type/);
      expect(r.stdout).toMatch(/ok=true/);
      expect(r.stdout).toMatch(/1 lane finding\(s\) above do NOT gate/);
    });
    it('exits 1 while a lane is still unresolved', async () => {
      await copyFile(
        join(FIX, 'findings-in-progress.json'),
        join(root, '.noldor', 'cr', 'x-spec-standalone.json'),
      );
      await expect(
        exec(TSX, [CLI, '--slug', 'x', '--unresolved-only'], { cwd: root }),
      ).rejects.toMatchObject({ code: 1 });
    });
    it('exits 1 on an untrustworthy sink — integrity is never muted', async () => {
      await writeFile(join(root, '.noldor', 'cr', 'x-spec-manual.json'), '{not json', 'utf8');
      await expect(
        exec(TSX, [CLI, '--slug', 'x', '--unresolved-only'], { cwd: root }),
      ).rejects.toMatchObject({ code: 1 });
    });
    it('exits 1 on a corrupt expected-lanes record — the Q-0100 hole stays closed', async () => {
      const dir = join(root, '.noldor', 'cr', 'expected');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'x-spec.json'), '{not json', 'utf8');
      await expect(
        exec(TSX, [CLI, '--slug', 'x', '--unresolved-only'], { cwd: root }),
      ).rejects.toMatchObject({ code: 1 });
    });
  });

  // The deletion test for Q-0211: a green sink written against a tree the
  // checkout has moved past must not exit 0 as if it were current.
  describe('stale round (Q-0211)', () => {
    let repo: string;
    const git = (args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

    beforeEach(async () => {
      repo = await mkdtemp(join(tmpdir(), 'agg-cli-stale-'));
      git(['init', '-q', '-b', 'main']);
      git(['config', 'user.email', 't@example.com']);
      git(['config', 'user.name', 'T']);
      await writeFile(join(repo, 'a.txt'), 'one\n', 'utf8');
      git(['add', '-A']);
      git(['commit', '-qm', 'base']);

      const expectedDir = join(repo, '.noldor', 'cr', 'expected');
      await mkdir(expectedDir, { recursive: true });
      await writeFile(
        join(expectedDir, 'x-code.json'),
        JSON.stringify({
          slug: 'x',
          kind: 'code',
          lanes: ['manual'],
          headSha: git(['rev-parse', 'HEAD']).trim(),
        }),
        'utf8',
      );
      await copyFile(
        join(FIX, 'findings-clean.json'),
        join(repo, '.noldor', 'cr', 'x-code-manual.json'),
      );
      // The commit the round never saw.
      await writeFile(join(repo, 'a.txt'), 'two\n', 'utf8');
      git(['commit', '-aqm', 'fix applied after the round']);
    });
    afterEach(async () => {
      await rm(repo, { recursive: true, force: true });
    });

    it('exits 1 and names the drift, though every sink is green', async () => {
      await expect(
        exec(TSX, [CLI, '--slug', 'x', '--kind', 'code'], { cwd: repo }),
      ).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('stale code round') });
    });

    it('exits 0 under --unresolved-only, still printing it', async () => {
      // The gate's kind-less drain step runs long after implementation commits
      // moved the tree — gating there would re-red every session.
      const r = await exec(TSX, [CLI, '--slug', 'x', '--unresolved-only'], { cwd: repo });
      expect(r.stdout).toMatch(/stale code round/);
      expect(r.stdout).toMatch(/ok=true/);
      expect(r.stdout).toMatch(/1 stale round\(s\) above do NOT gate either/);
    });
  });
});
