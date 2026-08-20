// @tests: ui-design-review-lane
import { describe, expect, it } from 'vitest';

import { errMessage } from '../err-message.js';

describe('errMessage', () => {
  it('uses an Error message when there is one', () => {
    expect(errMessage(new Error('boom'))).toBe('boom');
  });

  it('names an Error that carries no message instead of stringifying it to {}', () => {
    // Error's own properties are non-enumerable, so JSON.stringify yields `{}` —
    // a detail that tells the reader nothing.
    expect(errMessage(new Error())).toBe('Error (no message)');
    expect(errMessage(new TypeError())).toBe('TypeError (no message)');
  });

  it('passes a thrown string through, and labels an empty one', () => {
    expect(errMessage('plain rejection')).toBe('plain rejection');
    expect(errMessage('')).toBe('empty string throw');
  });

  it('serializes a non-Error value', () => {
    expect(errMessage({ code: 7 })).toBe('non-Error throw: {"code":7}');
  });

  it('describes a value JSON.stringify cannot represent', () => {
    expect(errMessage(undefined)).toBe('non-Error throw: undefined');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(errMessage(circular)).toContain('non-Error throw');
  });

  it('never throws, even on a value whose coercion is hostile', () => {
    // The point of the guard: this used to escape from inside an error path and
    // leave the caller unable to write its failure record at all.
    const hostile = {
      get [Symbol.toPrimitive]() {
        throw new Error('nope');
      },
      toJSON() {
        throw new Error('nope');
      },
    };
    expect(() => errMessage(hostile)).not.toThrow();
    expect(errMessage(hostile)).toContain('could not be described');
  });

  it('ignores a non-string message on an Error instance', () => {
    // `message` is typed string but not enforced at runtime; returning it raw
    // would hand the caller a non-string where its sink schema demands text.
    const weird = Object.assign(new Error('x'), { message: { not: 'a string' } });
    expect(errMessage(weird)).toBe('Error (no message)');
  });

  it('always returns a string', () => {
    const weird = Object.assign(new TypeError(), { message: 42 });
    expect(typeof errMessage(weird)).toBe('string');
    expect(errMessage(weird)).toBe('TypeError (no message)');
  });

  it('never returns an empty string', () => {
    for (const v of [undefined, null, '', 0, false, new Error(), {}, []]) {
      expect(errMessage(v).length).toBeGreaterThan(0);
    }
  });
});
