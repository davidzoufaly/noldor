// @tests: ui-design-review-lane
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { LaneInput } from '../../lane-types.js';
import { runUiReview } from '../../lanes/ui-review.js';
import { setUiDispatcher, type UiDispatchInput } from '../../lanes/ui-review-dispatch.js';

const SLUG = 'feat-ui';
// Minimum the real ConsumerConfigSchema accepts — the test parses through the
// production loader rather than a stub, so the fixture must be a valid config.
const CONSUMER = {
  name: 'fixture',
  repoUrl: 'https://example.com/fixture',
  lockstepPackages: ['.'],
  e2ePrefix: 'e2e',
  samplesPath: 'samples',
  packagePrefix: '@fixture/',
  appPathPrefix: 'apps/',
  uiPaths: ['src/ui/**'],
  uiSurfaces: { app: ['src/ui/**'] },
};

interface RepoOpts {
  uiReviewMode?: 'blocking' | 'advisory';
  /** Session marker path; `fast-track` carries no design dialogue. */
  sessionPath?: string;
  fdDesign?: 'required' | 'skip';
  /** Files (path → contents) committed as the "feature" commit. */
  changed?: Record<string, string>;
  /** Feature `.pen` files committed alongside, relative to docs/design/ui. */
  pens?: string[];
  noConsumerConfig?: boolean;
  waived?: boolean;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function repo(opts: RepoOpts = {}): { cwd: string; input: LaneInput } {
  const cwd = mkdtempSync(join(tmpdir(), 'noldor-ui-review-test-'));
  git(cwd, ['init', '-q', '-b', 'main']);
  git(cwd, ['config', 'user.email', 't@t']);
  git(cwd, ['config', 'user.name', 't']);
  mkdirSync(join(cwd, '.noldor'), { recursive: true });
  mkdirSync(join(cwd, 'docs', 'features'), { recursive: true });
  mkdirSync(join(cwd, 'docs', 'design', 'ui'), { recursive: true });

  if (!opts.noConsumerConfig) {
    writeFileSync(
      join(cwd, '.noldor', 'config.json'),
      JSON.stringify({
        consumer: CONSUMER,
        ...(opts.uiReviewMode ? { autonomous: { uiReviewMode: opts.uiReviewMode } } : {}),
      }),
    );
  }
  writeFileSync(
    join(cwd, 'docs', 'features', `${SLUG}.md`),
    `---\n${opts.fdDesign ? `design: ${opts.fdDesign}\n` : ''}---\n\n## Summary\n\nA panel.\n`,
  );
  writeFileSync(join(cwd, 'README.md'), 'base\n');
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-qm', 'base']);
  // A real origin/main ref: resolveDefaultBase falls back to that name, and the
  // predicate + ownership gate both resolve against it.
  git(cwd, ['update-ref', 'refs/remotes/origin/main', git(cwd, ['rev-parse', 'HEAD'])]);

  writeFileSync(
    join(cwd, '.noldor', 'session.json'),
    JSON.stringify({
      path: opts.sessionPath ?? 'specs-only-new',
      slug: SLUG,
      startedAt: new Date().toISOString(),
      markerVersion: 2,
      ...(opts.waived ? { uiWaiver: { reason: 'no editor', at: new Date().toISOString() } } : {}),
    }),
  );
  for (const [rel, body] of Object.entries(
    opts.changed ?? { 'src/ui/Panel.tsx': 'export const P = 1;\n' },
  )) {
    mkdirSync(join(cwd, rel, '..'), { recursive: true });
    writeFileSync(join(cwd, rel), body);
  }
  for (const pen of opts.pens ?? []) {
    mkdirSync(join(cwd, 'docs', 'design', 'ui', pen, '..'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'design', 'ui', pen), 'PEN-BYTES\n');
  }
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-qm', 'feature']);

  return {
    cwd,
    input: {
      slug: SLUG,
      artifact: 'src/ui/Panel.tsx',
      kind: 'code',
      fdPath: join('docs', 'features', `${SLUG}.md`),
      artifactSha: git(cwd, ['rev-parse', 'HEAD']),
      repoRoot: cwd,
    },
  };
}

function sink(cwd: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(cwd, '.noldor', 'cr', `${SLUG}-code-ui-reviewer.json`), 'utf8'),
  ) as Record<string, unknown>;
}

