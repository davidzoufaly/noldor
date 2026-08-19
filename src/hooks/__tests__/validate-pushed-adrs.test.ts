// @tests: architecture-decision-record-surface
import { describe, expect, it } from 'vitest';

import { renderAdrViolations, validatePushedAdrs } from '../validate-pushed-adrs.js';

import type { GitRunner } from '../validate-pushed-summaries.js';

const LOCAL = 'a'.repeat(40);
const REMOTE = 'b'.repeat(40);
const ZERO = '0'.repeat(40);
const MERGE_BASE = 'c'.repeat(40);

const refLine = (remoteSha: string, localSha = LOCAL) =>
  `refs/heads/feat ${localSha} refs/heads/feat ${remoteSha}`;

const ACCEPTED = `---
status: accepted
date: 2026-08-19
---

# Decision

Body.
`;

const FLIPPED = `---
status: superseded
date: 2026-08-19
superseded-by: '0002'
---

# Decision

Body.
`;

/** Stub runner: canned diff output + per-sha blob contents. */
function stubGit(opts: {
  diff?: string;
  blobs?: Record<string, string>;
  mergeBaseFails?: boolean;
}): GitRunner {
  return {
    text: (args) => {
      if (args[0] === 'diff') return { status: 0, stdout: opts.diff ?? '', stderr: '' };
      if (args[0] === 'merge-base') {
        return opts.mergeBaseFails
          ? { status: 128, stdout: '', stderr: 'no merge base' }
          : { status: 0, stdout: `${MERGE_BASE}\n`, stderr: '' };
      }
      if (args[0] === 'show') {
        const blob = opts.blobs?.[args[1] ?? ''];
        return blob === undefined
          ? { status: 128, stdout: '', stderr: `fatal: ${args[1]}` }
          : { status: 0, stdout: blob, stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
  };
}

describe('validatePushedAdrs', () => {
  it('passes a push that touches no adr path and a branch deletion', () => {
    const ok = validatePushedAdrs({
      git: stubGit({ diff: '' }),
      refLines: [refLine(REMOTE)],
      env: {},
    });
    expect(ok.kind).toBe('ok');

    const deletion = validatePushedAdrs({
      git: stubGit({}),
      refLines: [refLine(REMOTE, ZERO)],
      env: {},
    });
    expect(deletion.kind).toBe('ok');
  });

  it('allows added records, blocks deletions and renames', () => {
    const added = validatePushedAdrs({
      git: stubGit({ diff: 'A\tdocs/adr/0001-x.md' }),
      refLines: [refLine(REMOTE)],
      env: {},
    });
    expect(added.kind).toBe('ok');

    const deleted = validatePushedAdrs({
      git: stubGit({ diff: 'D\tdocs/adr/0001-x.md' }),
      refLines: [refLine(REMOTE)],
      env: {},
    });
    expect(deleted.kind).toBe('violations');
    if (deleted.kind === 'violations') expect(deleted.violations[0]?.change).toBe('deleted');
  });

  it('allows exactly the supersede flip and nothing else', () => {
    const flip = validatePushedAdrs({
      git: stubGit({
        diff: 'M\tdocs/adr/0001-x.md',
        blobs: {
          [`${REMOTE}:docs/adr/0001-x.md`]: ACCEPTED,
          [`${LOCAL}:docs/adr/0001-x.md`]: FLIPPED,
        },
      }),
      refLines: [refLine(REMOTE)],
      env: {},
    });
    expect(flip.kind).toBe('ok');

    const bodyEdit = validatePushedAdrs({
      git: stubGit({
        diff: 'M\tdocs/adr/0001-x.md',
        blobs: {
          [`${REMOTE}:docs/adr/0001-x.md`]: ACCEPTED,
          [`${LOCAL}:docs/adr/0001-x.md`]: ACCEPTED.replace('Body.', 'Reworded.'),
        },
      }),
      refLines: [refLine(REMOTE)],
      env: {},
    });
    expect(bodyEdit.kind).toBe('violations');

    const supersededEdit = validatePushedAdrs({
      git: stubGit({
        diff: 'M\tdocs/adr/0001-x.md',
        blobs: {
          [`${REMOTE}:docs/adr/0001-x.md`]: FLIPPED,
          [`${LOCAL}:docs/adr/0001-x.md`]: FLIPPED.replace('Body.', 'Reworded.'),
        },
      }),
      refLines: [refLine(REMOTE)],
      env: {},
    });
    expect(supersededEdit.kind).toBe('violations');
  });

  it('falls back to the merge-base on a new branch, and to none without origin/main', () => {
    const viaMergeBase = validatePushedAdrs({
      git: stubGit({
        diff: 'M\tdocs/adr/0001-x.md',
        blobs: {
          [`${MERGE_BASE}:docs/adr/0001-x.md`]: ACCEPTED,
          [`${LOCAL}:docs/adr/0001-x.md`]: ACCEPTED.replace('Body.', 'Reworded.'),
        },
      }),
      refLines: [refLine(ZERO)],
      env: {},
    });
    expect(viaMergeBase.kind).toBe('violations');

    const freshRepo = validatePushedAdrs({
      git: stubGit({ mergeBaseFails: true }),
      refLines: [refLine(ZERO)],
      env: {},
    });
    expect(freshRepo.kind).toBe('ok');
  });

  it('converts a block into a receipted repair under NOLDOR_ADR_REPAIR=1', () => {
    const repair = validatePushedAdrs({
      git: stubGit({ diff: 'D\tdocs/adr/0001-x.md' }),
      refLines: [refLine(REMOTE)],
      env: { NOLDOR_ADR_REPAIR: '1' },
    });
    expect(repair.kind).toBe('repair');
  });

  it('reports infra on malformed ref lines and failed git commands', () => {
    const malformed = validatePushedAdrs({
      git: stubGit({}),
      refLines: ['garbage line'],
      env: {},
    });
    expect(malformed.kind).toBe('infra');
  });

  it('renders violations with both remedies named', () => {
    const text = renderAdrViolations([
      { file: 'docs/adr/0001-x.md', change: 'deleted', detail: 'gone' },
    ]);
    expect(text).toContain('append-only');
    expect(text).toContain('--supersedes');
    expect(text).toContain('NOLDOR_ADR_REPAIR=1');
  });
});
