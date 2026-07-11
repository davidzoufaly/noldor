// @tests: noldor-native-wait-primitive
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { getPath, parsePredicate, evalPredicate, waitUntil, PredicateParseError } from '../wait.js';

describe('getPath', () => {
  it('resolves a top-level key', () => {
    expect(getPath({ phase: 'idle' }, 'phase')).toBe('idle');
  });
  it('resolves a nested key', () => {
    expect(getPath({ a: { b: 1 } }, 'a.b')).toBe(1);
  });
  it('indexes arrays with numeric segments', () => {
    expect(getPath({ xs: [10, 20] }, 'xs.1')).toBe(20);
    expect(getPath({ blockers: [{ m: 'x' }] }, 'blockers.0.m')).toBe('x');
  });
  it('resolves kebab-case keys', () => {
    expect(getPath({ retries: { 'my-feature': 3 } }, 'retries.my-feature')).toBe(3);
  });
  it('returns undefined for a missing path', () => {
    expect(getPath({ a: 1 }, 'a.b')).toBeUndefined();
    expect(getPath({}, 'phase')).toBeUndefined();
  });
  it('is null-safe on null roots and null intermediates', () => {
    expect(getPath(null, 'a')).toBeUndefined();
    expect(getPath({ a: null }, 'a.b')).toBeUndefined();
  });
});

describe('parsePredicate', () => {
  it('parses an exists predicate (trailing ?)', () => {
    expect(parsePredicate('finishedAt?')).toEqual({ kind: 'exists', path: 'finishedAt' });
    expect(parsePredicate('blockers.0?')).toEqual({ kind: 'exists', path: 'blockers.0' });
  });
  it('parses an eq predicate', () => {
    expect(parsePredicate('phase==idle')).toEqual({ kind: 'eq', path: 'phase', literal: 'idle' });
  });
  it('parses a neq predicate', () => {
    expect(parsePredicate('phase!=spawning')).toEqual({
      kind: 'neq',
      path: 'phase',
      literal: 'spawning',
    });
  });
  it('trims whitespace around dotpath and literal', () => {
    expect(parsePredicate('phase == idle')).toEqual({ kind: 'eq', path: 'phase', literal: 'idle' });
  });
  it('admits kebab-case dotpath segments', () => {
    expect(parsePredicate('retries.my-feature==3')).toEqual({
      kind: 'eq',
      path: 'retries.my-feature',
      literal: '3',
    });
  });
  it('splits on the leftmost operator; literal is unconstrained', () => {
    expect(parsePredicate('a!=b==c')).toEqual({ kind: 'neq', path: 'a', literal: 'b==c' });
    expect(parsePredicate('a!==b')).toEqual({ kind: 'neq', path: 'a', literal: '=b' });
  });
  it('throws on a bare dotpath with no operator', () => {
    expect(() => parsePredicate('phase')).toThrow(PredicateParseError);
  });
  it('throws on a single = (not ==)', () => {
    expect(() => parsePredicate('phase=idle')).toThrow(PredicateParseError);
  });
  it('throws when the dotpath carries a stray operator (phase==idle?)', () => {
    // trailing ? routes to exists branch -> path "phase==idle" has "=" -> rejected
    expect(() => parsePredicate('phase==idle?')).toThrow(PredicateParseError);
  });
  it('throws when the dotpath contains whitespace', () => {
    expect(() => parsePredicate('a b==c')).toThrow(PredicateParseError);
    expect(() => parsePredicate('foo bar baz')).toThrow(PredicateParseError);
  });
  it('throws on empty input', () => {
    expect(() => parsePredicate('')).toThrow(PredicateParseError);
  });
});

describe('evalPredicate', () => {
  it('eq matches an equal scalar', () => {
    expect(evalPredicate(parsePredicate('phase==idle'), { phase: 'idle' })).toBe(true);
  });
  it('eq does not match a different scalar', () => {
    expect(evalPredicate(parsePredicate('phase==idle'), { phase: 'spawning' })).toBe(false);
  });
  it('eq coerces numbers and booleans via String()', () => {
    expect(evalPredicate(parsePredicate('shipped==3'), { shipped: 3 })).toBe(true);
    expect(evalPredicate(parsePredicate('fullReview==true'), { fullReview: true })).toBe(true);
  });
  it('eq/neq short-circuit to false on an absent path (no false terminal)', () => {
    expect(evalPredicate(parsePredicate('phase==idle'), {})).toBe(false);
    expect(evalPredicate(parsePredicate('phase!=spawning'), {})).toBe(false);
    expect(evalPredicate(parsePredicate('phase==undefined'), {})).toBe(false);
  });
  it('eq/neq short-circuit to false when the resolved value is null', () => {
    expect(evalPredicate(parsePredicate('phase!=spawning'), { phase: null })).toBe(false);
  });
  it('neq matches a present, different scalar', () => {
    expect(evalPredicate(parsePredicate('phase!=spawning'), { phase: 'idle' })).toBe(true);
  });
  it('exists is true only when the path resolves to a non-null value', () => {
    expect(evalPredicate(parsePredicate('finishedAt?'), { finishedAt: '2026' })).toBe(true);
    expect(evalPredicate(parsePredicate('finishedAt?'), {})).toBe(false);
    expect(evalPredicate(parsePredicate('finishedAt?'), { finishedAt: null })).toBe(false);
  });
  it('exists over an array index reflects presence of an element', () => {
    expect(evalPredicate(parsePredicate('blockers.0?'), { blockers: [{ m: 'x' }] })).toBe(true);
    expect(evalPredicate(parsePredicate('blockers.0?'), { blockers: [] })).toBe(false);
  });
  it('compares a non-scalar via String() (defined, per spec)', () => {
    expect(evalPredicate(parsePredicate('xs==a,b'), { xs: ['a', 'b'] })).toBe(true);
  });
});

