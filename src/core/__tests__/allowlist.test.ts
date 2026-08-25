// @tests: release-sweep-process-hardening
import { describe, expect, it } from 'vitest';
import {
  isBookkeepingOnly,
  isMicroChoreAllowed,
  isNoReviewLaneAllowed,
  isReleaseSweepAllowed,
  isRetirementOnly,
  microChoreOffenders,
  MICRO_CHORE_GLOBS,
  releaseSweepOffenders,
  RELEASE_SWEEP_GLOBS,
  touchesCode,
} from '../allowlist';

describe('micro-chore allowlist', () => {
  it('accepts docs markdown', () => {
    expect(isMicroChoreAllowed(['docs/foo.md', 'docs/bar/baz.md'])).toBe(true);
  });
  it('accepts .claude/**', () => {
    expect(isMicroChoreAllowed(['.claude/CLAUDE.md', '.claude/skills/foo.md'])).toBe(true);
  });
  it('accepts root markdown', () => {
    expect(isMicroChoreAllowed(['ideas.md', 'README.md'])).toBe(true);
  });
  it('rejects code files', () => {
    expect(isMicroChoreAllowed(['packages/web/src/foo.ts'])).toBe(false);
  });
  it('rejects mixed (one code file taints all)', () => {
    expect(isMicroChoreAllowed(['docs/foo.md', 'packages/web/src/foo.ts'])).toBe(false);
  });
  it('exposes the canonical glob list', () => {
    expect(MICRO_CHORE_GLOBS).toContain('docs/**/*.md');
  });
  it('accepts lefthook.yml alone', () => {
    expect(isMicroChoreAllowed(['lefthook.yml'])).toBe(true);
  });
  it('accepts lefthook.yml mixed with .claude/**', () => {
    expect(isMicroChoreAllowed(['lefthook.yml', '.claude/skills/noldor-gate/SKILL.md'])).toBe(true);
  });
  it('rejects lefthook.yml + code file (tainted)', () => {
    expect(isMicroChoreAllowed(['lefthook.yml', 'packages/web/src/foo.ts'])).toBe(false);
  });
  it('accepts .gitignore alone', () => {
    expect(isMicroChoreAllowed(['.gitignore'])).toBe(true);
  });
  it('accepts .gitignore mixed with docs markdown', () => {
    expect(isMicroChoreAllowed(['.gitignore', 'docs/foo.md'])).toBe(true);
  });
  it('rejects .gitignore + code file (tainted)', () => {
    expect(isMicroChoreAllowed(['.gitignore', 'packages/web/src/foo.ts'])).toBe(false);
  });
  it('accepts a templated skill edited alongside its .claude twin', () => {
    expect(
      isMicroChoreAllowed([
        '.claude/skills/noldor-gate/SKILL.md',
        'templates/.claude/skills/noldor-gate/SKILL.md',
      ]),
    ).toBe(true);
  });
  it('rejects non-.claude templates paths (only template twins of skills qualify)', () => {
    expect(isMicroChoreAllowed(['templates/src/foo.ts'])).toBe(false);
  });
  it('accepts a docs page edited alongside its templates/docs twin', () => {
    expect(
      isMicroChoreAllowed(['docs/noldor/release.md', 'templates/docs/noldor/release.md']),
    ).toBe(true);
  });
  it('rejects non-md files under templates/docs', () => {
    expect(isMicroChoreAllowed(['templates/docs/noldor/diagram.svg'])).toBe(false);
  });
  it('accepts the triage bookkeeping counters the gate writes', () => {
    expect(isMicroChoreAllowed(['.noldor/id-counter.json'])).toBe(true);
    expect(isMicroChoreAllowed(['.noldor/retired-entry-ids.json'])).toBe(true);
  });
  it('accepts a triage commit: roadmap + ideas + both counters', () => {
    expect(
      isMicroChoreAllowed([
        'docs/roadmap.md',
        'ideas.md',
        '.noldor/id-counter.json',
        '.noldor/retired-entry-ids.json',
      ]),
    ).toBe(true);
  });
  it('rejects other .noldor json (only the two counters are admitted)', () => {
    expect(isMicroChoreAllowed(['.noldor/config.json'])).toBe(false);
    expect(isMicroChoreAllowed(['.noldor/session.json'])).toBe(false);
  });
});