const report = (payload: unknown): string =>
  `prose\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\n`;

/**
 * Dispatcher that records what the lane handed the child, reading the scratch
 * design WHILE the child would hold it — the lane removes the scratch dir on its
 * way out, so a post-run read proves nothing except that cleanup happened.
 */
function capture(payload: unknown): { seen: UiDispatchInput[]; penBytes: string[] } {
  const seen: UiDispatchInput[] = [];
  const penBytes: string[] = [];
  setUiDispatcher(async (input) => {
    seen.push(input);
    penBytes.push(readFileSync(input.penPath, 'utf8'));
    return report(payload);
  });
  return { seen, penBytes };
}

const PASS = { verdict: 'pass', findings: [] };
const FAIL = {
  verdict: 'fail',
  findings: [
    {
      file: 'src/ui/Panel.tsx',
      severity: 'high',
      message: 'submit button missing',
      designPage: 'FINAL:app: default',
      designElement: 'Submit',
    },
  ],
};

afterEach(() => {
  setUiDispatcher(async () => report(PASS));
});

describe('runUiReview — rounds with nothing to review', () => {
  it('is not-applicable when the consumer has no config at all', async () => {
    const { cwd, input } = repo({ noConsumerConfig: true });
    const r = await runUiReview(input);
    expect(r.ok).toBe(true);
    expect(sink(cwd)).toMatchObject({ verdict: 'not-applicable', reason: 'no-consumer-config' });
  });

  it('is not-applicable when no changed path matches uiPaths', async () => {
    const { cwd, input } = repo({ changed: { 'src/core/thing.ts': 'export const x = 1;\n' } });
    const r = await runUiReview(input);
    expect(r.ok).toBe(true);
    expect(sink(cwd)).toMatchObject({ verdict: 'not-applicable', reason: 'no-ui-paths' });
  });

  it('honors an FD design: skip override even when UI paths changed', async () => {
    const { cwd, input } = repo({ fdDesign: 'skip', pens: [`2026-08-20-${SLUG}.pen`] });
    await runUiReview(input);
    expect(sink(cwd)).toMatchObject({ verdict: 'not-applicable', reason: 'design-skip' });
  });

  it('is not-applicable when the operator waived the design step', async () => {
    const { cwd, input } = repo({ waived: true, uiReviewMode: 'blocking' });
    const r = await runUiReview(input);
    expect(r.ok).toBe(true);
    expect(sink(cwd)).toMatchObject({ verdict: 'not-applicable', reason: 'waived' });
  });

  it('never dispatches on a not-applicable round', async () => {
    const { seen } = capture(PASS);
    const { input } = repo({ changed: { 'src/core/thing.ts': 'x\n' } });
    await runUiReview(input);
    expect(seen).toHaveLength(0);
  });
});

