// @tests: noldor
import { describe, expect, it, vi } from 'vitest';

import { main, type CommitGit } from '../commit-cli.js';
import {
  classifyCommit,
  decideCommitVerdict,
  STAGED_LIST_CAP,
  VERDICT_PREFIX,
  type CommitObservation,
} from '../commit-wrapper.js';

const obs = (over: Partial<CommitObservation> = {}): CommitObservation => ({
  status: 0,
  headBefore: 'a'.repeat(40),
  headAfter: 'b'.repeat(40),
  subjectAfter: 'fix(core): thing',
  stagedAfter: [],
  dryRun: false,
  ...over,
});

describe('classifyCommit', () => {
  it('reports committed only when git succeeded and HEAD moved', () => {
    expect(classifyCommit(obs())).toBe('committed');
  });

  it('reports no-op when git exits 0 but HEAD is unchanged', () => {
    expect(classifyCommit(obs({ headAfter: 'a'.repeat(40) }))).toBe('no-op');
  });

  it('treats an unborn HEAD that gains a commit as committed', () => {
    expect(classifyCommit(obs({ headBefore: null }))).toBe('committed');
  });

  it('reports failed on any non-zero status, even if HEAD moved', () => {
    expect(classifyCommit(obs({ status: 1 }))).toBe('failed');
  });

  it('reports failed on a null status (spawn error / signal)', () => {
    expect(classifyCommit(obs({ status: null }))).toBe('failed');
  });
});

describe('decideCommitVerdict', () => {
  it('passes git exit 0 through and names the new commit', () => {
    const v = decideCommitVerdict(obs());
    expect(v.code).toBe(0);
    expect(v.outcome).toBe('committed');
    expect(v.lines[0]).toBe(`${VERDICT_PREFIX} OK — committed bbbbbbb fix(core): thing`);
  });

  it('notes paths left staged by a pathspec-scoped commit', () => {
    const v = decideCommitVerdict(obs({ stagedAfter: ['a.ts', 'b.ts'] }));
    expect(v.lines[1]).toContain('2 path(s) remain staged: a.ts, b.ts');
  });

  it('surfaces the real git exit code on failure', () => {
    const v = decideCommitVerdict(obs({ status: 1, headAfter: 'a'.repeat(40) }));
    expect(v.code).toBe(1);
    expect(v.lines[0]).toBe(`${VERDICT_PREFIX} FAILED — git exit 1; nothing was committed`);
  });

  it('names the still-staged files on failure — the silent half of the foot-gun', () => {
    const v = decideCommitVerdict(
      obs({ status: 1, headAfter: 'a'.repeat(40), stagedAfter: ['src/x.ts'] }),
    );
    expect(v.lines[1]).toBe(`${VERDICT_PREFIX} 1 path(s) still staged: src/x.ts`);
  });

  it('says so explicitly when a failure left nothing staged', () => {
    const v = decideCommitVerdict(obs({ status: 1, headAfter: 'a'.repeat(40) }));
    expect(v.lines[1]).toContain('index is empty');
  });

  it('exits 1 on a null status and explains that git never completed', () => {
    const v = decideCommitVerdict(obs({ status: null, headAfter: 'a'.repeat(40) }));
    expect(v.code).toBe(1);
    expect(v.lines[0]).toContain('git did not run to completion');
  });

  it('labels a --dry-run as a no-op rather than a success', () => {
    const v = decideCommitVerdict(obs({ headAfter: 'a'.repeat(40), dryRun: true }));
    expect(v.code).toBe(0);
    expect(v.outcome).toBe('no-op');
    expect(v.lines[0]).toContain('--dry-run');
  });

  it('labels an exit-0 run that did not move HEAD as a no-op', () => {
    const v = decideCommitVerdict(obs({ headAfter: 'a'.repeat(40) }));
    expect(v.lines[0]).toContain('HEAD did not move');
  });

  it('caps the staged list so a bulk stage cannot flood the tail', () => {
    const paths = Array.from({ length: STAGED_LIST_CAP + 3 }, (_, i) => `f${i}.ts`);
    const v = decideCommitVerdict(
      obs({ status: 1, headAfter: 'a'.repeat(40), stagedAfter: paths }),
    );
    expect(v.lines[1]).toContain('… (+3 more)');
    expect(v.lines[1]).not.toContain(`f${STAGED_LIST_CAP}.ts`);
  });

  it('omits the subject when it cannot be resolved', () => {
    const v = decideCommitVerdict(obs({ subjectAfter: null }));
    expect(v.lines[0]).toBe(`${VERDICT_PREFIX} OK — committed bbbbbbb`);
  });

  it('prefixes every line so a `| tail` reader can grep one token', () => {
    for (const o of [obs(), obs({ status: 1 }), obs({ headAfter: 'a'.repeat(40) })]) {
      for (const line of decideCommitVerdict(o).lines) {
        expect(line.startsWith(VERDICT_PREFIX)).toBe(true);
      }
    }
  });
});

describe('commit-cli main', () => {
  const fakeGit = (over: Partial<CommitGit> = {}): CommitGit => ({
    head: () => 'a'.repeat(40),
    subject: () => 'fix: x',
    stagedFiles: () => [],
    runCommit: () => 0,
    ...over,
  });

  it('forwards argv verbatim to git commit', () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const runCommit = vi.fn(() => 0);
    try {
      main(['-m', 'subject', '--no-edit'], fakeGit({ runCommit }));
      expect(runCommit).toHaveBeenCalledWith(['-m', 'subject', '--no-edit']);
    } finally {
      write.mockRestore();
    }
  });

  it('returns git’s exit code and writes the verdict to stdout', () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      const code = main(['-m', 'x'], fakeGit({ runCommit: () => 1, stagedFiles: () => ['a.ts'] }));
      expect(code).toBe(1);
      const out = write.mock.calls.map((c) => String(c[0])).join('');
      expect(out).toContain(`${VERDICT_PREFIX} FAILED — git exit 1`);
      expect(out).toContain('a.ts');
    } finally {
      write.mockRestore();
    }
  });

  it('detects the moved HEAD across the run', () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const heads = ['a'.repeat(40), 'c'.repeat(40)];
    try {
      const code = main(['-m', 'x'], fakeGit({ head: () => heads.shift() ?? null }));
      expect(code).toBe(0);
      expect(write.mock.calls.map((c) => String(c[0])).join('')).toContain(
        'OK — committed ccccccc',
      );
    } finally {
      write.mockRestore();
    }
  });

  it('flags --dry-run from argv so it is never reported as a commit', () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      main(['--dry-run'], fakeGit());
      expect(write.mock.calls.map((c) => String(c[0])).join('')).toContain('--dry-run');
    } finally {
      write.mockRestore();
    }
  });
});
