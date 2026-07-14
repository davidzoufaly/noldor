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
  it('resolves reviewer (canonical)', () => {
    expect(inferLaneFromFilename('foo-code-reviewer.json')).toBe('reviewer');
  });
  it('resolves verifier (canonical)', () => {
    expect(inferLaneFromFilename('foo-code-verifier.json')).toBe('verifier');
  });
  it('resolves legacy -subagent.json to reviewer (pre-0.7.0 sink)', () => {
    expect(inferLaneFromFilename('foo-code-subagent.json')).toBe('reviewer');
  });
  it('resolves legacy -verify.json to verifier (pre-0.7.0 sink)', () => {
    expect(inferLaneFromFilename('foo-code-verify.json')).toBe('verifier');
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
