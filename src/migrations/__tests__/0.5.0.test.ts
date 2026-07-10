import { describe, it, expect } from 'vitest';
import { migration_0_5_0 } from '../0.5.0.js';
import { resolveChain } from '../chain.js';
import { migration_0_4_0 } from '../0.4.0.js';
import { migration_0_6_0 } from '../0.6.0.js';

describe('migration_0_5_0 bridge', () => {
  it('is a no-op anchor from 0.4.0', () => {
    expect(migration_0_5_0.from).toBe('0.4.0');
    expect(migration_0_5_0.to).toBe('0.5.0');
    expect(migration_0_5_0.migrate(process.cwd(), {} as never)).toEqual([]);
  });
  it('keeps the chain contiguous 0.4.0 -> 0.6.0', () => {
    const chain = resolveChain(
      [migration_0_4_0, migration_0_5_0, migration_0_6_0],
      '0.4.0',
      '0.6.0',
    );
    expect(chain.map((m) => m.to)).toEqual(['0.5.0', '0.6.0']);
  });
});
