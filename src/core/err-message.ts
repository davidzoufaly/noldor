// @tests: ui-design-review-lane
// Message text for a caught value of unknown type. Lives in core because it is
// not about any one domain: a resolver, a lane, a CLI all catch `unknown` and all
// need a diagnostic string rather than `(err as Error).message`, which is
// `undefined` exactly when something unusual was thrown.

/**
 * Never throws, and never returns an empty string.
 *
 * The whole body is guarded: `String(err)` and `JSON.stringify(err)` both invoke
 * user-controlled coercion (`Symbol.toPrimitive`, a getter, a Proxy trap), so a
 * hostile or merely circular value could otherwise escape from inside the error
 * path — leaving a caller that was writing a failure record with no record.
 */
export function errMessage(err: unknown): string {
  try {
    if (err instanceof Error) {
      // An Error with an empty message still identifies itself by name; falling
      // through to JSON.stringify would yield `{}`, since Error's own
      // properties are non-enumerable.
      return err.message === '' ? `${err.name} (no message)` : err.message;
    }
    if (typeof err === 'string') return err === '' ? 'empty string throw' : err;
    const json = JSON.stringify(err);
    if (json !== undefined) return `non-Error throw: ${json}`;
    return `non-Error throw: ${typeof err}`;
  } catch {
    return 'non-Error throw: value could not be described';
  }
}
