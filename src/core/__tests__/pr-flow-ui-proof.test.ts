// @tests: ui-proof-screenshots-on-the-pr, framework-pr-flow-agent-auto-merge
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { composeBody, openAndAutoMerge } from '../pr-flow.js';
import type { PrFlowInput, SpawnFn, UiProofLink } from '../pr-flow.js';

const input: PrFlowInput = {
  cwd: '/tmp/wt',
  branch: 'feat/ui-change',
  base: 'main',
  repoUrl: 'https://github.com/o/r',
  session: { path: 'fast-track', slug: 'ui-change', startedAt: '2026-10-07T10:00:00Z' },
  fd: null,
  specPath: null,
  planPaths: [],
  crResults: { passes: [], status: 'clean' },
  verify: null,
  headSha: 'abc123',
  summaryCommit: {
    subject: 'feat(web): bigger header',
    body: [
      'Why — the header was too small to read on a phone screen.',
      'How — the header component takes the larger type scale token.',
      'What — apps/web/src/Header.tsx and its style sheet now use it.',
    ].join('\n'),
  },
  branchFiles: ['apps/web/src/Header.tsx'],
  taskIds: [],
};

const proof: UiProofLink[] = [
  {
    surface: 'app',
    source: 'e2e',
    imageUrls: ['https://github.com/o/r/blob/p1/feat/ui-change/abc123/app-1.png?raw=true'],
    notes: [],
  },
  {
    surface: 'site',
    source: null,
    imageUrls: [],
    notes: ['proof command exited 1'],
  },
];

describe('composeBody UI Proof section', () => {
  it('renders no UI Proof section when there is no proof', () => {
    expect(composeBody(input)).not.toContain('## UI Proof');
    expect(composeBody({ ...input, uiProof: [] })).toBe(composeBody(input));
  });

  it('shows each image inline and explains a surface left without one', () => {
    const body = composeBody({ ...input, uiProof: proof });
    const section = body.slice(body.indexOf('## UI Proof'), body.indexOf('## Test Plan'));
    expect(section).toContain(
      '![app 1](https://github.com/o/r/blob/p1/feat/ui-change/abc123/app-1.png?raw=true)',
    );
    expect(section).toContain('### site');
    expect(section).toContain('consumer.uiProof.site.command');
    expect(section).toContain('proof command exited 1');
  });

  it('keeps a failure note beside a fallback image', () => {
    const body = composeBody({
      ...input,
      uiProof: [
        {
          surface: 'app',
          source: 'render-compare',
          imageUrls: ['https://x/shot.png'],
          notes: ['proof command timed out after 300000 ms'],
        },
      ],
    });
    expect(body).toContain('![app 1](https://x/shot.png)');
    expect(body).toContain('proof command timed out after 300000 ms');
    expect(body).not.toContain('No screenshot');
  });

  it('states a declared skip instead of asking for a screenshot', () => {
    const body = composeBody({
      ...input,
      uiProof: [
        {
          surface: 'app',
          source: null,
          imageUrls: [],
          notes: [],
          skipped: '`Noldor-UI-Proof: skip`',
        },
      ],
    });
    expect(body).toContain('### app');
    expect(body).toContain(
      '_UI proof skipped: no visual change declared (`Noldor-UI-Proof: skip`)._',
    );
    expect(body).not.toContain('No screenshot');
  });
});

describe('openAndAutoMerge UI proof step', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function scripted(overrides: Record<string, { stdout: string; exitCode: number }> = {}): {
    spawn: SpawnFn;
    steps: string[];
    bodies: string[];
  } {
    const steps: string[] = [];
    const bodies: string[] = [];
    const answers: Record<string, { stdout: string; exitCode: number }> = {
      'gh --version': { stdout: 'gh version 2.50', exitCode: 0 },
      'gh auth': { stdout: 'Logged in', exitCode: 0 },
      'git fetch': { stdout: '', exitCode: 0 },
      'git cherry': { stdout: '+ deadbeef\n', exitCode: 0 },
      'git push': { stdout: '', exitCode: 0 },
      'gh pr list': { stdout: '[]', exitCode: 0 },
      'gh pr create': { stdout: 'https://github.com/o/r/pull/9', exitCode: 0 },
      ...overrides,
    };
    const spawn: SpawnFn = async (cmd, args) => {
      const step = args[0] === 'pr' ? `${cmd} pr ${args[1]}` : `${cmd} ${args[0]}`;
      steps.push(step);
      const bodyAt = args.indexOf('--body');
      if (bodyAt >= 0) bodies.push(args[bodyAt + 1] ?? '');
      return answers[step] ?? { stdout: '', exitCode: 1 };
    };
    return { spawn, steps, bodies };
  }

  it('runs the proof step after the guards and before the branch push, and the PR shows it', async () => {
    const { spawn, steps, bodies } = scripted();
    const prepareUiProof = async (): Promise<UiProofLink[]> => {
      steps.push('prepareUiProof');
      return proof;
    };
    await openAndAutoMerge({ ...input, spawn, openOnly: true, prepareUiProof });
    expect(steps).toEqual([
      'gh --version',
      'gh auth',
      'git fetch',
      'git cherry',
      'prepareUiProof',
      'git push',
      'gh pr list',
      'gh pr create',
    ]);
    expect(bodies[0]).toContain('## UI Proof');
  });

  it('refreshes a reused open PR with the section', async () => {
    const { spawn, bodies } = scripted({
      'gh pr list': { stdout: '[{"number":5,"url":"https://github.com/o/r/pull/5"}]', exitCode: 0 },
      'gh pr edit': { stdout: '', exitCode: 0 },
    });
    await openAndAutoMerge({ ...input, spawn, openOnly: true, prepareUiProof: async () => proof });
    expect(bodies[0]).toContain('## UI Proof');
  });

  it.each([
    ['a redundant delivery', { 'git cherry': { stdout: '- deadbeef\n', exitCode: 0 } }],
    ['a failed gh preflight', { 'gh --version': { stdout: '', exitCode: 127 } }],
  ])('never runs the proof step on %s', async (_label, overrides) => {
    const { spawn } = scripted(overrides);
    let ran = false;
    const prepareUiProof = async (): Promise<UiProofLink[]> => {
      ran = true;
      return proof;
    };
    await openAndAutoMerge({ ...input, spawn, openOnly: true, prepareUiProof }).catch(
      () => undefined,
    );
    expect(ran).toBe(false);
  });

  it('never runs the proof step when the PR summary is rejected', async () => {
    const { spawn } = scripted();
    let ran = false;
    await expect(
      openAndAutoMerge({
        ...input,
        summaryCommit: { subject: 'feat(web): x', body: '' },
        spawn,
        openOnly: true,
        prepareUiProof: async () => {
          ran = true;
          return proof;
        },
      }),
    ).rejects.toThrow();
    expect(ran).toBe(false);
  });
});
