import { describe, expect, it } from 'vitest';
import { pathToStage, type Stage } from '../stage.js';

describe('pathToStage', () => {
  it('maps code-producing paths to "code"', () => {
    for (const p of [
      'micro-chore',
      'fast-track',
      'full-new',
      'full-attach',
      'specs-only-new',
      'specs-only-attach',
    ] as const) {
      expect(pathToStage(p)).toBe('code');
    }
  });

  it('maps release paths to "release"', () => {
    expect(pathToStage('release-sweep')).toBe('release');
    expect(pathToStage('release-automation')).toBe('release');
  });

  it('Stage type includes triage and review for explicit callers', () => {
    const stages: Stage[] = ['triage', 'code', 'review', 'release'];
    expect(stages).toHaveLength(4);
  });
});
