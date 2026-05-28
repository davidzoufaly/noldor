import { describe, expect, it } from 'vitest';
import {
  isMicroChoreAllowed,
  MICRO_CHORE_GLOBS,
  isReleaseSweepAllowed,
  RELEASE_SWEEP_GLOBS,
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
    expect(isMicroChoreAllowed(['lefthook.yml', '.claude/skills/gate/SKILL.md'])).toBe(true);
  });
  it('rejects lefthook.yml + code file (tainted)', () => {
    expect(isMicroChoreAllowed(['lefthook.yml', 'packages/web/src/foo.ts'])).toBe(false);
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

  it('rejects non-md typedoc output (json/html) under docs/user/reference/api', () => {
    expect(isReleaseSweepAllowed(['docs/user/reference/api/data.json'])).toBe(false);
    expect(isReleaseSweepAllowed(['docs/user/reference/api/index.html'])).toBe(false);
  });

  it('rejects unrelated docs paths (e.g. docs/marketing/) not in tightened globs', () => {
    expect(isReleaseSweepAllowed(['docs/marketing/anything.md'])).toBe(false);
  });

  it('rejects non-md files in plans/specs dirs (consistency with rest of allowlist)', () => {
    expect(isReleaseSweepAllowed(['docs/superpowers/plans/2026-05-17-foo.json'])).toBe(false);
    expect(isReleaseSweepAllowed(['docs/superpowers/specs/2026-05-17-foo.ts'])).toBe(false);
  });

  it('admits superpowers plans + specs', () => {
    expect(isReleaseSweepAllowed(['docs/superpowers/plans/2026-05-17-foo.md'])).toBe(true);
    expect(isReleaseSweepAllowed(['docs/superpowers/specs/2026-05-17-foo-design.md'])).toBe(true);
  });

  it('admits self-edits to .claude/skills/release-sweep/SKILL.md', () => {
    expect(isReleaseSweepAllowed(['.claude/skills/release-sweep/SKILL.md'])).toBe(true);
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
