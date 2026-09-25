import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { computeDrift } from '../diff.js';
import { copyTemplate, adoptTemplate } from '../copy.js';
import { templateFiles, TEMPLATES_ROOT, SCAFFOLD_ONLY_TEMPLATES } from '../manifest.js';
import { filterTemplatesByAgents } from '../agent-filter.js';
import { parse as parseYaml } from 'yaml';

// @tests: noldor-package-lift, self-refreshing-compact-knowledge-graph

describe('computeDrift', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'noldor-drift-'));
    mkdirSync(join(dir, 'tpl'));
    mkdirSync(join(dir, 'consumer'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('unchanged when content matches', () => {
    writeFileSync(join(dir, 'tpl', 'a.md'), 'hi');
    writeFileSync(join(dir, 'consumer', 'a.md'), 'hi');
    expect(computeDrift(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md'])).toEqual([
      { path: 'a.md', status: 'unchanged' },
    ]);
  });

  it('drifted when content differs', () => {
    writeFileSync(join(dir, 'tpl', 'a.md'), 'hi');
    writeFileSync(join(dir, 'consumer', 'a.md'), 'mod');
    expect(computeDrift(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md'])).toEqual([
      { path: 'a.md', status: 'drifted' },
    ]);
  });

  it('missing when consumer file absent', () => {
    writeFileSync(join(dir, 'tpl', 'a.md'), 'hi');
    expect(computeDrift(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md'])).toEqual([
      { path: 'a.md', status: 'missing' },
    ]);
  });
});