describe('runUiReview — rounds it cannot perform', () => {
  it('reports no-design-artifact for a fast-track session that changed UI', async () => {
    const { cwd, input } = repo({ sessionPath: 'fast-track' });
    const r = await runUiReview(input);
    // Advisory: honest green. The point is that it is NOT `not-applicable`.
    expect(r.ok).toBe(true);
    expect(sink(cwd)).toMatchObject({ verdict: 'cannot-review', reason: 'no-design-artifact' });
  });

  it('reds a fast-track UI change under blocking (no silent bypass)', async () => {
    const { cwd, input } = repo({ sessionPath: 'fast-track', uiReviewMode: 'blocking' });
    const r = await runUiReview(input);
    expect(r.ok).toBe(false);
    expect(sink(cwd)).toMatchObject({ verdict: 'cannot-review', reason: 'no-design-artifact' });
    expect((sink(cwd).blockers as unknown[]).length).toBe(1);
  });

  it('reports no-feature-pen when the session has no design artifact', async () => {
    const { cwd, input } = repo({ pens: [] });
    await runUiReview(input);
    expect(sink(cwd)).toMatchObject({ verdict: 'cannot-review', reason: 'no-feature-pen' });
  });

  it('declines rather than guessing when two designs match the key', async () => {
    const { cwd, input } = repo({
      pens: [`2026-08-20-${SLUG}.pen`, `2026-08-19-${SLUG}.pen`],
    });
    await runUiReview(input);
    const s = sink(cwd);
    expect(s).toMatchObject({ verdict: 'cannot-review', reason: 'ambiguous-design' });
    expect(String((s.notes as string[])[0])).toContain('2026-08-20');
  });

  it('reports surfaces-unmapped when a changed UI path belongs to no surface', async () => {
    const { cwd, input } = repo();
    writeFileSync(
      join(cwd, '.noldor', 'config.json'),
      JSON.stringify({ consumer: { ...CONSUMER, uiSurfaces: { app: ['src/other/**'] } } }),
    );
    await runUiReview(input);
    expect(sink(cwd)).toMatchObject({ verdict: 'cannot-review', reason: 'surfaces-unmapped' });
  });

  it('reports config-unreadable when the consumer config exists but does not parse', async () => {
    const { cwd, input } = repo({ pens: [`2026-08-20-${SLUG}.pen`] });
    writeFileSync(join(cwd, '.noldor', 'config.json'), '{ not json');
    const r = await runUiReview(input);
    // Distinct from no-consumer-config: a broken config is a repo problem, not an opt-out.
    expect(sink(cwd)).toMatchObject({ verdict: 'cannot-review', reason: 'config-unreadable' });
    expect(r.ok).toBe(true);
  });

  it("keeps the child's no-final-pages distinct from no-feature-pen", async () => {
    setUiDispatcher(async () =>
      report({ verdict: 'cannot-review', findings: [], reason: 'no-final-pages' }),
    );
    const { cwd, input } = repo({ pens: [`2026-08-20-${SLUG}.pen`] });
    await runUiReview(input);
    expect(sink(cwd)).toMatchObject({ verdict: 'cannot-review', reason: 'no-final-pages' });
  });

  it('reports malformed-output when the child emits no parseable report', async () => {
    setUiDispatcher(async () => 'I have thoughts but no json');
    const { cwd, input } = repo({ pens: [`2026-08-20-${SLUG}.pen`] });
    await runUiReview(input);
    expect(sink(cwd)).toMatchObject({ verdict: 'cannot-review', reason: 'malformed-output' });
  });

  it("passes through the child's own pen-unreadable report", async () => {
    setUiDispatcher(async () =>
      report({ verdict: 'cannot-review', findings: [], reason: 'pen-unreadable' }),
    );
    const { cwd, input } = repo({ pens: [`2026-08-20-${SLUG}.pen`] });
    await runUiReview(input);
    expect(sink(cwd)).toMatchObject({ verdict: 'cannot-review', reason: 'pen-unreadable' });
  });
});