describe('microChoreOffenders', () => {
  it('names only the paths outside the allowlist', () => {
    expect(
      microChoreOffenders([
        'docs/foo.md',
        'src/core/allowlist.ts',
        'docs/bar.md',
        'bin/noldor.mjs',
      ]),
    ).toEqual(['src/core/allowlist.ts', 'bin/noldor.mjs']);
  });
  it('returns an empty list when every path is allowed', () => {
    expect(microChoreOffenders(['docs/foo.md', '.noldor/id-counter.json'])).toEqual([]);
  });
  it('returns an empty list for an empty set', () => {
    expect(microChoreOffenders([])).toEqual([]);
  });
  it('agrees with isMicroChoreAllowed on a non-empty set', () => {
    const paths = ['docs/foo.md', 'src/core/allowlist.ts'];
    expect(microChoreOffenders(paths).length === 0).toBe(isMicroChoreAllowed(paths));
  });
});

describe('releaseSweepOffenders', () => {
  it('names only the paths outside the sweep allowlist', () => {
    expect(releaseSweepOffenders(['CHANGELOG.md', 'src/core/allowlist.ts'])).toEqual([
      'src/core/allowlist.ts',
    ]);
  });
  it('returns an empty list when every path is allowed', () => {
    expect(releaseSweepOffenders(['CHANGELOG.md', 'docs/sdd-report.md'])).toEqual([]);
  });
});

describe('isReleaseSweepAllowed', () => {
  it('admits graphify outputs', () => {
    expect(isReleaseSweepAllowed(['graphify-out/graph.json'])).toBe(true);
    expect(isReleaseSweepAllowed(['graphify-out/GRAPH_REPORT.md'])).toBe(true);
  });

  it('admits sdd-report + release-notes + CHANGELOG', () => {
    expect(isReleaseSweepAllowed(['docs/sdd-report.md'])).toBe(true);
    expect(isReleaseSweepAllowed(['docs/release-notes.md'])).toBe(true);
    expect(isReleaseSweepAllowed(['CHANGELOG.md'])).toBe(true);
  });

  it('admits docs:build typedoc output (md only)', () => {
    expect(isReleaseSweepAllowed(['docs/user/reference/api/index.md'])).toBe(true);
    expect(isReleaseSweepAllowed(['docs/user/reference/api/sub/foo.md'])).toBe(true);
  });

  it('admits framework + feature MD drift', () => {
    expect(isReleaseSweepAllowed(['docs/noldor/release.md'])).toBe(true);
    expect(isReleaseSweepAllowed(['docs/features/example.md'])).toBe(true);
  });

  it('admits templates/docs twin drift (release-markers stamps both sides)', () => {
    expect(isReleaseSweepAllowed(['templates/docs/noldor/release.md'])).toBe(true);
    expect(
      isReleaseSweepAllowed(['docs/noldor/release.md', 'templates/docs/noldor/release.md']),
    ).toBe(true);
  });

  it('rejects non-md files under templates/docs', () => {
    expect(isReleaseSweepAllowed(['templates/docs/noldor/diagram.svg'])).toBe(false);
  });

  it('rejects non-md typedoc output (json/html) under docs/user/reference/api', () => {
    expect(isReleaseSweepAllowed(['docs/user/reference/api/data.json'])).toBe(false);
    expect(isReleaseSweepAllowed(['docs/user/reference/api/index.html'])).toBe(false);
  });

  it('rejects unrelated docs paths (e.g. docs/marketing/) not in tightened globs', () => {
    expect(isReleaseSweepAllowed(['docs/marketing/anything.md'])).toBe(false);
  });

  it('rejects non-md files in plans/specs dirs (consistency with rest of allowlist)', () => {
    expect(isReleaseSweepAllowed(['docs/design/plans/2026-05-17-foo.json'])).toBe(false);
    expect(isReleaseSweepAllowed(['docs/design/specs/2026-05-17-foo.ts'])).toBe(false);
  });

  it('admits design plans + specs under docs/design/', () => {
    expect(isReleaseSweepAllowed(['docs/design/plans/2026-05-17-foo.md'])).toBe(true);
    expect(isReleaseSweepAllowed(['docs/design/specs/2026-05-17-foo-design.md'])).toBe(true);
  });

  it('admits self-edits to .claude/skills/noldor-release-sweep/SKILL.md', () => {
    expect(isReleaseSweepAllowed(['.claude/skills/noldor-release-sweep/SKILL.md'])).toBe(true);
  });

  it('rejects source code', () => {
    expect(isReleaseSweepAllowed(['packages/noldor/src/core/session.ts'])).toBe(false);
    expect(isReleaseSweepAllowed(['packages/engine/src/foo.ts'])).toBe(false);
    expect(isReleaseSweepAllowed(['apps/web/src/main.tsx'])).toBe(false);
  });

  it('rejects when one of multiple paths is out-of-allowlist', () => {
    expect(isReleaseSweepAllowed(['graphify-out/graph.json', 'packages/engine/src/foo.ts'])).toBe(
      false,
    );
  });

  it('rejects empty input', () => {
    expect(isReleaseSweepAllowed([])).toBe(false);
  });

  it('exposes the canonical glob list', () => {
    expect(RELEASE_SWEEP_GLOBS).toContain('graphify-out/**');
  });
});