describe('copyTemplate', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'noldor-copy-'));
    mkdirSync(join(dir, 'tpl'));
    mkdirSync(join(dir, 'consumer'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('adds new files', () => {
    writeFileSync(join(dir, 'tpl', 'a.md'), 'hi');
    const out = copyTemplate(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md'], { update: false });
    expect(out).toEqual([{ path: 'a.md', status: 'added' }]);
    expect(readFileSync(join(dir, 'consumer', 'a.md'), 'utf8')).toBe('hi');
  });

  it('refuses overwrite without --update', () => {
    writeFileSync(join(dir, 'tpl', 'a.md'), 'hi');
    writeFileSync(join(dir, 'consumer', 'a.md'), 'old');
    expect(() =>
      copyTemplate(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md'], { update: false }),
    ).toThrow(/Refusing to overwrite/);
  });

  it('updates when --update', () => {
    writeFileSync(join(dir, 'tpl', 'a.md'), 'hi');
    writeFileSync(join(dir, 'consumer', 'a.md'), 'old');
    const out = copyTemplate(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md'], { update: true });
    expect(out).toEqual([{ path: 'a.md', status: 'updated' }]);
    expect(readFileSync(join(dir, 'consumer', 'a.md'), 'utf8')).toBe('hi');
  });

  it('reports unchanged when content already matches', () => {
    writeFileSync(join(dir, 'tpl', 'a.md'), 'hi');
    writeFileSync(join(dir, 'consumer', 'a.md'), 'hi');
    const out = copyTemplate(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md'], { update: true });
    expect(out).toEqual([{ path: 'a.md', status: 'unchanged' }]);
  });

  it('enumerates ALL conflicts at once and writes nothing when aborting', () => {
    for (const f of ['a.md', 'b.md', 'c.md']) {
      writeFileSync(join(dir, 'tpl', f), 'new');
    }
    writeFileSync(join(dir, 'consumer', 'a.md'), 'old'); // conflict
    writeFileSync(join(dir, 'consumer', 'b.md'), 'old'); // conflict
    // c.md absent → would be added, but the abort must not write it
    let msg = '';
    try {
      copyTemplate(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md', 'b.md', 'c.md'], {
        update: false,
      });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/Refusing to overwrite 2 existing file/);
    expect(msg).toContain('a.md');
    expect(msg).toContain('b.md');
    // no partial write: the would-be-added c.md was not created
    expect(existsSync(join(dir, 'consumer', 'c.md'))).toBe(false);
  });
});

describe('adoptTemplate', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'noldor-adopt-'));
    mkdirSync(join(dir, 'tpl'));
    mkdirSync(join(dir, 'consumer'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('copies consumer files INTO templates dir', () => {
    writeFileSync(join(dir, 'consumer', 'a.md'), 'canonical');
    adoptTemplate(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md']);
    expect(readFileSync(join(dir, 'tpl', 'a.md'), 'utf8')).toBe('canonical');
  });

  it('skips paths absent from the consumer', () => {
    adoptTemplate(join(dir, 'tpl'), join(dir, 'consumer'), ['a.md']);
    expect(existsSync(join(dir, 'tpl', 'a.md'))).toBe(false);
  });
});

describe('.claude/settings.json template (consumer edit-gating)', () => {
  const rel = '.claude/settings.json';

  it('ships in the template manifest', () => {
    expect(templateFiles()).toContain(rel);
  });

  it('is scaffold-only (consumer owns it; never a force-synced twin)', () => {
    expect(SCAFFOLD_ONLY_TEMPLATES.has(rel)).toBe(true);
  });

  it('is delivered to claude consumers and withheld from codex-only trees', () => {
    expect(filterTemplatesByAgents([rel], ['claude'])).toEqual([rel]);
    expect(filterTemplatesByAgents([rel], ['codex'])).toEqual([]);
  });

  it('wires the pre-edit-guard PreToolUse hook', () => {
    const cfg = JSON.parse(readFileSync(join(TEMPLATES_ROOT, rel), 'utf8'));
    const preToolUse = cfg.hooks?.PreToolUse ?? [];
    const commands = preToolUse.flatMap((m: { hooks?: { command?: string }[] }) =>
      (m.hooks ?? []).map((h) => h.command ?? ''),
    );
    expect(commands.some((c: string) => c.includes('pre-edit-guard'))).toBe(true);
  });
});

describe('.oxlintrc.json template (lint contract)', () => {
  const rel = '.oxlintrc.json';
  const cfg = JSON.parse(readFileSync(join(TEMPLATES_ROOT, rel), 'utf8'));

  // Scaffold-only, so `checks template-sync` skips it by design — this is the only
  // thing holding the two copies together, and it is what makes the assertions
  // below (which read the template) cover the root file `pnpm lint` actually uses.
  it('is byte-identical to the self-host copy the repo lints with', () => {
    expect(readFileSync(join(TEMPLATES_ROOT, '..', rel), 'utf8')).toBe(
      readFileSync(join(TEMPLATES_ROOT, rel), 'utf8'),
    );
  });

  it('ships in the template manifest', () => {
    expect(templateFiles()).toContain(rel);
  });

  it('is scaffold-only (which rules to relax depends on the consumer own code)', () => {
    expect(SCAFFOLD_ONLY_TEMPLATES.has(rel)).toBe(true);
  });

  it('is driver-neutral — every agent target gets it', () => {
    expect(filterTemplatesByAgents([rel], ['claude'])).toEqual([rel]);
    expect(filterTemplatesByAgents([rel], ['codex'])).toEqual([rel]);
  });

  // The contract `.claude/engineering-rules.md` claims: the three categories are
  // errors, and the two prose-only review dimensions (error flow, concurrency)
  // get their machine half.
  it('errors on the correctness/suspicious/perf categories', () => {
    expect(cfg.categories).toEqual({
      correctness: 'error',
      suspicious: 'error',
      perf: 'error',
    });
  });

  // `no-empty` is genuinely additive (no category carries it). `no-async-promise-executor`
  // already errors via `correctness` — pinned deliberately so an upstream category
  // reshuffle cannot silently drop the concurrency dimension's machine half.
  it('errors on the named error-flow and concurrency rules', () => {
    expect(cfg.rules['eslint/no-empty']).toBe('error');
    expect(cfg.rules['eslint/no-async-promise-executor']).toBe('error');
  });

  // The rules-doc table is otherwise the only record of these, so a silent
  // re-enable (or a dropped table row) would drift undetected.
  it('switches off exactly the deliberate-pattern rules the rules doc tables', () => {
    const off = Object.entries(cfg.rules)
      .filter(([, level]) => level === 'off')
      .map(([rule]) => rule)
      .toSorted();
    expect(off).toEqual([
      'eslint/no-await-in-loop',
      'eslint/no-underscore-dangle',
      'oxc/no-map-spread',
      'unicorn/consistent-function-scoping',
      'unicorn/no-array-sort',
    ]);
  });
});

interface WfStep {
  readonly uses?: string;
  readonly run?: string;
  readonly env?: Record<string, string>;
  readonly with?: Record<string, unknown>;
}
interface WfJob {
  readonly if: string;
  readonly concurrency: unknown;
  readonly permissions: Record<string, string>;
  readonly steps: WfStep[];
}

/** A throwaway directory holding `files`, removed when the owning scope ends. */
function tempTree(files: Record<string, string>): { dir: string; [Symbol.dispose](): void } {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-graph-build-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return { dir, [Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }) };
}

// The publish cases run the step's own script, which reads graph.json with jq.
const jqAvailable = spawnSync('jq', ['--version'], { stdio: 'ignore' }).status === 0;

describe('.github/workflows/update-knowledge-graph.yml template (graph refresh)', () => {
  const rel = '.github/workflows/update-knowledge-graph.yml';
  const raw = (): string => readFileSync(join(TEMPLATES_ROOT, rel), 'utf8');

  /**
   * The workflow with comment lines stripped. Every `not.toContain` below is an
   * assertion about what the file *does*, and the file explains each of those
   * absences in a comment — grepping the raw text makes the explanation fail the
   * test it explains. Both YAML `#` comments and shell `#` comments inside `run:`
   * blocks start their line, so one filter covers both.
   */
  const runnable = (): string =>
    raw()
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');

  const workflow = (): { permissions: unknown; jobs: Record<string, WfJob>; on?: unknown } =>
    parseYaml(raw()) as { permissions: unknown; jobs: Record<string, WfJob>; on?: unknown };

  it('ships in the template manifest', () => {
    expect(templateFiles()).toContain(rel);
  });

  it('is scaffold-only (runner labels and the pin are the consumer own)', () => {
    expect(SCAFFOLD_ONLY_TEMPLATES.has(rel)).toBe(true);
  });

  it('is driver-neutral — every agent target gets it', () => {
    expect(filterTemplatesByAgents([rel], ['claude'])).toEqual([rel]);
    expect(filterTemplatesByAgents([rel], ['codex'])).toEqual([rel]);
  });

  it('parses, and triggers only on a merged PR with a code-change title', () => {
    const wf = workflow() as Record<string, unknown>;
    // `on` is the YAML 1.1 boolean `true`, which is why this reads both keys.
    const on = (wf.on ?? wf[true as unknown as string]) as {
      pull_request: { types: string[]; branches?: string[] };
    };
    expect(on.pull_request.types).toEqual(['closed']);
    // No hardcoded branch name: `branches:` takes no expression, so the
    // default-branch check lives in the job's `if` instead.
    expect(on.pull_request.branches).toBeUndefined();

    const build = (wf.jobs as Record<string, WfJob>).build;
    expect(build.if).toContain('github.event.pull_request.merged == true');
    expect(build.if).toContain('github.event.repository.default_branch');
    for (const prefix of ['feat', 'fix', 'refactor']) {
      expect(build.if).toContain(`'${prefix}'`);
    }
    // Job level, not workflow level — see the comment in the file.
    expect(build.concurrency).toEqual({ group: 'knowledge-graph', 'cancel-in-progress': true });
    expect(wf.concurrency).toBeUndefined();
  });

  it('grants each job only the permissions it needs', () => {
    const wf = workflow();
    expect(wf.permissions).toEqual({});
    expect(wf.jobs.build.permissions).toEqual({ contents: 'read' });
    expect(wf.jobs.publish.permissions).toEqual({
      contents: 'write',
      'pull-requests': 'write',
    });
  });

  it('never reaches the default branch except through a PR', () => {
    const text = runnable();
    expect(text).not.toContain('--no-verify');
    expect(text).not.toContain('LEFTHOOK=0');
    expect(text).not.toContain('refs/heads/main');
    expect(text).not.toMatch(/HEAD:main\b/);
    expect(text).toContain('gh pr create');
  });

  it('calls the framework CLI, not noldor-only package scripts', () => {
    // Those scripts exist only in noldor's own package.json — a consumer would
    // fail on a missing script.
    const text = runnable();
    expect(text).not.toMatch(/pnpm\s+toon\b/);
    expect(text).not.toMatch(/pnpm\s+graphify:/);
    expect(text).toContain('pnpm noldor graphify build');
  });

  it('builds in one clean pass, not an incremental update', () => {
    // `graphify update` keeps every node graph.json already holds, so deleted
    // code never leaves, and it extracts markdown too. `enrich-docs` adds doc
    // nodes the release sweep's own pass never has.
    const text = runnable();
    expect(text).not.toMatch(/graphify\s+update/);
    expect(text).not.toContain('enrich-docs');
  });

  it('hands the build to the builder the release sweep runs too, with no recipe of its own', () => {
    // The recipe and its package pins live in the framework, so a consumer's copy
    // of this file cannot drift from the graph a release commits.
    const builds = workflow().jobs.build.steps.filter((s) =>
      (s.run ?? '').includes('graphify build'),
    );
    expect(builds.map((s) => s.run?.trim())).toEqual(['pnpm noldor graphify build']);
    const text = runnable();
    expect(text).not.toContain("<<'PY'");
    expect(text).not.toMatch(/\bpip3?\s+install\b/);
  });

  it('runs no repository code while the write token is in scope', () => {
    const { jobs } = workflow();
    const holdsToken = (j: WfJob): WfStep[] =>
      j.steps.filter((s) => JSON.stringify(s.env ?? {}).includes('GITHUB_TOKEN'));

    // The token exists in exactly one job.
    expect(holdsToken(jobs.build)).toHaveLength(0);
    expect(holdsToken(jobs.publish).length).toBeGreaterThan(0);

    // That job installs nothing, so lefthook is never installed in it — the
    // hooks are absent rather than bypassed, which is why no step needs
    // --no-verify or LEFTHOOK=0.
    for (const s of jobs.publish.steps) {
      expect(s.run ?? '').not.toMatch(/pnpm install|npm ci|yarn install/);
      expect(s.uses ?? '').not.toContain('pnpm/action-setup');
    }

    // The job that DOES run merged-tree code keeps no credentials on disk.
    const checkout = jobs.build.steps.find((s) => (s.uses ?? '').startsWith('actions/checkout'));
    expect(checkout?.with?.['persist-credentials']).toBe(false);
  });

  it('runs publishes one at a time, in a group of their own', () => {
    // Not the build group: its cancel-in-progress would cut a publish off mid-push.
    expect(workflow().jobs.publish.concurrency).toEqual({
      group: 'knowledge-graph-publish',
      'cancel-in-progress': false,
    });
  });

  describe.skipIf(!jqAvailable)('publish, run against a local remote', () => {
    // No signing and no global hooks, whatever this machine's git config says.
    const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    const git = (cwd: string, ...args: string[]): string =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
        cwd,
        env: gitEnv,
        encoding: 'utf8',
      }).trim();
    const graph = (fields: Record<string, string>): string => `${JSON.stringify(fields)}\n`;

    it.each([
      {
        name: 'the graph branch has a newer merge graph',
        holder: 'the graph branch',
        age: 'newer',
        publishes: false,
      },
      {
        name: 'the default branch has a newer merge graph',
        holder: 'the default branch',
        age: 'newer',
        publishes: false,
      },
      {
        name: 'the graph branch has an older merge graph',
        holder: 'the graph branch',
        age: 'older',
        publishes: true,
      },
      {
        name: 'the graph branch has this merge graph (a re-run)',
        holder: 'the graph branch',
        age: 'same',
        publishes: true,
      },
      {
        name: 'the default branch has this merge graph (a re-run after the graph PR landed)',
        holder: 'the default branch',
        age: 'same',
        publishes: false,
      },
      {
        name: 'fetching the graph branch fails for a reason other than a missing ref',
        holder: 'the graph branch',
        age: 'newer',
        publishes: true,
        fetchFails: true,
      },
      { name: 'no graph exists yet', holder: 'neither', age: 'none', publishes: true },
      {
        name: 'auto-merge is unavailable (a private repo on a free plan)',
        holder: 'neither',
        age: 'none',
        publishes: true,
        autoMerge: false,
      },
    ])(
      'when $name, publishes: $publishes',
      ({ holder, age, publishes, autoMerge = true, fetchFails = false }) => {
        // Logs every call, and refuses `--auto` the way GitHub does where auto-merge is off.
        using root = tempTree({
          'bin/gh':
            '#!/bin/sh\necho "$*" >> "$GH_LOG"\n' +
            'case "$*" in *--auto*) [ "$AUTO_MERGE" = on ] || exit 1 ;; esac\nexit 0\n',
        });
        chmodSync(join(root.dir, 'bin', 'gh'), 0o755);
        if (fetchFails) {
          // Refuses `git fetch origin <FAIL_FETCH>` the way an auth failure would; the ref exists.
          const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
          writeFileSync(
            join(root.dir, 'bin', 'git'),
            '#!/bin/sh\n[ "$1" = fetch ] && [ "$4" = "$FAIL_FETCH" ] && exit 128\n' +
              `exec "${realGit}" "$@"\n`,
          );
          chmodSync(join(root.dir, 'bin', 'git'), 0o755);
        }
        const remote = join(root.dir, 'origin.git');
        const seed = join(root.dir, 'seed');
        const work = join(root.dir, 'work');
        const branch = (parseYaml(raw()) as { env: { GRAPH_BRANCH: string } }).env.GRAPH_BRANCH;

        git(root.dir, 'init', '-q', '--bare', remote);
        git(root.dir, 'init', '-q', '-b', 'main', seed);
        const commit = (msg: string, files: Record<string, string>): string => {
          for (const [path, body] of Object.entries(files)) {
            mkdirSync(dirname(join(seed, path)), { recursive: true });
            writeFileSync(join(seed, path), body);
          }
          git(seed, 'add', '-A');
          git(seed, 'commit', '-q', '-m', msg);
          return git(seed, 'rev-parse', 'HEAD');
        };
        const base = commit('base', { 'graphify-out/graph.json': graph({ marker: 'base' }) });
        const mergeA = commit('merge A', { 'a.ts': 'a\n' });
        const mergeB = commit('merge B', { 'b.ts': 'b\n' });
        if (holder === 'the default branch') {
          commit('graph PR', {
            'graphify-out/graph.json': graph({
              built_at_commit: age === 'same' ? mergeA : mergeB,
              marker: 'remote',
            }),
          });
        }
        git(seed, 'push', '-q', remote, 'main');
        if (holder === 'the graph branch') {
          const builtAt = { older: base, same: mergeA, newer: mergeB }[age] ?? base;
          git(seed, 'checkout', '-q', '-b', branch, builtAt);
          commit('graph', {
            'graphify-out/graph.json': graph({ built_at_commit: builtAt, marker: 'remote' }),
          });
          git(seed, 'push', '-q', remote, branch);
        }

        // Publish's own checkout — the merge it was built from — with the artifact on top.
        git(root.dir, 'clone', '-q', remote, work);
        git(work, 'checkout', '-q', '--detach', mergeA);
        writeFileSync(
          join(work, 'graphify-out', 'graph.json'),
          graph({ built_at_commit: mergeA, marker: 'ours' }),
        );

        const step = workflow().jobs.publish.steps.find((s) => s.env?.GH_TOKEN !== undefined);
        const r = spawnSync('bash', ['-c', step?.run ?? 'exit 99'], {
          cwd: work,
          encoding: 'utf8',
          env: {
            ...gitEnv,
            PATH: `${join(root.dir, 'bin')}:${process.env.PATH ?? ''}`,
            GRAPH_BRANCH: branch,
            DEFAULT_BRANCH: 'main',
            MERGE_SHA: mergeA,
            PR_NUMBER: '7',
            GH_TOKEN: 'unused',
            GH_LOG: join(root.dir, 'gh.log'),
            AUTO_MERGE: autoMerge ? 'on' : 'off',
            FAIL_FETCH: fetchFails ? branch : '',
          },
        });
        expect(r.status, r.stderr).toBe(0);
        // A missing ref is silent; only a fetch that failed for another reason warns.
        expect(r.stdout.includes('::warning::could not fetch')).toBe(fetchFails);

        // Where auto-merge is refused the PR is still merged — directly, never by a push.
        const merges = publishes
          ? readFileSync(join(root.dir, 'gh.log'), 'utf8')
              .split('\n')
              .filter((l) => l.startsWith('pr merge'))
          : [];
        const expected = publishes ? [`pr merge --auto --squash ${branch}`] : [];
        if (publishes && !autoMerge) expected.push(`pr merge --squash ${branch}`);
        expect(merges).toEqual(expected);

        const landed = spawnSync(
          'git',
          ['--git-dir', remote, 'show', `${branch}:graphify-out/graph.json`],
          { env: gitEnv, encoding: 'utf8' },
        );
        const marker = landed.status === 0 ? JSON.parse(landed.stdout).marker : undefined;
        expect(marker === 'ours').toBe(publishes);
      },
      30_000,
    );
  });

  it('titles its own PR with a prefix the filter skips', () => {
    const text = runnable();
    expect(text).toContain('chore(graph):');
    expect(text).not.toMatch(/--title "(feat|fix|refactor)/);
  });

  it('checks out an explicit sha and force-updates one fixed bot branch', () => {
    const text = runnable();
    expect(text).toContain('github.event.pull_request.merge_commit_sha');
    expect(text).toContain('GRAPH_BRANCH: noldor/graph-refresh');
    expect(text).toContain('git checkout -B "$GRAPH_BRANCH"');
    expect(text).toContain('git push --force origin "HEAD:$GRAPH_BRANCH"');
  });

  it('stages the directory so each repo own ignore rules decide', () => {
    // Naming files breaks any consumer tracking a different subset: charuy
    // ignores everything under graphify-out/ but graph.json and GRAPH_REPORT.md.
    const text = runnable();
    expect(text).toContain('git add graphify-out/');
    expect(text).not.toContain('git add --force');
  });

  it('is byte-identical to the self-host copy noldor own CI runs', () => {
    expect(readFileSync(join(TEMPLATES_ROOT, '..', rel), 'utf8')).toBe(raw());
  });

  it('is excluded from the template-sync drift set', () => {
    // `check-template-sync` and `doctor` both filter on this set — membership is
    // what makes a consumer's edited runner labels not read as drift.
    expect(templateFiles().filter((f) => !SCAFFOLD_ONLY_TEMPLATES.has(f))).not.toContain(rel);
  });
});
