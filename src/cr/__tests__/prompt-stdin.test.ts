// @tests: acceptance-verify-lane, specs-cr-gate-multi-reviewer
import { describe, expect, it, vi } from 'vitest';

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(async () => 'user-answer'),
  select: vi.fn(async ({ choices }: { choices: Array<{ value: string }> }) => choices[0].value),
}));

import { promptSelect, promptText } from '../prompt-stdin.js';

describe('promptText', () => {
  it('returns inquirer input result', async () => {
    expect(await promptText({ message: 'q' })).toBe('user-answer');
  });
});

describe('promptSelect', () => {
  it('returns first choice value (mocked)', async () => {
    expect(
      await promptSelect({
        message: 'pick',
        choices: [
          { name: 'A', value: 'a' },
          { name: 'B', value: 'b' },
        ],
      }),
    ).toBe('a');
  });
});
