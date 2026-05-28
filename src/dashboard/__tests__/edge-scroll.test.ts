// @tests: dashboard-roadmap-backlog-polish

import { describe, expect, it } from 'vitest';

import { edgeScrollVelocity, shouldInsertBefore } from '../static/drag.js';

describe('edgeScrollVelocity', () => {
  // Task 3 — auto-scroll math. The HTML5 `dragover` event only fires on
  // cursor motion; the drag.ts module decouples target velocity (computed
  // here from cursor proximity to the viewport edge) from actual scrolling
  // (driven by a rAF loop). This pure helper is trivially testable; the
  // rAF loop is verified by manual smoke test (see plan Task 3).
  const viewportHeight = 800;
  const threshold = 80;
  const maxSpeed = 16;

  it('returns 0 when cursor is in the middle of the viewport', () => {
    expect(edgeScrollVelocity(400, viewportHeight, threshold, maxSpeed)).toBe(0);
  });

  it('returns 0 exactly at the threshold boundary (top)', () => {
    expect(edgeScrollVelocity(threshold, viewportHeight, threshold, maxSpeed)).toBe(0);
  });

  it('returns 0 exactly at the threshold boundary (bottom)', () => {
    expect(
      edgeScrollVelocity(viewportHeight - threshold, viewportHeight, threshold, maxSpeed),
    ).toBe(0);
  });

  it('returns negative value when cursor is inside the top threshold', () => {
    const v = edgeScrollVelocity(20, viewportHeight, threshold, maxSpeed);
    expect(v).toBeLessThan(0);
    // Linearly interpolated — at clientY=20, with threshold=80, ratio = (80-20)/80 = 0.75.
    // Expected: -0.75 * maxSpeed = -12.
    expect(v).toBeCloseTo(-12, 5);
  });

  it('returns -maxSpeed at the very top edge (clientY=0)', () => {
    expect(edgeScrollVelocity(0, viewportHeight, threshold, maxSpeed)).toBe(-maxSpeed);
  });

  it('returns positive value when cursor is inside the bottom threshold', () => {
    // clientY = viewportHeight - 20 = 780; bottom threshold zone is 720..800.
    // ratio = (780 - 720) / 80 = 0.75 → expected +12.
    const v = edgeScrollVelocity(780, viewportHeight, threshold, maxSpeed);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeCloseTo(12, 5);
  });

  it('returns +maxSpeed at the very bottom edge (clientY=viewportHeight)', () => {
    expect(edgeScrollVelocity(viewportHeight, viewportHeight, threshold, maxSpeed)).toBe(maxSpeed);
  });

  it('returns -maxSpeed when clientY is negative (above viewport)', () => {
    expect(edgeScrollVelocity(-50, viewportHeight, threshold, maxSpeed)).toBe(-maxSpeed);
  });

  it('returns +maxSpeed when clientY is below viewport', () => {
    expect(edgeScrollVelocity(viewportHeight + 50, viewportHeight, threshold, maxSpeed)).toBe(
      maxSpeed,
    );
  });
});

describe('shouldInsertBefore', () => {
  const rect = { top: 100, height: 40 }; // row spans Y=100..140

  it('non-first row: cursor in top half → insert before', () => {
    expect(shouldInsertBefore(rect, 110, false)).toBe(true);
  });

  it('non-first row: cursor in bottom half → insert after', () => {
    expect(shouldInsertBefore(rect, 130, false)).toBe(false);
  });

  it('non-first row: cursor exactly at midpoint → insert after (strict <)', () => {
    expect(shouldInsertBefore(rect, 120, false)).toBe(false);
  });

  it('first row: cursor in top half → insert before', () => {
    expect(shouldInsertBefore(rect, 105, true)).toBe(true);
  });

  it('first row: cursor in bottom half → insert before (expanded zone)', () => {
    expect(shouldInsertBefore(rect, 135, true)).toBe(true);
  });

  it('first row: cursor at row bottom → insert after (strict <)', () => {
    expect(shouldInsertBefore(rect, 140, true)).toBe(false);
  });

  it('first row: cursor past row bottom → insert after', () => {
    expect(shouldInsertBefore(rect, 150, true)).toBe(false);
  });
});