describe('waitUntil', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const until = (s: string) => parsePredicate(s);

  it('returns matched immediately when the first poll satisfies --until', async () => {
    const r = await waitUntil({
      read: () => ({ phase: 'idle' }),
      until: until('phase==idle'),
      intervalMs: 1000,
      timeoutMs: 5000,
    });
    expect(r.outcome).toBe('matched');
    expect((r as { snapshot: unknown }).snapshot).toEqual({ phase: 'idle' });
  });

  it('polls (does not one-shot) until --until matches', async () => {
    let n = 0;
    const read = () => {
      n += 1;
      return n >= 3 ? { phase: 'idle' } : { phase: 'spawning' };
    };
    const p = waitUntil({ read, until: until('phase==idle'), intervalMs: 1000, timeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(5000);
    const r = await p;
    expect(r.outcome).toBe('matched');
    expect(n).toBe(3);
  });

  it('returns failed when --fail-if matches', async () => {
    const r = await waitUntil({
      read: () => ({ finishedAt: '2026', blockers: [{ m: 'bug' }] }),
      until: until('finishedAt?'),
      failIf: until('blockers.0?'),
      intervalMs: 1000,
      timeoutMs: 5000,
    });
    expect(r.outcome).toBe('failed');
  });

  it('--fail-if wins when both --until and --fail-if match the same snapshot', async () => {
    // finishedAt present AND blockers present -> failed, not matched
    const r = await waitUntil({
      read: () => ({ finishedAt: '2026', blockers: [{ m: 'bug' }] }),
      until: until('finishedAt?'),
      failIf: until('blockers.0?'),
      intervalMs: 1000,
      timeoutMs: 5000,
    });
    expect(r.outcome).toBe('failed');
  });

  it('times out when no predicate matches; everReadable true when the file was readable', async () => {
    const p = waitUntil({
      read: () => ({ phase: 'spawning' }),
      until: until('phase==idle'),
      intervalMs: 1000,
      timeoutMs: 5000,
    });
    const caught = p;
    await vi.advanceTimersByTimeAsync(6000);
    const r = await caught;
    expect(r.outcome).toBe('timeout');
    expect((r as { everReadable: boolean }).everReadable).toBe(true);
  });

  it('times out with everReadable false when the file never became readable', async () => {
    const p = waitUntil({
      read: () => null,
      until: until('phase==idle'),
      intervalMs: 1000,
      timeoutMs: 5000,
    });
    const caught = p;
    await vi.advanceTimersByTimeAsync(6000);
    const r = await caught;
    expect(r.outcome).toBe('timeout');
    expect((r as { everReadable: boolean }).everReadable).toBe(false);
  });

  it('handles a startup race: missing file first, then it appears', async () => {
    let n = 0;
    const read = () => {
      n += 1;
      return n >= 2 ? { phase: 'idle' } : null;
    };
    const p = waitUntil({ read, until: until('phase==idle'), intervalMs: 1000, timeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(3000);
    const r = await p;
    expect(r.outcome).toBe('matched');
  });

  it('timeoutMs 0 disables the timeout (polls forever until match)', async () => {
    let idle = false;
    const read = () => (idle ? { phase: 'idle' } : { phase: 'spawning' });
    const p = waitUntil({ read, until: until('phase==idle'), intervalMs: 1000, timeoutMs: 0 });
    // advance well past any normal timeout — must still be waiting
    await vi.advanceTimersByTimeAsync(3_600_000);
    idle = true;
    await vi.advanceTimersByTimeAsync(1000);
    const r = await p;
    expect(r.outcome).toBe('matched');
  });

  it('invokes onPoll with the snapshot each poll', async () => {
    const seen: unknown[] = [];
    let n = 0;
    const read = () => {
      n += 1;
      return n >= 2 ? { phase: 'idle' } : { phase: 'spawning' };
    };
    const p = waitUntil({
      read,
      until: until('phase==idle'),
      intervalMs: 1000,
      timeoutMs: 60_000,
      onPoll: (snap) => seen.push(snap),
    });
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[0]).toEqual({ phase: 'spawning' });
  });
});
