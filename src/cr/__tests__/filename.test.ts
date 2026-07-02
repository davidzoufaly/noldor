// @tests: acceptance-verify-lane, specs-cr-gate-multi-reviewer
import { describe, expect, it } from 'vitest';
import { inferLaneFromFilename } from '../filename.js';

describe('inferLaneFromFilename', () => {
  it('resolves manual', () => {
    expect(inferLaneFromFilename('foo-spec-manual.json')).toBe('manual');
  });
  it('resolves codex', () => {
    expect(inferLaneFromFilename('foo-plan-codex.json')).toBe('codex');
  });
  it('resolves subagent', () => {
    expect(inferLaneFromFilename('foo-code-subagent.json')).toBe('subagent');
  });
  it('resolves standalone', () => {
    expect(inferLaneFromFilename('foo-spec-standalone.json')).toBe('standalone');
  });
  it('handles hyphenated slugs', () => {
    expect(inferLaneFromFilename('multi-word-slug-spec-manual.json')).toBe('manual');
  });
  it('returns null on non-conforming', () => {
    expect(inferLaneFromFilename('random.json')).toBeNull();
    expect(inferLaneFromFilename('foo-spec-unknown.json')).toBeNull();
    expect(inferLaneFromFilename('foo-spec-manual.txt')).toBeNull();
  });
});
