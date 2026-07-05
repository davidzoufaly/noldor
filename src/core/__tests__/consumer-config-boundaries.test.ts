// @tests: self-boundaries-declaration-and-cycle-break

import { BoundaryRuleSchema } from '../consumer-config.js';

describe('BoundaryRuleSchema', () => {
  it('parses the canonical no-cycle backstop rule (empty from, circular to)', () => {
    const rule = {
      name: 'no-module-cycles',
      severity: 'error',
      from: {},
      to: { circular: true },
    };
    const parsed = BoundaryRuleSchema.parse(rule);
    expect(parsed.to.circular).toBe(true);
    expect(parsed.from.path).toBeUndefined();
  });

  it('still parses the classic directional shape', () => {
    const rule = {
      name: 'core-is-foundation',
      severity: 'error',
      from: { path: '^src/core' },
      to: { path: '^src/cr' },
    };
    expect(BoundaryRuleSchema.parse(rule)).toStrictEqual(rule);
  });

  it('rejects a rule whose `to` side constrains nothing', () => {
    const rule = { name: 'vacuous', severity: 'error', from: { path: '^src/core' }, to: {} };
    expect(() => BoundaryRuleSchema.parse(rule)).toThrow(/must constrain/);
  });
});