describe('isBookkeepingOnly', () => {
  it('accepts each bookkeeping surface', () => {
    expect(isBookkeepingOnly(['docs/roadmap.md'])).toBe(true);
    expect(isBookkeepingOnly(['docs/backlog.md'])).toBe(true);
    expect(isBookkeepingOnly(['docs/features/some-feature.md'])).toBe(true);
    expect(isBookkeepingOnly(['docs/design/specs/2026-08-13-x-design.md'])).toBe(true);
    expect(isBookkeepingOnly(['docs/milestones/poc.md'])).toBe(true);
    expect(isBookkeepingOnly(['ideas.md'])).toBe(true);
    expect(isBookkeepingOnly(['.noldor/retired-entry-ids.json'])).toBe(true);
    expect(isBookkeepingOnly(['.noldor/id-counter.json'])).toBe(true);
    expect(isBookkeepingOnly(['.noldor/design/some-slug.md'])).toBe(true);
  });

  // The scaffold trio a `/noldor-gate` spec commit actually stages — the shape
  // that would otherwise be forced to author a Why/How/What body.
  it('accepts the real spec-commit trio', () => {
    expect(
      isBookkeepingOnly([
        '.noldor/id-counter.json',
        'docs/design/specs/2026-08-13-pr-summary-body-enforcement-design.md',
        'docs/features/pr-summary-body-enforcement.md',
      ]),
    ).toBe(true);
  });

  it('rejects a mixed set — one code file taints all', () => {
    expect(isBookkeepingOnly(['docs/roadmap.md', 'src/core/allowlist.ts'])).toBe(false);
  });

  it('rejects docs/noldor pages — prose, but not bookkeeping', () => {
    expect(isBookkeepingOnly(['docs/noldor/pr-flow.md'])).toBe(false);
  });

  // An empty set proves nothing; callers decide what emptiness means.
  it('returns false for an empty set', () => {
    expect(isBookkeepingOnly([])).toBe(false);
  });
});