describe('runUiReview — performed reviews', () => {
  it('hands the child a scratch copy, never the repo path, plus the surfaces in scope', async () => {
    const { seen, penBytes } = capture(PASS);
    const { cwd, input } = repo({ pens: [`2026-08-20-${SLUG}.pen`] });
    await runUiReview(input);
    expect(seen).toHaveLength(1);
    expect(seen[0].penPath.startsWith(cwd)).toBe(false);
    expect(penBytes[0]).toBe('PEN-BYTES\n');
    expect(seen[0].surfaces).toEqual(['app']);
    // Cleanup: the scratch copy does not outlive the round.
    expect(existsSync(seen[0].penPath)).toBe(false);
  });

  it('ignores input.baseSha so a delta round still sees the whole feature', async () => {
    const { seen } = capture(PASS);
    const { cwd, input } = repo({ pens: [`2026-08-20-${SLUG}.pen`] });
    // A delta round's base is the tip itself: a predicate honoring it would see an
    // empty diff and write a green `no-ui-paths` sink instead of reviewing.
    await runUiReview({ ...input, baseSha: input.artifactSha });
    expect(seen).toHaveLength(1);
    expect(sink(cwd)).toMatchObject({ verdict: 'pass' });
  });

  it('greens a pass', async () => {
    setUiDispatcher(async () => report(PASS));
    const { cwd, input } = repo({ pens: [`2026-08-20-${SLUG}.pen`] });
    const r = await runUiReview(input);
    expect(r.ok).toBe(true);
    expect(sink(cwd)).toMatchObject({ verdict: 'pass', blockers: [], suggestions: [] });
  });

  it('demotes findings to low suggestions under advisory', async () => {
    setUiDispatcher(async () => report(FAIL));
    const { cwd, input } = repo({ pens: [`2026-08-20-${SLUG}.pen`] });
    const r = await runUiReview(input);
    expect(r.ok).toBe(true);
    const s = sink(cwd);
    expect(s.blockers).toEqual([]);
    expect(s.suggestions).toMatchObject([{ severity: 'low' }]);
  });

  it('blocks with the child severity under blocking, evidence folded into the message', async () => {
    setUiDispatcher(async () => report(FAIL));
    const { cwd, input } = repo({ pens: [`2026-08-20-${SLUG}.pen`], uiReviewMode: 'blocking' });
    const r = await runUiReview(input);
    expect(r.ok).toBe(false);
    const blockers = sink(cwd).blockers as Array<{ severity: string; message: string }>;
    expect(blockers[0].severity).toBe('high');
    expect(blockers[0].message).toBe('[FINAL:app: default › Submit] submit button missing');
  });

  it('reds in BOTH modes when the design changed under the reviewer', async () => {
    for (const mode of ['advisory', 'blocking'] as const) {
      const { cwd, input } = repo({ pens: [`2026-08-20-${SLUG}.pen`], uiReviewMode: mode });
      setUiDispatcher(async () => {
        writeFileSync(join(cwd, 'docs', 'design', 'ui', `2026-08-20-${SLUG}.pen`), 'MUTATED\n');
        return report(PASS);
      });
      const r = await runUiReview(input);
      expect(r.ok).toBe(false);
      expect(sink(cwd)).toMatchObject({ verdict: 'fail', reason: 'pen-modified' });
    }
  });

  it('reports pen-modified even when the dispatch itself then failed', async () => {
    // A child that edits the design and then times out must not land as an
    // advisory-green timeout: the mutation invalidates the round either way.
    const { cwd, input } = repo({ pens: [`2026-08-20-${SLUG}.pen`] });
    setUiDispatcher(async () => {
      writeFileSync(join(cwd, 'docs', 'design', 'ui', `2026-08-20-${SLUG}.pen`), 'MUTATED\n');
      throw new Error('boom');
    });
    const r = await runUiReview(input);
    expect(r.ok).toBe(false);
    expect(sink(cwd)).toMatchObject({ verdict: 'fail', reason: 'pen-modified' });
  });

  it('treats a design that became unreadable during review as modified', async () => {
    const { cwd, input } = repo({ pens: [`2026-08-20-${SLUG}.pen`] });
    setUiDispatcher(async () => {
      rmSync(join(cwd, 'docs', 'design', 'ui', `2026-08-20-${SLUG}.pen`));
      return report(PASS);
    });
    const r = await runUiReview(input);
    expect(r.ok).toBe(false);
    expect(sink(cwd)).toMatchObject({ verdict: 'fail', reason: 'pen-modified' });
  });

  it('keeps a usable detail when the dispatcher rejects with a non-Error value', async () => {
    const { cwd, input } = repo({ pens: [`2026-08-20-${SLUG}.pen`] });
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    setUiDispatcher(async () => {
      throw 'plain string rejection';
    });
    await runUiReview(input);
    const s = sink(cwd);
    expect(s).toMatchObject({ verdict: 'cannot-review', reason: 'dispatch-failed' });
    expect((s.notes as string[]).join(' ')).toContain('plain string rejection');
  });

  it('reviews the archived design once gate Step 4 has moved it', async () => {
    const { seen } = capture(PASS);
    const { cwd, input } = repo({ pens: [join('archive', `2026-08-20-${SLUG}.pen`)] });
    await runUiReview(input);
    expect(seen).toHaveLength(1);
    expect(sink(cwd)).toMatchObject({ verdict: 'pass' });
  });
});