describe('isRetirementOnly', () => {
  it('accepts the roadmap alone', () => {
    expect(isRetirementOnly(['docs/roadmap.md'])).toBe(true);
  });

  // Post-Q-0107 shape: remove-block records the retired ID beside the removal.
  it('accepts the roadmap + retired-ID pair', () => {
    expect(isRetirementOnly(['docs/roadmap.md', '.noldor/retired-entry-ids.json'])).toBe(true);
  });

  it('rejects the pair plus a code file', () => {
    expect(
      isRetirementOnly([
        'docs/roadmap.md',
        '.noldor/retired-entry-ids.json',
        'src/core/framework-skew.ts',
      ]),
    ).toBe(false);
  });

  it('rejects other bookkeeping — an FD edit is not a retirement', () => {
    expect(isRetirementOnly(['docs/features/some-feature.md'])).toBe(false);
  });

  it('returns false for an empty set', () => {
    expect(isRetirementOnly([])).toBe(false);
  });
});

describe('touchesCode', () => {
  it('accepts source and executable surfaces', () => {
    expect(touchesCode(['src/core/allowlist.ts'])).toBe(true);
    expect(touchesCode(['bin/noldor.mjs'])).toBe(true);
    expect(touchesCode(['.github/workflows/publish.yml'])).toBe(true);
    expect(touchesCode(['.noldor/rules/pr-summary-why-how-what.md'])).toBe(true);
    expect(touchesCode(['package.json'])).toBe(true);
  });

  // Also a MICRO_CHORE_GLOBS member — lane membership is not the criterion.
  it('accepts root lefthook.yml despite its micro-chore lane', () => {
    expect(touchesCode(['lefthook.yml'])).toBe(true);
    expect(MICRO_CHORE_GLOBS).toContain('lefthook.yml');
  });

  it('rejects prose that is neither bookkeeping nor code', () => {
    expect(touchesCode(['docs/noldor/pr-flow.md'])).toBe(false);
    expect(touchesCode(['README.md'])).toBe(false);
  });

  it('rejects the template prose twins', () => {
    expect(touchesCode(['templates/docs/noldor/pr-flow.md'])).toBe(false);
    expect(touchesCode(['templates/.claude/skills/noldor-gate/SKILL.md'])).toBe(false);
    expect(touchesCode(['templates/.opencode/command/noldor-gate.md'])).toBe(false);
    expect(touchesCode(['templates/AGENTS.md'])).toBe(false);
  });

  it('accepts templates outside the prose exclusions', () => {
    expect(touchesCode(['templates/lefthook/noldor.yml'])).toBe(true);
  });

  it('accepts a mixed set — one code file is enough', () => {
    expect(touchesCode(['docs/noldor/pr-flow.md', 'src/core/pr-flow.ts'])).toBe(true);
  });

  it('returns false for an empty set', () => {
    expect(touchesCode([])).toBe(false);
  });
});

describe('isNoReviewLaneAllowed', () => {
  it('accepts a diff wholly inside the micro-chore lane', () => {
    expect(isNoReviewLaneAllowed(['docs/foo.md', 'ideas.md'])).toBe(true);
  });

  it('accepts a diff wholly inside the release-sweep lane', () => {
    expect(isNoReviewLaneAllowed(['graphify-out/graph.json', 'docs/sdd-report.md'])).toBe(true);
  });

  // The v1.4.0 sweep squash (PR #354): one micro-chore `ideas.md` commit plus
  // three sweep commits. Neither lane predicate covers it alone, and an `||` of
  // the two cannot either — each half of the diff fails the other's predicate.
  it('accepts a squash mixing both no-review lanes', () => {
    const mixed = ['ideas.md', 'graphify-out/graph.json'];
    expect(isMicroChoreAllowed(mixed)).toBe(false);
    expect(isReleaseSweepAllowed(mixed)).toBe(false);
    expect(isNoReviewLaneAllowed(mixed)).toBe(true);
  });

  it('rejects a set carrying source code', () => {
    expect(isNoReviewLaneAllowed(['graphify-out/graph.json', 'src/core/session.ts'])).toBe(false);
    expect(isNoReviewLaneAllowed(['ideas.md', 'templates/src/foo.ts'])).toBe(false);
  });

  it('rejects empty input', () => {
    expect(isNoReviewLaneAllowed([])).toBe(false);
  });
});
